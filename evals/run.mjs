#!/usr/bin/env node
/**
 * evals/run.mjs
 *
 * Dependency-free orchestration for this pack's baseline-versus-pack
 * evaluation suite. Node >=20, built-in modules only (fs, path, url,
 * crypto), matching scripts/check-freshness.mjs's policy.
 *
 * What this script does:
 *   --prepare    Builds clean, reproducible workspaces at
 *                <root>/iteration-<N>/<eval-id>/{with_pack,without_pack}/,
 *                copies the case fixtures into each, copies the pack
 *                context files into the with_pack arm only, records a
 *                SHA-256 manifest of everything it wrote, assigns blind
 *                labels, and emits a run.json template for the operator.
 *   --grade      Reads the operator-completed run.json and the captured
 *                transcript, enforces the evidence gate (fail closed),
 *                executes the declared mechanical assertions against files
 *                only, and writes grade.json.
 *   --aggregate  Rolls graded runs up into a benchmark.json validated
 *                against benchmark.schema.json, including launch-gate
 *                verdicts. Anything that cannot be computed from complete
 *                evidence is null and its gate is 'insufficient-data',
 *                never 'pass'.
 *   --validate   Validates evals.json against evals.schema.json and checks
 *                the suite's internal consistency (fixtures exist, every
 *                path an assertion depends on exists, manual assertions
 *                declare a judge).
 *
 * What this script deliberately never does:
 *   - It never launches an agent. It does not import node:child_process and
 *     spawns no process of any kind. The selected agent tool is driven by
 *     hand; see README.md for the protocol and release-gate designation.
 *   - It never executes, compiles, evaluates or imports anything an agent
 *     produced. Mechanical assertions read files, hash them, regex-match
 *     them and JSON.parse them. Nothing else. See ASSERTIONS.md.
 *   - It never touches the network.
 *   - It never writes outside the runs root it was given, and it refuses to
 *     delete a path that does not resolve inside that root.
 *   - It never infers a missing measurement. Absent evidence is recorded as
 *     absent, and absence fails the gate rather than being rounded to a
 *     benefit of the doubt.
 *
 * Exit codes:
 *   0 = the requested command completed and every requested unit was
 *       processed with complete evidence. Assertion failures are results,
 *       not errors, and still exit 0.
 *   1 = usage error, I/O error, invalid JSON/schema, or a fail-closed
 *       condition: missing evidence, missing run.json, unreadable
 *       transcript, or a benchmark that failed its own schema validation.
 *
 * Usage: node evals/run.mjs --help
 */

import { readFile, writeFile, mkdir, readdir, stat, rm, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const EVALS_DIR = path.dirname(__filename);
const REPO_ROOT = path.resolve(EVALS_DIR, '..');

const EVALS_PATH = path.join(EVALS_DIR, 'evals.json');
const EVALS_SCHEMA_PATH = path.join(EVALS_DIR, 'evals.schema.json');
const RUN_SCHEMA_PATH = path.join(EVALS_DIR, 'run.schema.json');
const BENCHMARK_SCHEMA_PATH = path.join(EVALS_DIR, 'benchmark.schema.json');
const DEFAULT_RUNS_ROOT = path.join(EVALS_DIR, 'runs');

const ARMS = ['with_pack', 'without_pack'];
const RUN_SCHEMA_VERSION = '1.0.0';
const GRADE_SCHEMA_VERSION = '1.0.0';
const BENCHMARK_SCHEMA_VERSION = '1.0.0';
const DEFAULT_REQUIRED_RUNS = 2;

/** Minimum number of operator-supplied characters before a transcript counts as captured. */
const MIN_TRANSCRIPT_CHARS = 200;
/** Files larger than this are not scanned by content assertions; see ASSERTIONS.md. */
const MAX_SCAN_BYTES = 2 * 1024 * 1024;

const TRANSCRIPT_TEMPLATE_MARKER = '<!-- PASTE THE FULL AGENT TRANSCRIPT BELOW THIS LINE -->';

/**
 * Repository-root-relative paths copied into the with_pack workspace and
 * nowhere else. A path that does not exist is skipped and recorded as
 * skipped, so PACK-STATE.json always shows exactly what the arm contained.
 */
const PACK_CONTEXT_PATHS = [
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  'manifest.json',
  'VERSION',
  '.github/copilot-instructions.md',
  '.github/instructions',
  '.github/skills',
  '.claude/skills',
  '.claude/rules',
  '.agents/skills',
];

// ---------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------

function printHelp() {
  console.log(`Usage: node evals/run.mjs <command> [options]

Commands (exactly one required):
  --prepare       Create clean iteration-N/<eval-id>/{with_pack,without_pack}
                  workspaces, copy fixtures, copy pack context into the
                  with_pack arm only, record SHA-256 manifests, assign blind
                  labels, and emit run.json templates for the operator.
  --grade         Grade prepared runs whose run.json and transcript.md the
                  operator has completed. Enforces the evidence gate, then
                  runs the declared mechanical assertions. Writes grade.json.
  --aggregate     Combine graded runs into benchmark.json and evaluate the
                  launch gates. Refuses to publish a number it cannot
                  compute from complete evidence.
  --validate      Validate evals.json against evals.schema.json and check
                  the suite's internal consistency. Touches nothing.

Options:
  --iteration=N       Iteration number (integer >= 1). Repeatable for
                      --aggregate, which then pools the listed iterations.
                      One iteration is one complete pass of one tool over
                      the suite; two passes means two iterations.
  --eval=ID[,ID...]   Restrict to the named case ids. Default: all cases.
  --arm=ARM           Restrict to with_pack or without_pack. Default: both.
  --tool=ID           --aggregate only. Restrict to runs whose
                      run.json tool.id matches, so a benchmark is not
                      silently pooled across different agents.
  --root=DIR          Where iteration directories live.
                      Default: evals/runs (git-ignored).
  --seed=STRING       Blind-label seed. Same seed gives the same labels, so
                      a prepare can be reproduced. Default: iteration-<N>.
  --required-runs=N   Runs per case per arm the protocol requires before a
                      case is comparable. Default: ${DEFAULT_REQUIRED_RUNS}.
  --force             --prepare only. Delete and recreate an existing arm
                      directory. Refuses to touch anything outside --root.
  --export-blinded    --grade only. Also copy each captured transcript to
                      <iteration>/blinding/<eval-id>/<label>.md so a judge
                      can read it without seeing which arm produced it.
  --format=text|json  Report format. Default: text.
  --help, -h          Show this help.

This script never launches GitHub Copilot, Claude Code, or any other agent,
and never executes anything an agent produced. See ASSERTIONS.md.

Exit codes: 0 = completed with complete evidence, 1 = usage/IO/schema error
or a fail-closed condition (missing evidence).
`);
}

function parseArgs(argv) {
  const args = {
    command: null,
    iterations: [],
    evalIds: null,
    arms: null,
    toolId: null,
    root: DEFAULT_RUNS_ROOT,
    seed: null,
    requiredRuns: DEFAULT_REQUIRED_RUNS,
    force: false,
    exportBlinded: false,
    format: 'text',
    help: false,
    errors: [],
  };

  const setCommand = (name) => {
    if (args.command && args.command !== name) {
      args.errors.push(`Only one command may be given (saw --${args.command} and --${name}).`);
    }
    args.command = name;
  };

  for (const raw of argv) {
    if (raw === '--prepare') setCommand('prepare');
    else if (raw === '--grade') setCommand('grade');
    else if (raw === '--aggregate') setCommand('aggregate');
    else if (raw === '--validate') setCommand('validate');
    else if (raw === '--force') args.force = true;
    else if (raw === '--export-blinded') args.exportBlinded = true;
    else if (raw === '--help' || raw === '-h') args.help = true;
    else if (raw.startsWith('--iteration=')) {
      const value = Number(raw.slice('--iteration='.length));
      if (!Number.isInteger(value) || value < 1) args.errors.push(`Invalid --iteration value: ${raw}`);
      else if (!args.iterations.includes(value)) args.iterations.push(value);
    } else if (raw.startsWith('--eval=')) {
      const ids = raw
        .slice('--eval='.length)
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
      args.evalIds = [...(args.evalIds ?? []), ...ids];
    } else if (raw.startsWith('--arm=')) {
      const arm = raw.slice('--arm='.length);
      if (!ARMS.includes(arm)) args.errors.push(`Invalid --arm value: ${arm} (expected ${ARMS.join('|')})`);
      else args.arms = [arm];
    } else if (raw.startsWith('--tool=')) {
      args.toolId = raw.slice('--tool='.length);
    } else if (raw.startsWith('--root=')) {
      args.root = path.resolve(raw.slice('--root='.length));
    } else if (raw.startsWith('--seed=')) {
      args.seed = raw.slice('--seed='.length);
    } else if (raw.startsWith('--required-runs=')) {
      const value = Number(raw.slice('--required-runs='.length));
      if (!Number.isInteger(value) || value < 1) args.errors.push(`Invalid --required-runs value: ${raw}`);
      else args.requiredRuns = value;
    } else if (raw.startsWith('--format=')) {
      args.format = raw.slice('--format='.length);
      if (!['text', 'json'].includes(args.format)) args.errors.push(`Invalid --format value: ${args.format}`);
    } else {
      args.errors.push(`Unknown argument: ${raw}`);
    }
  }

  args.arms = args.arms ?? [...ARMS];
  return args;
}

// ---------------------------------------------------------------------
// Minimal JSON Schema subset validator
//
// Supported: type (string or array of strings), const, enum, pattern,
// format ("date" | "date-time" | "uri"), minLength, maxLength, minimum,
// maximum, minItems, maxItems, uniqueItems, required, properties, items
// (single schema), additionalProperties (boolean only).
//
// Deliberately NOT a general-purpose JSON Schema engine: no $ref, no
// oneOf/anyOf/allOf, no $defs, no conditionals. The three schema files in
// this directory are written to stay inside this subset.
// ---------------------------------------------------------------------

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number' && Number.isInteger(value)) return 'integer';
  return typeof value;
}

function isValidDateString(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const parsed = new Date(`${str}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === str;
}

function isValidDateTimeString(str) {
  if (typeof str !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(str)) return false;
  return !Number.isNaN(new Date(str).getTime());
}

function isValidUriString(str) {
  if (typeof str !== 'string') return false;
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

function typeMatches(expected, actual) {
  if (expected === actual) return true;
  if (expected === 'number' && actual === 'integer') return true;
  return false;
}

function validate(schema, data, at = '$') {
  const errors = [];

  if (schema.type) {
    const actual = typeOf(data);
    const expectedList = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!expectedList.some((expected) => typeMatches(expected, actual))) {
      errors.push(`${at}: expected type ${JSON.stringify(schema.type)} but got "${actual}"`);
      return errors;
    }
    if (data === null) return errors; // nothing further applies to an allowed null
  }

  if ('const' in schema && data !== schema.const) {
    errors.push(`${at}: value ${JSON.stringify(data)} must equal ${JSON.stringify(schema.const)}`);
  }

  if (schema.enum && !schema.enum.includes(data)) {
    errors.push(`${at}: value ${JSON.stringify(data)} is not one of ${JSON.stringify(schema.enum)}`);
  }

  if (typeof data === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(data)) {
      errors.push(`${at}: "${data}" does not match pattern ${schema.pattern}`);
    }
    if (typeof schema.minLength === 'number' && data.length < schema.minLength) {
      errors.push(`${at}: string of length ${data.length} is shorter than minLength ${schema.minLength}`);
    }
    if (typeof schema.maxLength === 'number' && data.length > schema.maxLength) {
      errors.push(`${at}: string of length ${data.length} exceeds maxLength ${schema.maxLength}`);
    }
    if (schema.format === 'date' && !isValidDateString(data)) {
      errors.push(`${at}: "${data}" is not a valid YYYY-MM-DD date`);
    }
    if (schema.format === 'date-time' && !isValidDateTimeString(data)) {
      errors.push(`${at}: "${data}" is not a valid ISO 8601 date-time`);
    }
    if (schema.format === 'uri' && !isValidUriString(data)) {
      errors.push(`${at}: "${data}" is not a valid URI`);
    }
  }

  if (typeof data === 'number') {
    if (typeof schema.minimum === 'number' && data < schema.minimum) {
      errors.push(`${at}: ${data} is less than minimum ${schema.minimum}`);
    }
    if (typeof schema.maximum === 'number' && data > schema.maximum) {
      errors.push(`${at}: ${data} is greater than maximum ${schema.maximum}`);
    }
  }

  if (typeOf(data) === 'array') {
    if (typeof schema.minItems === 'number' && data.length < schema.minItems) {
      errors.push(`${at}: array has ${data.length} items, fewer than minItems ${schema.minItems}`);
    }
    if (typeof schema.maxItems === 'number' && data.length > schema.maxItems) {
      errors.push(`${at}: array has ${data.length} items, more than maxItems ${schema.maxItems}`);
    }
    if (schema.uniqueItems === true) {
      const seen = new Set(data.map((item) => JSON.stringify(item)));
      if (seen.size !== data.length) errors.push(`${at}: array items are not unique`);
    }
    if (schema.items) {
      data.forEach((item, index) => {
        errors.push(...validate(schema.items, item, `${at}[${index}]`));
      });
    }
  }

  if (typeOf(data) === 'object') {
    for (const key of schema.required ?? []) {
      if (!(key in data)) errors.push(`${at}: missing required property "${key}"`);
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(data)) {
        if (!allowed.has(key)) errors.push(`${at}: unexpected additional property "${key}"`);
      }
    }
    for (const [key, subSchema] of Object.entries(schema.properties ?? {})) {
      if (key in data) errors.push(...validate(subSchema, data[key], `${at}.${key}`));
    }
  }

  return errors;
}

// ---------------------------------------------------------------------
// Small file helpers
// ---------------------------------------------------------------------

async function readJson(filePath) {
  const raw = await readFile(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${filePath} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeText(filePath, text) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, text, 'utf8');
}

async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(target) {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function listFiles(root, prefix = '') {
  const out = [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listFiles(absolute, relative)));
    } else if (entry.isFile()) {
      out.push(relative);
    }
  }
  return out.sort();
}

const COPY_RETRY_DELAYS_MS = [50, 150, 400, 900];

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Copies one file, retrying transient Windows/OneDrive share locks
 * (EBUSY/EPERM) and falling back to a read-then-write. Fails loudly rather
 * than silently producing a partial arm: a workspace that is missing a
 * context file is not the workspace the manifest claims it is.
 */
async function copyOneFile(source, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  let lastError = null;
  for (let attempt = 0; attempt <= COPY_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      await copyFile(source, destination);
      return;
    } catch (err) {
      lastError = err;
      const code = err && typeof err === 'object' ? err.code : null;
      if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'EACCES') break;
      if (attempt < COPY_RETRY_DELAYS_MS.length) await sleep(COPY_RETRY_DELAYS_MS[attempt]);
    }
  }
  try {
    await writeFile(destination, await readFile(source));
    return;
  } catch {
    /* fall through to the original error, which is the more useful one */
  }
  throw new Error(
    `Could not copy ${source} into the prepared workspace: ${lastError instanceof Error ? lastError.message : String(lastError)}. ` +
      'A partially copied arm would not match its manifest, so preparation stopped. If a sync client or editor holds the file, close it and re-run with --force.',
  );
}

async function copyTree(source, destination) {
  const copied = [];
  const info = await stat(source);
  if (info.isFile()) {
    await copyOneFile(source, destination);
    copied.push(path.basename(destination));
    return copied;
  }
  const entries = await readdir(source, { withFileTypes: true });
  await mkdir(destination, { recursive: true });
  for (const entry of entries) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copied.push(...(await copyTree(from, to)).map((child) => `${entry.name}/${child}`));
    } else if (entry.isFile()) {
      await copyOneFile(from, to);
      copied.push(entry.name);
    }
  }
  return copied;
}

function globToRegExp(glob) {
  let source = '^';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === '*') {
      if (glob[index + 1] === '*') {
        if (glob[index + 2] === '/') {
          source += '(?:[^/]*/)*';
          index += 2;
        } else {
          source += '.*';
          index += 1;
        }
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`${source}$`);
}

/** FNV-1a, used only to derive a deterministic blind-label assignment. */
function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function nowIso() {
  return new Date().toISOString();
}

/** Thrown for operator mistakes, which get a one-line message rather than a stack trace. */
class UsageError extends Error {}

function mean(values) {
  const usable = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (usable.length === 0) return null;
  return usable.reduce((total, value) => total + value, 0) / usable.length;
}

function round(value, places = 3) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

// ---------------------------------------------------------------------
// Suite loading and validation
// ---------------------------------------------------------------------

async function loadSuite() {
  const [suite, schema] = await Promise.all([readJson(EVALS_PATH), readJson(EVALS_SCHEMA_PATH)]);
  const errors = validate(schema, suite, '$');
  return { suite, schema, errors };
}

function selectCases(suite, evalIds) {
  if (!evalIds || evalIds.length === 0) return suite.cases;
  const byId = new Map(suite.cases.map((testCase) => [testCase.id, testCase]));
  const selected = [];
  for (const id of evalIds) {
    const testCase = byId.get(id);
    if (!testCase) throw new UsageError(`Unknown eval id: ${id}. Run --validate to list what the suite defines.`);
    selected.push(testCase);
  }
  return selected;
}

/**
 * Checks the suite says things that are actually true of this directory:
 * fixtures exist, every path an assertion depends on exists in the fixture
 * set (otherwise the check could never be evaluated), manual assertions
 * declare a judge, and mechanical assertions carry the fields their type
 * needs.
 */
async function checkSuiteConsistency(suite) {
  const problems = [];
  const requiresPath = new Set([
    'file-exists',
    'file-absent',
    'file-matches',
    'file-not-matches',
    'json-parses',
    'file-unchanged',
    'file-changed',
  ]);
  const requiresPattern = new Set([
    'file-matches',
    'file-not-matches',
    'any-file-matches',
    'no-file-matches',
  ]);
  const requiresGlob = new Set(['any-file-matches', 'no-file-matches']);
  const requiresMax = new Set(['max-changed-files', 'max-added-files']);

  const seenIds = new Set();
  const slugs = new Set(suite.skillRegistry.slugs.map((entry) => entry.slug));
  const releaseGateTools = suite.tools.filter((tool) => tool.releaseGate);
  if (releaseGateTools.length !== 1) {
    problems.push(
      `exactly one tool must have releaseGate=true; found ${releaseGateTools.length}`,
    );
  } else if (releaseGateTools[0].id !== 'github-copilot-cli') {
    problems.push(
      `the current release benchmark must use github-copilot-cli, not ${releaseGateTools[0].id}`,
    );
  }

  for (const testCase of suite.cases) {
    if (seenIds.has(testCase.id)) problems.push(`duplicate case id: ${testCase.id}`);
    seenIds.add(testCase.id);

    const fixtureFiles = new Set();
    for (const fixture of testCase.fixtures) {
      const source = path.join(EVALS_DIR, fixture.source);
      if (!(await isDirectory(source))) {
        problems.push(`${testCase.id}: fixture directory not found: ${fixture.source}`);
        continue;
      }
      const files = await listFiles(source);
      if (files.length === 0) problems.push(`${testCase.id}: fixture directory is empty: ${fixture.source}`);
      for (const file of files) {
        fixtureFiles.add(fixture.mountAt === '.' ? file : `${fixture.mountAt}/${file}`);
      }
    }

    for (const skill of testCase.relevantSkills) {
      if (!slugs.has(skill)) problems.push(`${testCase.id}: relevantSkills references unknown slug "${skill}"`);
    }

    const assertionIds = new Set();
    let blockingMechanical = 0;
    let blockingManual = 0;

    for (const assertion of testCase.assertions) {
      if (assertionIds.has(assertion.id)) {
        problems.push(`${testCase.id}: duplicate assertion id "${assertion.id}"`);
      }
      assertionIds.add(assertion.id);

      if (assertion.type === 'manual') {
        if (!assertion.judge) problems.push(`${testCase.id}/${assertion.id}: manual assertion has no judge`);
        if (assertion.severity === 'blocking') blockingManual += 1;
        continue;
      }
      if (assertion.severity === 'blocking') blockingMechanical += 1;

      if (assertion.target === 'workspace' && requiresPath.has(assertion.type) && !assertion.path) {
        problems.push(`${testCase.id}/${assertion.id}: type ${assertion.type} requires "path"`);
      }
      if (requiresPattern.has(assertion.type) && !assertion.pattern) {
        problems.push(`${testCase.id}/${assertion.id}: type ${assertion.type} requires "pattern"`);
      }
      if (requiresGlob.has(assertion.type) && !assertion.pathGlob) {
        problems.push(`${testCase.id}/${assertion.id}: type ${assertion.type} requires "pathGlob"`);
      }
      if (requiresMax.has(assertion.type) && typeof assertion.max !== 'number') {
        problems.push(`${testCase.id}/${assertion.id}: type ${assertion.type} requires "max"`);
      }
      if (assertion.pattern) {
        try {
          new RegExp(assertion.pattern, assertion.flags ?? '');
        } catch (err) {
          problems.push(
            `${testCase.id}/${assertion.id}: invalid regular expression: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      // A file-unchanged / file-changed check needs a fixture baseline to
      // compare against, or it can never be evaluated.
      if (
        (assertion.type === 'file-unchanged' || assertion.type === 'file-changed') &&
        assertion.path &&
        !fixtureFiles.has(assertion.path)
      ) {
        problems.push(
          `${testCase.id}/${assertion.id}: ${assertion.type} names "${assertion.path}", which no fixture provides`,
        );
      }
    }

    const expected =
      blockingManual === 0 ? 'full' : blockingMechanical === 0 ? 'none' : 'partial';
    if (testCase.mechanicalCoverage !== expected) {
      problems.push(
        `${testCase.id}: mechanicalCoverage is "${testCase.mechanicalCoverage}" but ${blockingMechanical} blocking mechanical and ${blockingManual} blocking manual assertions imply "${expected}"`,
      );
    }

    for (const artifact of testCase.expectedArtifacts) {
      if (artifact.kind === 'unchanged' && !fixtureFiles.has(artifact.path)) {
        problems.push(`${testCase.id}: expectedArtifacts "${artifact.path}" is marked unchanged but no fixture provides it`);
      }
    }
  }

  return problems;
}

async function readPackVersion() {
  try {
    const raw = await readFile(path.join(REPO_ROOT, 'VERSION'), 'utf8');
    return raw.trim();
  } catch {
    return null;
  }
}

async function countAuthoredSkills() {
  const skillsRoot = path.join(REPO_ROOT, '.agents', 'skills');
  if (!(await isDirectory(skillsRoot))) return { count: 0, slugs: [] };
  const entries = await readdir(skillsRoot, { withFileTypes: true });
  const slugs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (await pathExists(path.join(skillsRoot, entry.name, 'SKILL.md'))) slugs.push(entry.name);
  }
  return { count: slugs.length, slugs: slugs.sort() };
}

// ---------------------------------------------------------------------
// Paths inside a runs root
// ---------------------------------------------------------------------

function iterationDir(root, iteration) {
  return path.join(root, `iteration-${iteration}`);
}

function caseDir(root, iteration, evalId) {
  return path.join(iterationDir(root, iteration), evalId);
}

function armDir(root, iteration, evalId, arm) {
  return path.join(caseDir(root, iteration, evalId), arm);
}

/** Refuses to operate on anything that does not resolve inside the runs root. */
function assertInsideRoot(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + path.sep)) {
    throw new UsageError(`Refusing to touch ${resolvedTarget}: it is outside the runs root ${resolvedRoot}`);
  }
}

// ---------------------------------------------------------------------
// prepare
// ---------------------------------------------------------------------

function blindLabelsFor(seed, evalId) {
  // Deterministic given (seed, evalId): the same prepare can be reproduced,
  // and no one can pick a labelling that flatters a particular arm.
  const withPackIsA = fnv1a(`${seed}|${evalId}`) % 2 === 0;
  return {
    A: withPackIsA ? 'with_pack' : 'without_pack',
    B: withPackIsA ? 'without_pack' : 'with_pack',
  };
}

function labelForArm(labels, arm) {
  return labels.A === arm ? 'A' : 'B';
}

async function buildFixtureManifest(workspace, files) {
  const entries = [];
  for (const relative of files) {
    const buffer = await readFile(path.join(workspace, relative));
    entries.push({ path: relative, bytes: buffer.length, sha256: sha256(buffer) });
  }
  const rollup = sha256(entries.map((entry) => `${entry.path}:${entry.sha256}`).join('\n'));
  return { files: entries, filesSha256: rollup };
}

async function copyPackContext(workspace) {
  const copied = [];
  const skipped = [];
  for (const relative of PACK_CONTEXT_PATHS) {
    const source = path.join(REPO_ROOT, ...relative.split('/'));
    if (!(await pathExists(source))) {
      skipped.push(relative);
      continue;
    }
    const destination = path.join(workspace, ...relative.split('/'));
    const info = await stat(source);
    if (info.isFile()) {
      await copyOneFile(source, destination);
      copied.push(relative);
    } else {
      const files = await copyTree(source, destination);
      copied.push(...files.map((file) => `${relative}/${file}`));
    }
  }
  const digests = [];
  for (const relative of copied.sort()) {
    const buffer = await readFile(path.join(workspace, ...relative.split('/')));
    digests.push({ path: relative, bytes: buffer.length, sha256: sha256(buffer) });
  }
  return {
    files: digests,
    skipped: skipped.sort(),
    contextFilesSha256: digests.length
      ? sha256(digests.map((entry) => `${entry.path}:${entry.sha256}`).join('\n'))
      : null,
  };
}

function renderPromptFile(testCase) {
  return `${testCase.prompt}\n`;
}

function renderInstructions(testCase, arm, iteration, relativeRunSchema) {
  const packLine =
    arm === 'with_pack'
      ? 'This workspace CONTAINS the pack context files. See PACK-STATE.json for exactly which files and their digests.'
      : 'This workspace contains NO pack context. If you find AGENTS.md, CLAUDE.md, .agents/skills or any adapter file inside workspace/, this run is invalid: stop and re-prepare.';

  return `# Run instructions — ${testCase.id} — ${arm} (iteration ${iteration})

${packLine}

Grading exports this run's transcript under a blind label so a judge can
read it without knowing which arm produced it. The label is written into
\`run.json\`, and the label-to-arm key is sealed in
\`../../blinding/labels.json\`. If you will also be judging this case, do
not read either until every verdict is written down — and prefer to have
someone who did not run the case do the judging.

## Before you start

1. Open a **brand new agent session**. No prior turns, no carried-over
   memory, no other repository open, no other workspace in context.
2. Point the agent at \`workspace/\` and nothing else. Do not let it see this
   file, \`CASE.md\`, \`run.json\`, or any other eval file — they describe what
   is being measured and would contaminate the run.
3. Note the exact tool version and model string the tool reports.
4. Start a timer.

## Run

5. Paste the contents of \`PROMPT.txt\` **verbatim**. Do not add context, do
   not rephrase, do not answer clarifying questions unless the case notes
   say otherwise.
6. Let the agent finish. Do not steer, do not correct, do not hint. If it
   goes wrong, that is a result.
7. Stop the timer.

## After

8. Paste the complete transcript into \`transcript.md\`, below the marker
   line. Include tool calls if the tool shows them.
9. Fill in \`run.json\`. Every field the grader needs is currently \`null\`.
   Record what you actually observed: \`"unavailable"\` is a valid and
   expected answer for token counts, and it is the honest one when the tool
   does not report them. Do not estimate silently.
10. Record one \`manualAssertions\` entry per \`manual\` assertion in the case,
    each with a verbatim quote. A verdict without a quote is treated as a
    missing verdict, and grading fails closed.
11. Leave \`workspace/\` exactly as the agent left it. The grader hashes it.

Schema for \`run.json\`: \`${relativeRunSchema}\`

Then: \`node evals/run.mjs --grade --iteration=${iteration} --eval=${testCase.id}\`
`;
}

function renderTranscriptTemplate(testCase, arm, iteration) {
  return `# Transcript — ${testCase.id} — ${arm} — iteration ${iteration}

Capture the session verbatim: the prompt as submitted, every agent message,
every tool call the tool displays, and the final output. Do not summarise,
do not tidy, do not remove anything that makes the agent look bad.

If the tool cannot produce a full transcript, say so explicitly here and
record \`evidence.transcriptCaptured: false\` in run.json. That fails the
evidence gate, which is the correct outcome: an ungraded run is honest, a
graded run without evidence is not.

${TRANSCRIPT_TEMPLATE_MARKER}
`;
}

function renderCaseDoc(testCase) {
  const artifacts = testCase.expectedArtifacts
    .map((artifact) => `| \`${artifact.path}\` | ${artifact.kind} | ${artifact.required ? 'yes' : 'no'} | ${artifact.description} |`)
    .join('\n');
  const manual = testCase.assertions
    .filter((assertion) => assertion.type === 'manual')
    .map((assertion) => `- \`${assertion.id}\` (${assertion.severity}, judge: ${assertion.judge}) — ${assertion.description}`)
    .join('\n');
  const mechanical = testCase.assertions
    .filter((assertion) => assertion.type !== 'manual')
    .map((assertion) => `- \`${assertion.id}\` (${assertion.type}, ${assertion.severity}) — ${assertion.description}`)
    .join('\n');

  return `# ${testCase.id} — ${testCase.title}

> **Operator only.** Never open this file, or any file outside
> \`<arm>/workspace/\`, inside an agent session. It states what is being
> measured and would contaminate the run.

- Category: ${testCase.category}
- Risk level: ${testCase.riskLevel}
- Non-trigger case: ${testCase.nonTrigger ? 'yes' : 'no'}
- Requires live retrieval: ${testCase.liveRetrievalRequired ? 'yes' : 'no'}
- Mechanical coverage: ${testCase.mechanicalCoverage}
- Blind labels: sealed in \`../blinding/labels.json\`; do not open until every verdict for this iteration is written down

## Why this case exists

${testCase.risk}

${testCase.promptNotes ? `## Prompt handling\n\n${testCase.promptNotes}\n` : ''}
## Expected artifacts

| Path | Kind | Required | Notes |
| --- | --- | --- | --- |
${artifacts || '| _none_ | | | |'}

## Mechanical assertions (run by \`--grade\`)

${mechanical || '_none_'}

## Judged assertions (need a quoted piece of evidence in run.json)

${manual || '_none_'}

## Rubric

${testCase.rubric.map((criterion) => `- \`${criterion.id}\` (weight ${criterion.weight}) — ${criterion.statement}`).join('\n')}
`;
}

function runTemplate({ testCase, iteration, arm, label, suite, packVersion, skillsAuthored, packState, relativeRunSchema }) {
  return {
    $schema: relativeRunSchema,
    runSchemaVersion: RUN_SCHEMA_VERSION,
    runId: `i${iteration}-${testCase.id}-${arm}`,
    evalId: testCase.id,
    iteration,
    arm,
    blindLabel: label,
    suiteVersion: suite.suiteVersion,
    packState: {
      packVersion: packVersion ?? suite.packUnderTest.version,
      packCommit: null,
      skillsAuthored,
      contextFilesSha256: packState ? packState.contextFilesSha256 : null,
      packPresentInWorkspace: arm === 'with_pack',
    },
    tool: {
      id: null,
      version: null,
      model: null,
      modelVersionObserved: null,
      contextState: null,
      settingsNotes: null,
    },
    operator: null,
    startedAt: null,
    completedAt: null,
    context: {
      cleanContext: null,
      priorTurns: null,
      followUpTurnsUsed: null,
      notes: null,
    },
    measurements: {
      wallClockSeconds: null,
      tokens: { input: null, output: null, total: null, source: null, sourceNotes: null },
      toolCalls: { total: null, byName: [], retrievalCalls: null, source: null },
      turns: null,
    },
    outcome: { status: null, artifactsProduced: [], summary: null },
    manualAssertions: [],
    rubricScores: [],
    regressions: [],
    evidence: {
      transcriptPath: 'transcript.md',
      transcriptCaptured: null,
      tokenReportPath: null,
      extraPaths: [],
    },
    notes: null,
  };
}

async function commandPrepare(args) {
  const { suite, errors } = await loadSuite();
  if (errors.length) {
    console.error('evals.json failed schema validation; refusing to prepare:');
    for (const error of errors) console.error(`  - ${error}`);
    return 1;
  }
  if (args.iterations.length !== 1) {
    console.error('--prepare needs exactly one --iteration=N');
    return 1;
  }

  const iteration = args.iterations[0];
  const seed = args.seed ?? `iteration-${iteration}`;
  const cases = selectCases(suite, args.evalIds);
  const runSchema = await readJson(RUN_SCHEMA_PATH);
  const packVersion = await readPackVersion();
  const authored = await countAuthoredSkills();

  const warnings = [];
  if (authored.count === 0) {
    warnings.push(
      'THE PACK HAS NO AUTHORED SKILLS. The with_pack arm will carry AGENTS.md and adapter files only. Any difference measured now is not evidence of skill value, and no lift may be claimed from this iteration.',
    );
  }
  if (packVersion && packVersion !== suite.packUnderTest.version) {
    warnings.push(
      `VERSION says ${packVersion} but evals.json packUnderTest.version says ${suite.packUnderTest.version}. Results across that boundary are not comparable.`,
    );
  }
  if (authored.count !== suite.packUnderTest.skillsAuthored) {
    warnings.push(
      `.agents/skills has ${authored.count} authored skill(s) but evals.json records ${suite.packUnderTest.skillsAuthored}. Update evals.json before trusting a comparison.`,
    );
  }

  const iterationRoot = iterationDir(args.root, iteration);
  const labelMap = {};
  const prepared = [];

  for (const testCase of cases) {
    const labels = blindLabelsFor(seed, testCase.id);
    labelMap[testCase.id] = labels;

    for (const arm of args.arms) {
      const target = armDir(args.root, iteration, testCase.id, arm);
      assertInsideRoot(args.root, target);
      if (await pathExists(target)) {
        if (!args.force) {
          console.error(`${toPosix(path.relative(process.cwd(), target))} already exists. Use --force to recreate it.`);
          return 1;
        }
        await rm(target, { recursive: true, force: true });
      }

      const workspace = path.join(target, 'workspace');
      await mkdir(workspace, { recursive: true });

      for (const fixture of testCase.fixtures) {
        const source = path.join(EVALS_DIR, fixture.source);
        if (!(await isDirectory(source))) {
          console.error(`${testCase.id}: fixture not found: ${fixture.source}`);
          return 1;
        }
        const destination = fixture.mountAt === '.' ? workspace : path.join(workspace, fixture.mountAt);
        await copyTree(source, destination);
      }

      const fixtureFiles = await listFiles(workspace);
      const fixtureManifest = await buildFixtureManifest(workspace, fixtureFiles);

      let packState = null;
      if (arm === 'with_pack') {
        packState = await copyPackContext(workspace);
        await writeJson(path.join(target, 'PACK-STATE.json'), {
          arm,
          packVersion,
          skillsAuthored: authored.count,
          authoredSkillSlugs: authored.slugs,
          copiedAt: nowIso(),
          contextFilesSha256: packState.contextFilesSha256,
          files: packState.files,
          skipped: packState.skipped,
          note:
            authored.count === 0
              ? 'No authored skills existed when this arm was prepared. This arm differs from the baseline only by AGENTS.md and adapter files.'
              : 'Pack context copied from the repository root as listed.',
        });
      } else {
        await writeJson(path.join(target, 'PACK-STATE.json'), {
          arm,
          packVersion,
          skillsAuthored: authored.count,
          authoredSkillSlugs: authored.slugs,
          copiedAt: nowIso(),
          contextFilesSha256: null,
          files: [],
          skipped: [...PACK_CONTEXT_PATHS],
          note: 'Baseline arm. No pack context is present in workspace/ by design.',
        });
      }

      await writeJson(path.join(target, 'fixture-manifest.json'), {
        evalId: testCase.id,
        arm,
        iteration,
        preparedAt: nowIso(),
        suiteVersion: suite.suiteVersion,
        fixtures: testCase.fixtures,
        filesSha256: fixtureManifest.filesSha256,
        files: fixtureManifest.files,
        packFiles: packState ? packState.files.map((entry) => entry.path) : [],
        note: 'Baseline for file-unchanged / file-changed / max-changed-files / max-added-files assertions. packFiles are excluded from change counting because the agent did not put them there.',
      });

      const label = labelForArm(labels, arm);
      const relativeRunSchema = toPosix(path.relative(target, RUN_SCHEMA_PATH));

      await writeText(path.join(target, 'PROMPT.txt'), renderPromptFile(testCase));
      await writeText(
        path.join(target, 'INSTRUCTIONS.md'),
        renderInstructions(testCase, arm, iteration, relativeRunSchema),
      );
      await writeText(path.join(target, 'transcript.md'), renderTranscriptTemplate(testCase, arm, iteration));
      await writeText(
        path.join(target, 'evidence', 'README.md'),
        `Put anything backing a number in run.json here: token-usage screenshots,
session exports, tool logs. Reference each file from
run.json evidence.extraPaths or evidence.tokenReportPath.

An unreferenced file in this directory is not evidence.
`,
      );

      const template = runTemplate({
        testCase,
        iteration,
        arm,
        label,
        suite,
        packVersion,
        skillsAuthored: authored.count,
        packState,
        relativeRunSchema,
      });
      const templateErrors = validate(runSchema, template, '$');
      if (templateErrors.length) {
        console.error('Internal error: generated run.json template does not satisfy run.schema.json:');
        for (const error of templateErrors) console.error(`  - ${error}`);
        return 1;
      }
      await writeJson(path.join(target, 'run.json'), template);

      prepared.push({ evalId: testCase.id, arm, label, path: toPosix(path.relative(process.cwd(), target)) });
    }

    await writeText(path.join(caseDir(args.root, iteration, testCase.id), 'CASE.md'), renderCaseDoc(testCase));
  }

  await writeJson(path.join(iterationRoot, 'blinding', 'labels.json'), {
    iteration,
    seed,
    sealed: true,
    createdAt: nowIso(),
    note: 'Sealed key: do not open until every manual verdict and rubric score for this iteration has been written down. Judges should be given transcripts by label only (run --grade --export-blinded).',
    map: labelMap,
  });

  await writeText(
    path.join(iterationRoot, 'ITERATION.md'),
    `# Iteration ${iteration}

Prepared ${nowIso()} from suite ${suite.suiteVersion}, pack ${packVersion ?? 'unknown'} (${authored.count} authored skill(s)).

One iteration is one complete pass of **one tool** over the suite. Two runs
per tool per case means two iterations for that tool. Record the tool in
each run.json; \`--aggregate --tool=<id>\` keeps tools from being pooled by
accident.

${warnings.length ? warnings.map((warning) => `> **Warning.** ${warning}`).join('\n\n') : '> No preparation warnings.'}

## Order of work

1. Read \`../../README.md\` for the protocol. It is not optional; the
   blinding, the clean-context rule and the no-benefit-of-the-doubt rule are
   what make the numbers mean anything.
2. Work through the case directories. In each, read \`<arm>/INSTRUCTIONS.md\`.
3. Randomise the order in which you run arms and cases. Do not do every
   with_pack run first.
4. Grade with \`node evals/run.mjs --grade --iteration=${iteration}\`.
5. Aggregate only when every case has been graded in both arms, in at least
   two iterations per tool.

\`blinding/labels.json\` is the sealed label key. Opening it early does not
break the tooling; it breaks the result.
`,
  );

  if (args.format === 'json') {
    console.log(JSON.stringify({ iteration, seed, prepared, warnings }, null, 2));
  } else {
    console.log(`Prepared iteration ${iteration} (seed "${seed}") at ${toPosix(path.relative(process.cwd(), iterationRoot))}`);
    console.log(`  cases: ${cases.length}, arms: ${args.arms.join(', ')}, run directories: ${prepared.length}`);
    for (const warning of warnings) console.log(`  WARNING: ${warning}`);
    console.log('  Next: read the ITERATION.md in that directory, then each <arm>/INSTRUCTIONS.md.');
    console.log('  This script did NOT launch any agent and will not; the runs are driven by hand.');
  }
  return 0;
}

// ---------------------------------------------------------------------
// Mechanical assertions
//
// Everything below reads files, hashes them, regex-matches them or
// JSON.parses them. Nothing is executed, imported, compiled or fetched.
// ---------------------------------------------------------------------

async function loadWorkspaceIndex(target, manifest) {
  const workspace = path.join(target, 'workspace');
  const packFiles = new Set(manifest.packFiles ?? []);
  const baseline = new Map((manifest.files ?? []).map((entry) => [entry.path, entry]));
  const present = await listFiles(workspace);
  const agentVisible = present.filter((file) => !packFiles.has(file));

  const added = [];
  const changed = [];
  const removed = [];
  const oversized = [];
  const digests = new Map();

  for (const relative of agentVisible) {
    const absolute = path.join(workspace, relative);
    const info = await stat(absolute);
    if (info.size > MAX_SCAN_BYTES) oversized.push(relative);
    const buffer = await readFile(absolute);
    const digest = sha256(buffer);
    digests.set(relative, digest);
    const base = baseline.get(relative);
    if (!base) added.push(relative);
    else if (base.sha256 !== digest) changed.push(relative);
  }
  for (const relative of baseline.keys()) {
    if (!present.includes(relative)) removed.push(relative);
  }

  return { workspace, packFiles, baseline, present, agentVisible, added, changed, removed, oversized, digests };
}

async function readTextIfPresent(filePath) {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return { ok: false, reason: 'not a file' };
    if (info.size > MAX_SCAN_BYTES) return { ok: false, reason: `larger than ${MAX_SCAN_BYTES} bytes; not scanned` };
    return { ok: true, text: await readFile(filePath, 'utf8') };
  } catch {
    return { ok: false, reason: 'not found' };
  }
}

function compileAssertionRegExp(assertion) {
  return new RegExp(assertion.pattern, assertion.flags ?? '');
}

async function evaluateAssertion(assertion, context) {
  const { index, transcriptPath, manualVerdicts } = context;
  const result = (verdict, detail) => ({
    id: assertion.id,
    type: assertion.type,
    severity: assertion.severity,
    source: assertion.type === 'manual' ? 'manual' : 'mechanical',
    result: verdict,
    detail,
  });

  if (assertion.type === 'manual') {
    const entry = manualVerdicts.get(assertion.id);
    if (!entry) return result('not-run', 'no verdict recorded in run.json manualAssertions');
    if (entry.verdict === 'not-applicable') return result('pass', 'recorded as not-applicable by the judge');
    return result(
      entry.verdict === 'pass' ? 'pass' : 'fail',
      `judge=${entry.judge}, blinded=${entry.judgeBlinded}, evidence quotes=${entry.evidence.length}`,
    );
  }

  if (assertion.target === 'transcript') {
    const read = await readTextIfPresent(transcriptPath);
    if (!read.ok) return result('fail', `transcript unreadable (${read.reason})`);
    const regex = compileAssertionRegExp(assertion);
    const matched = regex.test(read.text);
    if (assertion.type === 'file-matches') {
      return result(matched ? 'pass' : 'fail', matched ? 'pattern found in transcript' : 'pattern not found in transcript');
    }
    if (assertion.type === 'file-not-matches') {
      return result(!matched ? 'pass' : 'fail', matched ? 'forbidden pattern found in transcript' : 'pattern absent from transcript');
    }
    return result('not-run', `assertion type ${assertion.type} is not supported against a transcript`);
  }

  const absolute = assertion.path ? path.join(index.workspace, ...assertion.path.split('/')) : null;

  switch (assertion.type) {
    case 'file-exists': {
      const exists = index.present.includes(assertion.path);
      return result(exists ? 'pass' : 'fail', exists ? 'present' : 'not found in workspace');
    }
    case 'file-absent': {
      const exists = index.present.includes(assertion.path);
      return result(!exists ? 'pass' : 'fail', exists ? 'present but should be absent' : 'absent');
    }
    case 'json-parses': {
      const read = await readTextIfPresent(absolute);
      if (!read.ok) return result('fail', `cannot read ${assertion.path} (${read.reason})`);
      try {
        JSON.parse(read.text);
        return result('pass', 'parses as JSON');
      } catch (err) {
        return result('fail', `does not parse: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    case 'file-matches':
    case 'file-not-matches': {
      const read = await readTextIfPresent(absolute);
      if (!read.ok) return result('fail', `cannot read ${assertion.path} (${read.reason})`);
      const matched = compileAssertionRegExp(assertion).test(read.text);
      if (assertion.type === 'file-matches') {
        return result(matched ? 'pass' : 'fail', matched ? `pattern found in ${assertion.path}` : `pattern not found in ${assertion.path}`);
      }
      return result(!matched ? 'pass' : 'fail', matched ? `forbidden pattern found in ${assertion.path}` : `pattern absent from ${assertion.path}`);
    }
    case 'any-file-matches':
    case 'no-file-matches': {
      const regex = compileAssertionRegExp(assertion);
      const globRegex = globToRegExp(assertion.pathGlob);
      const candidates = index.agentVisible.filter((file) => globRegex.test(file));
      const unscanned = candidates.filter((file) => index.oversized.includes(file));
      const hits = [];
      for (const relative of candidates) {
        if (unscanned.includes(relative)) continue;
        const read = await readTextIfPresent(path.join(index.workspace, ...relative.split('/')));
        if (!read.ok) continue;
        if (regex.test(read.text)) hits.push(relative);
      }
      if (assertion.type === 'any-file-matches') {
        return result(
          hits.length > 0 ? 'pass' : 'fail',
          hits.length > 0
            ? `matched in ${hits.slice(0, 5).join(', ')}${hits.length > 5 ? ` (+${hits.length - 5} more)` : ''}`
            : `no file matching ${assertion.pathGlob} contained the pattern (${candidates.length} candidate file(s))`,
        );
      }
      if (unscanned.length > 0) {
        return result('fail', `cannot prove absence: ${unscanned.length} file(s) too large to scan (${unscanned.slice(0, 3).join(', ')})`);
      }
      return result(
        hits.length === 0 ? 'pass' : 'fail',
        hits.length === 0
          ? `pattern absent from ${candidates.length} candidate file(s)`
          : `forbidden pattern found in ${hits.slice(0, 5).join(', ')}${hits.length > 5 ? ` (+${hits.length - 5} more)` : ''}`,
      );
    }
    case 'file-unchanged':
    case 'file-changed': {
      const base = index.baseline.get(assertion.path);
      if (!base) return result('fail', `no prepared baseline recorded for ${assertion.path}; cannot compare`);
      const digest = index.digests.get(assertion.path);
      if (!digest) return result('fail', `${assertion.path} is missing from the workspace`);
      const same = digest === base.sha256;
      if (assertion.type === 'file-unchanged') {
        return result(same ? 'pass' : 'fail', same ? 'byte-identical to the prepared fixture' : 'differs from the prepared fixture');
      }
      return result(!same ? 'pass' : 'fail', same ? 'unchanged, but a change was required' : 'changed as required');
    }
    case 'max-changed-files': {
      const count = index.changed.length + index.removed.length;
      return result(
        count <= assertion.max ? 'pass' : 'fail',
        `${count} fixture file(s) changed or removed (limit ${assertion.max})${count ? `: ${[...index.changed, ...index.removed].slice(0, 8).join(', ')}` : ''}`,
      );
    }
    case 'max-added-files': {
      const count = index.added.length;
      return result(
        count <= assertion.max ? 'pass' : 'fail',
        `${count} new file(s) added (limit ${assertion.max})${count ? `: ${index.added.slice(0, 8).join(', ')}` : ''}`,
      );
    }
    default:
      return result('not-run', `unsupported assertion type ${assertion.type}`);
  }
}

// ---------------------------------------------------------------------
// Evidence gate — fail closed
// ---------------------------------------------------------------------

function isBlank(value) {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

async function evaluateEvidenceGate(testCase, run, target) {
  const missing = [];

  const requireField = (label, value) => {
    if (isBlank(value)) missing.push(label);
  };

  requireField('tool.id', run.tool?.id);
  requireField('tool.version', run.tool?.version);
  requireField('tool.model', run.tool?.model);
  requireField('tool.contextState', run.tool?.contextState);
  requireField('operator', run.operator);
  requireField('startedAt', run.startedAt);
  requireField('completedAt', run.completedAt);
  requireField('outcome.status', run.outcome?.status);
  requireField('measurements.tokens.source', run.measurements?.tokens?.source);
  requireField('measurements.toolCalls.source', run.measurements?.toolCalls?.source);

  if (run.tool?.contextState && run.tool.contextState !== 'fresh-session') {
    missing.push('tool.contextState is not "fresh-session": the clean-context rule was not met');
  }
  if (run.context?.cleanContext !== true) {
    missing.push('context.cleanContext is not true');
  }
  if (typeof run.measurements?.wallClockSeconds !== 'number') {
    missing.push('measurements.wallClockSeconds');
  }
  if (run.evidence?.transcriptCaptured !== true) {
    missing.push('evidence.transcriptCaptured is not true');
  }

  const transcriptPath = path.join(target, run.evidence?.transcriptPath || 'transcript.md');
  const transcript = await readTextIfPresent(transcriptPath);
  if (!transcript.ok) {
    missing.push(`transcript unreadable at ${run.evidence?.transcriptPath || 'transcript.md'} (${transcript.reason})`);
  } else {
    const markerIndex = transcript.text.indexOf(TRANSCRIPT_TEMPLATE_MARKER);
    const captured =
      markerIndex >= 0 ? transcript.text.slice(markerIndex + TRANSCRIPT_TEMPLATE_MARKER.length) : transcript.text;
    if (captured.trim().length < MIN_TRANSCRIPT_CHARS) {
      missing.push(
        `transcript holds ${captured.trim().length} captured characters, fewer than the ${MIN_TRANSCRIPT_CHARS} required`,
      );
    }
  }

  const manualVerdicts = new Map();
  for (const entry of run.manualAssertions ?? []) {
    manualVerdicts.set(entry.assertionId, entry);
  }
  const declaredManual = testCase.assertions.filter((assertion) => assertion.type === 'manual');
  for (const assertion of declaredManual) {
    const entry = manualVerdicts.get(assertion.id);
    if (!entry) {
      missing.push(`manualAssertions is missing a verdict for "${assertion.id}"`);
      continue;
    }
    const usable = (entry.evidence ?? []).filter(
      (evidence) => !isBlank(evidence.quote) && evidence.quote.trim().length >= 20 && !isBlank(evidence.locator),
    );
    if (usable.length === 0) {
      missing.push(`manualAssertions["${assertion.id}"] has no usable quoted evidence`);
    }
    if (entry.judge === 'llm-judge' && entry.judgeBlinded !== true) {
      missing.push(`manualAssertions["${assertion.id}"] used an unblinded llm-judge`);
    }
    if (assertion.judge !== 'either' && entry.judge !== assertion.judge) {
      missing.push(
        `manualAssertions["${assertion.id}"] was judged by ${entry.judge} but the case requires ${assertion.judge}`,
      );
    }
  }
  for (const entry of manualVerdicts.keys()) {
    if (!declaredManual.some((assertion) => assertion.id === entry)) {
      missing.push(`manualAssertions has a verdict for unknown assertion "${entry}"`);
    }
  }

  const rubricScored = new Set((run.rubricScores ?? []).map((score) => score.criterionId));
  for (const criterion of testCase.rubric) {
    if (!rubricScored.has(criterion.id)) missing.push(`rubricScores is missing criterion "${criterion.id}"`);
  }
  for (const score of run.rubricScores ?? []) {
    if (score.score > 0) {
      const usable = (score.evidence ?? []).filter(
        (evidence) => !isBlank(evidence.quote) && evidence.quote.trim().length >= 20,
      );
      if (usable.length === 0) {
        missing.push(`rubricScores["${score.criterionId}"] scores ${score.score} with no quoted evidence`);
      }
    }
  }

  if (testCase.liveRetrievalRequired && run.measurements?.toolCalls?.retrievalCalls === null) {
    missing.push('measurements.toolCalls.retrievalCalls is required for a live-retrieval case');
  }

  return { passed: missing.length === 0, missing, transcriptPath, manualVerdicts };
}

// ---------------------------------------------------------------------
// grade
// ---------------------------------------------------------------------

async function gradeOne({ testCase, iteration, arm, root, runSchema, exportBlinded }) {
  const target = armDir(root, iteration, testCase.id, arm);
  if (!(await isDirectory(target))) return { status: 'absent', target };

  const runPath = path.join(target, 'run.json');
  const manifestPath = path.join(target, 'fixture-manifest.json');
  if (!(await pathExists(runPath))) return { status: 'no-run-json', target };
  if (!(await pathExists(manifestPath))) return { status: 'no-manifest', target };

  const run = await readJson(runPath);
  const manifest = await readJson(manifestPath);
  const schemaErrors = validate(runSchema, run, '$');

  const gate = await evaluateEvidenceGate(testCase, run, target);
  const index = await loadWorkspaceIndex(target, manifest);

  const assertions = [];
  for (const assertion of testCase.assertions) {
    assertions.push(
      await evaluateAssertion(assertion, {
        index,
        transcriptPath: gate.transcriptPath,
        manualVerdicts: gate.manualVerdicts,
      }),
    );
  }

  const missingRequiredArtifacts = testCase.expectedArtifacts
    .filter((artifact) => artifact.required)
    .filter((artifact) => !index.present.some((file) => file === artifact.path || file.startsWith(`${artifact.path}/`)))
    .map((artifact) => artifact.path);

  const blockingFailures = assertions
    .filter((entry) => entry.severity === 'blocking' && entry.result !== 'pass')
    .map((entry) => `${entry.id}: ${entry.detail}`);
  const advisoryFailures = assertions
    .filter((entry) => entry.severity === 'advisory' && entry.result !== 'pass')
    .map((entry) => `${entry.id}: ${entry.detail}`);

  const evidenceComplete = gate.passed && schemaErrors.length === 0;
  const casePass = evidenceComplete && blockingFailures.length === 0 && missingRequiredArtifacts.length === 0;

  let casePassReason;
  if (!evidenceComplete) casePassReason = 'ungraded: evidence incomplete (fail closed)';
  else if (missingRequiredArtifacts.length) casePassReason = `required artifact(s) missing: ${missingRequiredArtifacts.join(', ')}`;
  else if (blockingFailures.length) casePassReason = `${blockingFailures.length} blocking assertion failure(s)`;
  else casePassReason = 'all blocking assertions passed with complete evidence';

  const grade = {
    gradeSchemaVersion: GRADE_SCHEMA_VERSION,
    gradedAt: nowIso(),
    gradedBy: 'evals/run.mjs --grade',
    evalId: testCase.id,
    iteration,
    arm,
    blindLabel: run.blindLabel,
    runId: run.runId,
    suiteVersion: run.suiteVersion,
    toolId: run.tool?.id ?? null,
    runSchemaValid: schemaErrors.length === 0,
    runSchemaErrors: schemaErrors,
    evidenceGate: { passed: gate.passed, missing: gate.missing },
    workspaceDelta: {
      addedFiles: index.added,
      changedFiles: index.changed,
      removedFiles: index.removed,
      unscannableFiles: index.oversized,
    },
    missingRequiredArtifacts,
    assertions,
    blockingFailures,
    advisoryFailures,
    evidenceComplete,
    casePass,
    casePassReason,
    measurements: run.measurements ?? null,
    regressionsReported: run.regressions ?? [],
    note:
      'casePass is false whenever evidence is incomplete. An ungraded run is never counted as a pass, and never counted as a baseline failure either: it is excluded from the comparison entirely.',
  };

  await writeJson(path.join(target, 'grade.json'), grade);

  if (exportBlinded && gate.transcriptPath) {
    const read = await readTextIfPresent(gate.transcriptPath);
    if (read.ok) {
      const destination = path.join(
        iterationDir(root, iteration),
        'blinding',
        testCase.id,
        `${run.blindLabel}.md`,
      );
      assertInsideRoot(root, destination);
      await writeText(destination, read.text);
    }
  }

  return { status: 'graded', target, grade };
}

async function commandGrade(args) {
  const { suite, errors } = await loadSuite();
  if (errors.length) {
    console.error('evals.json failed schema validation; refusing to grade:');
    for (const error of errors) console.error(`  - ${error}`);
    return 1;
  }
  if (args.iterations.length !== 1) {
    console.error('--grade needs exactly one --iteration=N');
    return 1;
  }

  const iteration = args.iterations[0];
  const cases = selectCases(suite, args.evalIds);
  const runSchema = await readJson(RUN_SCHEMA_PATH);

  const report = [];
  let failClosed = 0;

  for (const testCase of cases) {
    for (const arm of args.arms) {
      const outcome = await gradeOne({
        testCase,
        iteration,
        arm,
        root: args.root,
        runSchema,
        exportBlinded: args.exportBlinded,
      });

      if (outcome.status !== 'graded') {
        failClosed += 1;
        report.push({ evalId: testCase.id, arm, status: outcome.status, casePass: false });
        continue;
      }
      if (!outcome.grade.evidenceComplete) failClosed += 1;
      report.push({
        evalId: testCase.id,
        arm,
        status: 'graded',
        evidenceComplete: outcome.grade.evidenceComplete,
        casePass: outcome.grade.casePass,
        blockingFailures: outcome.grade.blockingFailures.length,
        advisoryFailures: outcome.grade.advisoryFailures.length,
        reason: outcome.grade.casePassReason,
        missing: outcome.grade.evidenceGate.missing,
      });
    }
  }

  if (args.format === 'json') {
    console.log(JSON.stringify({ iteration, report, failClosed }, null, 2));
  } else {
    console.log(`Graded iteration ${iteration}: ${report.length} run director${report.length === 1 ? 'y' : 'ies'}.`);
    for (const entry of report) {
      if (entry.status !== 'graded') {
        console.log(`  [${entry.status.toUpperCase()}] ${entry.evalId} / ${entry.arm}`);
        continue;
      }
      const verdict = !entry.evidenceComplete ? 'UNGRADED' : entry.casePass ? 'PASS' : 'FAIL';
      console.log(
        `  [${verdict}] ${entry.evalId} / ${entry.arm} — ${entry.reason}` +
          (entry.advisoryFailures ? ` (${entry.advisoryFailures} advisory)` : ''),
      );
      if (!entry.evidenceComplete) {
        for (const item of entry.missing.slice(0, 6)) console.log(`      missing: ${item}`);
        if (entry.missing.length > 6) console.log(`      missing: (+${entry.missing.length - 6} more)`);
      }
    }
    if (failClosed) {
      console.log(`\n${failClosed} run(s) could not be graded because evidence was missing. That is the fail-closed path,`);
      console.log('not a tooling bug: fill in the run.json fields and transcript listed above, then grade again.');
    }
  }

  return failClosed > 0 ? 1 : 0;
}

// ---------------------------------------------------------------------
// aggregate
// ---------------------------------------------------------------------

function assertionIsCorrectnessRelevant(assertion) {
  if (assertion.severity !== 'blocking') return false;
  return assertion.correctnessRelevant !== false;
}

function assertionIsSecurityRelevant(assertion) {
  return assertion.securityRelevant === true;
}

async function collectArmRuns({ root, iterations, evalId, arm, toolId }) {
  const collected = [];
  for (const iteration of iterations) {
    const target = armDir(root, iteration, evalId, arm);
    const gradePath = path.join(target, 'grade.json');
    const runPath = path.join(target, 'run.json');
    if (!(await pathExists(gradePath)) || !(await pathExists(runPath))) continue;
    const grade = await readJson(gradePath);
    const run = await readJson(runPath);
    if (toolId && (run.tool?.id ?? null) !== toolId) continue;
    collected.push({ iteration, grade, run });
  }
  return collected;
}

function summariseArm(collected) {
  const complete = collected.filter((entry) => entry.grade.evidenceComplete);
  const passes = complete.filter((entry) => entry.grade.casePass).length;
  const tokenSources = new Set(complete.map((entry) => entry.run.measurements?.tokens?.source ?? 'unavailable'));
  const tokenSource =
    complete.length === 0 ? null : tokenSources.size === 1 ? [...tokenSources][0] : 'mixed';

  const blockingAssertionFailures = new Set();
  for (const entry of complete) {
    for (const failure of entry.grade.assertions ?? []) {
      if (failure.severity === 'blocking' && failure.result !== 'pass') blockingAssertionFailures.add(failure.id);
    }
  }

  return {
    runsGraded: complete.length,
    passes,
    passRate: complete.length ? round(passes / complete.length) : null,
    evidenceComplete: collected.length > 0 && complete.length === collected.length,
    meanWallClockSeconds: round(mean(complete.map((entry) => entry.run.measurements?.wallClockSeconds ?? null)), 1),
    meanTotalTokens:
      tokenSource === 'tool-reported'
        ? round(mean(complete.map((entry) => entry.run.measurements?.tokens?.total ?? null)), 1)
        : null,
    tokenSource,
    meanToolCalls: round(mean(complete.map((entry) => entry.run.measurements?.toolCalls?.total ?? null)), 2),
    blockingAssertionFailures: [...blockingAssertionFailures].sort(),
    _complete: complete,
  };
}

function assertionOutcomes(complete, assertionId) {
  const results = [];
  for (const entry of complete) {
    const found = (entry.grade.assertions ?? []).find((assertion) => assertion.id === assertionId);
    if (found) results.push(found.result);
  }
  return results;
}

async function commandAggregate(args) {
  const { suite, errors } = await loadSuite();
  if (errors.length) {
    console.error('evals.json failed schema validation; refusing to aggregate:');
    for (const error of errors) console.error(`  - ${error}`);
    return 1;
  }
  if (args.iterations.length === 0) {
    console.error('--aggregate needs at least one --iteration=N');
    return 1;
  }

  const iterations = [...args.iterations].sort((a, b) => a - b);
  const cases = selectCases(suite, args.evalIds);
  const benchmarkSchema = await readJson(BENCHMARK_SCHEMA_PATH);
  const required = args.requiredRuns;

  const caseRecords = [];
  const toolsObserved = new Map();
  let totalGradedRuns = 0;
  let anyPackState = null;

  for (const testCase of cases) {
    const armSummaries = {};
    for (const arm of ARMS) {
      const collected = await collectArmRuns({
        root: args.root,
        iterations,
        evalId: testCase.id,
        arm,
        toolId: args.toolId,
      });
      const summary = summariseArm(collected);
      armSummaries[arm] = summary;
      totalGradedRuns += summary.runsGraded;

      for (const entry of summary._complete) {
        const id = entry.run.tool?.id ?? 'unrecorded';
        if (!toolsObserved.has(id)) toolsObserved.set(id, { id, versions: new Set(), models: new Set(), runs: 0 });
        const record = toolsObserved.get(id);
        record.runs += 1;
        if (entry.run.tool?.version) record.versions.add(entry.run.tool.version);
        if (entry.run.tool?.model) record.models.add(entry.run.tool.model);
        if (arm === 'with_pack' && !anyPackState) anyPackState = entry.run.packState;
      }
    }

    const withArm = armSummaries.with_pack;
    const withoutArm = armSummaries.without_pack;
    const comparable = withArm.runsGraded >= required && withoutArm.runsGraded >= required;

    const correctnessRegressions = [];
    const securityRegressions = [];
    if (comparable) {
      for (const assertion of testCase.assertions) {
        const baseline = assertionOutcomes(withoutArm._complete, assertion.id);
        const treatment = assertionOutcomes(withArm._complete, assertion.id);
        const baselineAlwaysPassed = baseline.length > 0 && baseline.every((result) => result === 'pass');
        const treatmentEverFailed = treatment.some((result) => result !== 'pass');
        if (!baselineAlwaysPassed || !treatmentEverFailed) continue;
        const detail = `baseline passed ${baseline.length}/${baseline.length}; with_pack failed ${treatment.filter((r) => r !== 'pass').length}/${treatment.length}`;
        if (assertionIsSecurityRelevant(assertion)) securityRegressions.push({ assertionId: assertion.id, detail });
        if (assertionIsCorrectnessRelevant(assertion)) correctnessRegressions.push({ assertionId: assertion.id, detail });
      }
      for (const entry of withArm._complete) {
        for (const reported of entry.grade.regressionsReported ?? []) {
          const detail = `operator-reported in ${entry.grade.runId}: ${reported.description}`;
          if (reported.type === 'security') securityRegressions.push({ assertionId: 'operator-reported', detail });
          else if (reported.type === 'correctness') correctnessRegressions.push({ assertionId: 'operator-reported', detail });
        }
      }
    }

    const tokenRatio =
      comparable &&
      withArm.tokenSource === 'tool-reported' &&
      withoutArm.tokenSource === 'tool-reported' &&
      typeof withArm.meanTotalTokens === 'number' &&
      typeof withoutArm.meanTotalTokens === 'number' &&
      withoutArm.meanTotalTokens > 0
        ? round(withArm.meanTotalTokens / withoutArm.meanTotalTokens)
        : null;

    caseRecords.push({
      evalId: testCase.id,
      riskLevel: testCase.riskLevel,
      nonTrigger: testCase.nonTrigger,
      liveRetrievalRequired: testCase.liveRetrievalRequired,
      arms: {
        with_pack: stripInternal(withArm),
        without_pack: stripInternal(withoutArm),
      },
      comparison: {
        status: comparable ? 'comparable' : 'insufficient-data',
        liftPercentagePoints:
          comparable && withArm.passRate !== null && withoutArm.passRate !== null
            ? round((withArm.passRate - withoutArm.passRate) * 100, 1)
            : null,
        tokenRatio,
        correctnessRegressions,
        securityRegressions,
      },
      _withArm: withArm,
      _withoutArm: withoutArm,
      _comparable: comparable,
    });
  }

  const comparableCases = caseRecords.filter((record) => record._comparable);
  const poolRate = (records, arm) => {
    const runs = records.reduce((total, record) => total + record.arms[arm].runsGraded, 0);
    const passes = records.reduce((total, record) => total + record.arms[arm].passes, 0);
    return runs > 0 ? round(passes / runs) : null;
  };

  const withPackPassRate = poolRate(comparableCases, 'with_pack');
  const withoutPackPassRate = poolRate(comparableCases, 'without_pack');
  const liftPercentagePoints =
    withPackPassRate !== null && withoutPackPassRate !== null
      ? round((withPackPassRate - withoutPackPassRate) * 100, 1)
      : null;

  const tokenReady = comparableCases.filter((record) => record.comparison.tokenRatio !== null);
  const tokenRatio =
    comparableCases.length > 0 && tokenReady.length === comparableCases.length
      ? round(mean(tokenReady.map((record) => record.comparison.tokenRatio)))
      : null;

  const liveCases = comparableCases.filter((record) => record.liveRetrievalRequired);
  const nonTriggerCases = comparableCases.filter((record) => record.nonTrigger);
  const liveRetrievalComplianceRate = liveCases.length ? poolRate(liveCases, 'with_pack') : null;
  const nonTriggerComplianceRate = nonTriggerCases.length ? poolRate(nonTriggerCases, 'with_pack') : null;

  const correctnessRegressionCount = comparableCases.reduce(
    (total, record) => total + record.comparison.correctnessRegressions.length,
    0,
  );
  const securityRegressionCount = comparableCases.reduce(
    (total, record) => total + record.comparison.securityRegressions.length,
    0,
  );

  const status =
    totalGradedRuns === 0 ? 'not-run' : comparableCases.length === caseRecords.length ? 'complete' : 'partial';
  const canJudgeRegressions = status === 'complete';

  const gate = (id, statement, threshold, observed, verdict, detail, blocking = true) => ({
    id,
    statement,
    threshold,
    observed,
    verdict,
    blocking,
    detail,
  });

  const launchGates = [
    gate(
      'pack-lift',
      'with_pack pass rate exceeds the baseline by at least 25 percentage points',
      '>= 25 pp',
      liftPercentagePoints,
      status !== 'complete' || liftPercentagePoints === null
        ? 'insufficient-data'
        : liftPercentagePoints >= 25
          ? 'pass'
          : 'fail',
      status !== 'complete' ? 'Not every case has the required graded runs in both arms.' : null,
    ),
    gate(
      'zero-correctness-regressions',
      'No case where the baseline was correct and the pack arm was not',
      '== 0',
      canJudgeRegressions ? correctnessRegressionCount : null,
      !canJudgeRegressions ? 'insufficient-data' : correctnessRegressionCount === 0 ? 'pass' : 'fail',
      canJudgeRegressions ? null : 'Regressions can only be judged when every case is comparable in both arms.',
    ),
    gate(
      'zero-security-regressions',
      'No case where the pack arm failed a security-relevant check the baseline passed',
      '== 0',
      canJudgeRegressions ? securityRegressionCount : null,
      !canJudgeRegressions ? 'insufficient-data' : securityRegressionCount === 0 ? 'pass' : 'fail',
      canJudgeRegressions ? null : 'Regressions can only be judged when every case is comparable in both arms.',
    ),
    gate(
      'token-cost',
      'The pack arm consumes no more than 1.5 times the baseline tokens',
      '<= 1.5x',
      tokenRatio,
      status !== 'complete' || tokenRatio === null ? 'insufficient-data' : tokenRatio <= 1.5 ? 'pass' : 'fail',
      tokenRatio === null
        ? 'Token counts must be tool-reported in both arms of every comparable case. Estimated or unavailable counts disqualify this gate rather than being approximated.'
        : null,
    ),
    gate(
      'live-retrieval',
      'Cases that require retrieving current documentation do so, with a verified citation',
      '>= 0.8',
      liveRetrievalComplianceRate,
      status !== 'complete' || liveRetrievalComplianceRate === null
        ? 'insufficient-data'
        : liveRetrievalComplianceRate >= 0.8
          ? 'pass'
          : 'fail',
      liveCases.length === 0 ? 'No comparable case requires live retrieval yet.' : null,
    ),
    gate(
      'non-trigger',
      'Out-of-scope questions are answered without the pack degrading or hijacking the answer',
      '>= 0.8',
      nonTriggerComplianceRate,
      status !== 'complete' || nonTriggerComplianceRate === null
        ? 'insufficient-data'
        : nonTriggerComplianceRate >= 0.8
          ? 'pass'
          : 'fail',
      nonTriggerCases.length === 0 ? 'No comparable non-trigger case yet.' : null,
    ),
  ];

  const launchReady = status === 'complete' && launchGates.every((entry) => !entry.blocking || entry.verdict === 'pass');

  const packVersion = anyPackState?.packVersion ?? (await readPackVersion()) ?? suite.packUnderTest.version;
  const authored = anyPackState ? anyPackState.skillsAuthored : (await countAuthoredSkills()).count;

  const limitations = [
    'Pass rates here are pass rates against this suite, not against real work. The suite is 16 hand-written cases chosen by the pack author, which is a conflict of interest that no amount of tooling removes.',
    'Every judged assertion depends on a human or an LLM judge. Blinding reduces but does not eliminate that bias.',
    'Mechanical checks are regex, hash and JSON-parse checks over files. They can be satisfied by output that is shaped correctly and still wrong, and they can fail output that is right in an unanticipated way.',
    'Nothing in this pipeline compiles, runs or tests the code an agent produced, so "passes" never means "works".',
    'Agent behaviour is not deterministic and model versions move underneath the suite. A result is a snapshot of one tool version and one model on one date.',
  ];
  if (authored === 0) {
    limitations.push(
      'The pack had zero authored skills, so the with_pack arm differed from the baseline only by AGENTS.md and adapter files. No claim about skill value can rest on this benchmark.',
    );
  }
  if (toolsObserved.size > 1 && !args.toolId) {
    limitations.push(
      `Runs from ${toolsObserved.size} different tools were pooled into these figures. Re-run with --tool=<id> for a per-tool benchmark before quoting a number.`,
    );
  }
  if (tokenRatio === null && status !== 'not-run') {
    limitations.push('Token cost could not be computed, so the token gate is unresolved rather than passed.');
  }
  if (status !== 'complete') {
    limitations.push('Status is not "complete": no headline figure from this file may be published in any form.');
  }

  const benchmark = {
    $schema: toPosix(path.relative(args.root, BENCHMARK_SCHEMA_PATH)),
    benchmarkSchemaVersion: BENCHMARK_SCHEMA_VERSION,
    generatedAt: nowIso(),
    generator: `node evals/run.mjs --aggregate ${iterations.map((n) => `--iteration=${n}`).join(' ')}${args.toolId ? ` --tool=${args.toolId}` : ''}`,
    iterations,
    status,
    suiteVersion: suite.suiteVersion,
    packState: {
      packVersion,
      packCommit: anyPackState?.packCommit ?? null,
      skillsAuthored: authored,
      warning:
        authored === 0
          ? 'Zero authored skills: the with_pack arm carried no skill guidance, so any difference between arms is not evidence about skills.'
          : null,
    },
    toolsObserved: [...toolsObserved.values()].map((record) => ({
      id: record.id,
      versions: [...record.versions].sort(),
      models: [...record.models].sort(),
      runs: record.runs,
    })),
    runsPerCasePerArm: {
      required,
      observedMin: caseRecords.length
        ? Math.min(...caseRecords.flatMap((record) => [record.arms.with_pack.runsGraded, record.arms.without_pack.runsGraded]))
        : null,
      observedMax: caseRecords.length
        ? Math.max(...caseRecords.flatMap((record) => [record.arms.with_pack.runsGraded, record.arms.without_pack.runsGraded]))
        : null,
    },
    cases: caseRecords.map(({ _withArm, _withoutArm, _comparable, ...record }) => record),
    aggregate: {
      casesTotal: caseRecords.length,
      casesComparable: comparableCases.length,
      withPackPassRate,
      withoutPackPassRate,
      liftPercentagePoints,
      tokenRatio,
      liveRetrievalComplianceRate,
      nonTriggerComplianceRate,
      correctnessRegressionCount: canJudgeRegressions ? correctnessRegressionCount : null,
      securityRegressionCount: canJudgeRegressions ? securityRegressionCount : null,
      meanWallClockSecondsWithPack: round(
        mean(comparableCases.map((record) => record.arms.with_pack.meanWallClockSeconds)),
        1,
      ),
      meanWallClockSecondsWithoutPack: round(
        mean(comparableCases.map((record) => record.arms.without_pack.meanWallClockSeconds)),
        1,
      ),
    },
    launchGates,
    launchReady,
    limitations,
    notes:
      status === 'not-run'
        ? 'No graded runs were found. This file records the absence of data, not a result.'
        : null,
  };

  const benchmarkErrors = validate(benchmarkSchema, benchmark, '$');
  if (benchmarkErrors.length) {
    console.error('Internal error: the generated benchmark does not satisfy benchmark.schema.json; nothing was written:');
    for (const error of benchmarkErrors) console.error(`  - ${error}`);
    return 1;
  }

  const suffix = `${iterations.join('-')}${args.toolId ? `-${args.toolId}` : ''}`;
  const outputPath = path.join(args.root, `benchmark-${suffix}.json`);
  assertInsideRoot(args.root, outputPath);
  await writeJson(outputPath, benchmark);

  if (args.format === 'json') {
    console.log(JSON.stringify(benchmark, null, 2));
  } else {
    console.log(`Wrote ${toPosix(path.relative(process.cwd(), outputPath))}`);
    console.log(`  status: ${benchmark.status}  (cases comparable: ${benchmark.aggregate.casesComparable}/${benchmark.aggregate.casesTotal}, runs required per arm: ${required})`);
    console.log(`  with_pack pass rate:    ${format(withPackPassRate)}`);
    console.log(`  without_pack pass rate: ${format(withoutPackPassRate)}`);
    console.log(`  lift:                   ${format(liftPercentagePoints)} pp`);
    console.log('  Launch gates:');
    for (const entry of launchGates) {
      console.log(`    [${entry.verdict.toUpperCase()}] ${entry.id} (${entry.threshold}) observed=${format(entry.observed)}`);
    }
    console.log(`  launchReady: ${launchReady}`);
    if (status !== 'complete') {
      console.log('\n  NO CLAIMS MAY BE MADE FROM THIS FILE. It is not a result; it is a record of what is missing.');
    }
  }

  return 0;
}

function stripInternal(summary) {
  const { _complete, ...rest } = summary;
  return rest;
}

function format(value) {
  if (value === null || value === undefined) return 'n/a';
  return String(value);
}

// ---------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------

async function commandValidate(args) {
  const { suite, errors } = await loadSuite();
  const schemaFiles = [
    ['evals.schema.json', EVALS_SCHEMA_PATH],
    ['run.schema.json', RUN_SCHEMA_PATH],
    ['benchmark.schema.json', BENCHMARK_SCHEMA_PATH],
  ];
  const schemaProblems = [];
  for (const [name, filePath] of schemaFiles) {
    try {
      const parsed = await readJson(filePath);
      if (!parsed.$schema || !parsed.title) schemaProblems.push(`${name}: missing $schema or title`);
    } catch (err) {
      schemaProblems.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const consistency = errors.length ? [] : await checkSuiteConsistency(suite);
  const authored = await countAuthoredSkills();
  const packVersion = await readPackVersion();

  const summary = {
    suiteVersion: suite.suiteVersion,
    status: suite.status,
    cases: suite.cases.length,
    nonTriggerCases: suite.cases.filter((testCase) => testCase.nonTrigger).length,
    liveRetrievalCases: suite.cases.filter((testCase) => testCase.liveRetrievalRequired).length,
    mechanicalAssertions: suite.cases.reduce(
      (total, testCase) => total + testCase.assertions.filter((assertion) => assertion.type !== 'manual').length,
      0,
    ),
    manualAssertions: suite.cases.reduce(
      (total, testCase) => total + testCase.assertions.filter((assertion) => assertion.type === 'manual').length,
      0,
    ),
    packVersion,
    authoredSkills: authored.count,
    releaseGateTools: suite.tools
      .filter((tool) => tool.releaseGate)
      .map((tool) => tool.id),
    schemaErrors: errors,
    schemaFileProblems: schemaProblems,
    consistencyProblems: consistency,
  };

  if (args.format === 'json') {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`evals.json: suite ${summary.suiteVersion}, status "${summary.status}", ${summary.cases} cases`);
    console.log(`  assertions: ${summary.mechanicalAssertions} mechanical, ${summary.manualAssertions} judged`);
    console.log(`  non-trigger cases: ${summary.nonTriggerCases}, live-retrieval cases: ${summary.liveRetrievalCases}`);
    console.log(`  pack VERSION: ${packVersion ?? 'unknown'}, authored skills on disk: ${authored.count}`);
    console.log(`  release benchmark tool: ${summary.releaseGateTools.join(', ') || 'none'}`);
    for (const problem of schemaProblems) console.log(`  SCHEMA FILE: ${problem}`);
    for (const error of errors) console.log(`  SCHEMA: ${error}`);
    for (const problem of consistency) console.log(`  CONSISTENCY: ${problem}`);
    if (!errors.length && !consistency.length && !schemaProblems.length) {
      console.log('  OK: schema-valid and internally consistent.');
      if (authored.count === 0) {
        console.log('  NOTE: zero authored skills, so running this suite today could not demonstrate skill value.');
      }
    }
  }

  return errors.length || consistency.length || schemaProblems.length ? 1 : 0;
}

// ---------------------------------------------------------------------
// main
// ---------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || (!args.command && args.errors.length === 0)) {
    printHelp();
    return args.command || args.help ? 0 : 1;
  }
  if (args.errors.length) {
    for (const error of args.errors) console.error(error);
    console.error('Run with --help for usage.');
    return 1;
  }

  switch (args.command) {
    case 'prepare':
      return commandPrepare(args);
    case 'grade':
      return commandGrade(args);
    case 'aggregate':
      return commandAggregate(args);
    case 'validate':
      return commandValidate(args);
    default:
      printHelp();
      return 1;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    if (err instanceof UsageError) console.error(err.message);
    else console.error(err instanceof Error ? err.stack || err.message : String(err));
    process.exitCode = 1;
  });
