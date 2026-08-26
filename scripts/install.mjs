#!/usr/bin/env node
/**
 * scripts/install.mjs
 *
 * Installs selected parts of this pack into another project, for one of
 * four agent tools. Dependency-free (Node >=20, built-in modules only).
 *
 * Safety model (this script writes into someone else's repository, so the
 * defaults are deliberately timid):
 *   - Dry run by default. Nothing is written without an explicit --write.
 *   - Never overwrites an existing, differing file without --force.
 *   - Every path is reported with the action taken, in both modes.
 *   - All writes are confined to --target; a path that would escape it, or
 *     that targets this pack itself, aborts the whole run.
 *   - MCP configuration is merged, never replaced: existing servers and
 *     unrelated keys in the target's config are preserved byte-for-byte
 *     apart from the single key this script adds.
 *   - Only the endpoint is configured. Tool/prompt/resource schemas are
 *     discovered by the MCP client at runtime and are never written here.
 *
 * Usage:
 *   node scripts/install.mjs --tool=copilot|claude|codex|gemini --target=<dir>
 *                            [--write] [--force] [--skills=a,b] [--no-mcp]
 *                            [--json] [--help]
 *
 * Exit codes: 0 = clean (planned or written), 1 = conflicts or error.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import {
  ADAPTERS,
  CANONICAL_SKILLS_DIR,
  CORE_ENTRY,
  LEARN_MCP,
  MCP_TARGETS,
  REPO_ROOT,
  byteCompare,
  discoverSkills,
  isDirectory,
  isFile,
  isInside,
  isMain,
  readPackMetadata,
  sha256Hex,
} from './lib/pack-lib.mjs';

const TOOLS = {
  copilot: {
    label: 'GitHub Copilot',
    adapter: '.github/copilot-instructions.md',
    skillsDir: '.github/skills',
    mcp: 'copilot',
  },
  claude: {
    label: 'Claude',
    adapter: 'CLAUDE.md',
    skillsDir: '.claude/skills',
    mcp: 'claude',
  },
  gemini: {
    label: 'Gemini',
    adapter: 'GEMINI.md',
    skillsDir: CANONICAL_SKILLS_DIR,
    mcp: 'gemini',
  },
  codex: {
    label: 'Codex',
    // Codex reads AGENTS.md directly, so the core file is the adapter.
    adapter: null,
    skillsDir: CANONICAL_SKILLS_DIR,
    mcp: 'codex',
  },
};

const ATTRIBUTION_DIR = '.context-pack';

// ---------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (typeof a !== 'object') return false;
  const aKeys = Object.keys(a).sort(byteCompare);
  const bKeys = Object.keys(b).sort(byteCompare);
  if (aKeys.join(',') !== bKeys.join(',')) return false;
  return aKeys.every((key) => deepEqual(a[key], b[key]));
}

function classify(targetRoot, rel, content) {
  const abs = path.join(targetRoot, ...rel.split('/'));
  if (!isFile(abs)) return { rel, abs, action: 'create', content };
  const existing = readFileSync(abs);
  if (Buffer.compare(existing, content) === 0) return { rel, abs, action: 'unchanged', content };
  return { rel, abs, action: 'conflict', content };
}

/**
 * Merge this pack's MCP endpoint into whatever the target already has.
 * Returns a planned file plus a description of what changed, or a conflict
 * when the target already defines the same server differently.
 */
function planMcp(targetRoot, toolKey) {
  const config = MCP_TARGETS[toolKey];
  if (!config) return null;
  if (!config.writable) {
    return { kind: 'snippet', file: config.file, snippet: config.snippet, note: config.note };
  }
  const abs = path.join(targetRoot, ...config.file.split('/'));
  let existing = {};
  if (isFile(abs)) {
    try {
      existing = JSON.parse(readFileSync(abs, 'utf8'));
    } catch (err) {
      return { kind: 'error', file: config.file, message: `existing ${config.file} is not valid JSON (${err.message}); refusing to touch it` };
    }
    if (existing === null || typeof existing !== 'object' || Array.isArray(existing)) {
      return { kind: 'error', file: config.file, message: `existing ${config.file} is not a JSON object; refusing to touch it` };
    }
  }
  const wrapper = existing[config.wrapper];
  if (wrapper !== undefined && (wrapper === null || typeof wrapper !== 'object' || Array.isArray(wrapper))) {
    return { kind: 'error', file: config.file, message: `existing ${config.file} has a non-object "${config.wrapper}" key; refusing to touch it` };
  }
  const servers = { ...(wrapper ?? {}) };
  const current = servers[LEARN_MCP.id];
  const merged = { ...existing, [config.wrapper]: { ...servers, [LEARN_MCP.id]: config.entry } };
  const content = Buffer.from(`${JSON.stringify(merged, null, 2)}\n`, 'utf8');

  let action = 'create';
  if (isFile(abs)) {
    action = current === undefined ? 'merge' : deepEqual(current, config.entry) ? 'unchanged' : 'conflict';
    if (action === 'unchanged' && Buffer.compare(readFileSync(abs), content) !== 0) {
      // Same server entry, different formatting elsewhere in the file: do
      // not rewrite the target's file just to reformat it.
      return { kind: 'file', file: config.file, plan: { rel: config.file, abs, action: 'unchanged', content: readFileSync(abs) }, note: config.note };
    }
  }
  return { kind: 'file', file: config.file, plan: { rel: config.file, abs, action, content }, note: config.note };
}

export function planInstall({ packRoot = REPO_ROOT, targetRoot, tool, skillFilter = null, includeMcp = true }) {
  const spec = TOOLS[tool];
  if (!spec) throw new Error(`unknown tool "${tool}" (expected: ${Object.keys(TOOLS).join(', ')})`);

  const meta = readPackMetadata(packRoot);
  const { skills } = discoverSkills(packRoot);
  const selected = skillFilter
    ? skills.filter((skill) => skillFilter.includes(skill.dirName))
    : skills;
  if (skillFilter) {
    const known = new Set(skills.map((s) => s.dirName));
    for (const name of skillFilter) {
      if (!known.has(name)) throw new Error(`no such skill: "${name}" (available: ${[...known].join(', ') || 'none'})`);
    }
  }

  const sources = new Map();
  const corePath = path.join(packRoot, CORE_ENTRY);
  if (!isFile(corePath)) throw new Error(`${CORE_ENTRY} is missing from the pack`);
  sources.set(CORE_ENTRY, readFileSync(corePath));

  if (spec.adapter) {
    const adapterAbs = path.join(packRoot, ...spec.adapter.split('/'));
    if (!isFile(adapterAbs)) {
      throw new Error(`${spec.adapter} has not been generated yet; run "npm run generate" in the pack first`);
    }
    sources.set(spec.adapter, readFileSync(adapterAbs));
  }

  for (const skill of selected) {
    for (const rel of skill.files) {
      sources.set(`${spec.skillsDir}/${skill.dirName}/${rel}`, readFileSync(path.join(skill.dirAbs, ...rel.split('/'))));
    }
  }

  for (const name of ['LICENSE', 'NOTICE']) {
    const abs = path.join(packRoot, name);
    if (isFile(abs)) sources.set(`${ATTRIBUTION_DIR}/${name}`, readFileSync(abs));
  }

  const receipt = {
    packId: 'cloud-full-stack',
    packName: meta.manifest?.name ?? null,
    packVersion: meta.version ?? meta.manifest?.version ?? null,
    repository: typeof meta.manifest?.repository === 'string' ? meta.manifest.repository : meta.manifest?.repository?.url ?? null,
    tool,
    installedSkills: selected.map((s) => s.dirName).sort(byteCompare),
    files: [...sources.keys()].sort(byteCompare).map((rel) => ({ path: rel, sha256: sha256Hex(sources.get(rel)) })),
  };
  sources.set(`${ATTRIBUTION_DIR}/install-receipt.json`, Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, 'utf8'));

  const files = [...sources.keys()].sort(byteCompare).map((rel) => classify(targetRoot, rel, sources.get(rel)));

  const mcp = includeMcp ? planMcp(targetRoot, spec.mcp) : null;
  if (mcp && mcp.kind === 'file') files.push(mcp.plan);

  return { tool, spec, files, mcp, skills: selected, packVersion: receipt.packVersion, adapters: ADAPTERS };
}

// ---------------------------------------------------------------------
// Target validation
// ---------------------------------------------------------------------

function resolveTarget(rawTarget, packRoot) {
  if (!rawTarget) throw new Error('--target=<dir> is required');
  const targetRoot = path.resolve(rawTarget);
  if (!isDirectory(targetRoot)) throw new Error(`target directory does not exist: ${targetRoot}`);
  if (path.resolve(targetRoot) === path.resolve(packRoot)) throw new Error('refusing to install the pack into itself');
  if (isInside(packRoot, targetRoot)) throw new Error('refusing to install into a directory inside the pack');
  if (path.resolve(targetRoot) === path.resolve(homedir())) throw new Error('refusing to install into the home directory');
  if (path.dirname(targetRoot) === targetRoot) throw new Error('refusing to install into a filesystem root');
  return targetRoot;
}

function assertContained(targetRoot, plan) {
  for (const file of plan.files) {
    if (!isInside(targetRoot, file.abs)) {
      throw new Error(`refusing to write outside the target directory: ${file.rel}`);
    }
  }
}

// ---------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------

function applyInstall(plan, { force }) {
  const applied = [];
  for (const file of plan.files) {
    if (file.action === 'unchanged') {
      applied.push({ ...file, applied: 'skipped (identical)' });
      continue;
    }
    if (file.action === 'conflict' && !force) {
      applied.push({ ...file, applied: 'skipped (conflict)' });
      continue;
    }
    mkdirSync(path.dirname(file.abs), { recursive: true });
    writeFileSync(file.abs, file.content);
    applied.push({ ...file, applied: file.action === 'conflict' ? 'overwritten' : 'written' });
  }
  return applied;
}

// ---------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    tool: null,
    target: null,
    write: false,
    force: false,
    skills: null,
    mcp: true,
    json: false,
    help: false,
    error: false,
  };
  for (const raw of argv) {
    if (raw.startsWith('--tool=')) args.tool = raw.slice('--tool='.length).trim().toLowerCase();
    else if (raw.startsWith('--target=')) args.target = raw.slice('--target='.length).trim();
    else if (raw === '--write') args.write = true;
    else if (raw === '--force') args.force = true;
    else if (raw === '--no-mcp') args.mcp = false;
    else if (raw.startsWith('--skills=')) {
      args.skills = raw
        .slice('--skills='.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (raw === '--json') args.json = true;
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
  console.log(`Usage: node scripts/install.mjs --tool=<tool> --target=<dir> [options]

Tools: ${Object.keys(TOOLS).join(', ')}

Options:
  --tool=<tool>     Which agent tool's layout to install.
  --target=<dir>    Project to install into. Must exist, and must not be
                    this pack or a directory inside it.
  --write           Actually write. Without it, this is a dry run.
  --force           Overwrite existing files that differ. Never implied.
  --skills=a,b      Install only these skills (default: all).
  --no-mcp          Do not configure the Microsoft Learn MCP endpoint.
  --json            Machine-readable plan/result.
  --help            Show this help.

What gets installed per tool:
  copilot  ${CORE_ENTRY}, .github/copilot-instructions.md, .github/skills/, .vscode/mcp.json
  claude   ${CORE_ENTRY}, CLAUDE.md, .claude/skills/, .mcp.json
  gemini   ${CORE_ENTRY}, GEMINI.md, ${CANONICAL_SKILLS_DIR}/, .gemini/settings.json
  codex    ${CORE_ENTRY}, ${CANONICAL_SKILLS_DIR}/ (Codex reads AGENTS.md directly;
           its MCP config is user-level, so the snippet is printed, not written)

Every run also writes ${ATTRIBUTION_DIR}/ with this pack's LICENSE, NOTICE and an
install receipt, so the target project keeps attribution and provenance.

Exit codes: 0 = clean, 1 = conflicts (rerun with --force) or error.
`);
}

function summarise(plan, applied, args) {
  const rows = applied ?? plan.files.map((f) => ({ ...f, applied: f.action }));
  const conflicts = rows.filter((r) => r.action === 'conflict' && r.applied !== 'overwritten');

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          tool: plan.tool,
          packVersion: plan.packVersion,
          mode: args.write ? 'write' : 'dry-run',
          skills: plan.skills.map((s) => s.dirName),
          files: rows.map(({ rel, action, applied: state }) => ({ path: rel, action, result: state })),
          mcp: plan.mcp
            ? plan.mcp.kind === 'file'
              ? { kind: 'file', file: plan.mcp.file, note: plan.mcp.note }
              : plan.mcp
            : null,
          conflicts: conflicts.map((c) => c.rel),
        },
        null,
        2,
      ),
    );
    return conflicts.length;
  }

  console.log(`${args.write ? 'Installing' : 'Planning (dry run)'} ${plan.spec.label} files, pack version ${plan.packVersion ?? 'unknown'}\n`);
  for (const row of rows) {
    const state = args.write ? row.applied : row.action;
    console.log(`  ${String(state).padEnd(20)} ${row.rel}`);
  }
  if (plan.mcp && plan.mcp.kind === 'snippet') {
    console.log(`\nMCP: ${plan.mcp.note}`);
    console.log(`Add this to ${plan.mcp.file} yourself:\n`);
    console.log(
      plan.mcp.snippet
        .split('\n')
        .map((line) => `    ${line}`)
        .join('\n'),
    );
  } else if (plan.mcp && plan.mcp.kind === 'error') {
    console.log(`\nMCP: ${plan.mcp.message}`);
  } else if (plan.mcp) {
    console.log(`\nMCP: ${plan.mcp.note}`);
    console.log(`     ${LEARN_MCP.id} -> ${LEARN_MCP.url} (endpoint only; tools are discovered at runtime)`);
  }

  if (conflicts.length > 0) {
    console.log(`\n${conflicts.length} file(s) already exist with different content and were not touched:`);
    for (const conflict of conflicts) console.log(`  ${conflict.rel}`);
    console.log('Re-run with --force to overwrite them.');
  } else if (!args.write) {
    console.log('\nNothing was written. Re-run with --write to apply this plan.');
  }
  return conflicts.length;
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.help || (!args.tool && !args.target)) {
    printHelp();
    return args.error ? 1 : 0;
  }
  if (!args.tool) {
    console.error(`--tool=<${Object.keys(TOOLS).join('|')}> is required`);
    return 1;
  }
  const targetRoot = resolveTarget(args.target, REPO_ROOT);
  const plan = planInstall({
    packRoot: REPO_ROOT,
    targetRoot,
    tool: args.tool,
    skillFilter: args.skills,
    includeMcp: args.mcp,
  });
  assertContained(targetRoot, plan);

  const mcpError = plan.mcp?.kind === 'error';
  if (mcpError && args.write) {
    console.error(`MCP configuration aborted: ${plan.mcp.message}`);
    return 1;
  }

  const applied = args.write ? applyInstall(plan, { force: args.force }) : null;
  const conflicts = summarise(plan, applied, args);
  return conflicts > 0 || mcpError ? 1 : 0;
}

if (isMain(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(`install failed: ${err.message}`);
    process.exitCode = 1;
  }
}
