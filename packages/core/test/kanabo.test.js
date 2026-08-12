import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { epochPath, requestPath, readEpoch, isFresh, requestRefresh, waitReady } from '../src/kanabo.js';

const proj = () => mkdtempSync(join(tmpdir(), 'uak-kb-'));

function writeSnap(root, snap) {
  mkdirSync(join(root, 'Temp', 'unity-agent-kit'), { recursive: true });
  writeFileSync(epochPath(root), JSON.stringify(snap));
}

const ready = (epoch, extra = {}) => ({ schema: 1, pid: 123, sessionId: 'abc', epoch, heartbeatMs: Date.now(), state: 'ready', worldRevision: 7, probePresent: false, probeValue: -1, ...extra });

test('readEpoch: null on missing, corrupt, and wrong-shape files; snapshot on valid', () => {
  const p = proj();
  assert.equal(readEpoch(p), null);
  writeSnap(p, ready(3));
  assert.equal(readEpoch(p).epoch, 3);
  writeFileSync(epochPath(p), '{torn');
  assert.equal(readEpoch(p), null);
  writeFileSync(epochPath(p), JSON.stringify({ hello: 'world' }));
  assert.equal(readEpoch(p), null);
});

test('isFresh: 3s heartbeat window', () => {
  const now = Date.now();
  assert.equal(isFresh(ready(1), now), true);
  assert.equal(isFresh({ ...ready(1), heartbeatMs: now - 2999 }, now), true);
  assert.equal(isFresh({ ...ready(1), heartbeatMs: now - 3001 }, now), false);
  assert.equal(isFresh(null, now), false);
});

test('requestRefresh writes the request file', () => {
  const p = proj();
  requestRefresh(p);
  assert.ok(existsSync(requestPath(p)));
  assert.match(readFileSync(requestPath(p), 'utf8'), /^\d+$/);
});

test('waitReady: immediate ok on a fresh ready file', async () => {
  const p = proj();
  writeSnap(p, ready(5));
  const r = await waitReady(p, { timeoutMs: 1000, pollMs: 20 });
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'ready');
  assert.equal(r.epoch, 5);
  assert.equal(r.worldRevision, 7);
});

test('waitReady: requireEpochBump waits for the bump then succeeds', async () => {
  const p = proj();
  writeSnap(p, ready(5));
  setTimeout(() => writeSnap(p, ready(6)), 150);
  const r = await waitReady(p, { sinceEpoch: 5, requireEpochBump: true, timeoutMs: 3000, pollMs: 25 });
  assert.equal(r.ok, true);
  assert.equal(r.epoch, 6);
  assert.ok(r.waitedMs >= 100, `waited ${r.waitedMs}`);
});

test('waitReady: compiling state is not ready; flips when state does', async () => {
  const p = proj();
  writeSnap(p, ready(4, { state: 'compiling' }));
  setTimeout(() => writeSnap(p, ready(4)), 150);
  const r = await waitReady(p, { timeoutMs: 3000, pollMs: 25 });
  assert.equal(r.ok, true);
  assert.equal(r.epoch, 4);
});

test('waitReady: no editor at all → no-editor at the deadline, never throws', async () => {
  const p = proj();
  const t0 = Date.now();
  const r = await waitReady(p, { timeoutMs: 300, pollMs: 40 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-editor');
  assert.ok(Date.now() - t0 < 1500, 'bounded');
});

test('waitReady: stale heartbeat with a live file → timeout reason says an editor WAS seen only if fresh once', async () => {
  const p = proj();
  writeSnap(p, ready(2, { heartbeatMs: Date.now() - 60000 }));
  const r = await waitReady(p, { timeoutMs: 300, pollMs: 40 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-editor'); // stale-only is indistinguishable from closed — honest label
});
