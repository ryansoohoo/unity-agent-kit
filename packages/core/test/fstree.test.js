import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { listFiles, treesEqual } from '../../../scripts/fstree.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('treesEqual: equal trees, content drift, extra files', () => {
  const a = mkdtempSync(join(tmpdir(), 'uak-f-'));
  const b = mkdtempSync(join(tmpdir(), 'uak-f-'));
  mkdirSync(join(a, 'd')); mkdirSync(join(b, 'd'));
  writeFileSync(join(a, 'd', 'f.md'), 'same');
  writeFileSync(join(b, 'd', 'f.md'), 'same');
  assert.deepEqual(listFiles(a), ['d/f.md']);
  assert.ok(treesEqual(a, b));
  writeFileSync(join(b, 'd', 'f.md'), 'drift');
  assert.ok(!treesEqual(a, b));
  writeFileSync(join(b, 'd', 'f.md'), 'same');
  writeFileSync(join(b, 'extra.md'), 'x');
  assert.ok(!treesEqual(a, b));
  assert.ok(!treesEqual(a, join(tmpdir(), 'uak-missing-xyz')));
  assert.ok(!treesEqual(join(tmpdir(), 'uak-missing-1'), join(tmpdir(), 'uak-missing-2')), 'two missing trees are not vacuously equal');
});

test('build-plugin --check passes on a fresh repo', () => {
  execFileSync(process.execPath, ['scripts/build-plugin.mjs', '--check'], { cwd: REPO });
});
