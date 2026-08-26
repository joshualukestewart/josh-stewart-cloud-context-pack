import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { REPO_ROOT } from '../lib/pack-lib.mjs';

function filesUnder(root, current = root) {
  const files = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(root, absolute));
    else files.push(path.relative(root, absolute).replaceAll(path.sep, '/'));
  }
  return files.sort();
}

test('write mode is atomic when an existing MCP config is invalid', () => {
  const target = mkdtempSync(path.join(os.tmpdir(), 'context-pack-install-'));
  try {
    const vscode = path.join(target, '.vscode');
    mkdirSync(vscode, { recursive: true });
    writeFileSync(
      path.join(vscode, 'mcp.json'),
      '{\n  // valid JSONC, deliberately invalid strict JSON\n  "servers": {}\n}\n',
      'utf8',
    );

    const result = spawnSync(
      process.execPath,
      [
        path.join(REPO_ROOT, 'scripts', 'install.mjs'),
        '--tool=copilot',
        `--target=${target}`,
        '--write',
      ],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );

    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.deepEqual(filesUnder(target), ['.vscode/mcp.json']);
    assert.match(result.stderr, /MCP configuration aborted/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
