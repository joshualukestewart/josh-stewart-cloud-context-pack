/**
 * scripts/tests/version-probe.test.mjs
 *
 * Fixture tests for the version-probe support in
 * scripts/lib/version-probe.mjs and its orchestration in
 * scripts/check-freshness.mjs.
 *
 * Everything here is offline: HTTP is exercised through injected `fetch`
 * doubles built from real `Response` objects, so parsing, bounding and
 * comparison are all covered without a live network.
 *
 *   node --test scripts/tests/
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_ALERT_ON,
  PROBE_FORMATS,
  ProbeError,
  bumpLevel,
  classifyProbe,
  compareVersions,
  extractLatestVersion,
  fetchBoundedJson,
  highestStable,
  isStable,
  parseVersion,
  probeHeaders,
  runProbe,
  shouldAlert,
  validateProbeConfig,
} from '../lib/version-probe.mjs';
import { checkVersionProbes, computeExitCode } from '../check-freshness.mjs';

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function jsonResponse(value, { status = 200, headers = {}, contentLength = null } = {}) {
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  const merged = { 'content-type': 'application/json', ...headers };
  if (contentLength !== null) merged['content-length'] = String(contentLength);
  return new Response(body, { status, headers: merged });
}

/** A fetch double that records its calls and returns canned responses. */
function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return typeof handler === 'function' ? handler(url, init) : handler;
  };
  impl.calls = calls;
  return impl;
}

// ---------------------------------------------------------------------
// Parsing and comparison
// ---------------------------------------------------------------------

test('parseVersion accepts the 2- to 4-part shapes these registries use', () => {
  assert.deepEqual(parseVersion('1.2.3'), {
    raw: '1.2.3',
    major: 1,
    minor: 2,
    patch: 3,
    revision: 0,
    prerelease: null,
    build: null,
  });
  assert.equal(parseVersion('9.0').major, 9);
  assert.equal(parseVersion('9.0').minor, 0);
  assert.equal(parseVersion('4.8.1.2').revision, 2);
  assert.equal(parseVersion('1.2.3-preview.4').prerelease, 'preview.4');
  assert.equal(parseVersion('1.2.3+sha.abc').build, 'sha.abc');
  assert.equal(parseVersion(' 1.2.3 ').raw, '1.2.3');
});

test('parseVersion rejects anything that is not a version', () => {
  for (const bad of ['', 'latest', 'v1.2.3', '1.2.3.4.5', 'x.y.z', null, undefined, 42, {}]) {
    assert.equal(parseVersion(bad), null, `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

test('compareVersions orders numerically, not textually', () => {
  assert.equal(compareVersions('1.9.0', '1.10.0'), -1);
  assert.equal(compareVersions('2.0.0', '10.0.0'), -1);
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  assert.equal(compareVersions('1.2.10', '1.2.9'), 1);
  assert.equal(compareVersions('4.8.1.2', '4.8.1.10'), -1);
  assert.equal(compareVersions('9.0', '9.0.0'), 0);
});

test('compareVersions applies semver prerelease precedence', () => {
  assert.equal(compareVersions('1.0.0-alpha', '1.0.0'), -1);
  assert.equal(compareVersions('1.0.0', '1.0.0-alpha'), 1);
  assert.equal(compareVersions('1.0.0-alpha.1', '1.0.0-alpha.2'), -1);
  assert.equal(compareVersions('1.0.0-alpha.9', '1.0.0-alpha.10'), -1);
  assert.equal(compareVersions('1.0.0-alpha', '1.0.0-beta'), -1);
  assert.equal(compareVersions('1.0.0-alpha', '1.0.0-alpha.1'), -1);
  assert.equal(compareVersions('1.0.0-1', '1.0.0-alpha'), -1);
});

test('compareVersions fails closed on unparseable input', () => {
  assert.throws(() => compareVersions('1.0.0', 'latest'), ProbeError);
});

test('isStable and highestStable ignore prereleases', () => {
  assert.equal(isStable(parseVersion('1.0.0')), true);
  assert.equal(isStable(parseVersion('1.0.0-rc.1')), false);
  assert.equal(highestStable(['1.0.0', '2.0.0-preview.1', '1.9.3']).raw, '1.9.3');
  assert.equal(highestStable(['2.0.0-preview.1', 'not-a-version']), null);
  assert.equal(highestStable([]), null);
});

test('bumpLevel classifies the change and shouldAlert applies the threshold', () => {
  assert.equal(bumpLevel('1.2.3', '2.0.0'), 'major');
  assert.equal(bumpLevel('1.2.3', '1.3.0'), 'minor');
  assert.equal(bumpLevel('1.2.3', '1.2.4'), 'patch');
  assert.equal(bumpLevel('4.8.1.2', '4.8.1.3'), 'patch');
  assert.equal(bumpLevel('1.2.3', '1.2.3'), null);
  assert.equal(bumpLevel('1.2.3-rc.1', '1.2.3'), 'prerelease');

  const matrix = [
    ['major', 'major', true],
    ['minor', 'major', false],
    ['patch', 'major', false],
    ['major', 'minor', true],
    ['minor', 'minor', true],
    ['patch', 'minor', false],
    ['major', 'any', true],
    ['minor', 'any', true],
    ['patch', 'any', true],
  ];
  for (const [bump, alertOn, expected] of matrix) {
    assert.equal(shouldAlert(bump, alertOn), expected, `${bump} @ alertOn=${alertOn}`);
  }
  assert.equal(shouldAlert(null, 'any'), false);
  assert.equal(shouldAlert('minor'), DEFAULT_ALERT_ON === 'minor');
});

// ---------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------

test('classifyProbe reports drift only at or above the alert threshold', () => {
  const probe = { testedVersion: '9.0.1', alertOn: 'minor' };
  assert.deepEqual(classifyProbe(probe, '9.0.1'), {
    testedVersion: '9.0.1',
    latestVersion: '9.0.1',
    alertOn: 'minor',
    bump: null,
    status: 'current',
    reviewRequired: false,
  });

  const patch = classifyProbe(probe, '9.0.8');
  assert.equal(patch.status, 'behind');
  assert.equal(patch.bump, 'patch');
  assert.equal(patch.reviewRequired, false);

  const minor = classifyProbe(probe, '9.1.0');
  assert.equal(minor.status, 'drift');
  assert.equal(minor.reviewRequired, true);

  const major = classifyProbe({ testedVersion: '9.0.1', alertOn: 'major' }, '10.0.0');
  assert.equal(major.status, 'drift');
  assert.equal(major.bump, 'major');

  const quiet = classifyProbe({ testedVersion: '9.0.1', alertOn: 'major' }, '9.4.0');
  assert.equal(quiet.status, 'behind');
  assert.equal(quiet.reviewRequired, false);

  const noisy = classifyProbe({ testedVersion: '9.0.1', alertOn: 'any' }, '9.0.2');
  assert.equal(noisy.status, 'drift');
});

test('classifyProbe escalates a testedVersion that is ahead of the registry', () => {
  const ahead = classifyProbe({ testedVersion: '10.0.0', alertOn: 'major' }, '9.0.8');
  assert.equal(ahead.status, 'ahead');
  assert.equal(ahead.reviewRequired, true);
});

test('classifyProbe defaults alertOn and fails closed on bad versions', () => {
  assert.equal(classifyProbe({ testedVersion: '1.0.0' }, '1.1.0').alertOn, DEFAULT_ALERT_ON);
  assert.throws(() => classifyProbe({ testedVersion: 'latest' }, '1.0.0'), ProbeError);
  assert.throws(() => classifyProbe({ testedVersion: '1.0.0' }, 'nightly'), ProbeError);
});

// ---------------------------------------------------------------------
// Format extraction
// ---------------------------------------------------------------------

test('npm-latest reads dist-tags.latest or a single version document', () => {
  assert.equal(extractLatestVersion('npm-latest', { 'dist-tags': { latest: '19.1.0' } }).raw, '19.1.0');
  assert.equal(extractLatestVersion('npm-latest', { name: 'react', version: '19.1.0' }).raw, '19.1.0');
});

test('npm-latest falls back to the highest stable when the latest tag is a prerelease', () => {
  const doc = {
    'dist-tags': { latest: '20.0.0-canary.3' },
    versions: { '19.1.0': {}, '19.2.0': {}, '20.0.0-canary.3': {} },
  };
  assert.equal(extractLatestVersion('npm-latest', doc).raw, '19.2.0');
});

test('npm-latest fails closed when no stable version can be established', () => {
  assert.throws(() => extractLatestVersion('npm-latest', { 'dist-tags': { latest: '2.0.0-rc.1' } }), ProbeError);
  assert.throws(() => extractLatestVersion('npm-latest', { name: 'react' }), ProbeError);
  assert.throws(() => extractLatestVersion('npm-latest', {}), ProbeError);
});

test('nuget-index picks the highest stable version from the flat container index', () => {
  const doc = { versions: ['8.0.0', '9.0.0-preview.2', '8.0.11', '9.0.0'] };
  assert.equal(extractLatestVersion('nuget-index', doc).raw, '9.0.0');
  assert.throws(() => extractLatestVersion('nuget-index', { versions: ['1.0.0-rc.1'] }), ProbeError);
  assert.throws(() => extractLatestVersion('nuget-index', { versions: [] }), ProbeError);
  assert.throws(() => extractLatestVersion('nuget-index', {}), ProbeError);
});

test('dotnet-release-index prefers supported channels', () => {
  const doc = {
    'releases-index': [
      { 'channel-version': '10.0', 'latest-release': '10.0.0-preview.6', 'support-phase': 'preview' },
      { 'channel-version': '9.0', 'latest-release': '9.0.8', 'support-phase': 'active' },
      { 'channel-version': '8.0', 'latest-release': '8.0.19', 'support-phase': 'maintenance' },
      { 'channel-version': '6.0', 'latest-release': '6.0.36', 'support-phase': 'eol' },
    ],
  };
  assert.equal(extractLatestVersion('dotnet-release-index', doc).raw, '9.0.8');
});

test('dotnet-release-index falls back to any stable channel and fails closed otherwise', () => {
  const eolOnly = { 'releases-index': [{ 'latest-release': '6.0.36', 'support-phase': 'eol' }] };
  assert.equal(extractLatestVersion('dotnet-release-index', eolOnly).raw, '6.0.36');
  assert.throws(
    () => extractLatestVersion('dotnet-release-index', { 'releases-index': [{ 'latest-release': '7.0.0-rc.1' }] }),
    ProbeError,
  );
  assert.throws(() => extractLatestVersion('dotnet-release-index', { 'releases-index': [] }), ProbeError);
  assert.throws(() => extractLatestVersion('dotnet-release-index', {}), ProbeError);
});

test('github-latest strips the tag prefix and refuses drafts and prereleases', () => {
  assert.equal(extractLatestVersion('github-latest', { tag_name: 'v2.5.1', draft: false, prerelease: false }).raw, '2.5.1');
  assert.equal(extractLatestVersion('github-latest', { tag_name: 'release-3.0.0' }).raw, '3.0.0');
  assert.throws(() => extractLatestVersion('github-latest', { tag_name: 'v2.0.0', draft: true }), ProbeError);
  assert.throws(() => extractLatestVersion('github-latest', { tag_name: 'v2.0.0', prerelease: true }), ProbeError);
  assert.throws(() => extractLatestVersion('github-latest', { tag_name: 'nightly' }), ProbeError);
  assert.throws(() => extractLatestVersion('github-latest', { tag_name: 'v2.0.0-rc.1' }), ProbeError);
  assert.throws(() => extractLatestVersion('github-latest', {}), ProbeError);
});

test('an unknown format fails closed rather than guessing', () => {
  assert.throws(() => extractLatestVersion('crates-io', { version: '1.0.0' }), ProbeError);
});

test('probeHeaders asks each registry for its smallest documented representation', () => {
  assert.match(probeHeaders('npm-latest').accept, /vnd\.npm\.install-v1\+json/);
  assert.match(probeHeaders('github-latest').accept, /vnd\.github\+json/);
  assert.equal(probeHeaders('github-latest')['x-github-api-version'], '2022-11-28');
  assert.equal(probeHeaders('nuget-index').accept, 'application/json');
  for (const format of PROBE_FORMATS) {
    assert.ok(probeHeaders(format)['user-agent'], `${format} must send a user-agent`);
  }
});

// ---------------------------------------------------------------------
// Bounded fetch
// ---------------------------------------------------------------------

test('fetchBoundedJson returns parsed JSON and validators, never a body', async () => {
  const impl = fakeFetch(() =>
    jsonResponse({ versions: ['1.0.0'] }, { headers: { etag: 'W/"abc"', 'last-modified': 'Mon, 01 Jan 2029 00:00:00 GMT' } }),
  );
  const { json, headers } = await fetchBoundedJson('https://example.test/index.json', {
    format: 'nuget-index',
    fetchImpl: impl,
  });
  assert.deepEqual(json, { versions: ['1.0.0'] });
  assert.deepEqual(headers, { status: 200, etag: 'W/"abc"', lastModified: 'Mon, 01 Jan 2029 00:00:00 GMT' });
  assert.equal(impl.calls[0].init.method, 'GET');
});

test('fetchBoundedJson refuses an oversized declared response without reading it', async () => {
  // A hand-built response whose body cannot be read without failing the
  // test: the only legitimate interaction is cancelling it.
  let readAttempted = false;
  let cancelled = false;
  const guardedResponse = {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json', 'content-length': '999999' }),
    body: {
      getReader() {
        readAttempted = true;
        throw new Error('the body must not be read');
      },
      async cancel() {
        cancelled = true;
      },
    },
    async text() {
      readAttempted = true;
      return '{}';
    },
  };
  const impl = fakeFetch(() => guardedResponse);
  await assert.rejects(
    fetchBoundedJson('https://example.test/big.json', { fetchImpl: impl, maxBytes: 1024 }),
    (err) => err instanceof ProbeError && /999999 bytes, over the 1024-byte probe limit/.test(err.message),
  );
  assert.equal(readAttempted, false, 'the body must not be read once the declared size is over the limit');
  assert.equal(cancelled, true, 'the oversized body must be cancelled');
});

test('fetchBoundedJson stops reading a streamed response once it exceeds the limit', async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(600));
      controller.enqueue(new Uint8Array(600));
      controller.enqueue(new Uint8Array(600));
      controller.close();
    },
  });
  const impl = fakeFetch(() => new Response(stream, { headers: { 'content-type': 'application/json' } }));
  await assert.rejects(
    fetchBoundedJson('https://example.test/stream.json', { fetchImpl: impl, maxBytes: 1000 }),
    (err) => err instanceof ProbeError && /exceeded the 1000-byte probe limit/.test(err.message),
  );
});

test('fetchBoundedJson fails closed on non-JSON, malformed JSON and HTTP errors', async () => {
  const html = fakeFetch(() => new Response('<html>nope</html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  await assert.rejects(
    fetchBoundedJson('https://example.test/x', { fetchImpl: html }),
    (err) => err instanceof ProbeError && /unexpected content-type/.test(err.message),
  );

  const malformed = fakeFetch(() => jsonResponse('{"versions": ['));
  await assert.rejects(
    fetchBoundedJson('https://example.test/x', { fetchImpl: malformed }),
    (err) => err instanceof ProbeError && /not parseable JSON/.test(err.message),
  );

  const serverError = fakeFetch(() => jsonResponse({ message: 'boom' }, { status: 500 }));
  await assert.rejects(
    fetchBoundedJson('https://example.test/x', { fetchImpl: serverError }),
    (err) => err instanceof ProbeError && /HTTP 500/.test(err.message),
  );
});

test('fetchBoundedJson names rate limiting and timeouts explicitly', async () => {
  const limited = fakeFetch(() =>
    jsonResponse({ message: 'rate limit exceeded' }, { status: 403, headers: { 'x-ratelimit-remaining': '0' } }),
  );
  await assert.rejects(fetchBoundedJson('https://example.test/x', { fetchImpl: limited }), (err) =>
    /rate limited/.test(err.message),
  );

  const timeout = fakeFetch(() => {
    const err = new Error('aborted');
    err.name = 'TimeoutError';
    throw err;
  });
  await assert.rejects(fetchBoundedJson('https://example.test/x', { fetchImpl: timeout, timeoutMs: 25 }), (err) =>
    /timed out after 25ms/.test(err.message),
  );
});

test('fetchBoundedJson surfaces the transport cause behind "fetch failed"', async () => {
  const tlsFailure = fakeFetch(() => {
    const err = new TypeError('fetch failed');
    err.cause = Object.assign(new Error('handshake'), { code: 'ERR_SSL_SSL/TLS_ALERT_HANDSHAKE_FAILURE' });
    throw err;
  });
  await assert.rejects(fetchBoundedJson('https://example.test/x', { fetchImpl: tlsFailure }), (err) =>
    /fetch failed \(ERR_SSL_SSL\/TLS_ALERT_HANDSHAKE_FAILURE\)/.test(err.message),
  );
});

test('runProbe never throws and reports the failure reason', async () => {
  const impl = fakeFetch(() => jsonResponse({ nope: true }));
  const result = await runProbe(
    { url: 'https://example.test/x', format: 'nuget-index', testedVersion: '1.0.0', alertOn: 'minor' },
    { fetchImpl: impl },
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /no "versions" array/);
});

// ---------------------------------------------------------------------
// Configuration validation
// ---------------------------------------------------------------------

test('validateProbeConfig accepts a well-formed probe', () => {
  assert.deepEqual(
    validateProbeConfig({
      url: 'https://api.nuget.org/v3-flatcontainer/newtonsoft.json/index.json',
      format: 'nuget-index',
      testedVersion: '13.0.3',
      alertOn: 'minor',
    }),
    [],
  );
  assert.deepEqual(
    validateProbeConfig({ url: 'https://example.test/x.json', format: 'npm-latest', testedVersion: '1.0.0' }),
    [],
    'alertOn is optional',
  );
});

test('validateProbeConfig rejects every malformed shape', () => {
  const cases = [
    [null, /must be an object/],
    ['https://example.test', /must be an object/],
    [{ format: 'npm-latest', testedVersion: '1.0.0' }, /url: required/],
    [{ url: 'http://example.test/x', format: 'npm-latest', testedVersion: '1.0.0' }, /must use https/],
    [{ url: 'not a url', format: 'npm-latest', testedVersion: '1.0.0' }, /not a valid URL/],
    [{ url: 'https://example.test/x', format: 'crates-io', testedVersion: '1.0.0' }, /format: must be one of/],
    [{ url: 'https://example.test/x', format: 'npm-latest' }, /testedVersion/],
    [{ url: 'https://example.test/x', format: 'npm-latest', testedVersion: 'latest' }, /testedVersion/],
    [
      { url: 'https://example.test/x', format: 'npm-latest', testedVersion: '1.0.0', alertOn: 'patch' },
      /alertOn: must be one of/,
    ],
    [
      { url: 'https://example.test/x', format: 'npm-latest', testedVersion: '1.0.0', autoUpdate: true },
      /unexpected property "autoUpdate"/,
    ],
  ];
  for (const [probe, pattern] of cases) {
    const errors = validateProbeConfig(probe);
    assert.ok(errors.length > 0, `expected errors for ${JSON.stringify(probe)}`);
    assert.ok(errors.some((e) => pattern.test(e)), `expected ${pattern} in ${JSON.stringify(errors)}`);
  }
});

// ---------------------------------------------------------------------
// Orchestration inside check-freshness.mjs
// ---------------------------------------------------------------------

function source(id, probe, extra = {}) {
  return {
    id,
    canonicalUrl: 'https://example.test/docs',
    retrievalPolicy: 'metadata-only',
    lastReviewed: '2026-01-01',
    reviewAfterDays: 30,
    ...extra,
    ...(probe ? { versionProbe: probe } : {}),
  };
}

test('checkVersionProbes classifies drift, informational bumps and failures', async () => {
  const responses = {
    'https://example.test/npm': () => jsonResponse({ 'dist-tags': { latest: '20.0.0' } }),
    'https://example.test/nuget': () => jsonResponse({ versions: ['9.0.1', '9.0.4'] }),
    'https://example.test/dotnet': () => jsonResponse('not json at all'),
  };
  const impl = fakeFetch((url) => responses[url]());

  const outcome = await checkVersionProbes(
    [
      source('no-probe', null),
      source('npm-drift', {
        url: 'https://example.test/npm',
        format: 'npm-latest',
        testedVersion: '19.1.0',
        alertOn: 'minor',
      }),
      source('nuget-quiet', {
        url: 'https://example.test/nuget',
        format: 'nuget-index',
        testedVersion: '9.0.1',
        alertOn: 'minor',
      }),
      source('dotnet-broken', {
        url: 'https://example.test/dotnet',
        format: 'dotnet-release-index',
        testedVersion: '9.0.8',
      }),
    ],
    { fetchImpl: impl, now: new Date('2026-08-26T00:00:00Z') },
  );

  assert.equal(outcome.versionDrift.length, 1);
  assert.equal(outcome.versionDrift[0].id, 'npm-drift');
  assert.equal(outcome.versionDrift[0].bump, 'major');
  assert.equal(outcome.versionCurrent.length, 1);
  assert.equal(outcome.versionCurrent[0].status, 'behind');
  assert.equal(outcome.probeErrors.length, 1);
  assert.equal(outcome.probeErrors[0].id, 'dotnet-broken');
  assert.match(outcome.probeErrors[0].error, /not parseable JSON/);
  assert.equal(impl.calls.length, 3, 'a source without a probe is never fetched');
});

test('checkVersionProbes caches only the observed version and validators', async () => {
  const impl = fakeFetch(() => jsonResponse({ versions: ['1.4.0'] }, { headers: { etag: '"v14"' } }));
  const outcome = await checkVersionProbes(
    [source('pkg', { url: 'https://example.test/n', format: 'nuget-index', testedVersion: '1.4.0' })],
    { fetchImpl: impl, now: new Date('2026-08-26T00:00:00Z') },
  );
  assert.deepEqual(Object.keys(outcome.cacheEntries), ['pkg']);
  assert.deepEqual(outcome.cacheEntries.pkg, {
    version: '1.4.0',
    etag: '"v14"',
    lastModified: null,
    status: 200,
    checkedAt: '2026-08-26T00:00:00.000Z',
  });
});

test('checkVersionProbes honours manual-review-only and skips invalid probes', async () => {
  const impl = fakeFetch(() => jsonResponse({ versions: ['2.0.0'] }));
  const outcome = await checkVersionProbes(
    [
      source(
        'hands-off',
        { url: 'https://example.test/n', format: 'nuget-index', testedVersion: '1.0.0' },
        { retrievalPolicy: 'manual-review-only' },
      ),
      source('bad-config', { url: 'http://example.test/n', format: 'nuget-index', testedVersion: '1.0.0' }),
    ],
    { fetchImpl: impl },
  );
  assert.equal(impl.calls.length, 0, 'neither probe may be executed');
  assert.deepEqual(
    outcome.probesSkipped.map((s) => s.id),
    ['hands-off'],
  );
  assert.equal(outcome.versionDrift.length + outcome.versionCurrent.length + outcome.probeErrors.length, 0);
});

test('importing check-freshness.mjs does not run the checker', async () => {
  const module = await import('../check-freshness.mjs');
  assert.equal(typeof module.checkVersionProbes, 'function');
});

test('computeExitCode keeps the documented 0/1/2 contract', () => {
  const empty = {
    schemaErrors: [],
    dateErrors: [],
    probeConfigErrors: [],
    overdue: [],
    drift: [],
    versionDrift: [],
    probeErrors: [],
  };
  assert.equal(computeExitCode(empty), 0);
  assert.equal(computeExitCode({ ...empty, probeConfigErrors: ['bad probe'] }), 1, 'probe config errors block');
  assert.equal(computeExitCode({ ...empty, overdue: [{ id: 'x' }] }), 1);
  assert.equal(computeExitCode({ ...empty, versionDrift: [{ id: 'x' }] }), 2, 'version drift requires review');
  assert.equal(computeExitCode({ ...empty, probeErrors: [{ id: 'x' }] }), 2, 'a failed probe fails closed');
  assert.equal(computeExitCode({ ...empty, drift: [{ id: 'x' }] }), 2);
  assert.equal(
    computeExitCode({ ...empty, schemaErrors: ['x'], versionDrift: [{ id: 'y' }] }),
    1,
    'blocking outranks review-required',
  );
  // Informational, below-threshold bumps must never change the exit code.
  assert.equal(computeExitCode({ ...empty, versionCurrent: [{ id: 'x', status: 'behind' }] }), 0);
});
