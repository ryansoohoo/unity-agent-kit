import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, renameSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmp } from './tmp.js';
import { channelDir, reqDir, runningDir, resDir, writeRequest, readOperation, readResult, cancelQueued, awaitResult, atomicJson } from '../src/actions.js';
import { acquireLease, leaseStatus, releaseLease, renewLease, cancelTicket } from '../src/leases.js';
import { epochPath } from '../src/kanabo.js';

function project() {
  const root = tmp('uak-ops-'); mkdirSync(channelDir(root), { recursive: true });
  writeFileSync(epochPath(root), JSON.stringify({ protocol: 2, sessionId: 'editor-A', epoch: 5, state: 'ready', heartbeatMs: Date.now() }));
  return root;
}
function claim(root, id) { mkdirSync(runningDir(root), { recursive: true }); renameSync(join(reqDir(root), id + '.json'), join(runningDir(root), id + '.json')); }
test('cancelling an unclaimed request wins ownership and no executable request remains', () => {
  const p = project(), id = writeRequest(p, 'invoke', { method: 'Fixture.Mutate' });
  assert.equal(cancelQueued(p, id).cancelled, true);
  assert.equal(existsSync(join(reqDir(p), id + '.json')), false);
  assert.throws(() => claim(p, id), { code: 'ENOENT' });
  assert.equal(readOperation(p, id).state, 'cancelled');
  assert.equal(readResult(p, id).ok, false);
});
test('a claimed request cannot be cancelled or reported as stopped', () => {
  const p = project(), id = writeRequest(p, 'invoke', { method: 'Fixture.Mutate' }); claim(p, id);
  const r = cancelQueued(p, id);
  assert.equal(r.cancelled, false); assert.equal(r.operation.state, 'running'); assert.equal(readResult(p, id), null);
});
test('a caller timeout cancels queued work but plain operation wait leaves it queued', async () => {
  const p = project(), first = writeRequest(p, 'invoke');
  const timeout = await awaitResult(p, first, { timeoutMs: 15, pollMs: 5, cancelOnTimeout: true });
  assert.equal(timeout.reason, 'timeout'); assert.equal(timeout.cancellation.cancelled, true);
  const second = writeRequest(p, 'invoke');
  await awaitResult(p, second, { timeoutMs: 15, pollMs: 5 });
  assert.equal(readOperation(p, second).state, 'queued');
});

test('a short wait deadline is not extended by a long poll interval', async () => {
  const p = project(), id = writeRequest(p, 'invoke');
  const result = await awaitResult(p, id, { timeoutMs: 20, pollMs: 2000 });
  assert.equal(result.reason, 'timeout');
  assert.ok(result.waitedMs < 1000, `20ms wait took ${result.waitedMs}ms`);
  assert.equal(readOperation(p, id).state, 'queued');
});
test('legacy protocol cancellation never claims certainty after moving a request', () => {
  const p = project(); const snap = JSON.parse(readFileSync(epochPath(p))); delete snap.protocol; writeFileSync(epochPath(p), JSON.stringify(snap));
  const id = writeRequest(p, 'invoke'); const r = cancelQueued(p, id);
  assert.equal(r.cancelled, false); assert.equal(r.removedFromQueue, true); assert.equal(readResult(p, id), null);
});
test('operation IDs cannot escape the request directories', () => {
  const p = project(); assert.throws(() => cancelQueued(p, '../../x'), /Invalid operation ID/); assert.throws(() => readOperation(p, 'x/y'), /Invalid operation ID/);
});
test('FIFO lease tickets do not jump an earlier waiting task', async () => {
  const p = project(), a = await acquireLease(p, { owner: 'A' });
  const b = await acquireLease(p, { owner: 'B' }), c = await acquireLease(p, { owner: 'C' });
  assert.equal(b.position, 1); assert.equal(c.position, 2);
  await releaseLease(p, a.lease.token);
  assert.equal((await acquireLease(p, { owner: 'C', ticket: c.ticket })).reason, 'queued');
  const admitted = await acquireLease(p, { owner: 'B', ticket: b.ticket }); assert.equal(admitted.ok, true);
  await releaseLease(p, admitted.lease.token);
  assert.equal((await acquireLease(p, { owner: 'C', ticket: c.ticket })).ok, true);
});
test('an expired owner cannot be displaced while its claimed operation still runs', async () => {
  const p = project(), a = await acquireLease(p, { owner: 'A' });
  const id = writeRequest(p, 'invoke', { leaseToken: a.lease.token }); claim(p, id);
  atomicJson(join(channelDir(p), 'lease.json'), { ...a.lease, expiresMs: Date.now() - 1 });
  assert.equal((await acquireLease(p, { owner: 'B' })).reason, 'queued');
  assert.equal((await releaseLease(p, a.lease.token)).reason, 'work-still-running');
});
test('active Play session protects an expired lease until restoration completes', async () => {
  const p = project(), a = await acquireLease(p, { owner: 'A' });
  atomicJson(join(channelDir(p), 'lease.json'), { ...a.lease, expiresMs: Date.now() - 1 });
  atomicJson(join(channelDir(p), 'play-session.json'), { id: 'play', state: 'stopping', editorSession: 'editor-A', leaseToken: a.lease.token });
  assert.equal((await acquireLease(p, { owner: 'B' })).reason, 'queued');
});

test('a profiler capture keeps its lease after start returns and through final restoration', async () => {
  const p = project(), a = await acquireLease(p, { owner: 'A' });
  const path = join(channelDir(p), 'profiler-capture.json');
  const capture = { id: 'capture', active: true, state: 'recording', editorSession: 'editor-A', leaseToken: a.lease.token };
  atomicJson(path, capture);
  atomicJson(join(channelDir(p), 'lease.json'), { ...a.lease, expiresMs: Date.now() - 1 });
  const waiting = await acquireLease(p, { owner: 'B' });
  assert.equal(waiting.reason, 'queued');
  assert.deepEqual(waiting.activeOperations, ['capture']);
  assert.equal((await releaseLease(p, a.lease.token)).reason, 'work-still-running');
  atomicJson(path, { ...capture, state: 'stopping' });
  assert.equal((await acquireLease(p, { owner: 'B', ticket: waiting.ticket })).reason, 'queued');
  assert.equal((await releaseLease(p, a.lease.token)).reason, 'work-still-running');
  atomicJson(path, { ...capture, state: 'complete', active: false });
  assert.equal((await releaseLease(p, a.lease.token)).ok, true);
  assert.equal((await acquireLease(p, { owner: 'B', ticket: waiting.ticket })).ok, true);
});

test('a stale capture snapshot from another Editor session does not hold a lease', async () => {
  const p = project(), a = await acquireLease(p, { owner: 'A' });
  atomicJson(join(channelDir(p), 'profiler-capture.json'), { id: 'old-capture', active: true, state: 'recording',
    editorSession: 'editor-before-restart', leaseToken: a.lease.token });
  assert.equal((await releaseLease(p, a.lease.token)).ok, true);
});
test('lease renewal, token checks and queue cancellation preserve the current owner', async () => {
  const p = project(), a = await acquireLease(p, { owner: 'A' }), b = await acquireLease(p, { owner: 'B' });
  await assert.rejects(releaseLease(p, 'wrong'), /token/);
  await cancelTicket(p, b.ticket); assert.equal(leaseStatus(p).queue.length, 0);
  const renewed = await renewLease(p, a.lease.token, 350000); assert.ok(renewed.lease.expiresMs > a.lease.expiresMs);
  await releaseLease(p, a.lease.token); assert.equal(leaseStatus(p).active, false);
});
test('bounded lease wait expires its ticket without changing the active owner', async () => {
  const p = project(), a = await acquireLease(p, { owner: 'A' });
  const b = await acquireLease(p, { owner: 'B', timeoutMs: 20, wait: true });
  assert.equal(b.reason, 'expired-or-editor-changed'); assert.equal(leaseStatus(p).lease.token, a.lease.token); assert.equal(leaseStatus(p).queue.length, 0);
});
