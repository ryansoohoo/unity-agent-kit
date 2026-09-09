import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProfilerArgs, profilerRequest, executeProfiler, compareProfiler, validateProfilerContext } from '../src/profiler.js';

test('profiler parses spaced paths, target -1, and removes output-only fields', () => {
  const p = parseProfilerArgs(['start', 'C:\\A Folder', '--label', 'first raid', '--target', '-1', '--seconds', '2.5', '--out', 'run.json']);
  assert.equal(p.root, 'C:\\A Folder');
  assert.deepEqual(profilerRequest(p), { action: 'start', label: 'first raid', target: -1, seconds: 2.5 });
  assert.equal(parseProfilerArgs(['load', '--session', 'abc', '--frame', '12']).session, 'abc');
});

test('profiler rejects typo, wrong-action, missing, duplicated and invalid numeric options before dispatch', () => {
  for (const args of [[], ['bogus'], ['status', '--seconds', '1'], ['start', '--typo'], ['start', '--seconds'],
    ['start', '--seconds', 'NaN'], ['start', '--seconds', 'Infinity'], ['start', '--seconds', '0'],
    ['frames', '--frame', '1'], ['frame', '--thread', '-1'], ['frame', '--frame', '9007199254740992'],
    ['frames', '--first', '20', '--last', '10'], ['status', '--timeout-ms', '0'],
    ['start', '--label', 'one', '--label', 'two'], ['load'], ['load', '--path', 'x', '--session', 'y'],
    ['sample'], ['mark'], ['compare', '--before', 'x']]) assert.throws(() => parseProfilerArgs(args), args.join(' '));
});

function transport(response) {
  return { writeRequest: () => 'request1', awaitResult: async () => ({ ok: true, reason: 'done', result: { ok: true, log: [{ type: 'Return', message: JSON.stringify(response) }] } }) };
}

test('profiler transport parses actual KitActions Return shape and adds an execution deadline', async () => {
  let sent;
  const tools = transport({ ok: true, queryMs: 1, data: { recording: false } });
  tools.writeRequest = (root, verb, body) => { sent = { root, verb, body }; return 'a'; };
  const result = await executeProfiler('project', { action: 'status' }, tools);
  assert.equal(result.data.recording, false);
  assert.equal(sent.verb, 'invoke');
  assert.equal(sent.body.method, 'UnityAgentKit.Doctor.KitProfiler.Execute');
  assert.ok(JSON.parse(sent.body.args[0]).deadlineMs >= Date.now());
});

test('profiler transport does not turn failed or malformed service responses into success', async () => {
  assert.equal((await executeProfiler('p', {}, transport({ ok: false, error: 'expired' }))).ok, false);
  for (const log of [[], [{ type: 'Return', message: 'not json' }], [{ type: 'Return', message: '{}' }]]) {
    const result = await executeProfiler('p', {}, { writeRequest: () => 'a', awaitResult: async () => ({ ok: true, reason: 'done', result: { log } }) });
    assert.equal(result.ok, false);
  }
});

test('timeout delegates cancellation to the common protocol and preserves uncertain outcomes', async () => {
  for (const cancelled of [true, false]) {
    const result = await executeProfiler('project', {}, { writeRequest: () => 'mine', awaitResult: async (root, id, options) => {
      assert.equal(options.cancelOnTimeout, true);
      return { ok: false, reason: 'timeout', cancellation: { cancelled, removedFromQueue: true }, operation: { id, state: cancelled ? 'cancelled' : 'unknown' } };
    } });
    assert.equal(result.cancelledBeforeStart, cancelled);
    assert.equal(result.operation.id, 'mine');
    if (!cancelled) assert.match(result.error, /uncertain/);
  }
});

test('profiler forwards the same deadline and ownership to its outer operation', async () => {
  const io = transport({ ok: true, data: {} });
  io.writeRequest = (root, verb, body) => {
    assert.equal(body.leaseToken, 'lease-1');
    assert.equal(body.expectedSession, 'editor-1');
    assert.equal(body.deadlineMs, JSON.parse(body.args[0]).deadlineMs);
    return 'operation-1';
  };
  await executeProfiler('project', { action: 'stop' }, { ...io, leaseToken: 'lease-1', expectedSession: 'editor-1' });
});

const stats = { mean: 10, median: 9, p95: 12, p99: 14, max: 20 };
const marker = (path, selfMs, calls = 10) => ({ path, thread: 'Main', threadGroup: '', selfMs, totalMs: selfMs * 2, calls, gcBytes: 100 });
const capture = (frameCount, markers, extra = {}) => ({ frameCount, markers, frameStats: stats, markersTruncated: false, ...extra });

test('comparison normalizes duration and call counts across captures of different lengths', () => {
  const b = capture(10, [marker('Parent/Child', 20, 10)]);
  const a = capture(20, [marker('Parent/Child', 40, 20)]);
  const result = compareProfiler({ ok: true, data: b }, { ok: true, data: a });
  assert.equal(result.changes[0].selfMsPerFrame.delta, 0);
  assert.equal(result.changes[0].callsPerFrame.delta, 0);
});

test('comparison preserves caller and thread identities; missing partial pages are not zero', () => {
  const b = capture(10, [marker('A/Child', 10), marker('B/Child', 50)]);
  const a = capture(10, [{ ...marker('A/Child', 30), thread: 'Worker' }], { markersTruncated: true });
  const result = compareProfiler(b, a);
  assert.equal(result.changes.length, 3);
  assert.equal(result.markerCoverageComplete, false);
  assert.ok(result.changes.every(x => x.presence === 'missing-from-page' && x.selfMsPerFrame === undefined));
});

test('comparison rejects invalid exports and identifies measured added/removed markers', () => {
  assert.throws(() => compareProfiler({}, {}), /analyze exports/);
  assert.throws(() => compareProfiler({ ok: false, data: {} }, {}), /failed/);
  const result = compareProfiler(capture(10, [marker('Old', 10)]), capture(10, [marker('New', 20)]));
  assert.equal(result.changes[0].presence, 'added');
  assert.equal(result.changes[0].selfMsPerFrame.percent, null);
});

const context = (scenario = {}, extra = {}) => ({ schema: 2, sourceContextKnown: true, stable: true,
  suppliedJson: JSON.stringify({ workload: 'constant-fire', actorCount: 16, warmup: { seconds: 5 }, seed: 41, ...scenario }),
  environment: { scope: 'profiled-editor', scenePath: 'Assets/Test.unity', width: 1920, height: 1080,
    editorFocused: false, runInBackground: true, backgroundPumpMode: 'unfocused-10Hz' },
  profiler: { target: -1, editor: false, deepProfiling: false, allocationMode: 0, checkpointFrames: 300 }, ...extra });
const contextualCapture = (scenario = {}, extra = {}) => capture(10, [marker('Update', 20)], { captureContext: context(scenario, extra) });

test('capture context and tick bookmarks preserve arbitrary JSON before dispatch', () => {
  const json = '{"event":"shot","actors":[1,2],"source":{"revision":"abc"}}';
  const parsed = parseProfilerArgs(['mark', '--label', 'shot', '--tick', '4294967296', '--context-json', json]);
  assert.deepEqual(profilerRequest(parsed), { action: 'mark', label: 'shot', tick: 4294967296, contextJson: json });
  assert.equal(parseProfilerArgs(['start', '--context', 'scenario file.json']).context, 'scenario file.json');
  for (const bad of ['[]', 'null', '42', '{broken', JSON.stringify({ large: 'x'.repeat(65536) })])
    assert.throws(() => validateProfilerContext(bad));
  assert.throws(() => parseProfilerArgs(['start', '--context', 'file', '--context-json', '{}']), /only one/);
  assert.throws(() => parseProfilerArgs(['mark', '--label', 'shot', '--tick', '-1']), /integer/);
});

test('comparison rejects mismatched resolution and workload while preserving measured deltas and context', () => {
  const before = contextualCapture();
  const after = contextualCapture({ actorCount: 32 }, { environment: { ...before.captureContext.environment, width: 1280 } });
  const result = compareProfiler(before, after);
  assert.equal(result.comparable, false);
  assert.deepEqual(result.mismatches.map(x => x.field).sort(), ['environment.width', 'scenario.actorCount']);
  assert.equal(result.changes[0].selfMsPerFrame.delta, 0);
  assert.deepEqual(result.afterContext, after.captureContext);
});

test('source revisions and worktrees are reported as A/B changes without invalidating a matched scenario', () => {
  const before = contextualCapture({ source: { revision: 'abc', worktree: 'baseline', filesHash: '1' } });
  const after = contextualCapture({ source: { worktree: 'candidate', filesHash: '2', revision: 'def' } });
  const result = compareProfiler(before, after);
  assert.equal(result.comparable, true);
  assert.equal(result.mismatches.length, 0);
  assert.deepEqual(result.sourceChanges.map(x => x.field), ['source.filesHash', 'source.revision', 'source.worktree']);
});

test('foreground and background execution settings cannot silently compare as a matched run', () => {
  const before = contextualCapture();
  const after = contextualCapture({}, { environment: { ...before.captureContext.environment,
    editorFocused: true, runInBackground: false, backgroundPumpMode: 'none' } });
  const result = compareProfiler(before, after);
  assert.equal(result.comparable, false);
  assert.deepEqual(result.mismatches.map(x => x.field),
    ['environment.backgroundPumpMode', 'environment.editorFocused', 'environment.runInBackground']);
  assert.equal(result.frameStats.mean.delta, 0);
});

test('old exports, missing scenario and remote host metadata have unknown comparability', () => {
  const old = capture(10, [marker('Update', 20)]);
  assert.equal(compareProfiler(old, old).comparable, null);
  const preFocus = contextualCapture({}, { schema: 1 });
  assert.equal(compareProfiler(preFocus, preFocus).comparable, null);
  const missingFocus = contextualCapture();
  delete missingFocus.captureContext.environment.editorFocused;
  assert.equal(compareProfiler(missingFocus, missingFocus).comparable, null);
  const missing = contextualCapture({}, { suppliedJson: '{"source":{"revision":"abc"}}' });
  assert.equal(compareProfiler(missing, missing).comparability, 'unknown');
  const remote = contextualCapture({}, { environment: { scope: 'host-editor', width: 1920, height: 1080 } });
  assert.equal(compareProfiler(remote, remote).comparable, null);
});

test('a changed capture environment, profiler mode, or missing frames invalidates comparison', () => {
  const before = contextualCapture();
  const changed = contextualCapture({}, { stable: false, profiler: { ...before.captureContext.profiler, allocationMode: 1 } });
  changed.archiveGaps = [{ first: 10, last: 11 }];
  const result = compareProfiler(before, changed);
  assert.equal(result.comparable, false);
  assert.ok(result.mismatches.some(x => x.field === 'captureContext.stable'));
  assert.ok(result.mismatches.some(x => x.field === 'profiler.allocationMode'));
  assert.ok(result.mismatches.some(x => x.field === 'after.archiveGaps'));
});
