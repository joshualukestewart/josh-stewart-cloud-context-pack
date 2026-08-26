/**
 * scripts/lib/version-probe.mjs
 *
 * Version-probe support for scripts/check-freshness.mjs. Dependency-free
 * (Node >=20 built-ins only) and deliberately split out from the checker so
 * every parsing/comparison rule can be tested without touching a network.
 *
 * A `versionProbe` on a source in sources.json opts that source into a
 * bounded, machine-readable version check:
 *
 *   "versionProbe": {
 *     "url": "https://registry.npmjs.org/react/latest",
 *     "format": "npm-latest",          // npm-latest | nuget-index
 *                                      // dotnet-release-index | github-latest
 *     "testedVersion": "19.1.0",
 *     "alertOn": "minor"               // major | minor | any
 *   }
 *
 * Guarantees this module is responsible for:
 *   - Responses are size- and time-bounded, and the body is never returned
 *     to a caller or persisted: only the extracted version string escapes.
 *   - Anything unexpected (HTTP error, wrong content type, oversized body,
 *     unparseable JSON, missing/prerelease-only version) fails closed as a
 *     probe error. A probe never silently reports "no drift".
 *   - Comparison is semantic, not textual, and tolerates the 2- to 4-part
 *     version shapes that npm, NuGet and .NET all use in practice.
 */

/** Probe formats understood by this module. */
export const PROBE_FORMATS = ['npm-latest', 'nuget-index', 'dotnet-release-index', 'github-latest'];

/** Alert thresholds, ordered from least to most sensitive. */
export const PROBE_ALERT_LEVELS = ['major', 'minor', 'any'];

/** Default when a probe omits `alertOn`. */
export const DEFAULT_ALERT_ON = 'minor';

/**
 * Hard limits. 1 MiB comfortably covers an npm abbreviated packument, a
 * NuGet flat-container index and the .NET releases index, while still
 * refusing anything that is obviously not a small metadata document.
 */
export const PROBE_LIMITS = { maxBytes: 1024 * 1024, timeoutMs: 8000 };

const USER_AGENT = 'josh-stewart-cloud-context-pack-freshness/1 (+https://github.com/joshualukestewart/josh-stewart-cloud-context-pack)';

/** Error type for every fail-closed probe outcome. */
export class ProbeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProbeError';
  }
}

// ---------------------------------------------------------------------
// Version parsing and comparison
// ---------------------------------------------------------------------

const VERSION_PATTERN =
  /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z][0-9A-Za-z.-]*))?(?:\+([0-9A-Za-z][0-9A-Za-z.-]*))?$/;

/**
 * Parse a version string. Accepts 1- to 4-part numeric versions (npm and
 * .NET use 3, NuGet sometimes uses 4) with an optional `-prerelease` and
 * `+build`. Returns null when the string is not a version.
 */
export function parseVersion(input) {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  const match = VERSION_PATTERN.exec(raw);
  if (!match) return null;
  return {
    raw,
    major: Number(match[1]),
    minor: match[2] === undefined ? 0 : Number(match[2]),
    patch: match[3] === undefined ? 0 : Number(match[3]),
    revision: match[4] === undefined ? 0 : Number(match[4]),
    prerelease: match[5] ?? null,
    build: match[6] ?? null,
  };
}

/** True when a parsed version carries no prerelease identifier. */
export function isStable(version) {
  return Boolean(version) && version.prerelease === null;
}

function comparePrerelease(a, b) {
  if (a === b) return 0;
  if (a === null) return 1; // a release outranks any prerelease
  if (b === null) return -1;
  const aParts = a.split('.');
  const bParts = b.split('.');
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i += 1) {
    const left = aParts[i];
    const right = bParts[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) {
      const diff = Number(left) - Number(right);
      if (diff !== 0) return diff < 0 ? -1 : 1;
    } else if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1; // numeric identifiers sort below alphanumeric
    } else if (left !== right) {
      return left < right ? -1 : 1;
    }
  }
  return 0;
}

/** Semantic comparison: -1 if a < b, 0 if equal precedence, 1 if a > b. */
export function compareVersions(a, b) {
  const left = typeof a === 'string' ? parseVersion(a) : a;
  const right = typeof b === 'string' ? parseVersion(b) : b;
  if (!left || !right) throw new ProbeError('cannot compare unparseable versions');
  for (const key of ['major', 'minor', 'patch', 'revision']) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

/** Highest-precedence stable version in a list, or null when there is none. */
export function highestStable(versions) {
  let best = null;
  for (const candidate of versions ?? []) {
    const parsed = parseVersion(candidate);
    if (!parsed || !isStable(parsed)) continue;
    if (best === null || compareVersions(parsed, best) > 0) best = parsed;
  }
  return best;
}

/**
 * Which part of the version changed between `from` and `to`.
 * Returns 'major' | 'minor' | 'patch' | 'prerelease' | null (no change).
 */
export function bumpLevel(from, to) {
  const a = typeof from === 'string' ? parseVersion(from) : from;
  const b = typeof to === 'string' ? parseVersion(to) : to;
  if (!a || !b) throw new ProbeError('cannot classify a bump between unparseable versions');
  if (a.major !== b.major) return 'major';
  if (a.minor !== b.minor) return 'minor';
  if (a.patch !== b.patch || a.revision !== b.revision) return 'patch';
  if (comparePrerelease(a.prerelease, b.prerelease) !== 0) return 'prerelease';
  return null;
}

/** Does a bump of this size warrant an alert at this threshold? */
export function shouldAlert(bump, alertOn = DEFAULT_ALERT_ON) {
  if (!bump) return false;
  if (alertOn === 'any') return true;
  if (alertOn === 'minor') return bump === 'major' || bump === 'minor';
  if (alertOn === 'major') return bump === 'major';
  return false;
}

// ---------------------------------------------------------------------
// Probe configuration
// ---------------------------------------------------------------------

/**
 * Validate a versionProbe object as written in sources.json. Returns
 * human-readable error strings; an empty array means the probe is usable.
 * This runs regardless of whether sources.schema.json already describes the
 * field, so a probe can never be executed from a shape this module does not
 * fully understand.
 */
export function validateProbeConfig(probe, at = 'versionProbe') {
  const errors = [];
  if (probe === null || typeof probe !== 'object' || Array.isArray(probe)) {
    return [`${at}: must be an object`];
  }
  const allowed = new Set(['url', 'format', 'testedVersion', 'alertOn', 'notes']);
  for (const key of Object.keys(probe)) {
    if (!allowed.has(key)) errors.push(`${at}: unexpected property "${key}"`);
  }
  if (typeof probe.url !== 'string' || probe.url.trim() === '') {
    errors.push(`${at}.url: required`);
  } else {
    let parsed = null;
    try {
      parsed = new URL(probe.url);
    } catch {
      errors.push(`${at}.url: "${probe.url}" is not a valid URL`);
    }
    if (parsed && parsed.protocol !== 'https:') errors.push(`${at}.url: must use https`);
  }
  if (!PROBE_FORMATS.includes(probe.format)) {
    errors.push(`${at}.format: must be one of ${PROBE_FORMATS.join(', ')}`);
  }
  if (typeof probe.testedVersion !== 'string' || parseVersion(probe.testedVersion) === null) {
    errors.push(`${at}.testedVersion: must be a version string this checker can parse`);
  }
  if (probe.alertOn !== undefined && !PROBE_ALERT_LEVELS.includes(probe.alertOn)) {
    errors.push(`${at}.alertOn: must be one of ${PROBE_ALERT_LEVELS.join(', ')}`);
  }
  return errors;
}

// ---------------------------------------------------------------------
// Format-specific extraction
// ---------------------------------------------------------------------

/** Request headers that keep each upstream response as small as it can be. */
export function probeHeaders(format) {
  const headers = { 'user-agent': USER_AGENT, accept: 'application/json' };
  if (format === 'npm-latest') headers.accept = 'application/vnd.npm.install-v1+json';
  if (format === 'github-latest') {
    headers.accept = 'application/vnd.github+json';
    headers['x-github-api-version'] = '2022-11-28';
  }
  return headers;
}

function extractNpm(json) {
  const distTags = json?.['dist-tags'];
  const tagged = distTags && typeof distTags.latest === 'string' ? distTags.latest : null;
  const single = typeof json?.version === 'string' ? json.version : null;
  const candidate = tagged ?? single;
  const parsed = candidate ? parseVersion(candidate) : null;
  if (parsed && isStable(parsed)) return parsed;
  // The "latest" dist-tag can point at a prerelease; fall back to the
  // highest stable version the document actually lists.
  const versions = json?.versions && typeof json.versions === 'object' ? Object.keys(json.versions) : [];
  const fallback = highestStable(versions);
  if (fallback) return fallback;
  if (candidate) throw new ProbeError(`npm reports "${candidate}" as latest, which is not a stable version`);
  throw new ProbeError('npm response contained no dist-tags.latest or version field');
}

function extractNuget(json) {
  const versions = json?.versions;
  if (!Array.isArray(versions) || versions.length === 0) {
    throw new ProbeError('NuGet index contained no "versions" array');
  }
  const best = highestStable(versions);
  if (!best) throw new ProbeError('NuGet index listed no stable versions');
  return best;
}

const DOTNET_SUPPORTED_PHASES = new Set(['active', 'maintenance']);

function extractDotnet(json) {
  const channels = json?.['releases-index'];
  if (!Array.isArray(channels) || channels.length === 0) {
    throw new ProbeError('.NET release index contained no "releases-index" array');
  }
  const supported = [];
  const all = [];
  for (const channel of channels) {
    if (!channel || typeof channel !== 'object') continue;
    const release = channel['latest-release'];
    if (typeof release !== 'string') continue;
    all.push(release);
    if (DOTNET_SUPPORTED_PHASES.has(channel['support-phase'])) supported.push(release);
  }
  const best = highestStable(supported) ?? highestStable(all);
  if (!best) throw new ProbeError('.NET release index listed no stable "latest-release" values');
  return best;
}

function extractGithub(json) {
  if (json?.draft === true) throw new ProbeError('the latest GitHub release is a draft');
  if (json?.prerelease === true) throw new ProbeError('the latest GitHub release is a prerelease');
  const tag = typeof json?.tag_name === 'string' ? json.tag_name : null;
  if (!tag) throw new ProbeError('GitHub response contained no tag_name');
  const trimmed = tag.trim().replace(/^[^0-9]*/, '');
  const parsed = parseVersion(trimmed);
  if (!parsed) throw new ProbeError(`GitHub tag "${tag}" is not a parseable version`);
  if (!isStable(parsed)) throw new ProbeError(`GitHub tag "${tag}" is a prerelease`);
  return parsed;
}

/**
 * Extract the latest stable version from an already-parsed, already-bounded
 * JSON document. Throws ProbeError for anything it does not fully
 * understand — never guesses.
 */
export function extractLatestVersion(format, json) {
  switch (format) {
    case 'npm-latest':
      return extractNpm(json);
    case 'nuget-index':
      return extractNuget(json);
    case 'dotnet-release-index':
      return extractDotnet(json);
    case 'github-latest':
      return extractGithub(json);
    default:
      throw new ProbeError(`unsupported probe format "${format}"`);
  }
}

// ---------------------------------------------------------------------
// Bounded fetch
// ---------------------------------------------------------------------

async function discardBody(response) {
  try {
    if (response?.body && typeof response.body.cancel === 'function') await response.body.cancel();
  } catch {
    /* nothing useful to do if the stream is already gone */
  }
}

async function readCapped(response, maxBytes) {
  const reader = response.body && typeof response.body.getReader === 'function' ? response.body.getReader() : null;
  if (!reader) {
    // No stream available (some fetch implementations, and test doubles).
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new ProbeError(`response exceeded the ${maxBytes}-byte probe limit`);
    }
    return text;
  }
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new ProbeError(`response exceeded the ${maxBytes}-byte probe limit`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* already closed */
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Fetch a small JSON document under hard size and time limits.
 *
 * Returns `{ json, headers }`. The raw text is never returned and never
 * stored: callers extract a version from `json` and discard the rest.
 */
export async function fetchBoundedJson(
  url,
  { format = null, maxBytes = PROBE_LIMITS.maxBytes, timeoutMs = PROBE_LIMITS.timeoutMs, fetchImpl = fetch } = {},
) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      headers: probeHeaders(format),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new ProbeError(`timed out after ${timeoutMs}ms`);
    }
    // Node's fetch reports transport problems as a bare "fetch failed";
    // the useful detail (DNS, TLS, proxy) lives on the cause.
    const cause = err?.cause?.code ?? err?.cause?.message ?? null;
    const message = err?.message ?? String(err);
    throw new ProbeError(cause ? `${message} (${cause})` : message);
  }

  const headers = {
    status: response.status,
    etag: response.headers?.get?.('etag') ?? null,
    lastModified: response.headers?.get?.('last-modified') ?? null,
  };

  if (!response.ok) {
    const rateLimited =
      response.status === 429 || (response.status === 403 && response.headers?.get?.('x-ratelimit-remaining') === '0');
    await discardBody(response);
    throw new ProbeError(rateLimited ? `HTTP ${response.status} (rate limited)` : `HTTP ${response.status}`);
  }

  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await discardBody(response);
    throw new ProbeError(`response declares ${declaredLength} bytes, over the ${maxBytes}-byte probe limit`);
  }

  const contentType = response.headers?.get?.('content-type') ?? '';
  if (contentType && !/json/i.test(contentType)) {
    await discardBody(response);
    throw new ProbeError(`unexpected content-type "${contentType}"; a probe URL must return JSON`);
  }

  let text;
  try {
    text = await readCapped(response, maxBytes);
  } catch (err) {
    await discardBody(response);
    throw err instanceof ProbeError ? err : new ProbeError(err?.message ?? String(err));
  }

  try {
    return { json: JSON.parse(text), headers };
  } catch {
    throw new ProbeError('response was not parseable JSON');
  }
}

// ---------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------

/**
 * Compare an observed latest version against a probe's testedVersion.
 *
 * status:
 *   'current'    - tested version is the latest stable
 *   'drift'      - newer stable release at or above the alert threshold
 *   'behind'     - newer stable release below the alert threshold (recorded,
 *                  not escalated)
 *   'ahead'      - testedVersion is newer than the latest published stable,
 *                  which usually means the registry, the pin, or the probe
 *                  URL is wrong; always escalated for review
 */
export function classifyProbe(probe, latestVersion) {
  const tested = parseVersion(probe.testedVersion);
  if (!tested) throw new ProbeError(`testedVersion "${probe.testedVersion}" is not parseable`);
  const latest = typeof latestVersion === 'string' ? parseVersion(latestVersion) : latestVersion;
  if (!latest) throw new ProbeError('observed version is not parseable');

  const alertOn = probe.alertOn ?? DEFAULT_ALERT_ON;
  const ordering = compareVersions(latest, tested);
  const base = {
    testedVersion: tested.raw,
    latestVersion: latest.raw,
    alertOn,
    bump: null,
  };
  if (ordering === 0) return { ...base, status: 'current', reviewRequired: false };
  if (ordering < 0) {
    return {
      ...base,
      status: 'ahead',
      bump: bumpLevel(latest, tested),
      reviewRequired: true,
    };
  }
  const bump = bumpLevel(tested, latest);
  const alert = shouldAlert(bump, alertOn);
  return { ...base, bump, status: alert ? 'drift' : 'behind', reviewRequired: alert };
}

/**
 * Run one probe end to end: bounded fetch, extraction, classification.
 * Returns `{ ok: true, result, headers }` or `{ ok: false, error }`; it
 * never throws, so one bad probe cannot abort a whole freshness run.
 */
export async function runProbe(probe, options = {}) {
  try {
    const { json, headers } = await fetchBoundedJson(probe.url, { ...options, format: probe.format });
    const latest = extractLatestVersion(probe.format, json);
    return { ok: true, result: classifyProbe(probe, latest), headers };
  } catch (err) {
    return { ok: false, error: err instanceof ProbeError ? err.message : err?.message ?? String(err) };
  }
}
