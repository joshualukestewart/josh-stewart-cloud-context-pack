#!/usr/bin/env node
/**
 * scripts/build-release.mjs
 *
 * Builds this pack's release artefacts into dist/ (gitignored), with no
 * dependencies: Node >=20 built-ins plus scripts/lib/zip.mjs, a minimal
 * deterministic ZIP writer.
 *
 * Outputs:
 *   dist/<name>-<version>.zip   sorted, allow-listed pack content with
 *                               fixed timestamps, plus an in-archive
 *                               release-manifest.json inventory (path,
 *                               size, sha256 for every other entry)
 *   dist/current.json           the delivery site's release pointer
 *   dist/SHA256SUMS             checksums for the artefacts above
 *   dist/PRERELEASE             only in --pre-release mode, explaining
 *                               which gates were bypassed
 *
 * Release gates (all must pass; --pre-release downgrades them to warnings
 * and marks the output as not publishable):
 *   - git working tree is clean and has a commit
 *   - node scripts/validate-pack.mjs --release passes
 *   - node scripts/check-freshness.mjs passes offline (exit 0)
 *   - manifest knowledge fields are present, match sources.json's hash and
 *     are not overdue
 *   - manifest.release declares what the pack was tested with
 *
 * Never included: .git, dist, node_modules, caches, archives,
 * credential-shaped files, or anything outside the allow-list below. Log
 * files are excluded except synthetic evidence required by eval fixtures.
 *
 * Usage:
 *   node scripts/build-release.mjs [--pre-release] [--published-at=<iso>]
 *                                  [--out=dist] [--store] [--json] [--help]
 *
 * Exit codes: 0 = built, 1 = a gate failed or the build is invalid.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  ALWAYS_EXCLUDED,
  REPO_ROOT,
  SITE_BLOB_PREFIX,
  SITE_CLAIM_LIST_MAX,
  SITE_KNOWN_TOOLS,
  SITE_PACK_ID,
  byteCompare,
  isDirectory,
  isFile,
  isMain,
  isScratchDir,
  listFiles,
  readJson,
  readPackMetadata,
  sha256Hex,
} from './lib/pack-lib.mjs';
import { createZip, verifyZip } from './lib/zip.mjs';

/** Identifier the delivery site validates; must not drift. */
const PACK_ID = SITE_PACK_ID;
const MAX_RELEASE_BYTES = 100_000_000;
const MAX_CONTRACT_LIST = SITE_CLAIM_LIST_MAX;
const SITE_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const BLOB_NAME_PATTERN = /^[0-9A-Za-z._/-]+$/;
const INVENTORY_ENTRY = 'release-manifest.json';

/** Files shipped verbatim from the repository root. */
const ROOT_FILES = [
  '.mcp.json',
  '.vscode/mcp.json',
  '.github/copilot-instructions.md',
  'AGENTS.md',
  'CHANGELOG.md',
  'CLAUDE.md',
  'COMPATIBILITY.md',
  'FRESHNESS.md',
  'GEMINI.md',
  'LICENSE',
  'NOTICE',
  'README.md',
  'VERSION',
  'manifest.json',
  'package.json',
  'sources.json',
  'sources.schema.json',
];

/** Directories shipped in full (subject to the exclusions below). */
const CONTENT_DIRS = [
  '.agents/skills',
  '.claude/rules',
  '.claude/skills',
  '.github/instructions',
  '.github/skills',
  'evals',
  'examples',
  'references',
  'scripts',
];

const EXCLUDED_EXTENSIONS = new Set(['.zip', '.tgz', '.tar', '.gz', '.7z', '.rar', '.log', '.pem', '.pfx', '.p12', '.key']);
const EXCLUDED_BASENAMES = [/^\.env(\..+)?$/i, /^id_rsa$/i, /^\.freshness-cache\.json$/i, /^freshness-report\./i];

// ---------------------------------------------------------------------
// Gate helpers
// ---------------------------------------------------------------------

function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: 'utf8', shell: false });
}

function gitState(repoRoot) {
  const status = run('git', ['status', '--porcelain'], repoRoot);
  if (status.error || status.status !== 0) {
    return { available: false, clean: false, commit: null, detail: status.stderr?.trim() || 'git is not available' };
  }
  const head = run('git', ['rev-parse', 'HEAD'], repoRoot);
  const commit = head.status === 0 ? head.stdout.trim() : null;
  return {
    available: true,
    clean: status.stdout.trim() === '',
    dirtyPaths: status.stdout.trim() === '' ? [] : status.stdout.trim().split(/\r?\n/),
    commit,
    detail: commit ? null : 'the repository has no commits yet',
  };
}

export function collectFiles(repoRoot) {
  const files = [];
  for (const rel of ROOT_FILES) {
    if (isFile(path.join(repoRoot, ...rel.split('/')))) files.push(rel);
  }
  for (const dir of CONTENT_DIRS) {
    const abs = path.join(repoRoot, ...dir.split('/'));
    if (!isDirectory(abs)) continue;
    for (const rel of listFiles(abs, { root: abs })) files.push(`${dir}/${rel}`);
  }
  return files
    .filter((rel) => {
      const segments = rel.split('/');
      const base = segments[segments.length - 1];
      if (ALWAYS_EXCLUDED.some((excluded) => rel === excluded || rel.startsWith(`${excluded}/`))) return false;
      // Defence in depth: listFiles already refuses to descend into tooling
      // scratch, so a scratch segment here means something changed upstream.
      if (segments.slice(0, -1).some((segment) => isScratchDir(segment))) return false;
      const extension = path.posix.extname(rel).toLowerCase();
      const requiredEvalLog =
        extension === '.log' && rel.startsWith('evals/fixtures/');
      if (EXCLUDED_EXTENSIONS.has(extension) && !requiredEvalLog) return false;
      if (EXCLUDED_BASENAMES.some((pattern) => pattern.test(base))) return false;
      return true;
    })
    .sort(byteCompare);
}

/** Everything the delivery site validates, re-checked before writing dist/. */
export function validateSiteContract(current, { now = Date.now() } = {}) {
  const problems = [];
  if (current.packId !== PACK_ID) problems.push(`packId must be "${PACK_ID}"`);
  if (!SITE_VERSION_PATTERN.test(current.version)) problems.push(`version "${current.version}" is not MAJOR.MINOR.PATCH[-prerelease]`);
  if (!SHA256_PATTERN.test(current.sha256)) problems.push('sha256 must be 64 lower-case hex characters');
  if (!SHA256_PATTERN.test(current.sourceRegistrySha256)) problems.push('sourceRegistrySha256 must be 64 lower-case hex characters');
  if (!(current.sizeBytes > 0 && current.sizeBytes <= MAX_RELEASE_BYTES)) problems.push(`sizeBytes must be between 1 and ${MAX_RELEASE_BYTES}`);
  if (!/^https:\/\//.test(current.repositoryUrl ?? '')) problems.push('repositoryUrl must be an absolute https URL');
  const blob = current.blobName ?? '';
  if (
    blob.length <= 4 ||
    blob.length > 256 ||
    !blob.toLowerCase().endsWith('.zip') ||
    blob.startsWith('/') ||
    blob.includes('\\') ||
    !BLOB_NAME_PATTERN.test(blob) ||
    blob.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    problems.push(`blobName "${blob}" is not a safe blob path ending in .zip`);
  }
  // The site pins releases under releases/<version>/ so a pointer can never
  // reference a blob from another version's namespace.
  if (!blob.startsWith(`${SITE_BLOB_PREFIX}/${current.version}/`)) {
    problems.push(`blobName must start with "${SITE_BLOB_PREFIX}/${current.version}/"`);
  }

  const lists = {};
  for (const key of ['formallyTestedWith', 'adapterSupport']) {
    const value = current[key];
    if (!Array.isArray(value)) {
      problems.push(`${key} must be an array`);
      continue;
    }
    lists[key] = value;
    if (value.length > MAX_CONTRACT_LIST) problems.push(`${key} must have at most ${MAX_CONTRACT_LIST} entries`);
    if (value.some((item) => typeof item !== 'string' || item.trim() === '')) {
      problems.push(`${key} entries must be non-empty strings`);
      continue;
    }
    const unknown = value.filter((item) => !SITE_KNOWN_TOOLS.includes(item));
    if (unknown.length > 0) {
      problems.push(`${key} contains ${unknown.map((i) => `"${i}"`).join(', ')}; only ${SITE_KNOWN_TOOLS.join(', ')} are accepted`);
    }
    if (new Set(value).size !== value.length) problems.push(`${key} entries must be unique`);
  }
  if (Array.isArray(lists.formallyTestedWith) && Array.isArray(lists.adapterSupport)) {
    const overlap = lists.formallyTestedWith.filter((item) => lists.adapterSupport.includes(item));
    if (overlap.length > 0) {
      problems.push(`${overlap.map((i) => `"${i}"`).join(', ')} may not appear in both formallyTestedWith and adapterSupport`);
    }
  }

  const published = Date.parse(current.publishedAt);
  const reviewed = Date.parse(current.knowledgeReviewedAt);
  const due = Date.parse(current.reviewDueAt);
  if (Number.isNaN(published) || Number.isNaN(reviewed) || Number.isNaN(due)) {
    problems.push('publishedAt / knowledgeReviewedAt / reviewDueAt must be ISO-8601 timestamps');
  } else {
    if (published > now + 5 * 60 * 1000) problems.push('publishedAt must not be more than 5 minutes in the future');
    if (reviewed > published + 5 * 60 * 1000) problems.push('knowledgeReviewedAt must not be later than publishedAt (+5 minutes)');
    if (due <= reviewed) problems.push('reviewDueAt must be later than knowledgeReviewedAt');
    if (due > reviewed + 365 * 24 * 60 * 60 * 1000) problems.push('reviewDueAt must be within 365 days of knowledgeReviewedAt');
  }
  return problems;
}

/** Provisional knowledge dates derived from sources.json, for --pre-release. */
function deriveKnowledgeFromSources(repoRoot) {
  const sourcesPath = path.join(repoRoot, 'sources.json');
  if (!isFile(sourcesPath)) return null;
  const raw = readFileSync(sourcesPath);
  let registry;
  try {
    registry = JSON.parse(raw.toString('utf8'));
  } catch {
    return null;
  }
  let reviewed = null;
  let due = null;
  for (const source of registry.sources ?? []) {
    if (typeof source.lastReviewed !== 'string' || typeof source.reviewAfterDays !== 'number') continue;
    const reviewedAt = new Date(`${source.lastReviewed}T00:00:00Z`);
    if (Number.isNaN(reviewedAt.getTime())) continue;
    const dueAt = new Date(reviewedAt.getTime() + source.reviewAfterDays * 24 * 60 * 60 * 1000);
    if (reviewed === null || reviewedAt > reviewed) reviewed = reviewedAt;
    if (due === null || dueAt < due) due = dueAt;
  }
  if (!reviewed || !due) return null;
  return {
    knowledgeReviewedAt: reviewed.toISOString(),
    reviewDueAt: due.toISOString(),
    sourceRegistrySha256: sha256Hex(raw),
  };
}

// ---------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------

export function buildRelease({
  repoRoot = REPO_ROOT,
  outDir = 'dist',
  preRelease = false,
  publishedAt = new Date().toISOString(),
  compression = 'deflate',
} = {}) {
  const failures = [];
  const warnings = [];
  const fail = (message) => {
    if (preRelease) warnings.push(message);
    else failures.push(message);
  };

  const meta = readPackMetadata(repoRoot);
  const version = meta.version;
  if (!version) throw new Error('VERSION is missing; cannot build a release');
  if (meta.manifest?.version !== version || meta.pkg?.version !== version) {
    fail(`version mismatch: VERSION=${version}, manifest.json=${meta.manifest?.version}, package.json=${meta.pkg?.version}`);
  }

  const git = gitState(repoRoot);
  if (!git.available) fail(`git state could not be read (${git.detail})`);
  else if (!git.commit) fail('the repository has no commits yet');
  else if (!git.clean) fail(`the working tree is dirty (${git.dirtyPaths.length} path(s)); commit or stash before releasing`);

  const validation = run(process.execPath, [path.join(repoRoot, 'scripts', 'validate-pack.mjs'), '--release', '--json'], repoRoot);
  let validationReport = null;
  try {
    validationReport = JSON.parse(validation.stdout);
  } catch {
    fail('validate-pack.mjs did not emit parseable JSON');
  }
  if (validationReport && validationReport.errors?.length > 0) {
    fail(`validate-pack --release reported ${validationReport.errors.length} error(s); run npm run validate:release`);
  }

  const freshness = run(process.execPath, [path.join(repoRoot, 'scripts', 'check-freshness.mjs'), '--format=json'], repoRoot);
  if (freshness.status !== 0) {
    fail(`check-freshness.mjs exited ${freshness.status}; the knowledge supply chain is not release-ready`);
  }

  const knowledge = meta.manifest?.knowledge ?? {};
  const sourcesPath = path.join(repoRoot, 'sources.json');
  const actualRegistryHash = isFile(sourcesPath) ? sha256Hex(readFileSync(sourcesPath)) : null;
  let releaseKnowledge = {
    knowledgeReviewedAt: knowledge.knowledgeReviewedAt ?? null,
    reviewDueAt: knowledge.reviewDueAt ?? null,
    sourceRegistrySha256: knowledge.sourceRegistrySha256 ?? null,
  };
  if (!releaseKnowledge.knowledgeReviewedAt || !releaseKnowledge.reviewDueAt || !releaseKnowledge.sourceRegistrySha256) {
    fail('manifest.knowledge is not populated; a human must run npm run freshness:update-manifest and commit the result');
    if (preRelease) {
      const derived = deriveKnowledgeFromSources(repoRoot);
      if (!derived) throw new Error('cannot derive provisional knowledge dates from sources.json');
      releaseKnowledge = derived;
      warnings.push('using provisional knowledge dates derived from sources.json (pre-release only, not publishable)');
    }
  } else if (actualRegistryHash && releaseKnowledge.sourceRegistrySha256 !== actualRegistryHash) {
    fail('sources.json has changed since its last recorded review (sourceRegistrySha256 mismatch)');
  }
  if (releaseKnowledge.reviewDueAt && Date.parse(releaseKnowledge.reviewDueAt) < Date.now()) {
    fail(`the knowledge review is overdue (reviewDueAt ${releaseKnowledge.reviewDueAt}); re-review before releasing`);
  }

  const releaseBlock = meta.manifest?.release ?? {};
  const formallyTestedWith = Array.isArray(releaseBlock.formallyTestedWith) ? releaseBlock.formallyTestedWith : [];
  const adapterSupport = Array.isArray(releaseBlock.adapterSupport) ? releaseBlock.adapterSupport : [];
  if (formallyTestedWith.length === 0) fail('manifest.release.formallyTestedWith is empty; a release must state what it was tested with');
  if (adapterSupport.length === 0) fail('manifest.release.adapterSupport is empty; a release must state which adapters it ships');

  if (failures.length > 0) {
    return { ok: false, failures, warnings };
  }

  // ---- assemble the archive -----------------------------------------
  const files = collectFiles(repoRoot);
  if (files.length === 0) throw new Error('no files matched the release allow-list');

  const entries = files.map((rel) => ({ name: rel, data: readFileSync(path.join(repoRoot, ...rel.split('/'))) }));
  const inventory = entries
    .map((entry) => ({ path: entry.name, sizeBytes: entry.data.length, sha256: sha256Hex(entry.data) }))
    .sort((a, b) => byteCompare(a.path, b.path));

  const releaseManifest = {
    packId: PACK_ID,
    name: meta.manifest?.name ?? null,
    version,
    status: meta.manifest?.status ?? null,
    repositoryUrl: typeof meta.manifest?.repository === 'string' ? meta.manifest.repository : meta.manifest?.repository?.url ?? null,
    commit: git.commit ?? null,
    license: meta.manifest?.license?.code ?? meta.pkg?.license ?? null,
    knowledge: releaseKnowledge,
    formallyTestedWith,
    adapterSupport,
    fileCount: inventory.length,
    files: inventory,
    note: 'Inventory of every other entry in this archive. Verify with: sha256sum each path and compare.',
  };
  entries.push({ name: INVENTORY_ENTRY, data: Buffer.from(`${JSON.stringify(releaseManifest, null, 2)}\n`, 'utf8') });
  entries.sort((a, b) => byteCompare(a.name, b.name));

  const { buffer, entries: zipEntries } = createZip(entries, { compression });
  const verified = verifyZip(buffer);
  if (verified.entryCount !== entries.length) throw new Error('the built archive failed its own structural check');

  const zipName = `${meta.manifest?.name ?? 'context-pack'}-${version}.zip`;
  const blobName = `${SITE_BLOB_PREFIX}/${version}/${zipName}`;
  const current = {
    packId: PACK_ID,
    version,
    blobName,
    sizeBytes: buffer.length,
    sha256: sha256Hex(buffer),
    publishedAt,
    repositoryUrl: releaseManifest.repositoryUrl,
    formallyTestedWith,
    adapterSupport,
    knowledgeReviewedAt: releaseKnowledge.knowledgeReviewedAt,
    reviewDueAt: releaseKnowledge.reviewDueAt,
    sourceRegistrySha256: releaseKnowledge.sourceRegistrySha256,
  };

  const contractProblems = validateSiteContract(current);
  if (contractProblems.length > 0 && !preRelease) {
    return { ok: false, failures: contractProblems.map((p) => `current.json contract: ${p}`), warnings };
  }
  for (const problem of contractProblems) warnings.push(`current.json contract: ${problem}`);

  // ---- write dist/ ---------------------------------------------------
  const outAbs = path.isAbsolute(outDir) ? outDir : path.join(repoRoot, outDir);
  rmSync(outAbs, { recursive: true, force: true });
  mkdirSync(outAbs, { recursive: true });

  const currentJson = `${JSON.stringify(current, null, 2)}\n`;
  writeFileSync(path.join(outAbs, zipName), buffer);
  writeFileSync(path.join(outAbs, 'current.json'), currentJson, 'utf8');
  const sums = [
    `${current.sha256}  ${zipName}`,
    `${sha256Hex(Buffer.from(currentJson, 'utf8'))}  current.json`,
  ].join('\n');
  writeFileSync(path.join(outAbs, 'SHA256SUMS'), `${sums}\n`, 'utf8');
  if (preRelease) {
    writeFileSync(
      path.join(outAbs, 'PRERELEASE'),
      [
        'This build was produced with --pre-release. It is NOT publishable.',
        '',
        'Gates bypassed or provisional in this build:',
        ...warnings.map((w) => `  - ${w}`),
        '',
        'Re-run "npm run release" with every gate green before publishing.',
        '',
      ].join('\n'),
      'utf8',
    );
  }

  return {
    ok: true,
    warnings,
    failures: [],
    outDir: outAbs,
    zipName,
    zipPath: path.join(outAbs, zipName),
    current,
    fileCount: inventory.length,
    entryCount: zipEntries.length,
    sizeBytes: buffer.length,
    preRelease,
  };
}

// ---------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------

function parseArgs(argv) {
  const args = { preRelease: false, publishedAt: null, out: 'dist', compression: 'deflate', json: false, help: false, error: false };
  for (const raw of argv) {
    if (raw === '--pre-release') args.preRelease = true;
    else if (raw === '--store') args.compression = 'store';
    else if (raw === '--json') args.json = true;
    else if (raw.startsWith('--published-at=')) args.publishedAt = raw.slice('--published-at='.length).trim();
    else if (raw.startsWith('--out=')) args.out = raw.slice('--out='.length).trim();
    else if (raw === '--help' || raw === '-h') args.help = true;
    else {
      console.error(`Unknown argument: ${raw}`);
      args.help = true;
      args.error = true;
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/build-release.mjs [options]

Options:
  --pre-release          Local-only build: release gates become warnings and
                         dist/PRERELEASE records what was bypassed. Never use
                         the output of this mode to publish.
  --published-at=<iso>   Timestamp written to current.json (default: now).
  --out=<dir>            Output directory (default: dist).
  --store                Store entries uncompressed. Byte-identical output on
                         every Node build, at the cost of size.
  --json                 Machine-readable result.
  --help                 Show this help.

Exit codes: 0 = built, 1 = a gate failed.
`);
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return args.error ? 1 : 0;
  }
  if (args.publishedAt && Number.isNaN(Date.parse(args.publishedAt))) {
    console.error(`--published-at is not a valid timestamp: ${args.publishedAt}`);
    return 1;
  }

  const result = buildRelease({
    outDir: args.out,
    preRelease: args.preRelease,
    compression: args.compression,
    ...(args.publishedAt ? { publishedAt: new Date(args.publishedAt).toISOString() } : {}),
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  }

  if (!result.ok) {
    console.error('Release blocked:');
    for (const failure of result.failures) console.error(`  - ${failure}`);
    console.error('\nFix the above, or build locally with --pre-release (output is not publishable).');
    return 1;
  }

  for (const warning of result.warnings) console.warn(`WARN  ${warning}`);
  console.log(
    `Built ${result.zipName}\n` +
      `  ${result.fileCount} pack file(s) + ${INVENTORY_ENTRY}, ${result.sizeBytes} bytes\n` +
      `  sha256 ${result.current.sha256}\n` +
      `  blobName ${result.current.blobName}\n` +
      `  output ${result.outDir}${result.preRelease ? '\n  MODE: pre-release (not publishable)' : ''}`,
  );
  return 0;
}

if (isMain(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(`build-release failed: ${err.message}`);
    process.exitCode = 1;
  }
}
