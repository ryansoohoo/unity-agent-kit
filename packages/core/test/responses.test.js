import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOperation, normalizeWait, normalizeCancellation } from '../src/responses.js';

const root = 'project';
const completed = extra => ({ id: 'proof', verb: 'invoke', method: 'Proof.Read', state: 'completed', ok: true,
  dataJson: '', log: [], ...extra });
const typed = (type, value, extra = {}) => completed({ returnType: type, hasReturnValue: true,
  returnJson: JSON.stringify(value), log: [{ type: 'Return', message: String(value) }], ...extra });

test('typed returns preserve bool, string, null and exact numeric representations without asserting invoke values', () => {
  for (const [type, returned] of [['System.Boolean', false], ['System.String', 'False'], ['System.String', '123'],
    ['System.String', '{"ok":false,"token":"game-data"}'], ['System.Single', 0.5], ['System.Int64', '9223372036854775807'],
    ['System.String', null]]) {
    const result = normalizeOperation(root, typed(type, returned));
    assert.equal(result.ok, true);
    assert.equal(result.returnValue, returned);
    assert.equal(result.returnType, type);
    assert.equal(result.returnValueKnown, true);
    assert.equal(result.data, null);
  }
  const empty = normalizeOperation(root, completed({ returnType: 'System.Void', hasReturnValue: false }));
  assert.equal(empty.returnValueKnown, true);
  assert.equal(empty.hasReturnValue, false);
  const check = normalizeOperation(root, typed('System.String', '{"ok":false,"live":null}', {
    verb: 'check', state: 'failed', ok: false, dataJson: '{"ok":false,"live":null}', error: 'No live runtime' }));
  assert.equal(check.ok, false);
  assert.deepEqual(check.data, { ok: false, live: null });
  const gameData = { ok: false, token: 'game-token', leaseToken: 'game-field', customJson: 'not JSON' };
  const projectCheck = normalizeOperation(root, completed({ verb: 'check', dataJson: JSON.stringify(gameData) }), { details: true });
  assert.deepEqual(projectCheck.data, gameData, 'bridge token redaction must not alter arbitrary project check evidence');
  assert.deepEqual(JSON.parse(projectCheck.operation.dataJson), gameData);
});

test('legacy display text stays explicitly untyped and malformed JSON cannot lose the durable id', () => {
  for (const message of ['False', 'True', '3', '{"ok":false}']) {
    const value = normalizeOperation(root, completed({ log: [{ type: 'Return', message }] }));
    assert.equal(value.returnValue, message);
    assert.equal(value.returnType, 'unknown');
    assert.equal(value.returnValueKnown, false);
    assert.equal(value.ok, true);
  }
  const malformed = normalizeOperation(root, completed({ dataJson: '{', returnJson: '{', returnType: 'System.String' }));
  assert.equal(malformed.id, 'proof');
  assert.equal(malformed.ok, false);
  assert.match(malformed.dataError, /Malformed Editor/);
  assert.match(malformed.returnError, /Malformed Editor/);
  assert.match(malformed.rawReceiptPath, /res[\\/]proof.json$/);
});

test('compact discovery removes repeated inventories while details and non-discovery evidence remain complete', () => {
  const assemblies = Array.from({ length: 120 }, (_, i) => ({ name: `Assembly${i}`, mvid: `identity${i}` }));
  const discovery = completed({ verb: 'status', dataJson: JSON.stringify({ protocol: 2, runtimeVersion: '0.6.0', commands: ['status'], assemblies }) });
  const before = JSON.stringify(discovery);
  const compact = normalizeOperation(root, discovery), details = normalizeOperation(root, discovery, { details: true });
  assert.equal(compact.data.assemblies, undefined);
  assert.equal(compact.operation.dataJson, undefined);
  assert.equal(compact.data.assemblyCount, 120);
  assert.equal(compact.data.assembliesIncluded, false);
  assert.deepEqual(details.data.assemblies, assemblies);
  assert.equal(JSON.stringify(discovery), before, 'presentation must not mutate receipt evidence');
  assert.ok(JSON.stringify(details).length > JSON.stringify(compact).length * 5);
  const diagnostics = Array.from({ length: 120 }, (_, line) => ({ line, message: `Compiler detail ${line}` }));
  assert.deepEqual(normalizeOperation(root, completed({ verb: 'refresh', dataJson: JSON.stringify({ diagnostics }) })).data.diagnostics, diagnostics);
});

test('known bridge metadata redacts lease tokens in both detail modes while preserving arbitrary game return strings', () => {
  const secret = 'owned-lease-secret';
  for (const verb of ['refresh', 'session']) for (const details of [false, true]) {
    const service = { ok: true, leaseToken: secret, request: { leaseToken: secret }, nested: { token: secret, value: 9 } };
    const operation = completed({ verb, leaseToken: secret, dataJson: JSON.stringify(service),
      payloadJson: JSON.stringify(service), args: [JSON.stringify(service)] });
    const result = normalizeOperation(root, operation, { details });
    assert.equal(JSON.stringify(result).includes(secret), false);
    assert.equal(result.data.nested.value, 9);
    assert.equal(operation.leaseToken, secret);
  }
  const opaque = '{"leaseToken":"game-value","token":"game-value"}';
  const game = normalizeOperation(root, typed('System.String', opaque), { details: true });
  assert.equal(game.returnValue, opaque);
  assert.equal(JSON.parse(game.operation.returnJson), opaque);
});

test('profiler service outcomes normalize identically during completion and recovery; generic methods do not infer them', () => {
  const response = '{"ok":false,"error":"capture failed","data":{"recording":false}}';
  const operation = typed('System.String', response, { method: 'UnityAgentKit.Doctor.KitProfiler.Execute' });
  const recovered = normalizeOperation(root, operation);
  const waited = normalizeWait(root, { reason: 'done', ok: true, result: operation }, operation);
  for (const result of [recovered, waited]) {
    assert.equal(result.ok, false);
    assert.equal(result.invocationOk, true);
    assert.equal(result.operation.ok, true);
    assert.equal(result.data.recording, false);
    assert.equal(result.id, operation.id);
  }
  assert.equal(normalizeOperation(root, { ...operation, method: 'Game.Other' }).ok, true);
  const service = { ok: true, data: { leaseToken: 'secret', recording: true } };
  const hidden = normalizeOperation(root, typed('System.String', JSON.stringify(service), {
    method: 'UnityAgentKit.Doctor.KitProfiler.Execute' }), { details: true });
  assert.equal(JSON.stringify(hidden).includes('secret'), false);
});

test('waiting keeps pending identity and cancellation action success differs from cancelled operation outcome', () => {
  const running = { id: 'running', state: 'running', ok: false, leaseToken: 'secret', dataJson: '' };
  const waited = normalizeWait(root, { reason: 'timeout', ok: false, operation: running,
    cancellation: { cancelled: false, operation: running } }, running);
  assert.equal(waited.ok, false);
  assert.equal(waited.pending, true);
  assert.equal(waited.data, null);
  assert.equal(waited.id, 'running');
  assert.equal(JSON.stringify(waited).includes('secret'), false);
  assert.match(waited.rawReceiptPath, /ops[\\/]running.json$/);
  const cancelled = normalizeCancellation(root, { cancelled: true, operation: { id: 'cancel', state: 'cancelled', ok: false } });
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.operation.ok, false);
  assert.equal(cancelled.pending, false);
  assert.equal(normalizeCancellation(root, { cancelled: false, operation: running }).ok, false);
});
