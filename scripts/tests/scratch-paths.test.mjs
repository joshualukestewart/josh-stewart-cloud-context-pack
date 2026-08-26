import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { collectFiles } from '../build-release.mjs';
import { isToolingScratchPath } from '../lib/pack-lib.mjs';
import { repoFiles } from '../validate-pack.mjs';

test('evaluation run workspaces are never validated or shipped', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pack-scratch-test-'));
  try {
    mkdirSync(path.join(root, 'evals', 'runs', 'iteration-1'), {
      recursive: true,
    });
    writeFileSync(path.join(root, 'evals', 'README.md'), 'reviewed source\n');
    writeFileSync(
      path.join(root, 'evals', 'runs', 'iteration-1', 'transcript.md'),
      'machine-local evidence\n',
    );

    const scanned = repoFiles(root);
    assert.ok(scanned.some((file) => file.rel === 'evals/README.md'));
    assert.ok(
      !scanned.some((file) => file.rel.startsWith('evals/runs/')),
    );
    assert.deepEqual(scanned.skipped, ['evals/runs']);

    const shipped = collectFiles(root);
    assert.ok(shipped.includes('evals/README.md'));
    assert.ok(!shipped.some((file) => file.startsWith('evals/runs/')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('tooling scratch matching is path-specific', () => {
  assert.equal(isToolingScratchPath('evals/runs'), true);
  assert.equal(isToolingScratchPath('evals/runs/iteration-1/run.json'), true);
  assert.equal(isToolingScratchPath('examples/runs/README.md'), false);
  assert.equal(isToolingScratchPath('evals/RESULTS.md'), false);
});
