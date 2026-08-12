import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createContext } from '../src/context.js';
import '../src/checks/index.js';
import { doctor } from '../src/engine.js';

function unityRepo(version) {
  const d = mkdtempSync(join(tmpdir(), 'uak-'));
  execFileSync('git', ['init', '-q', d]);
  mkdirSync(join(d, 'ProjectSettings'), { recursive: true });
  writeFileSync(join(d, 'ProjectSettings', 'ProjectVersion.txt'), `m_EditorVersion: ${version}\n`);
  return d;
}

test('unity-version: pass on 6000.x, warn otherwise, na without ProjectVersion', async () => {
  assert.equal((await doctor(createContext(unityRepo('6000.5.5f1')), { only: 'unity-version' }))[0].status, 'pass');
  assert.equal((await doctor(createContext(unityRepo('2022.3.10f1')), { only: 'unity-version' }))[0].status, 'warn');
  const bare = mkdtempSync(join(tmpdir(), 'uak-'));
  assert.equal((await doctor(createContext(bare), { only: 'unity-version' }))[0].status, 'na');
});

test('path-headroom: warn when Library nests deep relative to MAX_PATH', async () => {
  const d = unityRepo('6000.5.5f1');
  const deep = join(d, 'Library', 'PackageCache', 'a'.repeat(80), 'b'.repeat(80), 'c'.repeat(60));
  mkdirSync(deep, { recursive: true });
  writeFileSync(join(deep, 'x.meta'), '');
  const r = (await doctor(createContext(d), { only: 'path-headroom' }))[0];
  assert.equal(r.status, 'warn');
  assert.match(r.evidence, /headroom/);
});
