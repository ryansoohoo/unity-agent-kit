import { mkdirSync, writeFileSync, renameSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readEpoch, isFresh } from './kanabo.js';

// Editor-actions request channel (v3). The CLI drops req/<id>.json; the
// editor's KanaboEpoch tick picks it up, deletes it, does the work, and
// writes res/<id>.json once. Files, not sockets: the same reason as the
// epoch signal — this has to work across the domain-reload window.
export const channelDir = (root) => join(root, 'Temp', 'unity-agent-kit');
export const reqDir = (root) => join(channelDir(root), 'req');
export const resDir = (root) => join(channelDir(root), 'res');

export function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}`;
}

// Atomic: the editor must never read a half-written request.
export function writeRequest(root, verb, args = {}) {
  const id = newId();
  mkdirSync(reqDir(root), { recursive: true });
  const final = join(reqDir(root), `${id}.json`);
  writeFileSync(`${final}.tmp`, JSON.stringify({ id, verb, ...args, requestedMs: Date.now() }));
  renameSync(`${final}.tmp`, final);
  return id;
}

export function readResult(root, id) {
  try {
    const r = JSON.parse(readFileSync(join(resDir(root), `${id}.json`), 'utf8'));
    return r && typeof r === 'object' ? r : null;
  } catch { return null; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Bounded wait with a reason: 'done' | 'timeout' | 'no-editor' | 'blocked'.
// ok is true only for done + result.ok. Never throws.
export async function awaitResult(root, id, { timeoutMs = 120000, pollMs = 250 } = {}) {
  const started = Date.now();
  let sawEditor = false;
  for (;;) {
    const result = readResult(root, id);
    const snap = readEpoch(root);
    if (result) return { ok: result.ok === true, reason: 'done', result, snap, waitedMs: Date.now() - started };
    // Ahead of the freshness gate on purpose: blocked.json only exists when the
    // MAIN thread stalled, so the epoch heartbeat is stale by construction. Gating
    // this on isFresh would report 'no-editor' for the case it is meant to name.
    if (snap && snap.blocked) return { ok: false, reason: 'blocked', result: null, snap, waitedMs: Date.now() - started };
    if (snap && isFresh(snap)) sawEditor = true;
    if (Date.now() - started >= timeoutMs) {
      return { ok: false, reason: sawEditor ? 'timeout' : 'no-editor', result: null, snap: snap ?? null, waitedMs: Date.now() - started };
    }
    await sleep(pollMs);
  }
}
