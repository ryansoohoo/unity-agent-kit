import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

// Kanabō (v2, minimal): the reload-boundary contract. The editor-side
// component (upm/Editor/KanaboEpoch.cs) writes epoch.json on a 0.5 s
// heartbeat; this module is the read side. The signal lives in a FILE
// because the domain-reload window — the exact moment agents blind-sleep
// through — is when every socket and HTTP port is dead. Files aren't.
export const epochPath = (root) => join(root, 'Temp', 'unity-agent-kit', 'epoch.json');
export const requestPath = (root) => join(root, 'Temp', 'unity-agent-kit', 'refresh.request');
export const blockedPath = (root) => join(root, 'Temp', 'unity-agent-kit', 'blocked.json');

const HEARTBEAT_FRESH_MS = 3000; // 6x the writer's 500 ms cadence

// blocked.json is written by a BACKGROUND thread in the editor (KitBlocked.cs)
// precisely because the main thread — the one that writes epoch.json — is the
// thing that stalled (modal dialog, synchronous import). Fresh = its own
// heartbeat is recent; the main-thread heartbeat is stale by construction.
//
// The editor reports EVERY stall here; only kind 'modal' is a reason to stop
// waiting (see isWaitAborting). A long synchronous import stalls the main
// thread for well over StallMs and is a perfectly normal thing to wait out.
function readBlocked(root, now = Date.now()) {
  try {
    const b = JSON.parse(readFileSync(blockedPath(root), 'utf8'));
    if (!b || typeof b !== 'object' || typeof b.threadHeartbeatMs !== 'number') return null;
    return now - b.threadHeartbeatMs < HEARTBEAT_FRESH_MS ? b : null;
  } catch { return null; }
}

export function readEpoch(root) {
  try {
    const s = JSON.parse(readFileSync(epochPath(root), 'utf8'));
    if (!s || typeof s !== 'object' || typeof s.epoch !== 'number') return null;
    s.blocked = readBlocked(root);
    return s;
  } catch { return null; } // missing or torn mid-write: the poller just retries
}

export function isFresh(snap, now = Date.now()) {
  return !!snap && typeof snap.heartbeatMs === 'number' && now - snap.heartbeatMs < HEARTBEAT_FRESH_MS;
}

// Which stalls end a wait. ONLY a modal: it needs a human, so waiting is
// futile and the honest move is to name it and stop. Every other stall —
// a long synchronous AssetDatabase.Refresh is the common one — resolves on
// its own, so the poller rides it out. snap.blocked stays populated either
// way, so `--epoch` still shows what the editor is doing.
export function isWaitAborting(snap) {
  return snap?.blocked?.kind === 'modal';
}

// The explicit import trigger that works with the editor unfocused or
// headless (a measured v1 hazard: unfocused editors never auto-import).
export function requestRefresh(root) {
  mkdirSync(dirname(requestPath(root)), { recursive: true });
  writeFileSync(requestPath(root), String(Date.now()));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The anti-blind-sleep primitive: a BOUNDED poll with an explicit outcome.
// Never throws; never waits past timeoutMs (+ at most one poll interval);
// reason says WHY it stopped: 'ready' | 'timeout' | 'no-editor' | 'blocked'.
// 'blocked' means a MODAL only — a plain main-thread stall is waited out.
export async function waitReady(root, { sinceEpoch = -1, requireEpochBump = false, timeoutMs = 120000, pollMs = 250 } = {}) {
  const started = Date.now();
  let sawEditor = false;
  for (;;) {
    const snap = readEpoch(root);
    if (isWaitAborting(snap)) {
      return { ok: false, reason: 'blocked', epoch: snap.epoch, worldRevision: snap.worldRevision ?? 0, waitedMs: Date.now() - started, snap };
    }
    // A fresh blocked.json proves the editor is alive — its own background
    // thread just wrote it — even though the main-thread heartbeat is stale.
    // Without this a waited-out stall would end up labelled 'no-editor'.
    if (snap?.blocked) sawEditor = true;
    if (snap && isFresh(snap)) {
      sawEditor = true;
      const bumped = snap.epoch > sinceEpoch;
      if (snap.state === 'ready' && (!requireEpochBump || bumped)) {
        return { ok: true, reason: 'ready', epoch: snap.epoch, worldRevision: snap.worldRevision ?? 0, waitedMs: Date.now() - started, snap };
      }
    }
    if (Date.now() - started >= timeoutMs) {
      return { ok: false, reason: sawEditor ? 'timeout' : 'no-editor', epoch: snap?.epoch ?? -1, worldRevision: snap?.worldRevision ?? 0, waitedMs: Date.now() - started, snap: snap ?? null };
    }
    await sleep(pollMs);
  }
}
