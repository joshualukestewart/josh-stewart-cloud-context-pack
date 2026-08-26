#!/usr/bin/env node
/**
 * scripts/generate-adapters.mjs
 *
 * Deterministically generates this pack's tool adapters and physical skill
 * mirrors from the canonical sources:
 *
 *   AGENTS.md          -> .github/copilot-instructions.md, CLAUDE.md, GEMINI.md
 *   .agents/skills/**  -> .github/skills/**, .claude/skills/**  (real copies)
 *
 * Design rules this script keeps:
 *   - Deterministic: identical inputs always produce identical bytes. No
 *     timestamps, no locale-dependent sorting, LF line endings only.
 *   - Concise adapters: they point at AGENTS.md rather than duplicating it,
 *     because every adapter that duplicates prose eventually contradicts it.
 *   - CLAUDE.md explicitly imports @AGENTS.md: Claude does not read
 *     AGENTS.md on its own, so the import is what actually loads the core.
 *   - Mirrors are physical copies, never symlinks (symlinks do not survive
 *     archive extraction, Windows checkouts, or most tools' skill loaders).
 *   - Bounded blast radius: writes and deletes are confined to the declared
 *     adapter targets and mirror roots inside this repository. Nothing else
 *     is ever created, overwritten or removed.
 *
 * Usage:
 *   node scripts/generate-adapters.mjs [--check] [--json] [--quiet] [--help]
 *
 * Exit codes: 0 = up to date / written, 1 = drift (--check) or error.
 */

import { mkdirSync, rmSync, writeFileSync, readdirSync, rmdirSync } from 'node:fs';
import path from 'node:path';

import {
  ADAPTERS,
  CANONICAL_SKILLS_DIR,
  CORE_ENTRY,
  LEARN_MCP,
  REPO_ROOT,
  SKILL_MIRRORS,
  byteCompare,
  discoverSkills,
  isDirectory,
  isFile,
  isInside,
  isMain,
  listFiles,
  readFileSyncRetry,
  readPackMetadata,
  readText,
  tableCell,
} from './lib/pack-lib.mjs';

const BANNER_LINES = [
  'GENERATED FILE - DO NOT EDIT BY HAND.',
  '',
  'Source of truth: AGENTS.md and .agents/skills/.',
  'Regenerate with:  npm run generate',
  'Verify in CI with: npm run check',
];

// ---------------------------------------------------------------------
// AGENTS.md extraction
// ---------------------------------------------------------------------

/** Split AGENTS.md into { title, sections: [{heading, lines}] }. */
function parseCore(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const sections = [];
  let current = null;
  for (const line of lines) {
    const match = /^##\s+(.*)$/.exec(line);
    if (match) {
      current = { heading: match[1].trim(), lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return sections;
}

function findSection(sections, patterns) {
  for (const pattern of patterns) {
    const hit = sections.find((section) => pattern.test(section.heading));
    if (hit) return hit;
  }
  return null;
}

/** Collect top-level list items from a section, flattened to one line each. */
function listItems(section, limit) {
  if (!section) return [];
  const items = [];
  let buffer = null;
  const flush = () => {
    if (buffer) items.push(buffer.replace(/\s+/g, ' ').trim());
    buffer = null;
  };
  for (const line of section.lines) {
    const bullet = /^\s{0,3}(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
    if (bullet) {
      flush();
      buffer = bullet[1];
    } else if (buffer && /^\s{2,}\S/.test(line)) {
      buffer += ` ${line.trim()}`;
    } else if (/^\s*$/.test(line)) {
      flush();
    }
  }
  flush();
  return items.filter(Boolean).slice(0, limit);
}

/** Rewrite root-relative markdown links for a file living in `fromDir`. */
function relink(text, fromDir) {
  if (fromDir === '.') return text;
  const prefix = fromDir
    .split('/')
    .map(() => '..')
    .join('/');
  return text.replace(/\]\(([^)\s]+)\)/g, (whole, target) => {
    if (/^(?:[a-z]+:|#|\/)/i.test(target)) return whole;
    return `](${prefix}/${target})`;
  });
}

// ---------------------------------------------------------------------
// Adapter rendering
// ---------------------------------------------------------------------

function renderSkillTable(skills, { fromDir, skillPathFor }) {
  if (skills.length === 0) {
    return [
      `No skills are authored yet under \`${CANONICAL_SKILLS_DIR}/\`. Do not assume any`,
      'skill content exists; treat the core file above as the whole pack.',
    ].join('\n');
  }
  const rows = skills.map((skill) => {
    const link = relink(`[\`${skill.dirName}\`](${skillPathFor(skill)})`, fromDir);
    return `| ${link} | ${tableCell(skill.description ?? '(no description in front matter)')} |`;
  });
  return ['| Skill | Use it when |', '| --- | --- |', ...rows].join('\n');
}

function renderAdapter({ tool, label, target, skills, meta }) {
  const fromDir = path.posix.dirname(target) === '.' ? '.' : path.posix.dirname(target);
  const banner = `<!--\n${BANNER_LINES.join('\n')}\n-->`;
  const version = meta.manifest?.version ?? meta.version ?? 'unversioned';
  const status = meta.manifest?.status ?? 'unknown';
  const lines = [banner, ''];
  if (tool === 'claude' || tool === 'gemini') {
    lines.push(
      `# ${label} instructions`,
      '',
      `@${CORE_ENTRY}`,
      '',
      `The import above loads the canonical operating contract. Follow it in full.`,
    );
  } else {
    lines.push(
      `# ${label} instructions`,
      '',
      `Read ${relink(`[${CORE_ENTRY}](${CORE_ENTRY})`, fromDir)} first and follow it`,
      'as the canonical operating contract.',
    );
  }

  const skillDir =
    tool === 'copilot'
      ? '.github/skills/'
      : tool === 'claude'
        ? '.claude/skills/'
        : '.agents/skills/';
  lines.push(
    '',
    `Pack version \`${version}\` (status: \`${status}\`), ${skills.length} canonical ` +
      `skill${skills.length === 1 ? '' : 's'}.`,
    '',
    `Load only the skill matching the task from \`${skillDir}\`; native skill`,
    'discovery carries each skill description on demand, so it is not duplicated here.',
    '',
    '- Stay within the requested scope. If no skill matches, do not load one or add secondary advice.',
    '- Never introduce secrets or private identifiers; use managed identity and OIDC.',
    `- Retrieve volatile Microsoft facts live via \`${LEARN_MCP.url}\` or a primary source; do not guess.`,
    '- Preserve the consuming repository conventions and run the smallest relevant verification.',
    '',
  );

  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

function renderMirrorReadme(mirror, skills) {
  const rows =
    skills.length === 0
      ? ['_No skills are authored in the canonical directory yet, so this mirror is empty._']
      : ['| Skill | Canonical source |', '| --- | --- |', ...skills.map((s) => `| \`${s.dirName}\` | \`${s.dirRel}/\` |`)];
  return [
    `# \`${mirror.dir}/\` (generated mirror)`,
    '',
    `Physical copy of \`${CANONICAL_SKILLS_DIR}/\` for ${mirror.tool}, produced by`,
    '`npm run generate` (`scripts/generate-adapters.mjs`).',
    '',
    '**Do not edit anything in this directory.** Edit the canonical skill under',
    `\`${CANONICAL_SKILLS_DIR}/\` and regenerate; \`npm run check\` fails on drift.`,
    'These are real files rather than symlinks so they survive archive',
    'extraction, Windows checkouts and tool skill loaders.',
    '',
    ...rows,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------

/**
 * Compute every file this generator owns, without touching the disk.
 * Returns { files, prunable, skills, outputRoots }, where `files` maps a
 * repo-relative POSIX path to the exact Buffer that should be on disk.
 */
export function planGeneration(repoRoot = REPO_ROOT) {
  const corePath = path.join(repoRoot, CORE_ENTRY);
  if (!isFile(corePath)) {
    throw new Error(`${CORE_ENTRY} not found at ${corePath}; nothing to generate from`);
  }
  const core = parseCore(readText(corePath));
  const meta = readPackMetadata(repoRoot);
  const { skills } = discoverSkills(repoRoot);

  const files = new Map();
  for (const adapter of ADAPTERS) {
    const content = renderAdapter({ ...adapter, core, skills, meta });
    files.set(adapter.target, Buffer.from(content, 'utf8'));
  }

  // A skill whose source could not be read must stop generation outright:
  // mirroring it partially, or dropping it from the index, would publish a
  // silently incomplete pack.
  const unreadable = skills.filter((skill) => skill.readError);
  if (unreadable.length > 0) {
    throw new Error(
      `cannot generate while these skill sources are unreadable: ${unreadable
        .map((skill) => `${skill.skillMdRel} (${skill.readError})`)
        .join(', ')}`,
    );
  }

  for (const mirror of SKILL_MIRRORS) {
    files.set(`${mirror.dir}/README.md`, Buffer.from(renderMirrorReadme(mirror, skills), 'utf8'));
    for (const skill of skills) {
      for (const rel of skill.files) {
        const source = path.join(skill.dirAbs, ...rel.split('/'));
        files.set(`${mirror.dir}/${skill.dirName}/${rel}`, readFileSyncRetry(source));
      }
    }
  }

  // Stale mirror content: anything inside a mirrored skill directory that
  // the canonical directory no longer produces. Files sitting directly in a
  // mirror root (other than the generated README) are left alone - they are
  // not ours to delete.
  const prunable = [];
  for (const mirror of SKILL_MIRRORS) {
    const mirrorAbs = path.join(repoRoot, ...mirror.dir.split('/'));
    if (!isDirectory(mirrorAbs)) continue;
    for (const rel of listFiles(mirrorAbs, { root: mirrorAbs })) {
      const full = `${mirror.dir}/${rel}`;
      if (files.has(full)) continue;
      if (!rel.includes('/')) continue; // mirror-root file, not generated content
      prunable.push(full);
    }
  }

  const outputRoots = [
    ...ADAPTERS.map((adapter) => adapter.target),
    ...SKILL_MIRRORS.map((mirror) => mirror.dir),
  ];

  return {
    files: new Map([...files.entries()].sort((a, b) => byteCompare(a[0], b[0]))),
    prunable: prunable.sort(byteCompare),
    skills,
    outputRoots,
  };
}

/** Compare a plan against the working tree. */
export function diffPlan(plan, repoRoot = REPO_ROOT) {
  const missing = [];
  const changed = [];
  const unreadable = [];
  for (const [rel, content] of plan.files) {
    const abs = path.join(repoRoot, ...rel.split('/'));
    if (!isFile(abs)) {
      missing.push(rel);
      continue;
    }
    let current;
    try {
      current = readFileSyncRetry(abs);
    } catch (err) {
      unreadable.push(`${rel} (${err.code ?? err.message})`);
      continue;
    }
    if (Buffer.compare(current, content) !== 0) changed.push(rel);
  }
  return {
    missing,
    changed,
    unreadable,
    stale: plan.prunable,
    clean:
      missing.length === 0 && changed.length === 0 && unreadable.length === 0 && plan.prunable.length === 0,
  };
}

// ---------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------

function assertWritable(repoRoot, rel, outputRoots) {
  const abs = path.join(repoRoot, ...rel.split('/'));
  if (!isInside(repoRoot, abs)) throw new Error(`refusing to write outside the repository: ${rel}`);
  const allowed = outputRoots.some((root) => rel === root || rel.startsWith(`${root}/`));
  if (!allowed) throw new Error(`refusing to write outside this generator's declared outputs: ${rel}`);
  return abs;
}

function pruneEmptyDirs(repoRoot, rel) {
  let dir = path.dirname(path.join(repoRoot, ...rel.split('/')));
  while (isInside(repoRoot, dir) && path.resolve(dir) !== path.resolve(repoRoot)) {
    try {
      if (readdirSync(dir).length > 0) return;
      rmdirSync(dir);
    } catch {
      return;
    }
    dir = path.dirname(dir);
  }
}

export function applyPlan(plan, repoRoot) {
  const written = [];
  const unchanged = [];
  const removed = [];

  for (const [rel, content] of plan.files) {
    const abs = assertWritable(repoRoot, rel, plan.outputRoots);
    let identical = false;
    if (isFile(abs)) {
      try {
        identical = Buffer.compare(readFileSyncRetry(abs), content) === 0;
      } catch {
        identical = false; // unreadable target: rewrite it rather than trust it
      }
    }
    if (identical) {
      unchanged.push(rel);
      continue;
    }
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    written.push(rel);
  }

  for (const rel of plan.prunable) {
    const abs = assertWritable(repoRoot, rel, plan.outputRoots);
    rmSync(abs, { force: true });
    removed.push(rel);
    pruneEmptyDirs(repoRoot, rel);
  }

  return { written, unchanged, removed };
}

// ---------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------

function parseArgs(argv) {
  const args = { check: false, json: false, quiet: false, help: false };
  for (const raw of argv) {
    if (raw === '--check') args.check = true;
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
  console.log(`Usage: node scripts/generate-adapters.mjs [options]

Generates .github/copilot-instructions.md, CLAUDE.md, GEMINI.md and the
physical .github/skills/ and .claude/skills/ mirrors from AGENTS.md and
.agents/skills/.

Options:
  --check    Do not write anything; exit 1 if any generated file is missing,
             out of date, or stale. Intended for CI.
  --json     Machine-readable output.
  --quiet    Only print problems.
  --help     Show this help.
`);
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return args.error ? 1 : 0;
  }

  const plan = planGeneration(REPO_ROOT);

  if (args.check) {
    const diff = diffPlan(plan, REPO_ROOT);
    if (args.json) {
      console.log(JSON.stringify({ mode: 'check', ...diff, skills: plan.skills.map((s) => s.dirName) }, null, 2));
    } else if (diff.clean) {
      if (!args.quiet) console.log(`Adapters and skill mirrors are up to date (${plan.files.size} generated files).`);
    } else {
      console.error('Generated files are out of date. Run: npm run generate');
      for (const rel of diff.missing) console.error(`  missing:    ${rel}`);
      for (const rel of diff.changed) console.error(`  drifted:    ${rel}`);
      for (const rel of diff.stale) console.error(`  stale:      ${rel}`);
      for (const entry of diff.unreadable ?? []) console.error(`  unreadable: ${entry}`);
    }
    return diff.clean ? 0 : 1;
  }

  const result = applyPlan(plan, REPO_ROOT);
  if (args.json) {
    console.log(JSON.stringify({ mode: 'write', ...result }, null, 2));
  } else if (!args.quiet) {
    for (const rel of result.written) console.log(`  wrote:   ${rel}`);
    for (const rel of result.removed) console.log(`  removed: ${rel}`);
    console.log(
      `Generated ${plan.files.size} file(s): ${result.written.length} written, ` +
        `${result.unchanged.length} unchanged, ${result.removed.length} removed.`,
    );
  }
  return 0;
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(`generate-adapters failed: ${err.message}`);
      process.exitCode = 1;
    });
}
