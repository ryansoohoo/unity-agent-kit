import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createContext } from '../src/context.js';
import '../src/checks/index.js';
import { doctor } from '../src/engine.js';

function repoWith(files) {
  const d = mkdtempSync(join(tmpdir(), 'uak-'));
  execFileSync('git', ['init', '-q', d]);
  execFileSync('git', ['-C', d, 'config', 'user.email', 't@t.t']);
  execFileSync('git', ['-C', d, 'config', 'user.name', 't']);
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(d, ...p.split('/').slice(0, -1)), { recursive: true });
    writeFileSync(join(d, p), c);
  }
  execFileSync('git', ['-C', d, 'add', '-A']);
  execFileSync('git', ['-C', d, 'commit', '-qm', 'base']);
  return d;
}

test('warns when scenes/settings sit modified-uncommitted', async () => {
  const d = repoWith({ 'Assets/Main.unity': 'a', 'ProjectSettings/ProjectSettings.asset': 'b' });
  writeFileSync(join(d, 'Assets', 'Main.unity'), 'changed');
  writeFileSync(join(d, 'ProjectSettings', 'ProjectSettings.asset'), 'changed');
  const r = (await doctor(createContext(d), { only: 'editor-churn' }))[0];
  assert.equal(r.status, 'warn');
  assert.match(r.evidence, /Main\.unity/);
});

test('passes on a clean tree', async () => {
  const d = repoWith({ 'Assets/Main.unity': 'a' });
  assert.equal((await doctor(createContext(d), { only: 'editor-churn' }))[0].status, 'pass');
});
