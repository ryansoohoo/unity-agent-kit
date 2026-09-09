import { mkdirSync, readdirSync, unlinkSync, openSync, closeSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { channelDir, readJson, atomicJson, validId } from './actions.js';
import { readEpoch, isFresh } from './kanabo.js';

const pause = ms => new Promise(r => setTimeout(r, ms));
const leasePath = root => join(channelDir(root), 'lease.json');
const queueDir = root => join(channelDir(root), 'lease-queue');
const activeStates = new Set(['queued', 'entering', 'warmup', 'running', 'stopping', 'restoring', 'capturing']);
function activeWork(root, token) {
  const snap = readEpoch(root), dir = join(channelDir(root), 'running');
  let names = []; try { names = readdirSync(dir); } catch { /* no operations */ }
  const operations = names.filter(n => n.endsWith('.json')).map(n => readJson(join(dir, n)))
    .filter(x => x && x.leaseToken === token && (!x.expectedSession || x.expectedSession === snap?.sessionId)).map(x => x.id);
  const play = readJson(join(channelDir(root), 'play-session.json'));
  if (play?.leaseToken === token && activeStates.has(play.state) && (!play.editorSession || play.editorSession === snap?.sessionId)) operations.push(play.id);
  const capture = readJson(join(channelDir(root), 'profiler-capture.json'));
  if (capture?.active === true && capture.leaseToken === token && capture.editorSession === snap?.sessionId) operations.push(capture.id);
  return operations;
}
async function locked(root, action) {
  mkdirSync(channelDir(root), { recursive: true });
  const file = join(channelDir(root), 'lease.lock'), deadline = Date.now() + 5000;
  for (;;) {
    let fd;
    try { fd = openSync(file, 'wx'); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const owner = readJson(file);
      if (owner?.pid && Date.now() - owner.createdMs > 5000) {
        let alive = true; try { process.kill(owner.pid, 0); } catch (err) { alive = err.code !== 'ESRCH'; }
        if (!alive) { try { if (readJson(file)?.id === owner.id) unlinkSync(file); } catch { /* next pass */ } }
      }
      if (Date.now() >= deadline) throw new Error('Lease metadata is locked by another process; retry status');
      await pause(25); continue;
    }
    try { writeFileSync(fd, JSON.stringify({ id: randomUUID(), pid: process.pid, createdMs: Date.now() })); return action(); }
    finally { closeSync(fd); unlinkSync(file); }
  }
}
function tickets(root, clean = false) {
  let names = []; try { names = readdirSync(queueDir(root)); } catch { return []; }
  const now = Date.now(), session = readEpoch(root)?.sessionId;
  return names.filter(n => /^[a-zA-Z0-9_-]+\.json$/.test(n)).flatMap(n => {
    const file = join(queueDir(root), n), t = readJson(file);
    if (!t || t.deadlineMs <= now || t.sessionId !== session) { if (clean) try { unlinkSync(file); } catch { /* already gone */ } return []; }
    return [t];
  }).sort((a, b) => a.requestedMs - b.requestedMs || a.id.localeCompare(b.id));
}
export function leaseStatus(root) {
  const lease = readJson(leasePath(root)), snap = readEpoch(root);
  return { lease, active: !!lease && lease.sessionId === snap?.sessionId && lease.expiresMs > Date.now(),
    expired: !!lease && lease.expiresMs <= Date.now(), activeOperations: lease ? activeWork(root, lease.token) : [], queue: tickets(root) };
}
function bounds(value, min, max, name) { if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be ${min}..${max}`); }
export async function acquireLease(root, { owner, ttlMs = 300000, timeoutMs = 120000, wait = false, ticket } = {}) {
  if (!owner || typeof owner !== 'string' || owner.length > 200) throw new Error('lease acquire needs an owner, usually the task ID');
  bounds(ttlMs, 1000, 3600000, 'ttlMs'); bounds(timeoutMs, 1, 3600000, 'timeoutMs');
  const snap = readEpoch(root);
  if (!snap?.sessionId || !isFresh(snap)) return { ok: false, reason: 'no-responsive-editor', snap };
  let entry;
  await locked(root, () => {
    mkdirSync(queueDir(root), { recursive: true });
    if (ticket) {
      entry = readJson(join(queueDir(root), `${validId(ticket)}.json`));
      if (!entry || entry.owner !== owner || entry.sessionId !== snap.sessionId) throw new Error('Ticket absent, expired, or belongs to another owner/session');
    } else {
      entry = { id: randomUUID(), owner, ttlMs, requestedMs: Date.now(), deadlineMs: Date.now() + timeoutMs, sessionId: snap.sessionId };
      atomicJson(join(queueDir(root), `${entry.id}.json`), entry);
    }
  });
  for (;;) {
    const result = await locked(root, () => {
      const queue = tickets(root, true), current = leaseStatus(root);
      if (!queue.some(t => t.id === entry.id)) return { ok: false, reason: 'expired-or-editor-changed', ticket: entry.id };
      if (queue[0].id === entry.id && !current.active && current.activeOperations.length === 0) {
        const lease = { token: randomUUID(), owner, projectPath: resolve(root), sessionId: snap.sessionId,
          acquiredMs: Date.now(), expiresMs: Date.now() + entry.ttlMs };
        atomicJson(leasePath(root), lease); unlinkSync(join(queueDir(root), `${entry.id}.json`));
        return { ok: true, reason: 'acquired', lease };
      }
      return { ok: false, reason: 'queued', ticket: entry.id, position: queue.findIndex(t => t.id === entry.id) + 1,
        owner: current.lease?.owner, expiresMs: current.lease?.expiresMs, activeOperations: current.activeOperations };
    });
    if (result.ok || result.reason !== 'queued' || !wait) return result;
    await pause(250);
  }
}
export async function renewLease(root, token, ttlMs = 300000) {
  bounds(ttlMs, 1000, 3600000, 'ttlMs');
  return locked(root, () => {
    const status = leaseStatus(root);
    if (!status.lease || status.lease.token !== token || status.lease.sessionId !== readEpoch(root)?.sessionId) throw new Error('Lease token/editor does not match');
    const lease = { ...status.lease, expiresMs: Date.now() + ttlMs };
    atomicJson(leasePath(root), lease); return { ok: true, lease };
  });
}
export async function releaseLease(root, token) {
  return locked(root, () => {
    const status = leaseStatus(root);
    if (!status.lease || status.lease.token !== token) throw new Error('Lease token does not match');
    if (status.activeOperations.length) return { ok: false, reason: 'work-still-running', activeOperations: status.activeOperations };
    unlinkSync(leasePath(root)); return { ok: true, reason: 'released' };
  });
}
export async function cancelTicket(root, id) {
  return locked(root, () => { try { unlinkSync(join(queueDir(root), `${validId(id)}.json`)); return { ok: true, reason: 'cancelled' }; }
    catch (e) { if (e.code !== 'ENOENT') throw e; return { ok: false, reason: 'not-queued' }; } });
}
