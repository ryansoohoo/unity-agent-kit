import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { epochPath, blockedPath } from '../src/kanabo.js';
import { reqDir, resDir, newId, writeRequest, readResult, awaitResult } from '../src/actions.js';
import { tmp } from './tmp.js';

const proj = () => tmp('uak-act-');
function fresh(root, extra = {}) {
  mkdirSync(join(root, 'Temp', 'unity-agent-kit'), { recursive: true });
  writeFileSync(epochPath(root), JSON.stringify({ schema: 1, pid: 1, sessionId: 'x', epoch: 4, heartbeatMs: Date.now(), state: 'ready', worldRevision: 0, ...extra }));
}
function answer(root, id, body) {
  mkdirSync(resDir(root), { recursive: true });
  writeFileSync(join(resDir(root), `${id}.json`), JSON.stringify({ id, ...body }));
}

test('newId is unique and sortable-ish', () => {
  const a = newId(), b = newId();
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-z]+-[0-9a-z]{6}$/);
});

test('writeRequest lands req/<id>.json with verb+args and no .tmp left behind', () => {
  const p = proj();
  const id = writeRequest(p, 'invoke', { menu: 'Tools/Foo' });
  const files = readdirSync(reqDir(p));
  assert.deepEqual(files, [`${id}.json`]);
  const j = JSON.parse(readFileSync(join(reqDir(p), `${id}.json`), 'utf8'));
  assert.equal(j.verb, 'invoke'); assert.equal(j.menu, 'Tools/Foo'); assert.equal(j.id, id);
  assert.equal(typeof j.requestedMs, 'number');
});

test('readResult: null when missing or torn, object when valid', () => {
  const p = proj();
  assert.equal(readResult(p, 'nope'), null);
  mkdirSync(resDir(p), { recursive: true });
  writeFileSync(join(resDir(p), 'a.json'), '{torn');
  assert.equal(readResult(p, 'a'), null);
  answer(p, 'b', { ok: true, log: [] });
  assert.equal(readResult(p, 'b').ok, true);
});

test('awaitResult: done when the editor answers', async () => {
  const p = proj(); fresh(p);
  const id = writeRequest(p, 'invoke', { menu: 'X' });
  setTimeout(() => answer(p, id, { ok: true, log: [{ type: 'Log', message: 'hi' }] }), 120);
  const r = await awaitResult(p, id, { timeoutMs: 3000, pollMs: 20 });
  assert.equal(r.reason, 'done'); assert.equal(r.ok, true); assert.equal(r.result.log[0].message, 'hi');
});

test('awaitResult: done but ok=false when the editor reports an error', async () => {
  const p = proj(); fresh(p);
  const id = writeRequest(p, 'invoke', { menu: 'X' });
  answer(p, id, { ok: false, error: 'no such menu item' });
  const r = await awaitResult(p, id, { timeoutMs: 500, pollMs: 20 });
  assert.equal(r.reason, 'done'); assert.equal(r.ok, false); assert.equal(r.result.error, 'no such menu item');
});

test('awaitResult: no-editor when the heartbeat is never fresh; timeout when fresh but silent', async () => {
  const p = proj();
  const id = writeRequest(p, 'invoke', {});
  let r = await awaitResult(p, id, { timeoutMs: 100, pollMs: 20 });
  assert.equal(r.reason, 'no-editor'); assert.equal(r.ok, false);
  fresh(p);
  r = await awaitResult(p, id, { timeoutMs: 100, pollMs: 20 });
  assert.equal(r.reason, 'timeout'); assert.ok(r.waitedMs >= 100);
});

// The real modal path: the main thread stalled, so epoch.json's heartbeat is
// stale by construction and only blocked.json is fresh. 'blocked' must win.
test('awaitResult: blocked when the main thread is stalled and blocked.json is fresh', async () => {
  const p = proj(); fresh(p, { heartbeatMs: Date.now() - 6000 });
  writeFileSync(blockedPath(p), JSON.stringify({ kind: 'modal', title: 'API Update Required', sinceMs: Date.now() - 5000, threadHeartbeatMs: Date.now(), mainStalledMs: 5000 }));
  const id = writeRequest(p, 'invoke', {});
  const r = await awaitResult(p, id, { timeoutMs: 100, pollMs: 20 });
  assert.equal(r.reason, 'blocked'); assert.equal(r.snap.blocked.title, 'API Update Required');
});

// A long synchronous import is not a modal: nobody has to dismiss it, and the
// result lands when it finishes. Keep waiting, but keep showing it.
test('awaitResult: a non-modal stall is waited out, not treated as blocked', async () => {
  const p = proj(); fresh(p, { heartbeatMs: Date.now() - 6000 });
  writeFileSync(blockedPath(p), JSON.stringify({ kind: 'main-thread-stalled', title: '', sinceMs: Date.now() - 5000, threadHeartbeatMs: Date.now(), mainStalledMs: 5000 }));
  const id = writeRequest(p, 'invoke', {});
  const r = await awaitResult(p, id, { timeoutMs: 200, pollMs: 20 });
  assert.equal(r.reason, 'timeout');
  assert.equal(r.snap.blocked.kind, 'main-thread-stalled');
});
