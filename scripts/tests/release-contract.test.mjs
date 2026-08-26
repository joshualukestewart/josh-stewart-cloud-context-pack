/**
 * scripts/tests/release-contract.test.mjs
 *
 * Fixture tests for the delivery-site release contract: the canonical tool
 * names accepted in the two claim lists, the no-duplicate and no-overlap
 * rules, and the blob-name shape. Pure and offline.
 *
 *   node --test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  REPO_ROOT,
  SITE_BLOB_PREFIX,
  SITE_KNOWN_TOOLS,
  SITE_PACK_ID,
} from '../lib/pack-lib.mjs';
import { inspectReleaseClaims } from '../validate-pack.mjs';
import { collectFiles, validateSiteContract } from '../build-release.mjs';

const errors = (issues) => issues.filter((i) => i.level === 'error').map((i) => i.message);
const matches = (list, pattern) => list.some((message) => pattern.test(message));

const VALID_CURRENT = {
  packId: SITE_PACK_ID,
  version: '0.3.0-pre.1',
  blobName: `${SITE_BLOB_PREFIX}/0.3.0-pre.1/josh-stewart-cloud-context-pack-0.3.0-pre.1.zip`,
  sizeBytes: 1234,
  sha256: 'a'.repeat(64),
  publishedAt: '2026-08-26T01:00:00.000Z',
  repositoryUrl: 'https://github.com/joshualukestewart/josh-stewart-cloud-context-pack',
  formallyTestedWith: [],
  adapterSupport: ['GitHub Copilot', 'Claude Code', 'OpenAI Codex', 'Gemini CLI'],
  knowledgeReviewedAt: '2026-08-26T00:00:00.000Z',
  reviewDueAt: '2026-09-24T00:00:00.000Z',
  sourceRegistrySha256: 'b'.repeat(64),
};
const NOW = Date.parse('2026-08-26T02:00:00.000Z');

const contract = (overrides = {}) => validateSiteContract({ ...VALID_CURRENT, ...overrides }, { now: NOW });

// ---------------------------------------------------------------------
// The canonical tool names
// ---------------------------------------------------------------------

test('the canonical tool list is exactly what the delivery API accepts', () => {
  assert.deepEqual(SITE_KNOWN_TOOLS, ['GitHub Copilot', 'Claude Code', 'OpenAI Codex', 'Gemini CLI']);
});

test('a well-formed release block and pointer pass', () => {
  assert.deepEqual(
    inspectReleaseClaims({
      packId: SITE_PACK_ID,
      formallyTestedWith: [],
      adapterSupport: [...SITE_KNOWN_TOOLS],
    }),
    [],
  );
  assert.deepEqual(contract(), []);
});

test('tool names carrying file paths are rejected on both sides', () => {
  const decorated = ['GitHub Copilot (.github/copilot-instructions.md)', 'Claude (CLAUDE.md, .claude/skills)'];

  const manifestIssues = inspectReleaseClaims({
    packId: SITE_PACK_ID,
    formallyTestedWith: [],
    adapterSupport: decorated,
  });
  assert.ok(matches(errors(manifestIssues), /accepts only the canonical names/), JSON.stringify(errors(manifestIssues)));
  assert.ok(matches(errors(manifestIssues), /README\.md and COMPATIBILITY\.md/), JSON.stringify(errors(manifestIssues)));

  const pointerIssues = contract({ adapterSupport: decorated });
  assert.ok(matches(pointerIssues, /only GitHub Copilot, Claude Code, OpenAI Codex, Gemini CLI are accepted/), JSON.stringify(pointerIssues));
});

test('near-miss names are still rejected', () => {
  for (const wrong of ['Claude', 'Copilot', 'Codex', 'Gemini', 'github copilot']) {
    const issues = inspectReleaseClaims({ packId: SITE_PACK_ID, formallyTestedWith: [], adapterSupport: [wrong] });
    assert.ok(matches(errors(issues), /canonical names/), `${wrong} should be rejected`);
    assert.ok(matches(contract({ adapterSupport: [wrong] }), /are accepted/), `${wrong} should be rejected by the pointer check`);
  }
});

test('duplicates within a list are rejected', () => {
  const issues = inspectReleaseClaims({
    packId: SITE_PACK_ID,
    formallyTestedWith: [],
    adapterSupport: ['GitHub Copilot', 'GitHub Copilot'],
  });
  assert.ok(matches(errors(issues), /repeats "GitHub Copilot"/), JSON.stringify(errors(issues)));
  assert.ok(matches(contract({ adapterSupport: ['Claude Code', 'Claude Code'] }), /entries must be unique/));
});

test('a tool may not appear in both lists', () => {
  const issues = inspectReleaseClaims({
    packId: SITE_PACK_ID,
    formallyTestedWith: ['Claude Code'],
    adapterSupport: ['Claude Code', 'Gemini CLI'],
  });
  assert.ok(
    matches(errors(issues), /"Claude Code" appears in both formallyTestedWith and adapterSupport/),
    JSON.stringify(errors(issues)),
  );

  assert.ok(
    matches(contract({ formallyTestedWith: ['Gemini CLI'], adapterSupport: ['Gemini CLI'] }), /may not appear in both/),
  );
});

test('an empty formallyTestedWith is contract-valid; the build gate is what blocks a release', () => {
  assert.deepEqual(contract({ formallyTestedWith: [] }), []);
  assert.deepEqual(
    errors(inspectReleaseClaims({ packId: SITE_PACK_ID, formallyTestedWith: [], adapterSupport: [...SITE_KNOWN_TOOLS] })),
    [],
  );
});

test('packId drift is caught in the manifest and the pointer', () => {
  assert.ok(matches(errors(inspectReleaseClaims({ packId: 'josh-stewart-cloud-context-pack' })), /release\.packId must be/));
  assert.ok(matches(contract({ packId: 'other-pack' }), /packId must be "cloud-full-stack"/));
});

// ---------------------------------------------------------------------
// Blob naming and timestamps
// ---------------------------------------------------------------------

test('blobName must sit under releases/<version>/', () => {
  assert.ok(
    matches(contract({ blobName: 'cloud-full-stack/0.3.0-pre.1/pack.zip' }), /must start with "releases\/0\.3\.0-pre\.1\//),
  );
  assert.ok(matches(contract({ blobName: 'releases/9.9.9/pack.zip' }), /must start with "releases\/0\.3\.0-pre\.1\//));
  assert.deepEqual(contract({ blobName: 'releases/0.3.0-pre.1/pack.zip' }), []);
});

test('unsafe blob names are rejected', () => {
  for (const blob of ['/releases/0.3.0-pre.1/pack.zip', 'releases/0.3.0-pre.1/../pack.zip', 'releases\\0.3.0-pre.1\\pack.zip', 'releases/0.3.0-pre.1/pack.tar']) {
    assert.ok(contract({ blobName: blob }).length > 0, `${blob} should be rejected`);
  }
});

test('timestamps follow the site rules', () => {
  assert.ok(matches(contract({ publishedAt: '2026-08-27T00:00:00.000Z' }), /publishedAt must not be more than 5 minutes in the future/));
  assert.ok(matches(contract({ knowledgeReviewedAt: '2026-08-26T01:30:00.000Z' }), /knowledgeReviewedAt must not be later than publishedAt/));
  assert.ok(matches(contract({ reviewDueAt: '2026-08-26T00:00:00.000Z' }), /reviewDueAt must be later than knowledgeReviewedAt/));
  assert.ok(matches(contract({ reviewDueAt: '2027-09-24T00:00:00.000Z' }), /within 365 days/));
});

test('size, hashes and repository URL are checked', () => {
  assert.ok(matches(contract({ sizeBytes: 0 }), /sizeBytes must be between/));
  assert.ok(matches(contract({ sizeBytes: 100_000_001 }), /sizeBytes must be between/));
  assert.ok(matches(contract({ sha256: 'nope' }), /sha256 must be 64 lower-case hex/));
  assert.ok(matches(contract({ sourceRegistrySha256: 'A'.repeat(64) }), /sourceRegistrySha256 must be 64 lower-case hex/));
  assert.ok(matches(contract({ repositoryUrl: 'http://example.test/repo' }), /repositoryUrl must be an absolute https URL/));
});

test('the release includes log evidence required by the eval suite', () => {
  assert.ok(
    collectFiles(REPO_ROOT).includes(
      'evals/fixtures/trace-diagnosis/logs/api-excerpt.log',
    ),
  );
});
