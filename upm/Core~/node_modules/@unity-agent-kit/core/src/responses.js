import { join } from 'node:path';
import { channelDir, terminalStates } from './actions.js';

const profilerMethod = 'UnityAgentKit.Doctor.KitProfiler.Execute';

// Lease tokens are coordination credentials. Keep them in durable files, but
// omit them from observations, including JSON nested inside service metadata.
export function redactBridgeMetadata(value) {
  if (Array.isArray(value)) return value.map(redactBridgeMetadata);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['leaseToken', 'token'].includes(key)).map(([key, item]) => {
    if ((key.endsWith('Json') || key === 'args') && item) {
      const cleanJson = json => {
        if (typeof json !== 'string' || !json.trim()) return json;
        try {
          const parsed = JSON.parse(json);
          if (typeof parsed === 'string' && /^[\[{]/.test(parsed.trim()))
            return JSON.stringify(JSON.stringify(redactBridgeMetadata(JSON.parse(parsed))));
          return JSON.stringify(redactBridgeMetadata(parsed));
        }
        catch { return '[Malformed bridge JSON; inspect rawReceiptPath.]'; }
      };
      return [key, Array.isArray(item) ? item.map(cleanJson) : cleanJson(item)];
    }
    return [key, redactBridgeMetadata(item)];
  }));
}

// Presentation only: receipt files retain their original payload, diagnostics and
// logs. Detailed output includes the raw JSON fields for older callers that need them.
export function normalizeOperation(root, operation, { details = false, kind, receiptKey = 'operation' } = {}) {
  const state = operation.state ?? (operation.ok ? 'completed' : 'failed');
  const finished = terminalStates.has(state);
  const value = { id: operation.id, ok: finished ? operation.ok === true : state !== 'unknown', state,
    pending: !finished && state !== 'unknown', data: null, returnValue: null,
    returnType: operation.returnType || 'unknown', returnValueKnown: false,
    hasReturnValue: operation.returnType ? operation.hasReturnValue === true : null,
    rawReceiptPath: join(channelDir(root), finished ? 'res' : 'ops', `${operation.id}.json`) };
  const service = operation.method === profilerMethod || ['session', 'refresh', 'status', 'capabilities'].includes(operation.verb ?? kind);
  const { log, returnJson, args, dataJson, ...metadata } = operation;
  const receipt = { ...redactBridgeMetadata(metadata), state };
  if (dataJson !== undefined) receipt.dataJson = service ? redactBridgeMetadata({ dataJson }).dataJson : dataJson;
  if (log) receipt.log = service ? log.map(entry => entry.type === 'Return'
    ? { ...entry, message: redactBridgeMetadata({ dataJson: entry.message }).dataJson } : redactBridgeMetadata(entry)) : log;
  if (returnJson !== undefined) receipt.returnJson = service ? redactBridgeMetadata({ returnJson }).returnJson : returnJson;
  if (args !== undefined) receipt.args = service ? redactBridgeMetadata({ args }).args : args;
  if (!details) {
    delete receipt.dataJson;
    delete receipt.returnJson;
    delete receipt.payloadJson;
    delete receipt.args;
  }
  value[receiptKey] = receipt;
  const returned = operation.log?.find(entry => entry.type === 'Return');
  if (operation.returnType === 'System.Void') value.returnValueKnown = true;
  else if (typeof operation.returnJson === 'string' && operation.returnJson.trim()) {
    try { value.returnValue = JSON.parse(operation.returnJson); value.returnValueKnown = true; }
    catch { value.returnError = 'Malformed Editor returnJson; inspect rawReceiptPath.'; }
  }
  if (!value.returnValueKnown && returned) {
    value.returnValue = returned.message;
    value.hasReturnValue = true;
    value.returnNote = 'Display text only. This receipt has no decodable typed return value; do not infer a boolean or number.';
  }
  if (typeof operation.dataJson === 'string' && operation.dataJson.trim()) {
    try { const parsed = JSON.parse(operation.dataJson); value.data = service ? redactBridgeMetadata(parsed) : parsed; }
    catch { value.dataError = 'Malformed Editor dataJson; inspect rawReceiptPath.'; if (finished) value.ok = false; }
  }
  const discovery = kind === 'status' || kind === 'capabilities' || operation.verb === 'status' || operation.verb === 'capabilities'
    || !operation.verb && value.data?.protocol === 2 && typeof value.data?.runtimeVersion === 'string' && Array.isArray(value.data?.commands);
  if (discovery && value.data) value.data = discoveryData(value.data, details);
  if (service && typeof value.returnValue === 'string' && value.returnValue.trim()) {
    try { value.returnValue = JSON.stringify(redactBridgeMetadata(JSON.parse(value.returnValue))); } catch { /* opaque display text */ }
  }
  return operation.method === profilerMethod ? normalizeProfiler(value) : value;
}

export function discoveryData(data, details = false) {
  const { assemblies, ...summary } = data;
  const assemblyCount = data.assemblyCount ?? assemblies?.length ?? 0;
  return { ...summary, assemblyCount, assembliesIncluded: details && Array.isArray(assemblies) && data.assembliesIncluded !== false,
    detailsAvailable: true, ...(details ? { assemblies: assemblies ?? [] } : {}) };
}

// Only the kit's profiler API has this known JSON response contract. Other
// invoked methods never infer assertions from JSON-looking return strings.
export function normalizeProfiler(result) {
  if (result.pending || !result.ok) return result;
  try {
    const response = typeof result.returnValue === 'string' ? JSON.parse(result.returnValue) : result.returnValue;
    if (!response || typeof response.ok !== 'boolean') throw new Error('missing boolean ok field');
    return { ...result, ...response, id: result.id, data: response.data ?? null,
      ok: result.ok && response.ok, invocationOk: result.ok };
  } catch (error) { return { ...result, ok: false, error: `Invalid profiler response: ${error.message}` }; }
}

export function normalizeWait(root, waited, operation, options = {}) {
  const { result, operation: waitingOperation, ...waitFields } = waited;
  const normalized = normalizeOperation(root, operation ?? result ?? waitingOperation, options);
  return { ...redactBridgeMetadata(waitFields), ...normalized, ok: waited.reason === 'done' ? normalized.ok : false };
}

export function normalizeCancellation(root, cancellation, options = {}) {
  return { ...normalizeOperation(root, cancellation.operation, options), ok: cancellation.cancelled,
    cancelled: cancellation.cancelled, ...(cancellation.reason ? { reason: cancellation.reason } : {}),
    ...(cancellation.removedFromQueue ? { removedFromQueue: true } : {}) };
}
