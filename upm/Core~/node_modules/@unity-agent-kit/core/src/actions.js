import { mkdirSync, writeFileSync, renameSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readEpoch, isFresh, isWaitAborting } from './kanabo.js';

export const channelDir = root => join(root, 'Temp', 'unity-agent-kit');
export const reqDir = root => join(channelDir(root), 'req');
export const resDir = root => join(channelDir(root), 'res');
export const operationDir = root => join(channelDir(root), 'ops');
export const runningDir = root => join(channelDir(root), 'running');
export const terminalStates = new Set(['completed', 'failed', 'cancelled', 'interrupted', 'expired', 'rejected']);
export function newId() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}`; }
export function validId(id) { if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('Invalid operation ID'); return id; }
export function readJson(file) { try { return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } }
export function atomicJson(file, value) {
  const temp = `${file}.${process.pid}.${newId()}.tmp`;
  writeFileSync(temp, JSON.stringify(value));
  renameSync(temp, file);
}

// A request and its receipt share an ID. The Editor claims requests by rename,
// allowing cancellation to compete for ownership without read/delete races.
export function writeRequest(root, verb, args = {}) {
  const id = newId(), requestedMs = Date.now(), snap = readEpoch(root);
  const request = { ...args, id, verb, requestedMs, deadlineMs: args.deadlineMs ?? requestedMs + 120000,
    expectedSession: args.expectedSession ?? snap?.sessionId ?? '', protocol: 2 };
  if (!Number.isFinite(request.deadlineMs) || request.deadlineMs <= requestedMs) throw new Error('Request deadline must be in the future');
  mkdirSync(reqDir(root), { recursive: true });
  mkdirSync(operationDir(root), { recursive: true });
  atomicJson(join(operationDir(root), `${id}.json`), { ...request, state: 'queued', ok: false });
  atomicJson(join(reqDir(root), `${id}.json`), request);
  return id;
}
export function readResult(root, id) { return readJson(join(resDir(root), `${validId(id)}.json`)); }
export function readOperation(root, id) {
  validId(id);
  const result = readResult(root, id);
  if (result) return { ...result, state: result.state ?? (result.ok ? 'completed' : 'failed') };
  const receipt = readJson(join(operationDir(root), `${id}.json`));
  const request = readJson(join(reqDir(root), `${id}.json`));
  const running = readJson(join(runningDir(root), `${id}.json`));
  if (running) return { ...running, ...receipt, id, state: 'running' };
  if (request) return { ...request, ...receipt, id, state: 'queued' };
  return receipt ?? { id, state: 'unknown', ok: false };
}
export function listOperations(root, limit = 20) {
  let names; try { names = readdirSync(operationDir(root)); } catch { return []; }
  return names.filter(n => /^[a-zA-Z0-9_-]+\.json$/.test(n)).sort().reverse().slice(0, limit).map(n => readOperation(root, n.slice(0, -5)));
}
export function cancelQueued(root, id) {
  const operation = readOperation(root, id);
  if (terminalStates.has(operation.state)) return { cancelled: operation.state === 'cancelled', operation };
  const dest = join(channelDir(root), 'cancelled');
  mkdirSync(dest, { recursive: true });
  try { renameSync(join(reqDir(root), `${validId(id)}.json`), join(dest, `${id}.json`)); }
  catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return { cancelled: false, operation: readOperation(root, id), reason: 'Already claimed or unknown; inspect status. Running code was not interrupted.' };
  }
  // Old Editors read then delete; moving their request cannot prove they did not
  // already read it. Only protocol 2's rename-before-read grants cancellation.
  if ((readEpoch(root)?.protocol ?? 0) < 2) return { cancelled: false, removedFromQueue: true, operation,
    reason: 'Legacy Editor protocol: execution outcome is uncertain. Inspect status before retrying.' };
  const result = { id, ok: false, state: 'cancelled', code: 'cancelled_before_start', error: 'Cancelled before execution',
    completedMs: Date.now(), startedEpoch: 0, finishedEpoch: 0, log: [] };
  mkdirSync(resDir(root), { recursive: true });
  atomicJson(join(operationDir(root), `${id}.json`), result);
  atomicJson(join(resDir(root), `${id}.json`), result);
  return { cancelled: true, operation: result };
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// A wait deadline bounds the caller, not running Unity code. Mutating CLI calls
// cancel unclaimed work on timeout; operation wait leaves the existing job alone.
export async function awaitResult(root, id, { timeoutMs = 120000, pollMs = 250, cancelOnTimeout = false } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || !Number.isFinite(pollMs) || pollMs < 1) throw new Error('Invalid wait bounds');
  const started = Date.now(); let sawEditor = false;
  for (;;) {
    const result = readResult(root, id), snap = readEpoch(root);
    if (result) return { id, ok: result.ok === true, reason: 'done', result, snap, waitedMs: Date.now() - started };
    if (snap?.blocked || snap && isFresh(snap)) sawEditor = true;
    const reason = isWaitAborting(snap) ? 'blocked' : Date.now() - started >= timeoutMs ? sawEditor ? 'timeout' : 'no-editor' : null;
    if (reason) {
      const cancellation = cancelOnTimeout ? cancelQueued(root, id) : undefined;
      return { id, ok: false, reason, result: null, operation: readOperation(root, id), cancellation,
        snap: snap ?? null, waitedMs: Date.now() - started };
    }
    await sleep(Math.min(pollMs, Math.max(1, timeoutMs - (Date.now() - started))));
  }
}
