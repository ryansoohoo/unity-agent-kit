const COMMON = ['json', 'out', 'timeout-ms', 'lease'];
const OPTIONS = {
  status: [], targets: [], start: ['label', 'target', 'seconds', 'max-mb', 'checkpoint-frames', 'allocations', 'editor', 'context', 'context-json'],
  stop: [], cancel: [], save: ['label'], load: ['path', 'session', 'frame'], unload: [],
  frames: ['session', 'first', 'last', 'min-ms', 'offset', 'limit'],
  threads: ['frame'], frame: ['frame', 'thread', 'filter', 'offset', 'limit'],
  sample: ['frame', 'thread', 'sample'], mark: ['label', 'tick', 'context', 'context-json'], sessions: ['offset', 'limit'],
  analyze: ['session', 'first', 'last', 'thread', 'filter', 'min-ms', 'offset', 'limit'],
  compare: ['before', 'after', 'limit'],
};
const NUMBERS = {
  target: [-1, 2147483647, true], seconds: [1, 3600], 'max-mb': [16, 16384],
  'checkpoint-frames': [30, 1000, true], first: [0, 2147483647, true], last: [0, 2147483647, true],
  frame: [0, 2147483647, true], thread: [0, 2147483647, true], sample: [0, 2147483647, true],
  offset: [0, 2147483647, true], limit: [1, 1000, true], 'min-ms': [0, 3600000], 'timeout-ms': [1, 120000, true],
  tick: [0, Number.MAX_SAFE_INTEGER, true],
};
const camel = name => name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

// Parse before touching the request channel. Options belong to specific actions
// so a recording option accidentally attached to a query cannot be ignored.
export function parseProfilerArgs(argv) {
  const action = argv[0];
  if (!Object.hasOwn(OPTIONS, action)) throw new Error(`profiler action must be one of: ${Object.keys(OPTIONS).join(', ')}`);
  const parsed = { action };
  const allowed = new Set([...COMMON, ...OPTIONS[action]]);
  const seen = new Set();
  for (let i = 1; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      if (parsed.root !== undefined) throw new Error(`unexpected positional argument: ${token}`);
      parsed.root = token;
      continue;
    }
    const name = token.slice(2);
    if (!allowed.has(name)) throw new Error(`unknown ${action} option: ${token}`);
    if (seen.has(name)) throw new Error(`duplicate option: ${token}`);
    seen.add(name);
    if (name === 'json') continue;
    if (name === 'editor' || name === 'allocations') { parsed[name] = true; continue; }
    const value = argv[++i];
    if (value === undefined || value.startsWith('--') || !value.trim()) throw new Error(`${token} needs a value`);
    let result = value;
    if (NUMBERS[name]) {
      const [min, max, integer] = NUMBERS[name];
      result = Number(value);
      if (!Number.isFinite(result) || result < min || result > max || (integer && !Number.isSafeInteger(result)))
        throw new Error(`${token} must be ${integer ? 'an integer' : 'a number'} in ${min}..${max}`);
    }
    parsed[camel(name)] = result;
  }
  if (parsed.first !== undefined && parsed.last !== undefined && parsed.first > parsed.last) throw new Error('--first exceeds --last');
  if (action === 'load' && (!!parsed.path === !!parsed.session)) throw new Error('load needs exactly one of --path or --session');
  if (action === 'sample' && parsed.sample === undefined) throw new Error('sample needs --sample');
  if (action === 'mark' && !parsed.label) throw new Error('mark needs --label');
  if (action === 'compare' && (!parsed.before || !parsed.after)) throw new Error('compare needs --before and --after');
  if (parsed.context !== undefined && parsed.contextJson !== undefined) throw new Error('use only one of --context or --context-json');
  if (parsed.contextJson !== undefined) parsed.contextJson = validateProfilerContext(parsed.contextJson);
  return parsed;
}

// Preserve arbitrary game-specific fields as JSON. The bridge does not need a
// schema for a game's seed, workload, warmup, tunables, or event payloads.
export function validateProfilerContext(json) {
  if (typeof json !== 'string' || Buffer.byteLength(json, 'utf8') > 65536) throw new Error('profiler context must be a JSON object of at most 64 KiB');
  let value;
  try { value = JSON.parse(json); } catch { throw new Error('profiler context must be valid JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('profiler context must be a JSON object');
  return JSON.stringify(value);
}

export function profilerRequest(parsed) {
  const { root, timeoutMs, out, before, after, context, lease, ...request } = parsed;
  return request;
}

export async function executeProfiler(root, request, { writeRequest, awaitResult, timeoutMs = 10000, leaseToken, expectedSession } = {}) {
  const deadlineMs = Date.now() + timeoutMs;
  const id = writeRequest(root, 'invoke', { method: 'UnityAgentKit.Doctor.KitProfiler.Execute', args: [JSON.stringify({ ...request, deadlineMs })],
    deadlineMs, leaseToken, expectedSession });
  const waited = await awaitResult(root, id, { timeoutMs, cancelOnTimeout: true });
  if (waited.reason !== 'done') {
    const cancelledBeforeStart = waited.cancellation?.cancelled === true;
    return { ok: false, id, reason: waited.reason, cancelledBeforeStart, operation: waited.operation, cancellation: waited.cancellation,
      error: cancelledBeforeStart ? 'Request cancelled before execution.'
        : 'Execution outcome is uncertain; inspect operation and profiler status before retrying a mutation.' };
  }
  if (!waited.ok) return { ok: false, id, error: waited.result?.error || 'Editor invocation failed' };
  const entry = waited.result?.log?.find(line => line.type === 'Return');
  if (!entry) return { ok: false, id, error: 'Editor response has no Return message' };
  try {
    const response = JSON.parse(entry.message);
    if (!response || typeof response.ok !== 'boolean') throw new Error('missing boolean ok field');
    return { ...response, id };
  } catch (error) { return { ok: false, id, error: `Invalid profiler response: ${error.message}` }; }
}

function analysis(value) {
  let data = typeof value === 'string' ? JSON.parse(value) : value;
  for (let depth = 0; depth < 3 && data?.data; depth++) {
    if (data.ok === false) throw new Error('Cannot compare a failed profiler response');
    data = data.data;
  }
  if (!data || !Number.isInteger(data.frameCount) || data.frameCount <= 0 || !Array.isArray(data.markers) || !data.frameStats)
    throw new Error('compare requires two nonempty analyze exports');
  for (const marker of data.markers) {
    if (typeof marker.path !== 'string' || typeof marker.thread !== 'string') throw new Error('Invalid marker identity');
    for (const field of ['selfMs', 'totalMs', 'calls', 'gcBytes'])
      if (!Number.isFinite(marker[field]) || marker[field] < 0) throw new Error(`Invalid marker ${field}`);
  }
  return data;
}

const markerKey = m => JSON.stringify([m.threadGroup ?? '', m.thread, m.path]);
const difference = (before, after) => ({ before, after, delta: after - before, percent: before === 0 ? null : (after - before) * 100 / before });

function contextDifferences(before, after, path = '') {
  if (Object.is(before, after)) return [];
  if (before && after && typeof before === 'object' && typeof after === 'object'
      && !Array.isArray(before) && !Array.isArray(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
      .flatMap(key => contextDifferences(before[key], after[key], path ? `${path}.${key}` : key));
  }
  if (Array.isArray(before) && Array.isArray(after))
    return Array.from({ length: Math.max(before.length, after.length) }, (_, i) => contextDifferences(before[i], after[i], `${path}[${i}]`)).flat();
  return [{ field: path, before: before ?? null, after: after ?? null }];
}

function comparisonContext(before, after, warnings) {
  const b = before.captureContext, a = after.captureContext;
  const mismatches = [], sourceChanges = [];
  let known = true;
  if (!b || !a || b.schema !== 2 || a.schema !== 2 || !b.environment || !a.environment || !b.profiler || !a.profiler) {
    known = false;
    warnings.push('Capture context is missing or unsupported; scenario comparability is unknown.');
  } else {
    if (!b.sourceContextKnown || !a.sourceContextKnown) {
      known = false;
      warnings.push('At least one export has unknown capture provenance.');
    }
    if ([b.environment, a.environment].some(e => typeof e.editorFocused !== 'boolean'
      || typeof e.runInBackground !== 'boolean' || typeof e.backgroundPumpMode !== 'string')) {
      known = false;
      warnings.push('Focus or background execution metadata is missing; timing comparability is unknown.');
    }
    if (!b.stable || !a.stable) mismatches.push({ field: 'captureContext.stable', before: b.stable, after: a.stable,
      reason: 'Recorded context changed during at least one capture.' });
    mismatches.push(...contextDifferences(b.profiler, a.profiler, 'profiler'));
    if (b.environment.scope !== a.environment.scope) mismatches.push(...contextDifferences(b.environment.scope, a.environment.scope, 'environment.scope'));
    if (b.environment.scope === 'profiled-editor' && a.environment.scope === 'profiled-editor')
      mismatches.push(...contextDifferences(b.environment, a.environment, 'environment'));
    else {
      known = false;
      warnings.push('Automatic scene and resolution metadata belongs to the host Editor, not the connected Player; Player scenario comparability is unknown.');
    }
    try {
      const left = JSON.parse(validateProfilerContext(b.suppliedJson || '{}'));
      const right = JSON.parse(validateProfilerContext(a.suppliedJson || '{}'));
      const { source: beforeSource, ...beforeScenario } = left;
      const { source: afterSource, ...afterScenario } = right;
      sourceChanges.push(...contextDifferences(beforeSource, afterSource, 'source'));
      mismatches.push(...contextDifferences(beforeScenario, afterScenario, 'scenario'));
      if (Object.keys(beforeScenario).length === 0 || Object.keys(afterScenario).length === 0) {
        known = false;
        warnings.push('No game scenario was supplied for at least one capture; seed, workload, warmup and tunables are not inferred.');
      }
    } catch {
      known = false;
      warnings.push('Supplied capture context is invalid; scenario comparability is unknown.');
    }
  }
  for (const key of ['filter', 'threadFilter', 'unityVersion'])
    mismatches.push(...contextDifferences(before[key] ?? null, after[key] ?? null, key));
  if (before.markersTruncated || after.markersTruncated) mismatches.push({ field: 'markerCoverage', reason: 'A marker export contains a partial page.' });
  for (const [side, value] of [['before', before], ['after', after]])
    if (value.archiveGaps?.length) mismatches.push({ field: `${side}.archiveGaps`, reason: 'The capture has missing frames.' });
  const comparable = mismatches.length ? false : known ? true : null;
  if (comparable !== true) warnings.push('Deltas are measured differences only; these captures do not establish a performance regression or improvement.');
  return { comparable, comparability: comparable === null ? 'unknown' : comparable ? 'matched' : 'mismatch', mismatches, sourceChanges,
    beforeContext: b ?? null, afterContext: a ?? null };
}

// Normalize by captured frame count: a longer recording is not a regression.
export function compareProfiler(before, after, limit = 100) {
  const b = analysis(before), a = analysis(after);
  const bm = new Map(b.markers.map(m => [markerKey(m), m]));
  const am = new Map(a.markers.map(m => [markerKey(m), m]));
  const complete = !b.markersTruncated && !a.markersTruncated;
  const warnings = [];
  if (!complete) warnings.push('Marker exports contain partial pages. Absence from a page does not establish that a marker was absent from the capture.');
  if ((b.filter ?? '') !== (a.filter ?? '') || b.threadFilter !== a.threadFilter) warnings.push('The captures used different marker/thread filters.');
  if (b.unityVersion !== a.unityVersion) warnings.push('The exports were read with different Unity versions.');
  const context = comparisonContext(b, a, warnings);
  const changes = [];
  for (const key of new Set([...bm.keys(), ...am.keys()])) {
    const left = bm.get(key), right = am.get(key), marker = right ?? left;
    const row = { path: marker.path, thread: marker.thread, threadGroup: marker.threadGroup ?? '',
      presence: left && right ? 'both' : complete ? (left ? 'removed' : 'added') : 'missing-from-page' };
    if ((left && right) || complete) {
      for (const field of ['selfMs', 'totalMs', 'calls', 'gcBytes']) row[`${field}PerFrame`] = difference((left?.[field] ?? 0) / b.frameCount, (right?.[field] ?? 0) / a.frameCount);
    }
    changes.push(row);
  }
  changes.sort((x, y) => (y.selfMsPerFrame?.delta ?? -Infinity) - (x.selfMsPerFrame?.delta ?? -Infinity));
  const frameStats = {};
  for (const key of ['mean', 'median', 'p95', 'p99', 'max']) {
    if (!Number.isFinite(b.frameStats[key]) || !Number.isFinite(a.frameStats[key])) throw new Error(`Invalid frame statistic: ${key}`);
    frameStats[key] = difference(b.frameStats[key], a.frameStats[key]);
  }
  return { ok: true, ...context, beforeFrames: b.frameCount, afterFrames: a.frameCount, frameStats, markerCoverageComplete: complete,
    warnings, markerChanges: changes.length, truncated: changes.length > limit, changes: changes.slice(0, limit) };
}
