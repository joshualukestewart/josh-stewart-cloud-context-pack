/**
 * scripts/lib/pack-lib.mjs
 *
 * Shared, dependency-free helpers for this pack's tooling (Node >=20,
 * built-in modules only). Imported by generate-adapters.mjs,
 * validate-pack.mjs, install.mjs and build-release.mjs.
 *
 * Nothing in here performs network access or writes files on import.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Repository root of this pack (scripts/lib/../..). */
export const REPO_ROOT = path.resolve(HERE, '..', '..');

/** Canonical, tool-agnostic entry point every adapter defers to. */
export const CORE_ENTRY = 'AGENTS.md';

/** Canonical location of skill content. */
export const CANONICAL_SKILLS_DIR = '.agents/skills';

/**
 * Physical (never symlinked) mirrors of CANONICAL_SKILLS_DIR, keyed by the
 * tool family that discovers skills there.
 */
export const SKILL_MIRRORS = [
  { dir: '.github/skills', tool: 'GitHub Copilot' },
  { dir: '.claude/skills', tool: 'Claude' },
];

/** Generated adapter files, in deterministic (sorted-by-target) order. */
export const ADAPTERS = [
  { target: '.github/copilot-instructions.md', tool: 'copilot', label: 'GitHub Copilot' },
  { target: 'CLAUDE.md', tool: 'claude', label: 'Claude' },
  { target: 'GEMINI.md', tool: 'gemini', label: 'Gemini' },
];

/**
 * The official Microsoft Learn MCP endpoint. Declared as an endpoint only:
 * this pack never hard-codes a server's tool list or schema, because those
 * are discovered at runtime by the MCP client and change without notice.
 */
export const LEARN_MCP = {
  id: 'microsoft-learn',
  url: 'https://learn.microsoft.com/api/mcp',
  transport: 'http',
};

/**
 * Per-tool MCP configuration wrappers. Each entry declares the file a tool
 * reads and the top-level key that file's *current* documented format uses.
 * `writable: false` means the tool configures MCP outside a project
 * directory, so tooling here prints a snippet instead of writing anything.
 */
export const MCP_TARGETS = {
  copilot: {
    file: '.vscode/mcp.json',
    wrapper: 'servers',
    writable: true,
    entry: { type: 'http', url: LEARN_MCP.url },
    note: 'VS Code reads workspace MCP servers from .vscode/mcp.json under a "servers" key.',
  },
  claude: {
    file: '.mcp.json',
    wrapper: 'mcpServers',
    writable: true,
    entry: { type: 'http', url: LEARN_MCP.url },
    note: 'Claude Code reads project-scoped MCP servers from .mcp.json under an "mcpServers" key.',
  },
  gemini: {
    file: '.gemini/settings.json',
    wrapper: 'mcpServers',
    writable: true,
    entry: { httpUrl: LEARN_MCP.url },
    note: 'Gemini CLI reads project settings from .gemini/settings.json; HTTP MCP servers use "httpUrl".',
  },
  codex: {
    file: '~/.codex/config.toml',
    wrapper: 'mcp_servers',
    writable: false,
    snippet: ['[mcp_servers.microsoft_learn]', 'url = "https://learn.microsoft.com/api/mcp"'].join('\n'),
    note: 'Codex configures MCP servers at user level (~/.codex/config.toml), not per project. This installer never writes outside the target project, so it prints the snippet instead of writing it.',
  },
};

/** Identifier the delivery site validates a release against; must not drift. */
export const SITE_PACK_ID = 'cloud-full-stack';

/** Maximum entries the delivery site accepts in a release claim list. */
export const SITE_CLAIM_LIST_MAX = 8;

/**
 * The only tool names the delivery site accepts in `formallyTestedWith` or
 * `adapterSupport`. They are canonical product names, deliberately without
 * file paths: which files each tool reads belongs in README.md and
 * COMPATIBILITY.md, not in an API claim list.
 */
export const SITE_KNOWN_TOOLS = ['GitHub Copilot', 'Claude Code', 'OpenAI Codex', 'Gemini CLI'];

/** Container prefix the delivery site requires of a release blob name. */
export const SITE_BLOB_PREFIX = 'releases';

/** Files/directories no tooling in this repo may ever read, copy or ship. */
export const ALWAYS_EXCLUDED = [
  '.git',
  'node_modules',
  'dist',
  '.freshness-cache.json',
  '.DS_Store',
  'Thumbs.db',
];

/**
 * Dot-directories that hold real pack content. Any *other* dot-directory
 * is treated as tooling scratch (harness workspaces, editor state, local
 * caches): never scanned, never mirrored, never shipped. Keeping this as
 * an allow-list means a new scratch directory is ignored by default,
 * whereas a new content directory has to be declared here deliberately.
 */
export const CONTENT_DOT_DIRS = ['.agents', '.claude', '.github', '.vscode'];

/** True when a directory name is tooling scratch rather than pack content. */
export function isScratchDir(name) {
  return name.startsWith('.') && !CONTENT_DOT_DIRS.includes(name);
}

// ---------------------------------------------------------------------
// Small filesystem helpers
// ---------------------------------------------------------------------

/** Convert an OS path to a repo-relative POSIX path. */
export function toPosix(relPath) {
  return relPath.split(path.sep).join('/');
}

/** True when `child` is inside `parent` (or equal to it). */
export function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function exists(absPath) {
  try {
    statSync(absPath);
    return true;
  } catch {
    return false;
  }
}

export function isDirectory(absPath) {
  try {
    return statSync(absPath).isDirectory();
  } catch {
    return false;
  }
}

export function isFile(absPath) {
  try {
    return statSync(absPath).isFile();
  } catch {
    return false;
  }
}

export function readText(absPath) {
  return readFileSync(absPath, 'utf8');
}

/** Synchronous sleep, used only to space out filesystem retries. */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Read a file, retrying briefly on the transient locks that a syncing
 * client (OneDrive, Dropbox) or a concurrent writer produces on Windows.
 * Generation must never see a half-written source, and must never silently
 * skip one, so this either returns the bytes or throws with the path and
 * the number of attempts made.
 */
export function readFileSyncRetry(absPath, { attempts = 4, delayMs = 120, encoding = null } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return encoding ? readFileSync(absPath, encoding) : readFileSync(absPath);
    } catch (err) {
      lastError = err;
      if (!['EBUSY', 'EPERM', 'EACCES', 'EMFILE'].includes(err.code)) break;
      if (attempt < attempts) sleepSync(delayMs * attempt);
    }
  }
  const error = new Error(
    `could not read ${absPath} after ${attempts} attempt(s): ${lastError?.code ?? lastError?.message}. ` +
      'A sync client or another process may be holding it; retry once it settles.',
  );
  error.code = lastError?.code;
  error.path = absPath;
  throw error;
}

export function readJson(absPath) {
  return JSON.parse(readFileSync(absPath, 'utf8'));
}

export function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Normalise to LF and guarantee exactly one trailing newline. */
export function normaliseText(text) {
  return `${text.replace(/\r\n/g, '\n').replace(/\s+$/, '')}\n`;
}

/** Deterministic, locale-independent ordering used everywhere. */
export function byteCompare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Recursively list files under `absDir`, returning paths relative to
 * `root` as POSIX strings, sorted byte-wise. Symbolic links are never
 * followed: mirrors must be physical copies, and a link could point
 * anywhere on disk.
 */
export function listFiles(absDir, { root = absDir, excluded = ALWAYS_EXCLUDED } = {}) {
  const out = [];
  if (!isDirectory(absDir)) return out;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (excluded.includes(entry.name)) continue;
      if (entry.isSymbolicLink()) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (isScratchDir(entry.name)) continue;
        walk(abs);
      } else if (entry.isFile()) out.push(toPosix(path.relative(root, abs)));
    }
  };
  walk(absDir);
  return out.sort(byteCompare);
}

// ---------------------------------------------------------------------
// Minimal YAML front-matter parser
//
// SUPPORTED: nested block maps, block sequences ("- item"), inline flow
// sequences ("[a, b]"), quoted and bare scalars, booleans / null /
// numbers, block scalars (| and >) and # comments.
// NOT SUPPORTED (rejected with an error rather than guessed at): anchors,
// aliases, tags, multi-document streams, flow mappings.
// ---------------------------------------------------------------------

/** Split a markdown file into { hasFrontmatter, frontmatter, body, error }. */
export function splitFrontmatter(text) {
  const normalised = text.replace(/\r\n/g, '\n');
  if (!normalised.startsWith('---\n')) {
    return { hasFrontmatter: false, frontmatter: null, body: normalised, error: null };
  }
  const end = normalised.indexOf('\n---', 3);
  if (end === -1) {
    return {
      hasFrontmatter: true,
      frontmatter: null,
      body: normalised,
      error: 'front matter is not terminated by a closing "---"',
    };
  }
  const raw = normalised.slice(4, end + 1);
  const rest = normalised.slice(end + 4).replace(/^\n/, '');
  try {
    return { hasFrontmatter: true, frontmatter: parseYamlSubset(raw), body: rest, error: null };
  } catch (err) {
    return { hasFrontmatter: true, frontmatter: null, body: rest, error: err.message };
  }
}

export function parseYamlSubset(source) {
  const lines = source.split('\n');
  const rows = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*$/.test(line)) continue;
    if (/^\s*#/.test(line)) continue;
    rows.push({ indent: line.length - line.trimStart().length, text: line.trim(), lineNumber: i + 1 });
  }
  if (rows.length === 0) return {};
  const [value, consumed] = parseBlock(rows, 0, rows[0].indent);
  if (consumed < rows.length) {
    throw new Error(`unsupported YAML at line ${rows[consumed].lineNumber}: ${rows[consumed].text}`);
  }
  return value;
}

function parseBlock(rows, start, indent) {
  if (start >= rows.length) return [null, start];
  if (rows[start].text === '-' || rows[start].text.startsWith('- ')) {
    return parseSequence(rows, start, indent);
  }
  return parseMap(rows, start, indent);
}

function parseMap(rows, start, indent) {
  const map = {};
  let i = start;
  while (i < rows.length && rows[i].indent >= indent) {
    if (rows[i].indent > indent) throw new Error(`unexpected indentation at line ${rows[i].lineNumber}`);
    const { text, lineNumber } = rows[i];
    const colon = findKeyColon(text);
    if (colon === -1) throw new Error(`expected "key: value" at line ${lineNumber}: ${text}`);
    const key = stripQuotes(text.slice(0, colon).trim());
    const rawValue = text.slice(colon + 1).trim();
    i += 1;
    if (rawValue === '') {
      if (i < rows.length && rows[i].indent > indent) {
        const [child, next] = parseBlock(rows, i, rows[i].indent);
        map[key] = child;
        i = next;
      } else {
        map[key] = null;
      }
    } else if (/^[|>][-+]?$/.test(rawValue)) {
      const [block, next] = parseBlockScalar(rows, i, indent, rawValue);
      map[key] = block;
      i = next;
    } else {
      map[key] = parseScalar(rawValue, lineNumber);
    }
  }
  return [map, i];
}

function parseSequence(rows, start, indent) {
  const list = [];
  let i = start;
  while (i < rows.length && rows[i].indent === indent && (rows[i].text === '-' || rows[i].text.startsWith('- '))) {
    const item = rows[i].text === '-' ? '' : rows[i].text.slice(2).trim();
    const lineNumber = rows[i].lineNumber;
    i += 1;
    if (item === '') {
      if (i < rows.length && rows[i].indent > indent) {
        const [child, next] = parseBlock(rows, i, rows[i].indent);
        list.push(child);
        i = next;
      } else {
        list.push(null);
      }
    } else if (findKeyColon(item) !== -1) {
      const nested = [{ indent: indent + 2, text: item, lineNumber }];
      let j = i;
      while (j < rows.length && rows[j].indent > indent) {
        nested.push(rows[j]);
        j += 1;
      }
      const levelled = normaliseIndents(nested);
      const [child] = parseMap(levelled, 0, levelled[0].indent);
      list.push(child);
      i = j;
    } else {
      list.push(parseScalar(item, lineNumber));
    }
  }
  return [list, i];
}

function normaliseIndents(rows) {
  const min = Math.min(...rows.map((r) => r.indent));
  return rows.map((r) => ({ ...r, indent: r.indent - min }));
}

function parseBlockScalar(rows, start, parentIndent, marker) {
  const folded = marker.startsWith('>');
  const chomp = marker.length > 1 ? marker[1] : '';
  const parts = [];
  let i = start;
  while (i < rows.length && rows[i].indent > parentIndent) {
    parts.push(rows[i].text);
    i += 1;
  }
  let value = folded ? parts.join(' ') : parts.join('\n');
  if (chomp === '+') value += '\n';
  return [value, i];
}

/** Index of the ":" separating a key from its value, ignoring quoted text. */
function findKeyColon(text) {
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ':' && (i + 1 === text.length || /\s/.test(text[i + 1]))) return i;
  }
  return -1;
}

function stripQuotes(text) {
  if (
    text.length >= 2 &&
    ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

function parseScalar(raw, lineNumber) {
  const text = stripComment(raw).trim();
  if (text.startsWith('[') && text.endsWith(']')) {
    const inner = text.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map((part) => parseScalar(part.trim(), lineNumber));
  }
  if (text.startsWith('{')) throw new Error(`flow mappings are not supported (line ${lineNumber})`);
  if (text.startsWith('&') || text.startsWith('*') || text.startsWith('!')) {
    throw new Error(`YAML anchors/aliases/tags are not supported (line ${lineNumber})`);
  }
  const unquoted = stripQuotes(text);
  if (unquoted !== text) return unquoted;
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null' || text === '~') return null;
  if (/^-?\d+$/.test(text)) return Number.parseInt(text, 10);
  if (/^-?\d*\.\d+$/.test(text)) return Number.parseFloat(text);
  return text;
}

function stripComment(text) {
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '#' && (i === 0 || /\s/.test(text[i - 1]))) return text.slice(0, i);
  }
  return text;
}

// ---------------------------------------------------------------------
// Skill discovery and pack metadata
// ---------------------------------------------------------------------

/**
 * Discover canonical skills: one entry per directory under
 * `.agents/skills/` that contains a SKILL.md, sorted by directory name.
 * Directories without a SKILL.md are reported separately so callers decide
 * whether that is an error (validation) or simply not a skill (generation).
 */
export function discoverSkills(repoRoot = REPO_ROOT) {
  const base = path.join(repoRoot, ...CANONICAL_SKILLS_DIR.split('/'));
  const skills = [];
  const nonSkillDirs = [];
  if (!isDirectory(base)) return { skills, nonSkillDirs, baseDir: base };

  const entries = readdirSync(base, { withFileTypes: true }).sort((a, b) => byteCompare(a.name, b.name));
  for (const entry of entries) {
    if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
    if (ALWAYS_EXCLUDED.includes(entry.name) || isScratchDir(entry.name)) continue;
    const dirAbs = path.join(base, entry.name);
    const skillMd = path.join(dirAbs, 'SKILL.md');
    if (!isFile(skillMd)) {
      nonSkillDirs.push(`${CANONICAL_SKILLS_DIR}/${entry.name}`);
      continue;
    }
    let raw;
    try {
      raw = readFileSyncRetry(skillMd, { encoding: 'utf8' });
    } catch (err) {
      // A locked or mid-write file must not crash a caller; record it so
      // validation can report it instead.
      skills.push({
        dirName: entry.name,
        dirRel: `${CANONICAL_SKILLS_DIR}/${entry.name}`,
        skillMdRel: `${CANONICAL_SKILLS_DIR}/${entry.name}/SKILL.md`,
        dirAbs,
        files: [],
        frontmatter: null,
        frontmatterError: null,
        hasFrontmatter: false,
        readError: err.code ?? err.message,
        lineCount: 0,
        name: null,
        description: null,
      });
      continue;
    }
    const parsed = splitFrontmatter(raw);
    const fm = parsed.frontmatter;
    skills.push({
      dirName: entry.name,
      dirRel: `${CANONICAL_SKILLS_DIR}/${entry.name}`,
      skillMdRel: `${CANONICAL_SKILLS_DIR}/${entry.name}/SKILL.md`,
      dirAbs,
      files: listFiles(dirAbs, { root: dirAbs }),
      frontmatter: fm,
      frontmatterError: parsed.error,
      hasFrontmatter: parsed.hasFrontmatter,
      lineCount: raw.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').length,
      name: fm && typeof fm.name === 'string' ? fm.name : null,
      description: fm && typeof fm.description === 'string' ? fm.description.replace(/\s+/g, ' ').trim() : null,
    });
  }
  return { skills, nonSkillDirs, baseDir: base };
}

/** Read manifest.json / package.json / VERSION together. */
export function readPackMetadata(repoRoot = REPO_ROOT) {
  const manifestPath = path.join(repoRoot, 'manifest.json');
  const packagePath = path.join(repoRoot, 'package.json');
  const versionPath = path.join(repoRoot, 'VERSION');
  return {
    manifest: isFile(manifestPath) ? readJson(manifestPath) : null,
    pkg: isFile(packagePath) ? readJson(packagePath) : null,
    version: isFile(versionPath) ? readText(versionPath).trim() : null,
    manifestPath,
    packagePath,
    versionPath,
  };
}

/** True while the pack still declares itself a structural scaffold. */
export function isScaffold(manifest) {
  return !manifest || manifest.status === 'scaffold';
}

/** Escape a value for safe inclusion in a markdown table cell. */
export function tableCell(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .trim();
}

/** True when the importing module was executed directly by Node. */
export function isMain(importMetaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  return importMetaUrl === pathToFileURL(path.resolve(entry)).href;
}
