import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import { writeRequest, awaitResult, readOperation, listOperations, cancelQueued, terminalStates } from '@unity-agent-kit/core/src/actions.js';
import { acquireLease, leaseStatus, renewLease, releaseLease, cancelTicket } from '@unity-agent-kit/core/src/leases.js';
import { readEpoch, isFresh } from '@unity-agent-kit/core/src/kanabo.js';
import { readConsole, clearConsole, consolePath } from '@unity-agent-kit/core/src/console.js';
import { sourceFiles, sourceIdentity } from '@unity-agent-kit/core/src/bridge-cli.js';
import { KIT_VERSION } from '@unity-agent-kit/core/src/version.js';
import { parseProfilerArgs, profilerRequest, compareProfiler, validateProfilerContext } from '@unity-agent-kit/core/src/profiler.js';

const version = KIT_VERSION;
const text = z.string().trim().min(1).max(4096);
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const token = z.string().min(1).max(200);
const owner = z.string().trim().min(1).max(200);
const leaseFields = { leaseToken: token };
const waitFields = {
  waitMs: z.number().int().min(0).max(5000).default(1000).describe('Time to wait for this response. A pending operation keeps running.'),
};
const requestFields = {
  ...waitFields,
  timeoutMs: z.number().int().min(1).max(3600000).default(120000).describe('Editor dispatch deadline, separate from the MCP wait. It cannot interrupt running code.'),
  after: id.optional().describe('Require this successful source refresh receipt before execution.'),
  expectedEpoch: z.number().int().min(0).max(2147483647).default(0),
};
const readonlyProfiler = new Set(['status', 'targets', 'sessions', 'frames', 'threads', 'frame', 'sample']);

// Bind once at startup. Tool arguments cannot redirect a connected client to a
// second Editor or silently resolve a relative path against the MCP host's cwd.
export function projectFromArgs(args) {
  if (args.length !== 2 || args[0] !== '--project' || !isAbsolute(args[1]))
    throw new Error('Usage: unity-agent-kit-mcp --project <absolute Unity project path>');
  const root = realpathSync(args[1]);
  if (!statSync(join(root, 'Assets')).isDirectory() || !existsSync(join(root, 'ProjectSettings', 'ProjectVersion.txt'))
      || !existsSync(join(root, 'Packages', 'manifest.json')))
    throw new Error(`Not a Unity project: ${root}. Expected Assets, ProjectSettings/ProjectVersion.txt and Packages/manifest.json.`);
  return root;
}

// Read-only observations should not suggest that another task's lease token is
// reusable. This is coordination between trusted local clients, not a sandbox.
function publicValue(value) {
  if (Array.isArray(value)) return value.map(publicValue);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (['leaseToken', 'token', 'payloadJson', 'args'].includes(key)) continue;
    if (key === 'dataJson' && typeof item === 'string' && item.trim()) {
      try { result[key] = JSON.stringify(publicValue(JSON.parse(item))); }
      catch { result[key] = item; }
    } else result[key] = publicValue(item);
  }
  return result;
}

function outcome(operation) {
  const finished = terminalStates.has(operation.state);
  const result = { ok: finished ? operation.ok === true : operation.state !== 'unknown', id: operation.id,
    pending: !finished && operation.state !== 'unknown', operation: publicValue(operation) };
  if (typeof operation.dataJson === 'string' && operation.dataJson.trim()) {
    try { result.data = publicValue(JSON.parse(operation.dataJson)); }
    catch { result.dataError = 'Malformed Editor dataJson; inspect the preserved operation receipt.'; if (finished) result.ok = false; }
  }
  else {
    const returned = operation.log?.find(entry => entry.type === 'Return')?.message;
    if (returned) {
      try { result.data = publicValue(JSON.parse(returned)); } catch { result.returnValue = returned; }
    }
  }
  return result;
}

export function createServer(root) {
  const server = new McpServer({ name: 'unity-agent-kit', version }, { instructions:
    'This server controls one local Unity project. Inspect status, acquire a lease with your task ID, and keep that lease through refresh, Play, profiling and cleanup. A pending operation ID is not completion. Poll operation status or wait; disconnecting or timing out never stops Unity code. Release only after cleanup. Files must already be integrated into the bound Editor checkout.' });

  function register(name, description, shape, readOnlyHint, run) {
    server.registerTool(name, { description, inputSchema: z.strictObject(shape),
      annotations: { readOnlyHint, destructiveHint: !readOnlyHint, openWorldHint: !readOnlyHint } }, async args => {
      try {
        const value = await run(args);
        return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value,
          isError: value.ok === false && value.reason !== 'queued' };
      } catch (error) {
        const value = { ok: false, error: error.message };
        return { isError: true, content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value };
      }
    });
  }
  function localStatus() {
    const snapshot = readEpoch(root);
    return { projectPath: root, adapterVersion: version, responsive: isFresh(snapshot), snapshot,
      ownership: publicValue(leaseStatus(root)) };
  }
  function requireLease(leaseToken, cleanup = false) {
    const state = leaseStatus(root), snapshot = readEpoch(root);
    if (!leaseToken || state.lease?.token !== leaseToken || state.lease.sessionId !== snapshot?.sessionId)
      throw new Error('A matching leaseToken is required. Acquire the project lease with your task owner ID first.');
    if (!state.active && !(cleanup && state.activeOperations.length))
      throw new Error('Lease expired. Renew it before starting work.');
    return state;
  }
  async function waitFor(id, waitMs) {
    const waited = await awaitResult(root, id, { timeoutMs: waitMs, pollMs: 25, cancelOnTimeout: false });
    const result = outcome(readOperation(root, id));
    if (result.pending) result.reason = waited.reason;
    return result;
  }
  async function dispatch(verb, payload, args, mutation = false, cleanup = false) {
    if (mutation) requireLease(args.leaseToken, cleanup);
    const snapshot = readEpoch(root);
    if (!snapshot?.sessionId || !isFresh(snapshot) && !snapshot.blocked)
      throw new Error('No responsive Editor for the bound project. Open Unity with the bridge package installed, then inspect unity_status. No request was queued.');
    if ((snapshot.protocol ?? 0) < 2) throw new Error('Editor bridge protocol 2 is required. Update the Unity package and inspect unity_status.');
    const timeoutMs = args.timeoutMs ?? 120000;
    const operationId = writeRequest(root, verb, { ...payload, leaseToken: args.leaseToken ?? '',
      expectedSession: snapshot.sessionId, expectedEpoch: args.expectedEpoch ?? 0,
      requiredReceipt: args.after ?? '', deadlineMs: Date.now() + timeoutMs });
    const result = await waitFor(operationId, Math.min(args.waitMs ?? 1000, timeoutMs));
    if (result.pending) result.accepted = true;
    return result;
  }

  register('unity_status', 'Read bound project identity, bridge heartbeat, ownership, and live Editor status. Works without an Editor.', waitFields, true, async args => {
    const local = localStatus();
    if (!local.responsive && !local.snapshot?.blocked) return { ok: true, local, reason: 'no-responsive-editor', runtime: null };
    return { ...await dispatch('status', { payloadJson: '{}' }, args), local };
  });
  register('unity_capabilities', 'Discover loaded bridge versions and commands. A filter of at least three characters also lists matching static methods. Use offset and limit to page results; inspect scanTruncated for incomplete scans.', {
    ...waitFields, filter: z.string().trim().max(500).refine(value => value.length === 0 || value.length >= 3, 'Filter needs at least three characters').default(''),
    offset: z.number().int().min(0).max(2147483647).default(0), limit: z.number().int().min(1).max(200).default(100),
  }, true, args => dispatch('capabilities', { payloadJson: JSON.stringify({ filter: args.filter, offset: args.offset, limit: args.limit }) }, args));

  register('unity_lease_acquire', 'Acquire exclusive Editor ownership or receive a FIFO ticket. Retry with the same owner and ticket. This call does not wait in the queue.', {
    owner, ttlMs: z.number().int().min(1000).max(3600000).default(300000),
    timeoutMs: z.number().int().min(1).max(3600000).default(120000).describe('Lifetime of the FIFO ticket.'), ticket: id.optional(),
  }, false, args => acquireLease(root, { ...args, wait: false }));
  register('unity_lease_status', 'Inspect the owner, lease expiry, protected operations and FIFO queue. Tokens are omitted.', {}, true,
    () => ({ ok: true, ...publicValue(leaseStatus(root)) }));
  register('unity_lease_renew', 'Extend your existing lease through verification and cleanup.', {
    ...leaseFields, ttlMs: z.number().int().min(1000).max(3600000).default(300000),
  }, false, args => renewLease(root, args.leaseToken, args.ttlMs));
  register('unity_lease_release', 'Release your lease after all owned operations, Play and profiler restoration have finished. Refuses active work.', leaseFields, false,
    args => releaseLease(root, args.leaseToken));
  register('unity_lease_cancel', 'Remove your waiting FIFO ticket. This does not cancel a running operation or release an acquired lease.', {
    ticket: id, owner,
  }, false, async args => {
    const queued = leaseStatus(root).queue.find(entry => entry.id === args.ticket);
    if (!queued) return { ok: false, reason: 'not-queued' };
    if (queued.owner !== args.owner) throw new Error('FIFO ticket belongs to another owner.');
    return cancelTicket(root, args.ticket);
  });

  register('unity_refresh', 'Hash changed files, explicitly import/compile, and return a durable source receipt. Poll the operation until successful before using its id as after. An optional static-field probe proves the supplied loaded value.', {
    ...leaseFields, ...requestFields, files: z.array(text).min(1).max(200),
    probe: z.strictObject({ type: text, field: text, expected: z.string().max(65536) }).optional(),
  }, false, args => {
    requireLease(args.leaseToken);
    const payload = { files: sourceFiles(root, args.files) };
    if (args.probe) payload.probe = args.probe;
    return dispatch('refresh', { payloadJson: JSON.stringify(payload) }, args, true);
  });
  register('unity_invoke', 'Invoke an exact static method or Unity menu path. Supply exactly one of method/menu. A returned false is a successful invocation; use unity_check for assertions.', {
    ...leaseFields, ...requestFields, method: text.optional(), menu: text.optional(), args: z.array(z.string().max(65536)).max(100).default([]),
  }, false, args => {
    if (!!args.method === !!args.menu || args.menu && args.args.length) throw new Error('Supply exactly one of method/menu; menu invocations take no args.');
    return dispatch('invoke', args.menu ? { menu: args.menu } : { method: args.method, args: args.args }, args, true);
  });
  register('unity_check', 'Invoke an exact static check method. Boolean false or a structured ok:false fails the check. Use after to require a completed source refresh receipt.', {
    ...leaseFields, ...requestFields, method: text, args: z.array(z.string().max(65536)).max(100).default([]),
  }, false, args => dispatch('check', { method: args.method, args: args.args }, args, true));

  register('unity_operation_status', 'Read the durable state/result of an operation without enqueueing another Editor request.', { id }, true,
    args => outcome(readOperation(root, args.id)));
  register('unity_operation_wait', 'Wait up to 5 seconds for an existing operation. Returns pending if unfinished; it does not cancel or retry work.', {
    id, waitMs: z.number().int().min(0).max(5000).default(1000),
  }, true, args => waitFor(args.id, args.waitMs));
  register('unity_operation_list', 'List recent durable operation receipts from the bound project.', {
    limit: z.number().int().min(1).max(1000).default(20),
  }, true, args => ({ ok: true, operations: listOperations(root, args.limit).map(outcome) }));
  register('unity_operation_cancel', 'Cancel your queued operation by atomic claim. Running code cannot be interrupted; inspect the returned state before retrying.', {
    id, ...leaseFields,
  }, false, args => {
    requireLease(args.leaseToken, true);
    const operation = readOperation(root, args.id);
    if (!terminalStates.has(operation.state) && operation.leaseToken !== args.leaseToken)
      throw new Error('Operation is unknown or belongs to another lease.');
    return { ok: true, ...publicValue(cancelQueued(root, args.id)) };
  });

  register('unity_play_start', 'Start a bounded Play scenario with explicit project-owned static callbacks. Keep the lease until status confirms terminal cleanup. Start completion only acknowledges the session.', {
    ...leaseFields, ...requestFields, owner: owner.optional(), scene: text.optional(),
    setupMethod: text.optional(), stepMethod: text.optional(), checkMethod: text.optional(), teardownMethod: text.optional(),
    screenshotPath: text.optional(), durationSeconds: z.number().gt(0).max(600).default(10), warmupSeconds: z.number().min(0).max(60).default(0.5),
  }, false, args => {
    const { waitMs, timeoutMs, after, expectedEpoch, ...scenario } = args;
    return dispatch('session', { payloadJson: JSON.stringify({ ...scenario, action: 'start' }) }, args, true);
  });
  register('unity_play_status', 'Inspect the latest or specified Play session, including verification and cleanup. Does not require ownership.', {
    id: id.optional(), ...waitFields,
  }, true, args => dispatch('session', { payloadJson: JSON.stringify({ action: 'status', id: args.id }) }, args));
  for (const action of ['stop', 'cancel']) register(`unity_play_${action}`, `${action === 'stop' ? 'Stop' : 'Cancel'} your Play session and run teardown/restoration. Poll status until cleanup is terminal before releasing the lease.`, {
    id, ...leaseFields, ...requestFields,
  }, false, args => dispatch('session', { payloadJson: JSON.stringify({ action, id: args.id, leaseToken: args.leaseToken }) }, args, true, true));

  register('unity_console', 'Read the bridge console mirror even during reload or stalls. Filtering by epoch is inclusive.', {
    errors: z.boolean().default(false), sinceEpoch: z.number().int().min(-1).default(-1), last: z.number().int().min(1).max(1000).default(100),
  }, true, args => ({ ok: true, path: consolePath(root), entries: readConsole(root, args) }));
  register('unity_console_clear', 'Clear the bridge console mirror file for the lease owner. This does not clear the Unity Console window.', leaseFields, false, args => {
    requireLease(args.leaseToken); clearConsole(root); return { ok: true };
  });

  const index = z.number().int().min(0).max(2147483647).optional();
  register('unity_profiler', 'Query or control Unity Profiler using existing bridge actions. status/targets/sessions/frames/threads/frame/sample are read-only. All other actions, including analyze, require leaseToken. Keep capture ownership through stop/cancel and restoration. Options must belong to the chosen action.', {
    ...requestFields, leaseToken: token.optional(),
    action: z.enum(['status', 'targets', 'start', 'stop', 'cancel', 'save', 'load', 'unload', 'frames', 'threads', 'frame', 'sample', 'mark', 'sessions', 'analyze']),
    options: z.strictObject({ label: text.optional(), target: z.number().int().min(-1).max(2147483647).optional(),
      seconds: z.number().min(1).max(3600).optional(), maxMb: z.number().min(16).max(16384).optional(),
      checkpointFrames: z.number().int().min(30).max(1000).optional(), allocations: z.boolean().optional(), editor: z.boolean().optional(),
      contextJson: z.string().max(65536).optional().describe('JSON object containing scenario, seed, workload, warmup and tunables.'),
      path: text.optional(), session: text.optional(), frame: index, first: index, last: index, thread: index, sample: index,
      filter: z.string().max(500).optional(), offset: index, limit: z.number().int().min(1).max(1000).optional(),
      minMs: z.number().min(0).max(3600000).optional(), tick: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    }).default({}),
  }, false, async args => {
    const argv = [args.action];
    for (const [key, value] of Object.entries(args.options)) {
      const name = `--${key.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`)}`;
      if (typeof value === 'boolean') argv.push(name);
      else argv.push(name, String(value));
    }
    const request = profilerRequest(parseProfilerArgs(argv));
    for (const [key, value] of Object.entries(args.options)) if (value === false) request[key] = false;
    if (args.action === 'start') {
      const context = JSON.parse(request.contextJson ?? '{}');
      context.source = { ...context.source, ...sourceIdentity(root) };
      request.contextJson = validateProfilerContext(JSON.stringify(context));
    }
    request.deadlineMs = Date.now() + args.timeoutMs;
    const result = await dispatch('invoke', { method: 'UnityAgentKit.Doctor.KitProfiler.Execute', args: [JSON.stringify(request)] }, args,
      !readonlyProfiler.has(args.action), ['stop', 'cancel'].includes(args.action));
    if (result.data?.ok === false) result.ok = false;
    return result;
  });
  register('unity_profiler_compare', 'Compare two saved analyze JSON exports under the bound project. Reports context mismatches and unknown comparability; does not load captures into Unity.', {
    before: text, after: text, limit: z.number().int().min(1).max(1000).default(100),
  }, true, args => {
    const readExport = path => {
      const file = realpathSync(resolve(root, path)), rel = relative(root, file);
      if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Profiler comparison files must be inside the bound project.');
      if (statSync(file).size > 32 * 1024 * 1024) throw new Error('Profiler comparison export exceeds 32 MiB.');
      return readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    };
    return compareProfiler(readExport(args.before), readExport(args.after), args.limit);
  });
  return server;
}
