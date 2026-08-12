import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import '../src/checks/index.js';
import { getCheck } from '../src/registry.js';
import { _deps } from '../src/checks/orphans.js';

const orphans = getCheck('orphans');
const fakeCtx = (root) => ({ root, platform: 'win32', git: () => ({ ok: false, out: '', code: 1 }) });

function withProcs(procs, fn) {
  const prev = _deps.processes;
  _deps.processes = () => procs;
  return Promise.resolve(fn()).finally(() => { _deps.processes = prev; });
}

test('orphans: na off-Windows and when tasklist is unavailable', async () => {
  assert.equal((await orphans.detect({ ...fakeCtx('X:\\x'), platform: 'linux' })).status, 'na');
  await withProcs(null, async () => {
    assert.equal((await orphans.detect(fakeCtx('X:\\x'))).status, 'na');
  });
});

test('orphans: clean process table and no locks = pass', async () => {
  const root = mkdtempSync(join(tmpdir(), 'uak-or-'));
  await withProcs([{ name: 'Unity.exe', pid: 100 }, { name: 'dotnet.exe', pid: 200 }], async () => {
    const r = await orphans.detect(fakeCtx(root));
    assert.equal(r.status, 'pass');
    assert.match(r.evidence, /1 Unity, 1 dotnet/);
  });
});

test('orphans: multiple Unity processes warn with PIDs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'uak-or-'));
  await withProcs([{ name: 'Unity.exe', pid: 100 }, { name: 'Unity.exe', pid: 101 }], async () => {
    const r = await orphans.detect(fakeCtx(root));
    assert.equal(r.status, 'warn');
    assert.match(r.evidence, /2 Unity processes \(PIDs 100, 101\)/);
  });
});

test('orphans: UnityLockfile with no Unity running = stale lock warn', async () => {
  const root = mkdtempSync(join(tmpdir(), 'uak-or-'));
  mkdirSync(join(root, 'Temp'), { recursive: true });
  writeFileSync(join(root, 'Temp', 'UnityLockfile'), '');
  await withProcs([], async () => {
    const r = await orphans.detect(fakeCtx(root));
    assert.equal(r.status, 'warn');
    assert.match(r.evidence, /stale Temp\/UnityLockfile/);
  });
});

test('orphans: locked git worktree admin dirs are reported', async () => {
  const root = mkdtempSync(join(tmpdir(), 'uak-or-'));
  mkdirSync(join(root, '.git', 'worktrees', 'wt-a'), { recursive: true });
  writeFileSync(join(root, '.git', 'worktrees', 'wt-a', 'locked'), 'dead session');
  await withProcs([{ name: 'Unity.exe', pid: 1 }], async () => {
    const r = await orphans.detect(fakeCtx(root));
    assert.equal(r.status, 'warn');
    assert.match(r.evidence, /locked git worktrees: wt-a/);
  });
});

test('orphans: stale locks are scanned across every worktree root', async () => {
  const rootA = mkdtempSync(join(tmpdir(), 'uak-or-'));
  const rootB = mkdtempSync(join(tmpdir(), 'uak-or-'));
  mkdirSync(join(rootB, 'Temp'), { recursive: true });
  writeFileSync(join(rootB, 'Temp', 'UnityLockfile'), '');
  const ctx = {
    root: rootA, platform: 'win32',
    git: () => ({ ok: true, out: `worktree ${rootA}\nHEAD abc\nbranch refs/heads/main\n\nworktree ${rootB}\nHEAD def\ndetached`, code: 0 }),
  };
  await withProcs([], async () => {
    const r = await orphans.detect(ctx);
    assert.equal(r.status, 'warn');
    assert.match(r.evidence, /stale Temp\/UnityLockfile/);
    assert.ok(r.evidence.includes(rootB));
  });
});

test('orphans: tasklist CSV parser handles real output shape', () => {
  // _deps.processes is the ONLY place allowed to touch the real tasklist; here we
  // only verify it returns null or an array of {name, pid} without throwing.
  const procs = _deps.processes();
  assert.ok(procs === null || (Array.isArray(procs) && procs.every(p => typeof p.name === 'string' && Number.isInteger(p.pid))));
});
