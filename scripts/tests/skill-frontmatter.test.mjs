/**
 * scripts/tests/skill-frontmatter.test.mjs
 *
 * Fixture tests for the Agent Skills front-matter shape enforced by
 * scripts/validate-pack.mjs. Pure and offline: each case parses real
 * front-matter text with the pack's own YAML subset parser, then asserts
 * what the validator reports.
 *
 *   node --test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { splitFrontmatter } from '../lib/pack-lib.mjs';
import {
  inspectPositioning,
  inspectSkillFrontmatter,
  isTextFile,
} from '../validate-pack.mjs';

/** Parse front-matter text exactly as the validator does. */
function frontmatter(text) {
  const parsed = splitFrontmatter(`---\n${text}---\n\n# Skill\n`);
  assert.equal(parsed.error, null, `front matter should parse: ${parsed.error}`);
  return parsed.frontmatter;
}

function inspect(text, dirName = 'example-skill', options = {}) {
  return inspectSkillFrontmatter(frontmatter(text), dirName, options);
}

const errors = (issues) => issues.filter((i) => i.level === 'error').map((i) => i.message);
const warnings = (issues) => issues.filter((i) => i.level === 'warn').map((i) => i.message);
const matches = (list, pattern) => list.some((message) => pattern.test(message));

const VALID = `name: example-skill
description: Use when doing the example thing in this codebase.
license: MIT
compatibility: Authored 2026-08-26 against the Agent Skills specification; no behaviour has been benchmarked.
metadata:
  pack: josh-stewart-cloud-context-pack
  owner: Joshua Stewart
  layer: api
`;

// ---------------------------------------------------------------------
// The standard shape
// ---------------------------------------------------------------------

test('the standard shape passes with no issues', () => {
  assert.deepEqual(inspect(VALID), []);
});

test('compatibility is required and must be a top-level string', () => {
  const missing = inspect(`name: example-skill
description: Use when doing the example thing.
license: MIT
`);
  assert.ok(matches(errors(missing), /"compatibility" is required/), JSON.stringify(errors(missing)));

  const mapping = inspect(`name: example-skill
description: Use when doing the example thing.
license: MIT
compatibility:
  authored: "2026-08-26"
  behaviourVerified: "none"
`);
  assert.ok(matches(errors(mapping), /"compatibility" must be a string, not object/), JSON.stringify(errors(mapping)));

  const list = inspect(`name: example-skill
description: Use when doing the example thing.
license: MIT
compatibility: [one, two]
`);
  assert.ok(matches(errors(list), /must be a string, not a list/), JSON.stringify(errors(list)));

  const empty = inspect(`name: example-skill
description: Use when doing the example thing.
license: MIT
compatibility: ""
`);
  assert.ok(matches(errors(empty), /must not be empty/), JSON.stringify(errors(empty)));
});

test('nested metadata.compatibility is rejected with a migration hint', () => {
  const issues = inspect(`name: example-skill
description: Use when doing the example thing.
license: MIT
compatibility: Authored 2026-08-26; nothing benchmarked.
metadata:
  pack: josh-stewart-cloud-context-pack
  compatibility:
    authored: "2026-08-26"
    behaviourVerified: "none"
`);
  assert.ok(
    matches(errors(issues), /metadata\.compatibility is not the standard shape.*top-level "compatibility" string/s),
    JSON.stringify(errors(issues)),
  );
});

test('metadata values must be flat strings', () => {
  const nested = inspect(`name: example-skill
description: Use when doing the example thing.
license: MIT
compatibility: Authored 2026-08-26; nothing benchmarked.
metadata:
  pack: josh-stewart-cloud-context-pack
  anchors:
    dotnet: "9.0.19"
`);
  assert.ok(matches(errors(nested), /metadata\.anchors must be a flat string; nested metadata/), JSON.stringify(errors(nested)));

  const list = inspect(`name: example-skill
description: Use when doing the example thing.
license: MIT
compatibility: Authored 2026-08-26; nothing benchmarked.
metadata:
  tools: [copilot, claude]
`);
  assert.ok(matches(errors(list), /metadata\.tools must be a flat string, not a list/), JSON.stringify(errors(list)));

  const unquoted = inspect(`name: example-skill
description: Use when doing the example thing.
license: MIT
compatibility: Authored 2026-08-26; nothing benchmarked.
metadata:
  version: 3
  verified: false
`);
  assert.ok(matches(errors(unquoted), /metadata\.version must be a quoted string, not a number/), JSON.stringify(errors(unquoted)));
  assert.ok(matches(errors(unquoted), /metadata\.verified must be a quoted string, not a boolean/), JSON.stringify(errors(unquoted)));

  const emptyValue = inspect(`name: example-skill
description: Use when doing the example thing.
license: MIT
compatibility: Authored 2026-08-26; nothing benchmarked.
metadata:
  owner:
`);
  assert.ok(matches(errors(emptyValue), /metadata\.owner must be a string, not an empty value/), JSON.stringify(errors(emptyValue)));

  const scalarMetadata = inspect(`name: example-skill
description: Use when doing the example thing.
license: MIT
compatibility: Authored 2026-08-26; nothing benchmarked.
metadata: josh-stewart-cloud-context-pack
`);
  assert.ok(matches(errors(scalarMetadata), /"metadata" must be a mapping of flat string values/), JSON.stringify(errors(scalarMetadata)));
});

test('metadata is optional', () => {
  assert.deepEqual(
    inspect(`name: example-skill
description: Use when doing the example thing.
license: MIT
compatibility: Authored 2026-08-26; nothing benchmarked.
`),
    [],
  );
});

// ---------------------------------------------------------------------
// Identity, description and licence
// ---------------------------------------------------------------------

test('name must be kebab-case and match its directory', () => {
  const mismatch = inspect(VALID, 'other-skill');
  assert.ok(matches(errors(mismatch), /does not match its directory "other-skill"/), JSON.stringify(errors(mismatch)));

  const shouty = inspect(VALID.replace('name: example-skill', 'name: Example_Skill'), 'Example_Skill');
  assert.ok(matches(errors(shouty), /must be lower-case kebab-case/), JSON.stringify(errors(shouty)));

  const absent = inspect(`description: Use when doing the example thing.
license: MIT
compatibility: Authored 2026-08-26; nothing benchmarked.
`);
  assert.ok(matches(errors(absent), /"name" is required/), JSON.stringify(errors(absent)));
});

test('description must exist, be real, and stay within budget', () => {
  const placeholder = inspect(VALID.replace(/description: .*/, 'description: TODO write this'));
  assert.ok(matches(errors(placeholder), /description is still a placeholder/), JSON.stringify(errors(placeholder)));

  const long = inspect(VALID.replace(/description: .*/, `description: ${'x'.repeat(1100)}`));
  assert.ok(matches(errors(long), /description is 1100 characters/), JSON.stringify(errors(long)));

  const chatty = inspect(VALID.replace(/description: .*/, `description: ${'x'.repeat(700)}`));
  assert.ok(matches(warnings(chatty), /consider tightening it/), JSON.stringify(warnings(chatty)));
  assert.deepEqual(errors(chatty), []);
});

test('licence must be SPDX-style, and a mismatch with the pack licence warns', () => {
  const bad = inspect(VALID.replace('license: MIT', 'license: "see NOTICE"'));
  assert.ok(matches(errors(bad), /is not an SPDX-style identifier/), JSON.stringify(errors(bad)));

  const matching = inspect(VALID, 'example-skill', { packLicense: 'MIT' });
  assert.deepEqual(matching, []);

  const different = inspect(VALID.replace('license: MIT', 'license: Apache-2.0'), 'example-skill', { packLicense: 'MIT' });
  assert.ok(matches(warnings(different), /differs from the pack license "MIT"/), JSON.stringify(warnings(different)));
});

test('compatibility has a length budget and rejects placeholders', () => {
  const long = inspect(VALID.replace(/compatibility: .*/, `compatibility: ${'y'.repeat(1100)}`));
  assert.ok(matches(errors(long), /compatibility is 1100 characters/), JSON.stringify(errors(long)));

  const placeholder = inspect(VALID.replace(/compatibility: .*/, 'compatibility: TBD'));
  assert.ok(matches(errors(placeholder), /compatibility is still a placeholder/), JSON.stringify(errors(placeholder)));
});

test('keys outside the standard shape are flagged but not fatal', () => {
  const issues = inspect(`${VALID}unverified: true
`);
  assert.deepEqual(errors(issues), []);
  assert.ok(matches(warnings(issues), /"unverified" is outside the Agent Skills standard shape/), JSON.stringify(warnings(issues)));
});

test('allowed-tools and version are part of the standard shape', () => {
  const issues = inspect(`${VALID}allowed-tools: Read, Grep
version: "1.0.0"
`);
  assert.deepEqual(issues, []);
});

// ---------------------------------------------------------------------
// Positioning claims about the pack itself
// ---------------------------------------------------------------------

test('inaccurate positioning claims are caught where the pack describes itself', () => {
  const vendorNeutral = inspectPositioning(
    "Joshua Stewart's vendor-neutral, versioned context pack for Microsoft Azure full-stack development.",
    'manifest.description',
  );
  assert.equal(vendorNeutral.length, 1);
  assert.match(vendorNeutral[0].message, /inaccurate: the guidance is deliberately Microsoft Azure-specific/);

  assert.equal(inspectPositioning('A cloud agnostic pack.', 'README.md').length, 1);
  assert.deepEqual(inspectPositioning("Joshua Stewart's tool-portable, versioned context pack.", 'manifest.description'), []);
  assert.deepEqual(inspectPositioning('A cross-agent context pack for Microsoft Azure.', 'README.md'), []);
});

test('recording the wording change is not itself a claim', () => {
  assert.deepEqual(
    inspectPositioning('Renamed the positioning from vendor-neutral to tool-portable.', 'CHANGELOG.md'),
    [],
  );
  assert.deepEqual(inspectPositioning('', 'manifest.description'), []);
  assert.deepEqual(inspectPositioning(undefined, 'manifest.description'), []);
});

test('secret scanning covers every source format shipped by the pack', () => {
  for (const extension of [
    '.cs',
    '.csproj',
    '.tsx',
    '.ts',
    '.css',
    '.bicep',
    '.bicepparam',
    '.sql',
    '.log',
  ]) {
    assert.equal(isTextFile(`evals/fixture/file${extension}`), true, extension);
  }
});
