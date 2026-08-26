#!/usr/bin/env node
/**
 * scripts/check-freshness.mjs
 *
 * Dependency-free freshness check for this pack's knowledge supply chain
 * (sources.json). Node >=20 only, built-in modules only (fs, path, url,
 * crypto). No npm dependencies, per this repository's scripts/ policy.
 *
 * What this script does:
 *   1. Loads sources.json and validates it offline against
 *      sources.schema.json using a small hand-written JSON Schema subset
 *      validator (see SUPPORTED_SCHEMA_FEATURES below) — no network access
 *      required for this step.
 *   2. Checks each source's lastReviewed / reviewAfterDays for overdue or
 *      invalid (missing/malformed/future-dated) review dates.
 *   3. Validates the shape of any optional `versionProbe` on a source,
 *      offline, whether or not the schema already describes that field.
 *   4. Optionally (--network flag only), performs a headers-only
 *      reachability check against each source whose retrievalPolicy is
 *      "metadata-only", comparing the observed ETag / Last-Modified
 *      against a local cache (.freshness-cache.json, gitignored) to
 *      surface "drift" — a signal that a human should re-review the
 *      source, NOT an automatic determination that anything is wrong.
 *   5. Optionally (--network flag only), runs each source's `versionProbe`:
 *      a bounded fetch of one small machine-readable JSON document
 *      (npm / NuGet / .NET release index / GitHub latest release), from
 *      which only the latest stable version string is extracted and
 *      compared semantically against the recorded testedVersion. See
 *      scripts/lib/version-probe.mjs.
 *
 * What this script deliberately never does:
 *   - It never reads or stores documentation page bodies. Reachability
 *     checks use HEAD requests; if a server rejects HEAD, it falls back to
 *     GET but immediately cancels the response body stream without
 *     buffering or persisting any of it.
 *   - Version probes are the one case where a body is parsed at all, and
 *     they are bounded in both size and time, must return JSON, and are
 *     discarded immediately: only the extracted version string and the
 *     response's ETag/Last-Modified are ever cached. A malformed,
 *     oversized, slow or non-JSON response fails closed as a probe error —
 *     never as "no drift".
 *   - It never rewrites sources.json, manifest.json (unless --write-manifest
 *     is explicitly passed — see below), or any skill/prose content. This
 *     script only ever reports; humans decide what to do with the report.
 *     This is the "no-autonomous-update rule" described in FRESHNESS.md.
 *   - --write-manifest, if passed explicitly by a human running this
 *     script locally, updates ONLY the three placeholder metadata fields
 *     in manifest.json (knowledgeReviewedAt, reviewDueAt,
 *     sourceRegistrySha256) — never skill content. This flag is never
 *     invoked by CI/the scheduled workflow; see .github/workflows/freshness.yml.
 *
 * Exit codes (the "release gate" contract used by FRESHNESS.md / CI):
 *   0 = clean: no schema/date/probe-config errors, nothing overdue, no
 *       drift detected.
 *   1 = blocking: one or more schema/date/probe-configuration errors and/or
 *       overdue sources. A release should not proceed while this is
 *       nonzero.
 *   2 = drift-only / review required: no blocking errors, but network
 *       checks found metadata drift, a version bump at or above a probe's
 *       alertOn threshold, or a probe that could not be completed safely
 *       (only possible with --network). Not necessarily release-blocking,
 *       but the scheduled workflow treats it as "review required".
 *
 * Usage:
 *   node scripts/check-freshness.mjs [--network] [--format=text|json|markdown]
 *                                     [--write-manifest] [--help]
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

import { PROBE_LIMITS, runProbe, validateProbeConfig } from './lib/version-probe.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const SOURCES_PATH = path.join(REPO_ROOT, 'sources.json');
const SCHEMA_PATH = path.join(REPO_ROOT, 'sources.schema.json');
const MANIFEST_PATH = path.join(REPO_ROOT, 'manifest.json');
const CACHE_PATH = path.join(REPO_ROOT, '.freshness-cache.json');

const NETWORK_TIMEOUT_MS = 8000;

// ---------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    network: false,
    format: 'text',
    writeManifest: false,
    help: false,
  };
  for (const raw of argv) {
    if (raw === '--network') args.network = true;
    else if (raw === '--write-manifest') args.writeManifest = true;
    else if (raw === '--help' || raw === '-h') args.help = true;
    else if (raw.startsWith('--format=')) args.format = raw.slice('--format='.length);
    else {
      console.error(`Unknown argument: ${raw}`);
      process.exitCode = 1;
      args.help = true;
    }
  }
  if (!['text', 'json', 'markdown'].includes(args.format)) {
    console.error(`Invalid --format value: ${args.format} (expected text|json|markdown)`);
    args.help = true;
    process.exitCode = 1;
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/check-freshness.mjs [options]

Options:
  --network          Also perform headers-only reachability/drift checks
                      (HEAD requests, or GET with body immediately
                      discarded) for sources whose retrievalPolicy is
                      "metadata-only", and run any configured versionProbe
                      (a bounded, JSON-only fetch of one small version
                      document). Documentation page bodies are never read
                      or stored.
  --format=<fmt>      Output format: text (default, human console),
                      json (machine-readable), or markdown (for a GitHub
                      issue body).
  --write-manifest    After a clean check, update ONLY the
                      knowledgeReviewedAt / reviewDueAt / sourceRegistrySha256
                      placeholder fields in manifest.json. Intended for a
                      human to run locally and commit after review — never
                      invoked by CI. Skipped with a warning if the check is
                      not clean (exit code would be nonzero).
  --help, -h          Show this help text.

Exit codes: 0 = clean, 1 = blocking (invalid/overdue), 2 = review required
(metadata drift, a version bump at or above a probe's alertOn threshold, or
a probe that could not be completed safely).
`);
}

// ---------------------------------------------------------------------
// Minimal JSON Schema subset validator
//
// SUPPORTED_SCHEMA_FEATURES: type, required, properties, items (single
// schema), enum, pattern, format ("date" | "uri"), minItems, minLength,
// minimum, additionalProperties (boolean only). This is intentionally NOT
// a general-purpose JSON Schema engine (no $ref, no oneOf/anyOf, no
// $defs) — it only implements what sources.schema.json actually uses, so
// this file stays dependency-free.
// ---------------------------------------------------------------------

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value; // 'object' | 'string' | 'number' | 'boolean'
}

function isValidDateString(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const d = new Date(`${str}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === str;
}

function isValidUriString(str) {
  if (typeof str !== 'string') return false;
  try {
    // eslint-disable-next-line no-new
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates `data` against a (subset) JSON Schema `schema`.
 * Returns an array of human-readable error strings; empty means valid.
 */
function validate(schema, data, at = '$') {
  const errors = [];

  if (schema.type) {
    const actual = typeOf(data);
    const expected = schema.type;
    const matches =
      actual === expected ||
      (expected === 'number' && actual === 'integer'); // integers satisfy "number"
    if (!matches) {
      errors.push(`${at}: expected type "${expected}" but got "${actual}"`);
      return errors; // further checks would be noise once the type is wrong
    }
  }

  if (schema.enum && !schema.enum.includes(data)) {
    errors.push(`${at}: value ${JSON.stringify(data)} is not one of ${JSON.stringify(schema.enum)}`);
  }

  if (typeof data === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(data)) {
      errors.push(`${at}: "${data}" does not match pattern ${schema.pattern}`);
    }
    if (typeof schema.minLength === 'number' && data.length < schema.minLength) {
      errors.push(`${at}: string shorter than minLength ${schema.minLength}`);
    }
    if (schema.format === 'date' && !isValidDateString(data)) {
      errors.push(`${at}: "${data}" is not a valid YYYY-MM-DD date`);
    }
    if (schema.format === 'uri' && !isValidUriString(data)) {
      errors.push(`${at}: "${data}" is not a valid URI`);
    }
  }

  if (typeof data === 'number' && typeof schema.minimum === 'number' && data < schema.minimum) {
    errors.push(`${at}: ${data} is less than minimum ${schema.minimum}`);
  }

  if (typeOf(data) === 'array') {
    if (typeof schema.minItems === 'number' && data.length < schema.minItems) {
      errors.push(`${at}: array has ${data.length} items, fewer than minItems ${schema.minItems}`);
    }
    if (schema.items) {
      data.forEach((item, i) => {
        errors.push(...validate(schema.items, item, `${at}[${i}]`));
      });
    }
  }

  if (typeOf(data) === 'object') {
    for (const key of schema.required ?? []) {
      if (!(key in data)) {
        errors.push(`${at}: missing required property "${key}"`);
      }
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(data)) {
        if (!allowed.has(key)) {
          errors.push(`${at}: unexpected additional property "${key}"`);
        }
      }
    }
    for (const [key, subSchema] of Object.entries(schema.properties ?? {})) {
      if (key in data) {
        errors.push(...validate(subSchema, data[key], `${at}.${key}`));
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------
// Date / overdue logic
// ---------------------------------------------------------------------

function msPerDay() {
  return 24 * 60 * 60 * 1000;
}

/** Returns { overdue: boolean, dueDate: string, daysOverdue: number } or null if lastReviewed is invalid. */
function computeOverdue(lastReviewed, reviewAfterDays, now) {
  if (!isValidDateString(lastReviewed)) return null;
  const reviewedAt = new Date(`${lastReviewed}T00:00:00Z`);
  if (reviewedAt.getTime() > now.getTime()) return { futureDated: true };
  const dueAt = new Date(reviewedAt.getTime() + reviewAfterDays * msPerDay());
  const overdue = now.getTime() > dueAt.getTime();
  const daysOverdue = overdue ? Math.floor((now.getTime() - dueAt.getTime()) / msPerDay()) : 0;
  return { overdue, dueDate: dueAt.toISOString().slice(0, 10), daysOverdue };
}

// ---------------------------------------------------------------------
// Network check (headers only, --network only)
// ---------------------------------------------------------------------

async function checkReachability(url) {
  const signal = AbortSignal.timeout(NETWORK_TIMEOUT_MS);
  try {
    let res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal });
    if (res.status === 405 || res.status === 501) {
      // Some servers reject HEAD; fall back to GET but never read the body.
      res = await fetch(url, { method: 'GET', redirect: 'follow', signal });
    }
    // Always discard any body without buffering or persisting it.
    if (res.body && typeof res.body.cancel === 'function') {
      try {
        await res.body.cancel();
      } catch {
        /* ignore cancellation errors */
      }
    }
    return {
      ok: res.ok,
      status: res.status,
      etag: res.headers.get('etag'),
      lastModified: res.headers.get('last-modified'),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function loadCache() {
  try {
    const raw = await readFile(CACHE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveCache(cache) {
  await writeFile(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}

// ---------------------------------------------------------------------
// Version probes (--network only)
// ---------------------------------------------------------------------

/**
 * Run every runnable versionProbe in `sources`.
 *
 * Exported so the fixture tests can drive the whole pipeline with an
 * injected `fetchImpl` and no live network. Returns plain data; the caller
 * decides how it affects the report, the cache and the exit code.
 *
 * Sources whose retrievalPolicy is "manual-review-only" are skipped by
 * policy (FRESHNESS.md: never checked automatically, regardless of
 * technical feasibility). Probes with an invalid shape are skipped here
 * because they are already reported as blocking configuration errors.
 */
export async function checkVersionProbes(sources, { now = new Date(), fetchImpl, maxBytes, timeoutMs } = {}) {
  const outcome = { versionDrift: [], versionCurrent: [], probeErrors: [], probesSkipped: [], cacheEntries: {} };
  const options = {
    ...(fetchImpl ? { fetchImpl } : {}),
    maxBytes: maxBytes ?? PROBE_LIMITS.maxBytes,
    timeoutMs: timeoutMs ?? PROBE_LIMITS.timeoutMs,
  };

  for (const source of sources) {
    const probe = source?.versionProbe;
    if (probe === undefined || probe === null) continue;
    const id = typeof source.id === 'string' ? source.id : '(unknown id)';
    if (validateProbeConfig(probe).length > 0) continue; // reported as a blocking config error
    if (source.retrievalPolicy === 'manual-review-only') {
      outcome.probesSkipped.push({ id, reason: 'retrievalPolicy is "manual-review-only"' });
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const probed = await runProbe(probe, options);
    if (!probed.ok) {
      outcome.probeErrors.push({ id, url: probe.url, format: probe.format, error: probed.error });
      continue;
    }

    const entry = { id, url: probe.url, format: probe.format, ...probed.result };
    if (probed.result.reviewRequired) outcome.versionDrift.push(entry);
    else outcome.versionCurrent.push(entry);

    // Cache the observed version and validators only — never a body.
    outcome.cacheEntries[id] = {
      version: probed.result.latestVersion,
      etag: probed.headers?.etag ?? null,
      lastModified: probed.headers?.lastModified ?? null,
      status: probed.headers?.status ?? null,
      checkedAt: now.toISOString(),
    };
  }

  return outcome;
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return process.exitCode ?? 0;
  }

  const now = new Date();
  const report = {
    checkedAt: now.toISOString(),
    network: args.network,
    schemaErrors: [],
    dateErrors: [],
    probeConfigErrors: [],
    overdue: [],
    unreachable: [],
    drift: [],
    versionDrift: [],
    versionCurrent: [],
    probeErrors: [],
    probesSkipped: [],
    skippedForNetwork: [],
    sourceCount: 0,
    probeCount: 0,
  };

  let registry;
  let schema;
  try {
    [registry, schema] = await Promise.all([
      readFile(SOURCES_PATH, 'utf8').then(JSON.parse),
      readFile(SCHEMA_PATH, 'utf8').then(JSON.parse),
    ]);
  } catch (err) {
    report.schemaErrors.push(`Failed to load sources.json / sources.schema.json: ${err.message}`);
    emit(report, args.format);
    return 1;
  }

  report.schemaErrors.push(...validate(schema, registry, 'sources.json'));

  const sources = Array.isArray(registry.sources) ? registry.sources : [];
  report.sourceCount = sources.length;

  for (const source of sources) {
    const id = source && typeof source.id === 'string' ? source.id : '(unknown id)';
    if (source && source.versionProbe !== undefined && source.versionProbe !== null) {
      report.probeCount += 1;
      report.probeConfigErrors.push(...validateProbeConfig(source.versionProbe, `${id}.versionProbe`));
    }
    if (typeof source.lastReviewed !== 'string' || typeof source.reviewAfterDays !== 'number') {
      // Already reported by schema validation above; skip date logic.
      continue;
    }
    const result = computeOverdue(source.lastReviewed, source.reviewAfterDays, now);
    if (result === null) {
      report.dateErrors.push(`${id}: lastReviewed "${source.lastReviewed}" is not a valid date`);
    } else if (result.futureDated) {
      report.dateErrors.push(`${id}: lastReviewed "${source.lastReviewed}" is in the future`);
    } else if (result.overdue) {
      report.overdue.push({
        id,
        lastReviewed: source.lastReviewed,
        reviewAfterDays: source.reviewAfterDays,
        dueDate: result.dueDate,
        daysOverdue: result.daysOverdue,
      });
    }
  }

  if (args.network) {
    const cache = await loadCache();
    const nextCache = { ...cache };
    for (const source of sources) {
      if (source.retrievalPolicy !== 'metadata-only') {
        report.skippedForNetwork.push({ id: source.id, reason: `retrievalPolicy is "${source.retrievalPolicy}"` });
        continue;
      }
      const result = await checkReachability(source.canonicalUrl);
      if (result.error || result.ok === false) {
        report.unreachable.push({ id: source.id, url: source.canonicalUrl, error: result.error ?? `HTTP ${result.status}` });
        continue;
      }
      const prev = cache[source.id];
      const current = { etag: result.etag, lastModified: result.lastModified, status: result.status, checkedAt: now.toISOString() };
      if (prev && (prev.etag || prev.lastModified)) {
        const etagChanged = Boolean(prev.etag) && Boolean(result.etag) && prev.etag !== result.etag;
        const lastModChanged =
          Boolean(prev.lastModified) && Boolean(result.lastModified) && prev.lastModified !== result.lastModified;
        if (etagChanged || lastModChanged) {
          report.drift.push({
            id: source.id,
            url: source.canonicalUrl,
            previous: { etag: prev.etag, lastModified: prev.lastModified },
            current: { etag: result.etag, lastModified: result.lastModified },
          });
        }
      }
      // Preserve any previously cached version-probe observation for this
      // source; the reachability check owns only the header fields.
      nextCache[source.id] = { ...(cache[source.id] ?? {}), ...current };
    }

    const probes = await checkVersionProbes(sources, { now });
    report.versionDrift.push(...probes.versionDrift);
    report.versionCurrent.push(...probes.versionCurrent);
    report.probeErrors.push(...probes.probeErrors);
    report.probesSkipped.push(...probes.probesSkipped);
    for (const [id, observed] of Object.entries(probes.cacheEntries)) {
      nextCache[id] = { ...(nextCache[id] ?? {}), probe: observed };
    }

    await saveCache(nextCache);
  }

  const exitCode = computeExitCode(report);
  report.exitCode = exitCode;
  report.reviewRequired = exitCode !== 0;

  emit(report, args.format);

  if (args.writeManifest) {
    if (exitCode !== 0) {
      console.error('Skipping --write-manifest: check was not clean (see report above). Fix issues first.');
    } else {
      await writeManifestMetadata(sources, now);
    }
  }

  return exitCode;
}

async function writeManifestMetadata(sources, now) {
  const manifestRaw = await readFile(MANIFEST_PATH, 'utf8');
  const manifest = JSON.parse(manifestRaw);
  const sourcesRaw = await readFile(SOURCES_PATH, 'utf8');
  const sha256 = createHash('sha256').update(sourcesRaw, 'utf8').digest('hex');

  let reviewDueAt = null;
  for (const source of sources) {
    if (typeof source.lastReviewed !== 'string' || typeof source.reviewAfterDays !== 'number') continue;
    const due = new Date(new Date(`${source.lastReviewed}T00:00:00Z`).getTime() + source.reviewAfterDays * msPerDay());
    if (reviewDueAt === null || due.getTime() < reviewDueAt.getTime()) reviewDueAt = due;
  }

  manifest.knowledge = manifest.knowledge ?? {};
  manifest.knowledge.knowledgeReviewedAt = now.toISOString();
  manifest.knowledge.reviewDueAt = reviewDueAt ? reviewDueAt.toISOString() : null;
  manifest.knowledge.sourceRegistrySha256 = sha256;

  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log('manifest.json knowledge fields updated. Review the diff and commit deliberately.');
}

/**
 * The exit-code contract, in one place so it can be tested directly:
 *   1 = blocking   (registry data or probe configuration is wrong)
 *   2 = review required (metadata drift, a version bump at or above a
 *       probe's alertOn threshold, or a probe that could not be completed)
 *   0 = clean
 */
export function computeExitCode(report) {
  const hasBlocking =
    (report.schemaErrors?.length ?? 0) > 0 ||
    (report.dateErrors?.length ?? 0) > 0 ||
    (report.probeConfigErrors?.length ?? 0) > 0 ||
    (report.overdue?.length ?? 0) > 0;
  const hasReview =
    (report.drift?.length ?? 0) > 0 ||
    (report.versionDrift?.length ?? 0) > 0 ||
    (report.probeErrors?.length ?? 0) > 0;
  return hasBlocking ? 1 : hasReview ? 2 : 0;
}

// ---------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------

function emit(report, format) {
  if (format === 'json') {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (format === 'markdown') {
    console.log(toMarkdown(report));
    return;
  }
  console.log(toText(report));
}

function toText(report) {
  const lines = [];
  lines.push(`Freshness check @ ${report.checkedAt} (network: ${report.network})`);
  lines.push(`Sources checked: ${report.sourceCount} (version probes configured: ${report.probeCount ?? 0})`);
  lines.push('');
  lines.push(`Schema errors:   ${report.schemaErrors.length}`);
  report.schemaErrors.forEach((e) => lines.push(`  - ${e}`));
  lines.push(`Date errors:     ${report.dateErrors.length}`);
  report.dateErrors.forEach((e) => lines.push(`  - ${e}`));
  lines.push(`Probe config errors: ${(report.probeConfigErrors ?? []).length}`);
  (report.probeConfigErrors ?? []).forEach((e) => lines.push(`  - ${e}`));
  lines.push(`Overdue:         ${report.overdue.length}`);
  report.overdue.forEach((o) => lines.push(`  - ${o.id}: due ${o.dueDate} (${o.daysOverdue} day(s) overdue)`));
  if (report.network) {
    lines.push(`Unreachable:     ${report.unreachable.length}`);
    report.unreachable.forEach((u) => lines.push(`  - ${u.id}: ${u.error}`));
    lines.push(`Drift detected:  ${report.drift.length}`);
    report.drift.forEach((d) => lines.push(`  - ${d.id}: ${d.url}`));
    lines.push(`Version drift:   ${(report.versionDrift ?? []).length}`);
    (report.versionDrift ?? []).forEach((v) => lines.push(`  - ${v.id}: ${describeVersionFinding(v)}`));
    lines.push(`Probe errors:    ${(report.probeErrors ?? []).length}`);
    (report.probeErrors ?? []).forEach((p) => lines.push(`  - ${p.id}: ${p.error}`));
    lines.push(`Versions current: ${(report.versionCurrent ?? []).length}`);
    (report.versionCurrent ?? [])
      .filter((v) => v.status === 'behind')
      .forEach((v) =>
        lines.push(`  - ${v.id}: ${v.latestVersion} available (tested ${v.testedVersion}, below alertOn=${v.alertOn})`),
      );
    lines.push(`Skipped (policy): ${report.skippedForNetwork.length}`);
  }
  lines.push('');
  lines.push(`Exit code ${report.exitCode} (0=clean, 1=blocking, 2=review required). reviewRequired=${report.reviewRequired}`);
  return lines.join('\n');
}

/** One-line human summary of a version finding. */
function describeVersionFinding(finding) {
  if (finding.status === 'ahead') {
    return `testedVersion ${finding.testedVersion} is newer than the latest published stable ${finding.latestVersion} (check the pin or the probe URL)`;
  }
  return `${finding.testedVersion} -> ${finding.latestVersion} (${finding.bump} bump, alertOn=${finding.alertOn})`;
}

function toMarkdown(report) {
  const lines = [];
  lines.push(`### Freshness report`);
  lines.push('');
  lines.push(`- Checked at: \`${report.checkedAt}\``);
  lines.push(`- Network checks: ${report.network ? 'enabled' : 'disabled (offline only)'}`);
  lines.push(`- Sources in registry: ${report.sourceCount}`);
  if (report.probeCount) lines.push(`- Version probes configured: ${report.probeCount}`);
  lines.push(`- Result: **${report.exitCode === 0 ? 'clean' : report.exitCode === 1 ? 'BLOCKING' : 'review required'}**`);
  lines.push('');

  if (report.schemaErrors.length) {
    lines.push('#### Schema errors');
    report.schemaErrors.forEach((e) => lines.push(`- ${e}`));
    lines.push('');
  }
  if (report.dateErrors.length) {
    lines.push('#### Date errors');
    report.dateErrors.forEach((e) => lines.push(`- ${e}`));
    lines.push('');
  }
  if ((report.probeConfigErrors ?? []).length) {
    lines.push('#### Version probe configuration errors');
    report.probeConfigErrors.forEach((e) => lines.push(`- ${e}`));
    lines.push('');
  }
  if (report.overdue.length) {
    lines.push('#### Overdue sources');
    report.overdue.forEach((o) => lines.push(`- \`${o.id}\`: was due ${o.dueDate}, ${o.daysOverdue} day(s) overdue`));
    lines.push('');
  }
  if (report.network && report.unreachable.length) {
    lines.push('#### Unreachable sources');
    report.unreachable.forEach((u) => lines.push(`- \`${u.id}\`: ${u.error}`));
    lines.push('');
  }
  if (report.network && report.drift.length) {
    lines.push('#### Drift detected (needs human review)');
    report.drift.forEach((d) => lines.push(`- \`${d.id}\` (${d.url}): metadata changed since last check`));
    lines.push('');
  }
  if (report.network && (report.versionDrift ?? []).length) {
    lines.push('#### Version drift (needs human review)');
    lines.push('');
    lines.push('| Source | Tested | Latest stable | Change | alertOn |');
    lines.push('| --- | --- | --- | --- | --- |');
    report.versionDrift.forEach((v) =>
      lines.push(
        `| \`${v.id}\` | ${v.testedVersion} | ${v.latestVersion} | ${v.status === 'ahead' ? 'tested version is ahead of the registry' : `${v.bump} bump`} | ${v.alertOn} |`,
      ),
    );
    lines.push('');
  }
  if (report.network && (report.probeErrors ?? []).length) {
    lines.push('#### Version probes that could not be completed');
    lines.push('');
    lines.push('These fail closed: a probe that cannot be read safely is never treated as "no drift".');
    lines.push('');
    report.probeErrors.forEach((p) => lines.push(`- \`${p.id}\` (${p.format}): ${p.error}`));
    lines.push('');
  }
  const belowThreshold = (report.versionCurrent ?? []).filter((v) => v.status === 'behind');
  if (report.network && belowThreshold.length) {
    lines.push('#### Newer versions below the alert threshold (informational)');
    belowThreshold.forEach((v) =>
      lines.push(`- \`${v.id}\`: ${v.testedVersion} → ${v.latestVersion} (${v.bump} bump, alertOn=${v.alertOn})`),
    );
    lines.push('');
  }
  if (report.exitCode === 0) {
    lines.push('No action required.');
  } else {
    lines.push(
      '_This report never reads or stores documentation page bodies; version probes read one bounded JSON document and keep only the extracted version string. It never auto-updates content. A human must review sources.json and, if appropriate, update `lastReviewed` / `testedVersion` after checking the canonical URL._'
    );
  }
  return lines.join('\n');
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error('check-freshness failed unexpectedly:', err);
      process.exitCode = 1;
    });
}
