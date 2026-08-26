#!/usr/bin/env node
/**
 * scripts/validate-pack.mjs
 *
 * Dependency-free structural validator for this pack (Node >=20, built-in
 * modules only). It is the single gate CI and the release build both run.
 *
 * What it checks (each check reports errors and/or warnings):
 *   1.  json          - every JSON file in the repo parses
 *   2.  files         - required files exist
 *   3.  version       - VERSION / package.json / manifest.json agree, and the
 *                       version is shaped the way the delivery site requires
 *   4.  manifest      - manifest describes the repository as it actually is
 *   5.  skills        - exactly 9 canonical skills once status leaves
 *                       "scaffold"; front matter shape; SKILL.md < 500 lines
 *   6.  references    - local markdown links exist, do not escape the repo,
 *                       and do not deep-link into another skill's internals
 *   7.  adapters      - generated adapters/mirrors match their sources
 *   8.  freshness     - scripts/check-freshness.mjs passes offline
 *   9.  mcp           - MCP configs declare endpoints only, and every declared
 *                       server is registered in sources.json (FRESHNESS.md)
 *   10. trademark     - product-name and attribution guardrails
 *   11. hygiene       - no secrets, build output, archives or dependencies
 *   12. license      - manifest licence block matches the licence files shipped
 *   13. release      - manifest knowledge fields and sources.json hash
 *
 * Usage:
 *   node scripts/validate-pack.mjs [--release] [--strict] [--json] [--quiet]
 *
 * Exit codes: 0 = pass, 1 = failed (errors, or warnings under --strict).
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import {
  ADAPTERS,
  ALWAYS_EXCLUDED,
  CANONICAL_SKILLS_DIR,
  CORE_ENTRY,
  LEARN_MCP,
  REPO_ROOT,
  SITE_CLAIM_LIST_MAX,
  SITE_KNOWN_TOOLS,
  SITE_PACK_ID,
  SKILL_MIRRORS,
  byteCompare,
  discoverSkills,
  isDirectory,
  isFile,
  isMain,
  isScaffold,
  isScratchDir,
  isToolingScratchPath,
  listFiles,
  readJson,
  readPackMetadata,
  readText,
  sha256Hex,
  splitFrontmatter,
  toPosix,
} from './lib/pack-lib.mjs';
import { diffPlan, planGeneration } from './generate-adapters.mjs';

const REQUIRED_SKILL_COUNT = 9;
const MAX_SKILL_LINES = 500;
const SKILL_LINE_WARNING = 400;
/**
 * Skill descriptions are matched against a task by the agent, so they are
 * allowed to be long; 1024 characters is the limit the skill format
 * ecosystem converges on. Anything past the warning threshold is usually a
 * sign the skill is doing too much.
 */
const MAX_DESCRIPTION_CHARS = 1024;
const DESCRIPTION_WARNING_CHARS = 600;

/**
 * Skill front matter follows the Agent Skills standard shape:
 *   name / description / license / compatibility (a string) / metadata
 *   (a flat map of string values) / allowed-tools / version.
 * Anything else is reported so it can be reviewed deliberately.
 */
const KNOWN_SKILL_KEYS = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools', 'version']);
const MAX_COMPATIBILITY_CHARS = 1024;

/** Matches the version shape the delivery site accepts for a release. */
const SITE_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SPDX_PATTERN = /^[A-Za-z0-9.+-]+(?: (?:WITH|OR|AND) [A-Za-z0-9.+-]+)*$/;

const REQUIRED_FILES = [
  '.github/copilot-instructions.md',
  '.github/workflows/freshness.yml',
  '.github/workflows/release.yml',
  '.github/workflows/validate.yml',
  '.gitignore',
  '.mcp.json',
  '.vscode/mcp.json',
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
  'scripts/build-release.mjs',
  'scripts/check-freshness.mjs',
  'scripts/generate-adapters.mjs',
  'scripts/install.mjs',
  'scripts/validate-pack.mjs',
  'sources.json',
  'sources.schema.json',
];

/** Product-name and attribution guardrails (see NOTICE). */
const FORBIDDEN_NAME_PATTERNS = [
  { pattern: /azure[\s_-]*full[\s_-]*stack[\s_-]*context[\s_-]*pack/i, why: 'retired product name that put a Microsoft mark in this pack\'s own name' },
  { pattern: /microsoft[\s_-]+(?:context|skills?|agent)[\s_-]+pack/i, why: 'product name must not lead with a Microsoft mark' },
];
const AFFILIATION_PATTERNS = [
  /\b(?:endorsed|sponsored|certified|approved|authorised|authorized)\s+by\s+(?:microsoft|azure)\b/i,
  /\b(?:is|are|was|were|am)\s+(?:an?\s+)?(?:official|officially)\b[^.\n]{0,40}?\b(?:microsoft|azure)\b/i,
  /\bmicrosoft[-\s]+(?:partner|certified|endorsed|approved)\b/i,
  /\bofficial\s+(?:microsoft|azure)\s+(?:partner|product|offering|pack|context\s+pack|skill|skills|reseller|distributor)\b/i,
  /\bin\s+partnership\s+with\s+microsoft\b/i,
];
const NEGATION_WINDOW = 80;
const NEGATION_PATTERN = /\b(?:not|never|no|nor|neither|without|isn't|is not|are not|aren't)\b/i;
/** A retired name may still be *named* when the text is recording the rename. */
const RENAME_CONTEXT_WINDOW = 160;
const RENAME_CONTEXT_PATTERN = /\b(?:renamed|rename|formerly|previously|retired|superseded|was called|old name|from)\b/i;

/**
 * Positioning claims that would be inaccurate about *this* pack. Checked
 * only where the pack describes itself (the manifest and package
 * descriptions, and the README's opening section) — never repo-wide, since
 * the same words can be perfectly accurate about something else, e.g. an
 * eval fixture that really is vendor-neutral.
 */
const MISLEADING_POSITIONING = [
  {
    pattern: /\bvendor[-\s]?neutral\b/i,
    why: 'the guidance is deliberately Microsoft Azure-specific; only the packaging is portable across agent tools. Use "tool-portable" or "cross-agent"',
  },
  {
    pattern: /\bcloud[-\s]?agnostic\b/i,
    why: 'this pack targets Microsoft Azure specifically',
  },
];

const SECRET_PATTERNS = [
  { id: 'private-key', pattern: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/, level: 'error' },
  { id: 'storage-account-key', pattern: /AccountKey\s*=\s*[A-Za-z0-9+/=]{20,}/i, level: 'error' },
  { id: 'shared-access-key', pattern: /SharedAccessKey\s*=\s*[A-Za-z0-9+/=]{20,}/i, level: 'error' },
  { id: 'sas-signature', pattern: /[?&]sig=[A-Za-z0-9%+/=]{20,}/, level: 'error' },
  { id: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/, level: 'error' },
  { id: 'github-pat', pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/, level: 'error' },
  { id: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/, level: 'error' },
  { id: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, level: 'error' },
  { id: 'client-secret', pattern: /["']?client[_-]?secret["']?\s*[:=]\s*["'][^"'\s]{8,}["']/i, level: 'error' },
  { id: 'inline-password', pattern: /\bpassword\s*[:=]\s*["'][^"'\s]{6,}["']/i, level: 'warn' },
];
const SECRET_FILENAME_PATTERNS = [/^\.env(\..+)?$/i, /\.pem$/i, /\.pfx$/i, /\.p12$/i, /^id_rsa$/i, /\.key$/i];

/** Files this validator does not scan for secrets: it defines the patterns. */
const SECRET_SCAN_EXEMPT = ['scripts/validate-pack.mjs'];

const TEXT_EXTENSIONS = new Set([
  '.md',
  '.json',
  '.mjs',
  '.js',
  '.cjs',
  '.yml',
  '.yaml',
  '.txt',
  '.toml',
  '.cs',
  '.csproj',
  '.props',
  '.targets',
  '.ts',
  '.tsx',
  '.css',
  '.scss',
  '.html',
  '.xml',
  '.bicep',
  '.bicepparam',
  '.sql',
  '.log',
  '.sh',
  '.ps1',
  '.gitignore',
  '',
]);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp']);
const ARCHIVE_EXTENSIONS = new Set(['.zip', '.tgz', '.tar', '.gz', '.7z', '.rar']);

// ---------------------------------------------------------------------
// Report plumbing
// ---------------------------------------------------------------------

class Report {
  constructor() {
    this.issues = [];
    this.info = {};
  }

  add(level, check, message, file) {
    this.issues.push({ level, check, message, file: file ?? null });
  }

  error(check, message, file) {
    this.add('error', check, message, file);
  }

  warn(check, message, file) {
    this.add('warn', check, message, file);
  }

  /** Error in release mode, warning otherwise. */
  gate(releaseMode, check, message, file) {
    this.add(releaseMode ? 'error' : 'warn', check, message, file);
  }

  get errors() {
    return this.issues.filter((i) => i.level === 'error');
  }

  get warnings() {
    return this.issues.filter((i) => i.level === 'warn');
  }
}

// ---------------------------------------------------------------------
// Repository scan helpers
// ---------------------------------------------------------------------

export function repoFiles(repoRoot) {
  const out = [];
  const unreadable = [];
  const skipped = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => byteCompare(a.name, b.name));
    } catch (err) {
      unreadable.push({ rel: toPosix(path.relative(repoRoot, dir)) || '.', reason: err.code ?? err.message });
      return;
    }
    for (const entry of entries) {
      if (ALWAYS_EXCLUDED.includes(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        out.push({ rel: toPosix(path.relative(repoRoot, abs)), abs, symlink: true });
        continue;
      }
      if (entry.isDirectory()) {
        // Tooling scratch (eval harness workspaces, editor state) is not
        // pack content: it is neither validated nor shipped.
        const rel = toPosix(path.relative(repoRoot, abs));
        if (isScratchDir(entry.name) || isToolingScratchPath(rel)) {
          skipped.push(toPosix(path.relative(repoRoot, abs)));
          continue;
        }
        walk(abs);
      } else if (entry.isFile()) out.push({ rel: toPosix(path.relative(repoRoot, abs)), abs, symlink: false });
    }
  };
  walk(repoRoot);
  out.unreadable = unreadable;
  out.skipped = skipped.sort(byteCompare);
  return out;
}

/**
 * Read a file for scanning, tolerating the transient failures that happen
 * in a live working tree (a file being rewritten, a sync client holding a
 * lock). A file that cannot be read has not been checked, so this is a
 * warning during development and an error under --release, where every
 * file must actually be inspected before it is published.
 */
function safeReadText(report, file, releaseMode) {
  try {
    return readFileSync(file.abs, 'utf8');
  } catch (err) {
    // Report each unreadable file once, however many scanners hit it.
    report.unreadableFiles ??= new Set();
    if (!report.unreadableFiles.has(file.rel)) {
      report.unreadableFiles.add(file.rel);
      report.gate(releaseMode, 'files', `could not be read (${err.code ?? err.message}); it may be locked or mid-write`, file.rel);
    }
    return null;
  }
}

/** Read a known file by absolute path, returning null when it cannot be read. */
function tryRead(absPath) {
  try {
    return readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
}

function safeSize(file) {
  try {
    return statSync(file.abs).size;
  } catch {
    return null;
  }
}

export function isTextFile(rel) {
  const ext = path.extname(rel).toLowerCase();
  if (ext === '' && path.basename(rel).startsWith('.')) return true;
  return TEXT_EXTENSIONS.has(ext);
}

function hasNegationBefore(text, index) {
  return NEGATION_PATTERN.test(text.slice(Math.max(0, index - NEGATION_WINDOW), index));
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

// ---------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------

function checkJsonAndFiles(report, repoRoot, files, releaseMode) {
  for (const entry of files.unreadable ?? []) {
    report.gate(releaseMode, 'files', `directory could not be listed (${entry.reason})`, entry.rel);
  }
  for (const file of files) {
    if (file.symlink) {
      report.error('files', 'symbolic links are not portable across checkouts and archives', file.rel);
      continue;
    }
    if (path.extname(file.rel).toLowerCase() !== '.json') continue;
    const text = safeReadText(report, file, releaseMode);
    if (text === null) continue;
    try {
      JSON.parse(text);
    } catch (err) {
      report.error('json', `invalid JSON: ${err.message}`, file.rel);
    }
  }
  for (const rel of REQUIRED_FILES) {
    if (!isFile(path.join(repoRoot, ...rel.split('/')))) {
      report.error('files', 'required file is missing', rel);
    }
  }
}

function checkVersion(report, meta, repoRoot, releaseMode) {
  const { manifest, pkg, version } = meta;
  if (!version) {
    report.error('version', 'VERSION file is missing or empty', 'VERSION');
    return;
  }
  if (!SITE_VERSION_PATTERN.test(version)) {
    report.error('version', `"${version}" is not accepted by the delivery site (expected MAJOR.MINOR.PATCH[-prerelease])`, 'VERSION');
  }
  if (pkg && pkg.version !== version) {
    report.error('version', `package.json version "${pkg.version}" does not match VERSION "${version}"`, 'package.json');
  }
  if (manifest && manifest.version !== version) {
    report.error('version', `manifest.json version "${manifest.version}" does not match VERSION "${version}"`, 'manifest.json');
  }
  const changelogPath = path.join(repoRoot, 'CHANGELOG.md');
  const changelog = isFile(changelogPath) ? tryRead(changelogPath) : null;
  if (changelog !== null && !changelog.includes(`[${version}]`)) {
    report.gate(releaseMode, 'version', `CHANGELOG.md has no "[${version}]" section`, 'CHANGELOG.md');
  }
  if (pkg && manifest && pkg.name !== manifest.name) {
    report.error('version', `package.json name "${pkg.name}" does not match manifest.json name "${manifest.name}"`, 'package.json');
  }
}

function checkManifest(report, meta, skills, repoRoot, releaseMode) {
  const { manifest, pkg } = meta;
  if (!manifest) {
    report.error('manifest', 'manifest.json could not be read', 'manifest.json');
    return;
  }
  for (const key of ['name', 'version', 'description', 'status', 'entryPoint', 'skills', 'adapters', 'knowledge']) {
    if (manifest[key] === undefined) report.error('manifest', `missing required key "${key}"`, 'manifest.json');
  }
  if (manifest.entryPoint && manifest.entryPoint !== CORE_ENTRY) {
    report.error('manifest', `entryPoint should be "${CORE_ENTRY}" (found "${manifest.entryPoint}")`, 'manifest.json');
  }
  const skillsBlock = manifest.skills ?? {};
  if (skillsBlock.location && skillsBlock.location !== CANONICAL_SKILLS_DIR) {
    report.error('manifest', `skills.location should be "${CANONICAL_SKILLS_DIR}"`, 'manifest.json');
  }
  const declaredMirrors = Array.isArray(skillsBlock.mirrors) ? [...skillsBlock.mirrors].sort(byteCompare) : [];
  const actualMirrors = SKILL_MIRRORS.map((m) => m.dir).sort(byteCompare);
  if (declaredMirrors.join(',') !== actualMirrors.join(',')) {
    report.error('manifest', `skills.mirrors should be ${JSON.stringify(actualMirrors)}`, 'manifest.json');
  }
  if (typeof skillsBlock.authored === 'number' && skillsBlock.authored !== skills.length) {
    report.error('manifest', `skills.authored is ${skillsBlock.authored} but ${skills.length} skill(s) exist on disk`, 'manifest.json');
  }
  if (skills.length > 0 && isScaffold(manifest)) {
    // AGENTS.md's own convention: status, description, VERSION and
    // CHANGELOG move together when the pack's content changes materially.
    report.warn('manifest', `status is still "scaffold" although ${skills.length} skill(s) are authored; update status, description, VERSION and CHANGELOG together when that stops being true`, 'manifest.json');
  }
  if (skills.length > 0 && /no skill content .*authored|scaffold only/i.test(manifest.description ?? '')) {
    report.warn('manifest', 'description still says no skill content is authored, but skills exist on disk', 'manifest.json');
  }
  if (typeof skillsBlock.planned === 'number' && skillsBlock.planned !== REQUIRED_SKILL_COUNT) {
    report.warn('manifest', `skills.planned is ${skillsBlock.planned}; this pack's contract is ${REQUIRED_SKILL_COUNT}`, 'manifest.json');
  }

  const declaredTargets = Array.isArray(manifest.adapters) ? manifest.adapters.map((a) => a.target).sort(byteCompare) : [];
  const actualTargets = ADAPTERS.map((a) => a.target).sort(byteCompare);
  if (declaredTargets.join(',') !== actualTargets.join(',')) {
    report.error('manifest', `adapters should declare exactly ${JSON.stringify(actualTargets)}`, 'manifest.json');
  }
  if (!isScaffold(manifest)) {
    for (const adapter of manifest.adapters ?? []) {
      if (adapter.generated !== true) {
        report.error('manifest', `adapter "${adapter.target}" is not marked generated, but the pack is past scaffold status`, 'manifest.json');
      }
    }
  }

  if (pkg) {
    const deps = Object.keys(pkg.dependencies ?? {}).length + Object.keys(pkg.devDependencies ?? {}).length;
    if (deps > 0) {
      report.error('manifest', 'package.json declares dependencies; this pack\'s tooling must stay dependency-free', 'package.json');
    }
    for (const script of ['generate', 'check', 'validate', 'release']) {
      if (!pkg.scripts || !pkg.scripts[script]) {
        report.error('manifest', `package.json is missing the "${script}" script`, 'package.json');
      }
    }
    if (pkg.scripts && pkg.scripts.install) {
      report.error('manifest', '"install" is an npm lifecycle name; use "install:pack" instead', 'package.json');
    }
  }

  const repoUrl = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
  if (!repoUrl || !repoUrl.startsWith('https://')) {
    report.gate(releaseMode, 'manifest', 'repository must be an absolute https URL (the delivery site rejects anything else)', 'manifest.json');
  }
  if (!isDirectory(path.join(repoRoot, '.github', 'workflows'))) {
    report.error('manifest', '.github/workflows is missing', '.github/workflows');
  }
}

function checkSkills(report, skills, nonSkillDirs, manifest, releaseMode) {
  for (const rel of nonSkillDirs) {
    report.error('skills', 'skill directory has no SKILL.md', rel);
  }

  const scaffold = isScaffold(manifest);
  if (!scaffold && skills.length !== REQUIRED_SKILL_COUNT) {
    report.error('skills', `expected exactly ${REQUIRED_SKILL_COUNT} canonical skills once status is past "scaffold", found ${skills.length}`, CANONICAL_SKILLS_DIR);
  }
  if (scaffold && skills.length !== REQUIRED_SKILL_COUNT) {
    report.gate(releaseMode, 'skills', `${skills.length}/${REQUIRED_SKILL_COUNT} skills authored while status is "scaffold"`, CANONICAL_SKILLS_DIR);
  }

  for (const skill of skills) {
    const at = skill.skillMdRel;
    if (skill.readError) {
      report.gate(releaseMode, 'skills', `SKILL.md could not be read (${skill.readError}); it may be locked or mid-write`, at);
      continue;
    }
    if (!skill.hasFrontmatter) {
      report.error('skills', 'SKILL.md has no YAML front matter', at);
      continue;
    }
    if (skill.frontmatterError) {
      report.error('skills', `front matter could not be parsed: ${skill.frontmatterError}`, at);
      continue;
    }

    const packLicense = manifest?.license?.content ?? manifest?.license?.code ?? null;
    for (const issue of inspectSkillFrontmatter(skill.frontmatter ?? {}, skill.dirName, { packLicense })) {
      report.add(issue.level, 'skills', issue.message, at);
    }

    if (skill.lineCount > MAX_SKILL_LINES) {
      report.error('skills', `SKILL.md is ${skill.lineCount} lines; the limit is ${MAX_SKILL_LINES}. Move detail into references/`, at);
    } else if (skill.lineCount > SKILL_LINE_WARNING) {
      report.warn('skills', `SKILL.md is ${skill.lineCount} lines, approaching the ${MAX_SKILL_LINES}-line limit`, at);
    }
  }
}

/**
 * Validate one skill's front matter against the Agent Skills standard
 * shape. Pure: takes the parsed front matter, returns
 * `[{ level, message }]`, touches nothing. That keeps the rules directly
 * unit-testable (scripts/tests/skill-frontmatter.test.mjs).
 *
 * The shape:
 *   name           lower-case kebab-case, identical to the directory name
 *   description    non-empty string an agent matches a task against
 *   license        SPDX-style identifier
 *   compatibility  a top-level STRING stating what the skill was checked
 *                  against. Not a mapping, and not nested under metadata:
 *                  loaders read this field as text, so a nested block is
 *                  silently dropped by anything following the standard.
 *   metadata       optional, and a FLAT map of string values only
 */
export function inspectSkillFrontmatter(fm, dirName, { packLicense = null } = {}) {
  const issues = [];
  const error = (message) => issues.push({ level: 'error', message });
  const warn = (message) => issues.push({ level: 'warn', message });

  if (typeof fm.name !== 'string' || fm.name.trim() === '') {
    error('front matter "name" is required');
  } else {
    if (!SKILL_NAME_PATTERN.test(fm.name)) error(`front matter name "${fm.name}" must be lower-case kebab-case`);
    if (dirName && fm.name !== dirName) {
      error(`front matter name "${fm.name}" does not match its directory "${dirName}"`);
    }
  }

  if (typeof fm.description !== 'string' || fm.description.trim() === '') {
    error('front matter "description" is required (it is what an agent matches a task against)');
  } else {
    const description = fm.description.replace(/\s+/g, ' ').trim();
    if (description.length > MAX_DESCRIPTION_CHARS) {
      error(`description is ${description.length} characters; keep it under ${MAX_DESCRIPTION_CHARS}`);
    } else if (description.length > DESCRIPTION_WARNING_CHARS) {
      warn(`description is ${description.length} characters; consider tightening it (soft limit ${DESCRIPTION_WARNING_CHARS})`);
    }
    if (/^(?:todo|tbd|placeholder)\b/i.test(description)) error('description is still a placeholder');
  }

  if (typeof fm.license !== 'string' || fm.license.trim() === '') {
    error('front matter "license" is required');
  } else if (!SPDX_PATTERN.test(fm.license.trim())) {
    error(`license "${fm.license}" is not an SPDX-style identifier`);
  } else if (packLicense && fm.license.trim() !== packLicense) {
    warn(`license "${fm.license}" differs from the pack license "${packLicense}"; NOTICE must explain why`);
  }

  // compatibility: required, top-level, and a plain string.
  if (fm.compatibility === undefined || fm.compatibility === null) {
    error('front matter "compatibility" is required: a single string stating what this skill was checked against, even if the answer is "not verified"');
  } else if (typeof fm.compatibility !== 'string') {
    error(`front matter "compatibility" must be a string, not ${Array.isArray(fm.compatibility) ? 'a list' : typeof fm.compatibility}; the Agent Skills shape reads this field as text`);
  } else if (fm.compatibility.trim() === '') {
    error('front matter "compatibility" must not be empty');
  } else {
    const compatibility = fm.compatibility.replace(/\s+/g, ' ').trim();
    if (compatibility.length > MAX_COMPATIBILITY_CHARS) {
      error(`compatibility is ${compatibility.length} characters; keep it under ${MAX_COMPATIBILITY_CHARS} and put detail in references/`);
    }
    if (/^(?:todo|tbd|placeholder)\b/i.test(compatibility)) error('compatibility is still a placeholder');
  }

  // metadata: optional, flat, string values only.
  if (fm.metadata !== undefined && fm.metadata !== null) {
    if (Array.isArray(fm.metadata) || typeof fm.metadata !== 'object') {
      error('front matter "metadata" must be a mapping of flat string values');
    } else {
      for (const [key, value] of Object.entries(fm.metadata)) {
        if (key === 'compatibility') {
          error('metadata.compatibility is not the standard shape: move it to a top-level "compatibility" string, since loaders do not read nested metadata as compatibility');
          continue;
        }
        if (typeof value === 'string') continue;
        if (value === null) {
          error(`metadata.${key} must be a string, not an empty value`);
        } else if (Array.isArray(value)) {
          error(`metadata.${key} must be a flat string, not a list`);
        } else if (typeof value === 'object') {
          error(`metadata.${key} must be a flat string; nested metadata blocks are not part of the standard shape`);
        } else {
          error(`metadata.${key} must be a quoted string, not a ${typeof value}`);
        }
      }
    }
  }

  for (const key of Object.keys(fm)) {
    if (!KNOWN_SKILL_KEYS.has(key)) {
      warn(`front matter key "${key}" is outside the Agent Skills standard shape (${[...KNOWN_SKILL_KEYS].join(', ')}); some loaders reject unknown keys`);
    }
  }

  return issues;
}

function checkReferences(report, repoRoot, files, releaseMode) {
  const markdown = files.filter((f) => !f.symlink && path.extname(f.rel).toLowerCase() === '.md');
  const mirrorDirs = SKILL_MIRRORS.map((m) => m.dir);

  for (const file of markdown) {
    const text = safeReadText(report, file, releaseMode);
    if (text === null) continue;
    const fromDir = path.posix.dirname(file.rel);
    const targets = [];
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      targets.push({ target: match[1], index: match.index ?? 0 });
    }
    for (const match of text.matchAll(/^\[[^\]]+\]:\s+(\S+)/gm)) {
      targets.push({ target: match[1], index: match.index ?? 0 });
    }

    for (const { target, index } of targets) {
      if (/^(?:[a-z][a-z0-9+.-]*:|#|mailto:|<)/i.test(target)) continue;
      const clean = decodeURIComponent(target.split('#')[0].split('?')[0]).trim();
      if (clean === '') continue;
      const where = `${file.rel}:${lineOf(text, index)}`;

      if (clean.startsWith('/') || /^[A-Za-z]:[\\/]/.test(clean) || clean.includes('\\')) {
        report.error('references', `absolute or Windows-style link "${target}" is not portable`, where);
        continue;
      }

      const resolvedAbs = path.resolve(path.join(repoRoot, ...fromDir.split('/')), ...clean.split('/'));
      const rel = toPosix(path.relative(repoRoot, resolvedAbs));
      if (rel.startsWith('..')) {
        report.error('references', `link "${target}" escapes the repository`, where);
        continue;
      }
      if (!isFile(resolvedAbs) && !isDirectory(resolvedAbs)) {
        report.error('references', `link target "${target}" does not exist`, where);
        continue;
      }
      if (ALWAYS_EXCLUDED.some((excluded) => rel === excluded || rel.startsWith(`${excluded}/`))) {
        report.error('references', `link "${target}" points into an excluded path`, where);
        continue;
      }

      const sourceSkill = /^\.agents\/skills\/([^/]+)\//.exec(`${file.rel}`);
      const targetSkill = /^\.agents\/skills\/([^/]+)\/(.*)$/.exec(rel);
      if (targetSkill && (!sourceSkill || sourceSkill[1] !== targetSkill[1]) && targetSkill[2] !== 'SKILL.md') {
        report.error('references', `link "${target}" deep-links into another skill's internals; link to its SKILL.md instead`, where);
      }
      if (file.rel.startsWith(`${CANONICAL_SKILLS_DIR}/`) && mirrorDirs.some((dir) => rel.startsWith(`${dir}/`))) {
        report.error('references', `canonical content must not link into the generated mirror "${rel}"`, where);
      }
    }
  }
}

function checkAdapters(report, repoRoot, manifest, releaseMode) {
  let diff;
  try {
    diff = diffPlan(planGeneration(repoRoot), repoRoot);
  } catch (err) {
    report.error('adapters', `adapter generation failed: ${err.message}`);
    return;
  }
  const scaffold = isScaffold(manifest);
  const adaptersGenerated = Array.isArray(manifest?.adapters) && manifest.adapters.every((a) => a.generated === true);
  const level = scaffold && !adaptersGenerated && !releaseMode ? 'warn' : 'error';
  const note = level === 'warn' ? ' (still marked as an ungenerated scaffold placeholder)' : '';

  for (const rel of diff.missing) report.add(level, 'adapters', `generated file is missing${note}; run npm run generate`, rel);
  for (const rel of diff.changed) report.add(level, 'adapters', `generated file has drifted from its source${note}; run npm run generate`, rel);
  for (const rel of diff.stale) report.add(level, 'adapters', `stale generated file${note}; run npm run generate`, rel);
}

function checkFreshness(report, repoRoot, releaseMode) {
  const script = path.join(repoRoot, 'scripts', 'check-freshness.mjs');
  if (!isFile(script)) return;
  const result = spawnSync(process.execPath, [script, '--format=json'], { encoding: 'utf8', cwd: repoRoot });
  if (result.error) {
    report.error('freshness', `could not run check-freshness.mjs: ${result.error.message}`, 'scripts/check-freshness.mjs');
    return;
  }
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    report.error('freshness', 'check-freshness.mjs did not emit parseable JSON', 'scripts/check-freshness.mjs');
    return;
  }
  for (const message of parsed.schemaErrors ?? []) report.error('freshness', message, 'sources.json');
  for (const message of parsed.dateErrors ?? []) report.error('freshness', message, 'sources.json');
  for (const entry of parsed.overdue ?? []) {
    report.gate(releaseMode, 'freshness', `source "${entry.id}" is ${entry.daysOverdue} day(s) overdue (due ${entry.dueDate})`, 'sources.json');
  }
  return parsed;
}

function checkMcp(report, repoRoot, manifest, releaseMode) {
  const configs = [
    { rel: '.mcp.json', wrapper: 'mcpServers' },
    { rel: '.vscode/mcp.json', wrapper: 'servers' },
  ];
  const declaredHosts = new Set();
  let totalServers = 0;

  for (const config of configs) {
    const abs = path.join(repoRoot, ...config.rel.split('/'));
    if (!isFile(abs)) continue;
    let json;
    try {
      json = readJson(abs);
    } catch {
      continue; // already reported by the json check
    }
    const servers = json[config.wrapper];
    if (servers === undefined || servers === null || typeof servers !== 'object' || Array.isArray(servers)) {
      report.error('mcp', `must declare its servers under a "${config.wrapper}" object`, config.rel);
      continue;
    }
    const names = Object.keys(servers);
    totalServers = Math.max(totalServers, names.length);
    if (!names.includes(LEARN_MCP.id)) {
      report.error('mcp', `does not declare the "${LEARN_MCP.id}" endpoint (${LEARN_MCP.url})`, config.rel);
    }
    for (const [name, server] of Object.entries(servers)) {
      if (!server || typeof server !== 'object' || Array.isArray(server)) {
        report.error('mcp', `server "${name}" must be an object`, config.rel);
        continue;
      }
      const url = server.url ?? server.httpUrl ?? server.serverUrl;
      if (server.command) {
        report.warn('mcp', `server "${name}" launches a local command; this pack declares remote endpoints only`, config.rel);
      } else if (typeof url !== 'string' || !url.startsWith('https://')) {
        report.error('mcp', `server "${name}" must declare an https endpoint URL`, config.rel);
      } else {
        try {
          declaredHosts.add(new URL(url).host);
        } catch {
          report.error('mcp', `server "${name}" has an unparseable URL`, config.rel);
        }
      }
      for (const forbidden of ['tools', 'toolSchemas', 'capabilities', 'prompts', 'resources', 'schema']) {
        if (server[forbidden] !== undefined) {
          report.error('mcp', `server "${name}" hard-codes "${forbidden}"; MCP tool schemas are discovered at runtime and must not be pinned here`, config.rel);
        }
      }
      if (name === LEARN_MCP.id && url !== LEARN_MCP.url) {
        report.error('mcp', `"${LEARN_MCP.id}" must point at ${LEARN_MCP.url}`, config.rel);
      }
    }
  }

  if (manifest?.mcp && typeof manifest.mcp.serversDeclared === 'number' && manifest.mcp.serversDeclared !== totalServers) {
    report.error('manifest', `mcp.serversDeclared is ${manifest.mcp.serversDeclared} but ${totalServers} server(s) are configured`, 'manifest.json');
  }

  // FRESHNESS.md live-MCP policy: a declared server must be registered in
  // sources.json so it enters the review cadence.
  const sourcesPath = path.join(repoRoot, 'sources.json');
  if (declaredHosts.size > 0 && isFile(sourcesPath)) {
    let registryHosts = new Set();
    try {
      for (const source of readJson(sourcesPath).sources ?? []) {
        try {
          registryHosts.add(new URL(source.canonicalUrl).host);
        } catch {
          /* invalid URLs are reported by the freshness check */
        }
      }
    } catch {
      registryHosts = new Set();
    }
    for (const host of [...declaredHosts].sort(byteCompare)) {
      if (!registryHosts.has(host)) {
        report.gate(releaseMode, 'mcp', `MCP endpoint host "${host}" has no sources.json entry; FRESHNESS.md requires declared servers to enter the review cadence`, 'sources.json');
      }
    }
  }
}

function checkTrademark(report, repoRoot, meta, files, releaseMode) {
  const { manifest, pkg } = meta;
  const ownNames = [
    { value: pkg?.name, at: 'package.json' },
    { value: manifest?.name, at: 'manifest.json' },
  ];
  for (const { value, at } of ownNames) {
    if (typeof value !== 'string') continue;
    if (/\b(?:microsoft|azure)\b/i.test(value.replace(/-/g, ' '))) {
      report.error('trademark', `this pack's own name "${value}" must not contain a Microsoft mark`, at);
    }
  }

  for (const file of files) {
    if (file.symlink) continue;
    const ext = path.extname(file.rel).toLowerCase();
    if (IMAGE_EXTENSIONS.has(ext) && /(?:microsoft|azure|windows|office|ms-)/i.test(path.basename(file.rel))) {
      report.error('trademark', 'image files must not carry Microsoft brand names; this pack ships no Microsoft brand assets', file.rel);
    }
    if (!isTextFile(file.rel)) continue;
    const size = safeSize(file);
    if (size === null || size > 512 * 1024) continue;
    const text = safeReadText(report, file, releaseMode);
    if (text === null) continue;

    for (const { pattern, why } of FORBIDDEN_NAME_PATTERNS) {
      const match = pattern.exec(text);
      if (match) {
        const index = match.index;
        const context = text.slice(Math.max(0, index - RENAME_CONTEXT_WINDOW), index);
        // CHANGELOG-style prose that records the rename is allowed to name
        // the retired name; reintroducing it as a current name is not.
        if (!RENAME_CONTEXT_PATTERN.test(context)) {
          report.error('trademark', `contains "${match[0].replace(/\s+/g, ' ')}" - ${why}`, `${file.rel}:${lineOf(text, index)}`);
        }
      }
    }
    for (const pattern of AFFILIATION_PATTERNS) {
      for (const match of text.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))) {
        const index = match.index ?? 0;
        if (hasNegationBefore(text, index)) continue;
        report.error('trademark', `unqualified affiliation claim "${match[0].trim()}"; this project is independent of Microsoft`, `${file.rel}:${lineOf(text, index)}`);
      }
    }
    // Only root-level documents carry this pack's product identity. A skill
    // titled "Azure App Service deployment" is descriptive, and descriptive
    // use of a mark is exactly what the trademark guidance permits.
    if (!file.rel.includes('/')) {
      const heading = /^#\s+(.*)$/m.exec(text);
      if (heading && /^(?:microsoft|azure)\b/i.test(heading[1].trim())) {
        report.warn('trademark', `title "${heading[1].trim()}" leads with a Microsoft mark; keep marks in subordinate, descriptive wording`, file.rel);
      }
    }
  }

  const notice = tryRead(path.join(repoRoot, 'NOTICE'));
  if (notice !== null && (!/trademark/i.test(notice) || !/not\s+affiliated/i.test(notice))) {
    report.error('trademark', 'NOTICE must carry a trademark disclaimer stating this project is not affiliated with Microsoft', 'NOTICE');
  }
  const readme = tryRead(path.join(repoRoot, 'README.md'));
  if (readme !== null && !/trademark|NOTICE/i.test(readme)) {
    report.warn('trademark', 'README.md does not point at NOTICE or mention trademarks', 'README.md');
  }
}

/**
 * Check the places where the pack describes itself for claims that are not
 * true of it. Deliberately narrow: the manifest and package descriptions,
 * and the README's opening section (down to its first `##` heading).
 */
export function inspectPositioning(text, where) {
  const issues = [];
  if (typeof text !== 'string' || text.trim() === '') return issues;
  for (const { pattern, why } of MISLEADING_POSITIONING) {
    const match = pattern.exec(text);
    if (!match) continue;
    const context = text.slice(Math.max(0, match.index - RENAME_CONTEXT_WINDOW), match.index);
    if (RENAME_CONTEXT_PATTERN.test(context)) continue; // recording the change, not making the claim
    issues.push({
      level: 'error',
      message: `${where} describes this pack as "${match[0]}", which is inaccurate: ${why}`,
    });
  }
  return issues;
}

function checkPositioning(report, repoRoot, meta) {
  for (const [where, text, file] of [
    ['manifest.description', meta.manifest?.description, 'manifest.json'],
    ['package.json description', meta.pkg?.description, 'package.json'],
  ]) {
    for (const issue of inspectPositioning(text, where)) report.add(issue.level, 'trademark', issue.message, file);
  }

  const readme = tryRead(path.join(repoRoot, 'README.md'));
  if (readme === null) return;
  // Only the opening pitch, before the first "## " section.
  const headingIndex = readme.indexOf('\n## ');
  const intro = headingIndex === -1 ? readme : readme.slice(0, headingIndex);
  for (const issue of inspectPositioning(intro, 'README.md')) report.add(issue.level, 'trademark', issue.message, 'README.md');
}

function checkHygiene(report, repoRoot, files, releaseMode) {
  const ignore = tryRead(path.join(repoRoot, '.gitignore'));
  if (ignore !== null) {
    for (const entry of ['node_modules/', 'dist/']) {
      if (!ignore.split(/\r?\n/).some((line) => line.trim() === entry || line.trim() === entry.replace(/\/$/, ''))) {
        report.error('hygiene', `.gitignore must ignore "${entry}"`, '.gitignore');
      }
    }
  }

  for (const file of files) {
    if (file.symlink) continue;
    const base = path.basename(file.rel);
    const ext = path.extname(file.rel).toLowerCase();

    if (SECRET_FILENAME_PATTERNS.some((pattern) => pattern.test(base))) {
      report.error('hygiene', 'credential-shaped file must never be committed', file.rel);
      continue;
    }
    if (ARCHIVE_EXTENSIONS.has(ext)) {
      report.error('hygiene', 'build archives belong in dist/ (gitignored), not in the pack tree', file.rel);
      continue;
    }
    if (SECRET_SCAN_EXEMPT.includes(file.rel)) continue;
    if (!isTextFile(file.rel)) continue;
    const size = safeSize(file);
    if (size !== null && size > 512 * 1024) {
      report.warn('hygiene', 'file is unusually large for this pack; check it is not build output', file.rel);
      continue;
    }
    const text = safeReadText(report, file, releaseMode);
    if (text === null) continue;
    for (const { id, pattern, level } of SECRET_PATTERNS) {
      const match = pattern.exec(text);
      if (match) {
        report.add(level, 'hygiene', `possible secret (${id}) detected`, `${file.rel}:${lineOf(text, match.index)}`);
      }
    }
  }

  if (isDirectory(path.join(repoRoot, 'node_modules'))) {
    report.warn('hygiene', 'node_modules exists; this pack\'s tooling is dependency-free and should never need it', 'node_modules');
  }
}

function checkLicensing(report, repoRoot, meta, files) {
  const license = meta.manifest?.license;
  if (!license || typeof license !== 'object' || Array.isArray(license)) {
    report.error('license', 'manifest.json must declare a license block with "code" and "content"', 'manifest.json');
    return;
  }
  for (const key of ['code', 'content']) {
    if (typeof license[key] !== 'string' || license[key].trim() === '') {
      report.error('license', `manifest.license.${key} is required`, 'manifest.json');
    } else if (!SPDX_PATTERN.test(license[key].trim())) {
      report.error('license', `manifest.license.${key} "${license[key]}" is not an SPDX-style identifier`, 'manifest.json');
    }
  }
  if (meta.pkg && typeof meta.pkg.license === 'string' && license.code && meta.pkg.license !== license.code) {
    report.error('license', `package.json license "${meta.pkg.license}" does not match manifest.license.code "${license.code}"`, 'package.json');
  }

  // Every licence file the pack ships must be named by the manifest, and
  // every named file must exist. This is what stops an unused or
  // superseded licence file reappearing unnoticed.
  const declared = new Map();
  for (const key of ['codeFile', 'contentFile']) {
    const value = license[key];
    if (typeof value !== 'string' || value.trim() === '') continue;
    declared.set(value, key);
    if (!isFile(path.join(repoRoot, ...value.split('/')))) {
      report.error('license', `manifest.license.${key} names "${value}", which does not exist`, 'manifest.json');
    }
  }
  for (const file of files) {
    if (file.rel.includes('/') || !/^licen[cs]e/i.test(file.rel)) continue;
    if (!declared.has(file.rel)) {
      report.error('license', `licence file is not declared in manifest.license; remove it or name it there (the pack ships a single ${license.code ?? 'MIT'} licence for both code and content)`, file.rel);
    }
  }
  if (license.code === license.content && declared.size > 1) {
    report.error('license', `code and content are both "${license.code}" but ${declared.size} licence files are declared; one licence needs one file`, 'manifest.json');
  }
  if (license.content && !license.contentNote) {
    report.warn('license', 'manifest.license.contentNote should record how third-party material must be attributed if any is ever added', 'manifest.json');
  }
}

/**
 * Claim-list rules the delivery site enforces, checked here so a bad edit
 * fails locally instead of at publish time. Pure: takes the manifest's
 * release block, returns `[{ level, message }]`.
 */
export function inspectReleaseClaims(release) {
  const issues = [];
  const error = (message) => issues.push({ level: 'error', message });

  if (!release || typeof release !== 'object' || Array.isArray(release)) {
    return [{ level: 'error', message: 'manifest.release must be an object with packId and the two claim lists' }];
  }
  if (release.packId !== SITE_PACK_ID) {
    error(`release.packId must be "${SITE_PACK_ID}" (the identifier the delivery site validates); the repository/product name is separate from it`);
  }

  const lists = {};
  for (const key of ['formallyTestedWith', 'adapterSupport']) {
    const value = release[key];
    if (value === undefined) continue;
    if (!Array.isArray(value)) {
      error(`release.${key} must be an array`);
      continue;
    }
    lists[key] = value;
    if (value.length > SITE_CLAIM_LIST_MAX) {
      error(`release.${key} accepts at most ${SITE_CLAIM_LIST_MAX} entries`);
    }
    if (value.some((item) => typeof item !== 'string' || item.trim() === '')) {
      error(`release.${key} entries must be non-empty strings`);
      continue;
    }
    const unknown = value.filter((item) => !SITE_KNOWN_TOOLS.includes(item));
    if (unknown.length > 0) {
      error(
        `release.${key} contains ${unknown.map((item) => `"${item}"`).join(', ')}; the delivery site accepts only the canonical names ${SITE_KNOWN_TOOLS.map((tool) => `"${tool}"`).join(', ')}. Put file locations in README.md and COMPATIBILITY.md, not in this list`,
      );
    }
    const duplicates = value.filter((item, index) => value.indexOf(item) !== index);
    if (duplicates.length > 0) {
      error(`release.${key} repeats ${[...new Set(duplicates)].map((item) => `"${item}"`).join(', ')}; entries must be unique`);
    }
  }

  if (Array.isArray(lists.formallyTestedWith) && Array.isArray(lists.adapterSupport)) {
    const overlap = lists.formallyTestedWith.filter((item) => lists.adapterSupport.includes(item));
    if (overlap.length > 0) {
      error(
        `${overlap.map((item) => `"${item}"`).join(', ')} appears in both formallyTestedWith and adapterSupport; a tool is either benchmarked or format-only, never both`,
      );
    }
  }

  return issues;
}

function checkRelease(report, repoRoot, meta, releaseMode) {
  // The release block feeds current.json, which the delivery site validates
  // strictly. Catching a bad edit here beats discovering it at publish time.
  const release = meta.manifest?.release;
  if (release) {
    for (const issue of inspectReleaseClaims(release)) {
      report.add(issue.level, 'release', issue.message, 'manifest.json');
    }
    for (const key of ['formallyTestedWith', 'adapterSupport']) {
      if (Array.isArray(release[key]) && release[key].length === 0) {
        report.gate(releaseMode, 'release', `release.${key} is empty; a release must state what it was tested with, from verified COMPATIBILITY.md rows`, 'manifest.json');
      }
    }
  } else {
    report.gate(releaseMode, 'release', 'manifest.json has no release block; scripts/build-release.mjs needs release.packId and the two claim lists', 'manifest.json');
  }

  const knowledge = meta.manifest?.knowledge;
  if (!knowledge) {
    report.error('release', 'manifest.json has no knowledge block', 'manifest.json');
    return;
  }
  const sourcesPath = path.join(repoRoot, 'sources.json');
  const sourcesText = tryRead(sourcesPath);
  const actualHash = sourcesText === null ? null : sha256Hex(Buffer.from(sourcesText, 'utf8'));

  const { knowledgeReviewedAt, reviewDueAt, sourceRegistrySha256 } = knowledge;
  if (!knowledgeReviewedAt || !reviewDueAt || !sourceRegistrySha256) {
    report.gate(releaseMode, 'release', 'knowledge.knowledgeReviewedAt / reviewDueAt / sourceRegistrySha256 are unset; run npm run freshness:update-manifest after a human review', 'manifest.json');
    return;
  }
  if (!SHA256_PATTERN.test(sourceRegistrySha256)) {
    report.error('release', 'knowledge.sourceRegistrySha256 must be 64 lower-case hex characters', 'manifest.json');
  } else if (actualHash && sourceRegistrySha256 !== actualHash) {
    report.error('release', 'sources.json has changed since it was last reviewed (sourceRegistrySha256 mismatch); re-review and re-run npm run freshness:update-manifest', 'manifest.json');
  }

  const reviewed = new Date(knowledgeReviewedAt);
  const due = new Date(reviewDueAt);
  const now = new Date();
  if (Number.isNaN(reviewed.getTime()) || Number.isNaN(due.getTime())) {
    report.error('release', 'knowledge.knowledgeReviewedAt / reviewDueAt must be ISO-8601 timestamps', 'manifest.json');
    return;
  }
  if (reviewed.getTime() > now.getTime()) {
    report.error('release', 'knowledge.knowledgeReviewedAt is in the future', 'manifest.json');
  }
  if (due.getTime() <= reviewed.getTime()) {
    report.error('release', 'knowledge.reviewDueAt must be later than knowledgeReviewedAt (the delivery site rejects anything else)', 'manifest.json');
  }
  if (due.getTime() > reviewed.getTime() + 365 * 24 * 60 * 60 * 1000) {
    report.error('release', 'knowledge.reviewDueAt is more than 365 days after knowledgeReviewedAt (the delivery site rejects anything else)', 'manifest.json');
  }
  if (due.getTime() < now.getTime()) {
    report.gate(releaseMode, 'release', `knowledge review is overdue (reviewDueAt ${reviewDueAt})`, 'manifest.json');
  }
}

// ---------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------

export function validatePack({ repoRoot = REPO_ROOT, releaseMode = false } = {}) {
  const report = new Report();
  const files = repoFiles(repoRoot);

  let meta;
  try {
    meta = readPackMetadata(repoRoot);
  } catch (err) {
    // manifest.json / package.json mid-write, locked, or malformed: report
    // it rather than crashing, and carry on with the checks that can still
    // run against the filesystem.
    report.error('files', `manifest.json / package.json / VERSION could not be read (${err.code ?? err.message})`);
    meta = { manifest: null, pkg: null, version: null };
  }
  const { skills, nonSkillDirs } = discoverSkills(repoRoot);

  report.info = {
    repoRoot,
    releaseMode,
    version: meta.version,
    status: meta.manifest?.status ?? null,
    skillCount: skills.length,
    fileCount: files.length,
    skippedScratchDirs: files.skipped ?? [],
    generatedFileCount: 0,
  };

  checkJsonAndFiles(report, repoRoot, files, releaseMode);
  checkVersion(report, meta, repoRoot, releaseMode);
  checkManifest(report, meta, skills, repoRoot, releaseMode);
  checkSkills(report, skills, nonSkillDirs, meta.manifest, releaseMode);
  checkReferences(report, repoRoot, files, releaseMode);
  checkAdapters(report, repoRoot, meta.manifest, releaseMode);
  checkFreshness(report, repoRoot, releaseMode);
  checkMcp(report, repoRoot, meta.manifest, releaseMode);
  checkTrademark(report, repoRoot, meta, files, releaseMode);
  checkPositioning(report, repoRoot, meta);
  checkHygiene(report, repoRoot, files, releaseMode);
  checkLicensing(report, repoRoot, meta, files);
  checkRelease(report, repoRoot, meta, releaseMode);

  try {
    report.info.generatedFileCount = planGeneration(repoRoot).files.size;
  } catch {
    /* already reported */
  }

  return report;
}

function parseArgs(argv) {
  const args = { release: false, strict: false, json: false, quiet: false, help: false, error: false };
  for (const raw of argv) {
    if (raw === '--release') args.release = true;
    else if (raw === '--strict') args.strict = true;
    else if (raw === '--json') args.json = true;
    else if (raw === '--quiet') args.quiet = true;
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
  console.log(`Usage: node scripts/validate-pack.mjs [options]

Options:
  --release   Apply release gates: scaffold-tolerant warnings become errors
              (skill count, knowledge review fields, changelog entry, MCP
              source registration, overdue sources).
  --strict    Fail on warnings as well as errors.
  --json      Machine-readable report.
  --quiet     Print only problems and the summary line.
  --help      Show this help.

Exit codes: 0 = pass, 1 = failed.
`);
}

function printReport(report, args) {
  if (args.json) {
    console.log(
      JSON.stringify(
        { ...report.info, errors: report.errors, warnings: report.warnings, ok: report.errors.length === 0 },
        null,
        2,
      ),
    );
    return;
  }
  if (!args.quiet) {
    console.log(
      `Validating ${report.info.repoRoot}\n` +
        `  version ${report.info.version ?? '(none)'} | status ${report.info.status ?? '(none)'} | ` +
        `${report.info.skillCount} skill(s) | ${report.info.fileCount} file(s)` +
        `${report.info.releaseMode ? ' | RELEASE MODE' : ''}` +
        `${(report.info.skippedScratchDirs ?? []).length > 0 ? `\n  skipped scratch: ${report.info.skippedScratchDirs.join(', ')}` : ''}\n`,
    );
  }
  for (const issue of report.issues) {
    const marker = issue.level === 'error' ? 'ERROR' : 'WARN ';
    console.log(`${marker} [${issue.check}] ${issue.file ? `${issue.file}: ` : ''}${issue.message}`);
  }
  const errors = report.errors.length;
  const warnings = report.warnings.length;
  console.log(`\n${errors} error(s), ${warnings} warning(s).`);
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return args.error ? 1 : 0;
  }
  const report = validatePack({ releaseMode: args.release });
  printReport(report, args);
  if (report.errors.length > 0) return 1;
  if (args.strict && report.warnings.length > 0) return 1;
  return 0;
}

if (isMain(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(`validate-pack failed: ${err.stack ?? err.message}`);
    process.exitCode = 1;
  }
}
