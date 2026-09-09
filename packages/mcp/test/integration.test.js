import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, renameSync, rmSync, existsSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { atomicJson, channelDir, readJson, reqDir, runningDir, operationDir, resDir } from '@unity-agent-kit/core/src/actions.js';
import { KIT_VERSION } from '@unity-agent-kit/core/src/version.js';

const launcher = fileURLToPath(new URL('../bin/server.js', import.meta.url));
const content = result => result.structuredContent ?? JSON.parse(result.content.find(item => item.type === 'text').text);

// The real Editor's KitFiles writer retries transient Windows sharing errors.
// Keep the fake's replacement behavior equivalent when a client is reading.
function publish(file, value) {
  for (let attempt = 0; ; attempt++) {
    try { atomicJson(file, value); return; }
    catch (error) {
      if (attempt === 20 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
}

function project(t, editor = true) {
  const root = mkdtempSync(join(tmpdir(), 'uak-mcp-'));
  for (const path of ['Assets', 'Packages', 'ProjectSettings', 'Temp/unity-agent-kit/req', 'Temp/unity-agent-kit/running', 'Temp/unity-agent-kit/ops', 'Temp/unity-agent-kit/res'])
    mkdirSync(join(root, path), { recursive: true });
  writeFileSync(join(root, 'Packages/manifest.json'), '{"dependencies":{}}');
  writeFileSync(join(root, 'ProjectSettings/ProjectVersion.txt'), 'm_EditorVersion: 6000.5.5f1\n');
  const fake = { root, requests: [], hold: false, claim: true, errors: [], clients: [], sessionId: 'fake-editor-A' };
  let timer, lastHeartbeat = 0;
  t.after(async () => {
    clearInterval(timer);
    try { for (const close of fake.clients) await close(); assert.deepEqual(fake.errors, []); }
    finally { rmSync(root, { recursive: true, force: true }); }
  });
  fake.complete = (request, result = {}) => {
    const operation = { id: request.id, state: 'completed', ok: true, startedMs: Date.now(), completedMs: Date.now(),
      startedEpoch: 4, finishedEpoch: 4, sessionId: fake.sessionId, projectPath: root, dataJson: '', error: '', log: [], ...result };
    publish(join(operationDir(root), `${request.id}.json`), operation);
    publish(join(resDir(root), `${request.id}.json`), operation);
    unlinkSync(join(runningDir(root), `${request.id}.json`));
  };
  if (editor) {
    const tick = () => {
      try {
        if (Date.now() - lastHeartbeat >= 500) {
          publish(join(channelDir(root), 'epoch.json'), { protocol: 2, epoch: 4, sessionId: fake.sessionId, state: 'ready', heartbeatMs: Date.now() });
          lastHeartbeat = Date.now();
        }
        if (!fake.claim) return;
        for (const name of readdirSync(reqDir(root)).filter(name => name.endsWith('.json'))) {
          try { renameSync(join(reqDir(root), name), join(runningDir(root), name)); }
          catch (error) { if (error.code === 'ENOENT') continue; throw error; }
          const request = readJson(join(runningDir(root), name));
          fake.requests.push(request);
          publish(join(operationDir(root), name), { id: request.id, state: 'running', ok: false, startedMs: Date.now(), dataJson: '', error: '', log: [] });
          if (fake.hold) continue;
          if (request.verb === 'status' || request.verb === 'capabilities') {
            const query = JSON.parse(request.payloadJson);
            if (request.verb === 'capabilities') {
              assert.deepEqual(Object.keys(query).sort(), ['filter', 'limit', 'offset']);
              assert.ok(query.limit >= 1 && query.limit <= 200);
              assert.ok(query.filter.length === 0 || query.filter.length >= 3);
            }
            fake.complete(request, { dataJson: JSON.stringify({ projectPath: root, sessionId: fake.sessionId, protocol: 2, commands: ['status', 'invoke'], ...query }) });
          } else if (request.method === 'UnityAgentKit.Doctor.KitProfiler.Execute') {
            fake.complete(request, { log: [{ type: 'Return', message: JSON.stringify({ ok: true, data: { action: JSON.parse(request.args[0]).action } }) }] });
          } else if (request.verb === 'invoke') fake.complete(request, { log: [{ type: 'Return', message: request.method === 'Fixture.StructuredGetter' ? '{"ok":false,"value":17}' : 'false' }] });
          else if (request.verb === 'check') fake.complete(request, { state: 'failed', ok: false, error: 'Check returned false' });
          else if (request.verb === 'session') fake.complete(request, { dataJson: JSON.stringify({ ok: true, id: 'play-test', state: 'running' }) });
          else fake.complete(request, { dataJson: '{"ok":true,"outcome":"fake-dispatch-only"}' });
        }
      } catch (error) { fake.errors.push(error); }
    };
    tick();
    timer = setInterval(tick, 10);
  }
  return fake;
}

async function connect(t, fake) {
  const client = new Client({ name: 'unity-kit-integration-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [launcher, '--project', fake.root], stderr: 'pipe' });
  let stderr = '';
  transport.stderr.on('data', chunk => { stderr += chunk.toString(); });
  await client.connect(transport);
  fake.clients.push(async () => { await client.close(); assert.equal(stderr, ''); });
  return {
    client,
    raw: (name, args = {}, options) => client.callTool({ name, arguments: args }, undefined, options),
    call: async (name, args = {}) => content(await client.callTool({ name, arguments: args })),
  };
}

test('SDK handshake, discovery, bound status and exact capability pagination work over STDIO', async t => {
  const fake = project(t), { client, call, raw } = await connect(t, fake);
  assert.equal(client.getServerVersion().name, 'unity-agent-kit');
  assert.equal(client.getServerVersion().version, KIT_VERSION);
  const { tools } = await client.listTools();
  assert.ok(tools.find(tool => tool.name === 'unity_refresh').inputSchema.required.includes('leaseToken'));
  const status = await call('unity_status');
  assert.equal(status.local.projectPath, fake.root);
  assert.equal(status.data.sessionId, fake.sessionId);
  const found = await call('unity_capabilities', { filter: 'Fixture', offset: 9, limit: 200 });
  assert.equal(found.data.offset, 9);
  assert.equal(found.data.limit, 200);
  const before = fake.requests.length;
  for (const args of [{ filter: 'ab' }, { limit: 201 }, { offset: -1 }, { methods: true }])
    assert.equal((await raw('unity_capabilities', args)).isError, true);
  assert.equal(fake.requests.length, before, 'invalid discovery bounds must fail before dispatch');
});

test('two SDK clients share FIFO ownership; tokenless and wrong-owner mutations never dispatch', async t => {
  const fake = project(t), a = await connect(t, fake), b = await connect(t, fake);
  const first = await a.call('unity_lease_acquire', { owner: 'task-A' });
  const leaseToken = first.lease.token;
  const waiting = await b.call('unity_lease_acquire', { owner: 'task-B' });
  assert.equal(waiting.reason, 'queued');
  assert.equal(waiting.position, 1);
  const observed = await b.call('unity_lease_status');
  assert.equal(observed.lease.owner, 'task-A');
  assert.equal(observed.lease.token, undefined);
  const before = fake.requests.length;
  assert.equal((await a.raw('unity_invoke', { method: 'Fixture.Run' })).isError, true);
  assert.equal((await b.raw('unity_invoke', { method: 'Fixture.Run', leaseToken: 'wrong' })).isError, true);
  assert.equal((await b.raw('unity_lease_cancel', { ticket: waiting.ticket, owner: 'task-C' })).isError, true);
  assert.equal(fake.requests.length, before);
  const invoked = await a.call('unity_invoke', { method: 'Fixture.FalseGetter', args: ['spaces "quotes" $(literal)'], leaseToken });
  assert.equal(invoked.ok, true, 'false getter is a successful invocation');
  assert.equal(invoked.data, false);
  assert.deepEqual(fake.requests.at(-1).args, ['spaces "quotes" $(literal)']);
  assert.equal(fake.requests.at(-1).leaseToken, leaseToken);
  assert.equal(fake.requests.at(-1).expectedSession, fake.sessionId);
  const structured = await a.call('unity_invoke', { method: 'Fixture.StructuredGetter', leaseToken });
  assert.equal(structured.ok, true, 'generic invoke does not turn a returned object into an assertion');
  assert.deepEqual(structured.data, { ok: false, value: 17 });
  const checked = await a.call('unity_check', { method: 'Fixture.Check', leaseToken });
  assert.equal(checked.ok, false);
  assert.equal(checked.operation.error, 'Check returned false');
  await a.call('unity_lease_renew', { leaseToken });
  assert.equal((await a.call('unity_lease_release', { leaseToken })).ok, true);
  const next = await b.call('unity_lease_acquire', { owner: 'task-B', ticket: waiting.ticket });
  assert.equal(next.ok, true);
  assert.notEqual(next.lease.token, leaseToken);
});

test('source hashes, receipt gate, Play lifecycle and profiler query/mutation arguments reach the existing protocol', async t => {
  const fake = project(t), { call, raw } = await connect(t, fake);
  const leaseToken = (await call('unity_lease_acquire', { owner: 'task-source' })).lease.token;
  const bytes = 'class Fixture { public static int Version = 2; }';
  writeFileSync(join(fake.root, 'Assets/Fixture.cs'), bytes);
  const refreshed = await call('unity_refresh', { leaseToken, files: ['Assets/Fixture.cs'] });
  const refresh = fake.requests.at(-1), payload = JSON.parse(refresh.payloadJson);
  assert.deepEqual(payload.files, [{ path: resolve(fake.root, 'Assets/Fixture.cs'), sha256: createHash('sha256').update(bytes).digest('hex') }]);
  assert.equal(Object.hasOwn(payload, 'probe'), false, 'no-probe payload must omit the field');
  await call('unity_check', { leaseToken, method: 'Fixture.Check', after: refreshed.id, expectedEpoch: 4 });
  assert.equal(fake.requests.at(-1).requiredReceipt, refreshed.id);
  assert.equal(fake.requests.at(-1).expectedEpoch, 4);
  await call('unity_play_start', { leaseToken, setupMethod: 'Fixture.Setup', checkMethod: 'Fixture.Check', durationSeconds: 1 });
  assert.equal(JSON.parse(fake.requests.at(-1).payloadJson).leaseToken, leaseToken);
  await call('unity_play_status', { id: 'play-test' });
  assert.equal(fake.requests.at(-1).leaseToken, '');
  await call('unity_play_stop', { id: 'play-test', leaseToken });
  assert.equal(JSON.parse(fake.requests.at(-1).payloadJson).action, 'stop');
  const query = await call('unity_profiler', { action: 'frames', options: { first: 0, last: 5, limit: 3 } });
  assert.equal(query.data.data.action, 'frames');
  assert.equal(fake.requests.at(-1).leaseToken, '');
  const before = fake.requests.length;
  assert.equal((await raw('unity_profiler', { action: 'start' })).isError, true);
  assert.equal((await raw('unity_profiler', { action: 'analyze' })).isError, true);
  assert.equal((await raw('unity_profiler', { action: 'status', options: { editor: false } })).isError, true);
  assert.equal((await raw('unity_profiler', { action: 'sample' })).isError, true);
  assert.equal(fake.requests.length, before);
  await call('unity_profiler', { action: 'start', leaseToken, options: { seconds: 1, contextJson: '{"seed":42,"source":{"note":"fixture","worktree":"stale"}}', allocations: false } });
  const profiler = fake.requests.at(-1), request = JSON.parse(profiler.args[0]);
  assert.equal(profiler.method, 'UnityAgentKit.Doctor.KitProfiler.Execute');
  assert.equal(profiler.leaseToken, leaseToken);
  const context = JSON.parse(request.contextJson);
  assert.equal(context.seed, 42);
  assert.equal(context.source.worktree, fake.root);
  assert.equal(context.source.note, 'fixture');
  assert.equal(context.source.revision, null);
  assert.equal(context.source.branch, null);
  assert.equal(request.allocations, false);
  assert.ok(request.deadlineMs > Date.now());
});

test('bounded waits and MCP cancellation preserve running work and its durable result', async t => {
  const fake = project(t), { call, raw } = await connect(t, fake);
  const leaseToken = (await call('unity_lease_acquire', { owner: 'task-slow' })).lease.token;
  fake.hold = true;
  const accepted = await call('unity_invoke', { method: 'Fixture.Slow', leaseToken, waitMs: 50 });
  assert.equal(accepted.pending, true);
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.operation.state, 'running');
  assert.equal(accepted.operation.dataJson, '', 'empty C# dataJson must preserve the running receipt and its id');
  assert.ok(existsSync(join(runningDir(fake.root), `${accepted.id}.json`)));
  assert.equal((await call('unity_operation_cancel', { id: accepted.id, leaseToken })).cancelled, false);
  assert.equal((await call('unity_lease_release', { leaseToken })).reason, 'work-still-running');
  const controller = new AbortController();
  const pending = raw('unity_operation_wait', { id: accepted.id, waitMs: 500 }, { signal: controller.signal });
  setTimeout(() => controller.abort(new Error('client stopped waiting')), 25);
  await assert.rejects(pending);
  assert.ok(existsSync(join(runningDir(fake.root), `${accepted.id}.json`)), 'MCP cancellation must not claim Unity stopped');
  assert.equal(existsSync(join(resDir(fake.root), `${accepted.id}.json`)), false);
  fake.complete(fake.requests.find(request => request.id === accepted.id));
  assert.equal((await call('unity_operation_wait', { id: accepted.id })).operation.state, 'completed');
  assert.equal((await call('unity_lease_release', { leaseToken })).ok, true);
});

test('malformed terminal JSON preserves the durable operation id and opaque returns remain readable', async t => {
  const fake = project(t), { call } = await connect(t, fake);
  const leaseToken = (await call('unity_lease_acquire', { owner: 'task-result' })).lease.token;
  fake.hold = true;
  const pending = await call('unity_invoke', { method: 'Fixture.Malformed', leaseToken, waitMs: 50 });
  fake.complete(fake.requests.find(request => request.id === pending.id), { dataJson: '{' });
  const malformed = await call('unity_operation_status', { id: pending.id });
  assert.equal(malformed.id, pending.id);
  assert.equal(malformed.operation.state, 'completed');
  assert.equal(malformed.ok, false);
  assert.match(malformed.dataError, /Malformed Editor/);
  const other = await call('unity_invoke', { method: 'Fixture.String', leaseToken, waitMs: 50 });
  fake.complete(fake.requests.find(request => request.id === other.id), { log: [{ type: 'Return', message: 'opaque user string' }] });
  const returned = await call('unity_operation_status', { id: other.id });
  assert.equal(returned.id, other.id);
  assert.equal(returned.ok, true);
  assert.equal(returned.returnValue, 'opaque user string');
});

test('explicit cancellation can remove queued work; disconnected clients leave it inspectable', async t => {
  const fake = project(t), a = await connect(t, fake);
  const leaseToken = (await a.call('unity_lease_acquire', { owner: 'task-queue' })).lease.token;
  fake.claim = false;
  const queued = await a.call('unity_invoke', { method: 'Fixture.Queued', leaseToken, waitMs: 0 });
  assert.equal(queued.operation.state, 'queued');
  await a.client.close();
  const b = await connect(t, fake);
  assert.equal((await b.call('unity_operation_status', { id: queued.id })).operation.state, 'queued');
  const cancelled = await b.call('unity_operation_cancel', { id: queued.id, leaseToken });
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.operation.state, 'cancelled');
  assert.equal(existsSync(join(reqDir(fake.root), `${queued.id}.json`)), false);
});

test('missing Editor and malformed arguments produce useful responses without creating executable requests', async t => {
  const fake = project(t, false), { call, raw } = await connect(t, fake);
  const status = await call('unity_status');
  assert.equal(status.local.responsive, false);
  assert.equal(status.reason, 'no-responsive-editor');
  assert.equal((await call('unity_lease_acquire', { owner: 'task-no-editor' })).reason, 'no-responsive-editor');
  assert.equal((await raw('unity_capabilities')).isError, true);
  for (const [name, args] of [
    ['unity_operation_status', { id: '../../escape' }],
    ['unity_invoke', { leaseToken: 'x', method: 'Fixture.Run', unexpected: true }],
    ['unity_refresh', { leaseToken: 'x', files: ['Assets/File.cs'], probe: { type: 'Fixture', field: '' } }],
    ['unity_operation_wait', { id: 'x', waitMs: 5001 }],
    ['unity_play_start', { leaseToken: 'x', durationSeconds: 0 }],
  ]) assert.equal((await raw(name, args)).isError, true);
  assert.deepEqual(readdirSync(reqDir(fake.root)), []);
  writeFileSync(join(channelDir(fake.root), 'console.jsonl'), '{"type":"Error","message":"compile failed","epoch":4}\n');
  assert.equal((await call('unity_console', { errors: true })).entries[0].message, 'compile failed');
});

test('launcher rejects relative project binding on stderr without writing non-protocol stdout', () => {
  const result = spawnSync(process.execPath, [launcher, '--project', '.'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /absolute Unity project path/);
});
