import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Run against a disposable graphical Editor with PlaySessionProof.cs installed.
// This writes a proof script under Assets/Editor and exercises real Play mode.
const project = resolve(process.argv[2] ?? '');
if (!process.argv[2] || !existsSync(join(project, 'Assets/Editor/PlaySessionProof.cs')))
  throw new Error('Supply a disposable Unity project containing Assets/Editor/PlaySessionProof.cs.');
const proofFile = join(project, 'Assets/Editor/McpReleaseProof.cs');
if (existsSync(proofFile)) throw new Error('McpReleaseProof.cs already exists; use a fresh proof project.');
const server = fileURLToPath(new URL('../packages/mcp/bin/server.js', import.meta.url));
const pause = ms => new Promise(done => setTimeout(done, ms));
const clients = [];
const evidence = { calls: [] };
async function connect(name) {
  const client = new Client({ name, version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [server, '--project', project], stderr: 'inherit' }));
  clients.push(client);
  return client;
}
async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  const data = result.structuredContent ?? JSON.parse(result.content[0].text);
  evidence.calls.push({ name, data });
  return data;
}
async function completed(client, result) {
  const end = Date.now() + 120000;
  while (result.pending && Date.now() < end)
    result = await call(client, 'unity_operation_wait', { id: result.id, waitMs: 5000 });
  assert.notEqual(result.pending, true, 'Operation did not finish');
  return result;
}
let leaseToken, waitingTicket;
try {
  const a = await connect('release-proof-a'), b = await connect('release-proof-b');
  const catalog = await a.listTools();
  evidence.tools = catalog.tools.map(tool => tool.name);
  for (const name of ['unity_refresh', 'unity_check', 'unity_play_start', 'unity_profiler'])
    assert.ok(evidence.tools.includes(name), `Missing ${name}`);
  const status = await completed(a, await call(a, 'unity_status'));
  assert.equal(status.ok, true);
  assert.equal(status.data.runtimeVersion, '0.6.0');
  assert.equal(status.data.editorFocused, false, 'Proof requires Unity to stay in the background');
  const initialBackground = status.data.runInBackground;
  const discovery = await completed(a, await call(a, 'unity_capabilities', { filter: 'PlaySessionProof', limit: 200 }));
  assert.ok(discovery.data.methods.some(method => method.method === 'PlaySessionProof.Check'));
  const lease = await call(a, 'unity_lease_acquire', { owner: 'release-proof-a', ttlMs: 300000 });
  assert.equal(lease.ok, true); leaseToken = lease.lease.token;
  const waiting = await call(b, 'unity_lease_acquire', { owner: 'release-proof-b' });
  assert.equal(waiting.reason, 'queued'); assert.equal(waiting.position, 1);
  waitingTicket = waiting.ticket;
  const refused = await call(b, 'unity_check', { method: 'PlaySessionProof.Fail', leaseToken: 'not-the-owner' });
  assert.equal(refused.ok, false);
  const revision = `mcp-release-${Date.now()}`;
  writeFileSync(proofFile, `public static class McpReleaseProof { public const string Revision = "${revision}"; public static bool Check() => Revision == "${revision}"; }\n`, { flag: 'wx' });
  const refreshed = await completed(a, await call(a, 'unity_refresh', { leaseToken,
    files: ['Assets/Editor/McpReleaseProof.cs'], probe: { type: 'McpReleaseProof', field: 'Revision', expected: revision }, waitMs: 1000 }));
  assert.equal(refreshed.ok, true, JSON.stringify(refreshed));
  const checked = await completed(a, await call(a, 'unity_check', { method: 'McpReleaseProof.Check', leaseToken, after: refreshed.id }));
  assert.equal(checked.ok, true, JSON.stringify(checked));
  const failed = await completed(a, await call(a, 'unity_check', { method: 'PlaySessionProof.Fail', leaseToken }));
  assert.equal(failed.ok, false, 'False must fail a check');
  const play = await completed(a, await call(a, 'unity_play_start', { leaseToken, durationSeconds: 2,
    setupMethod: 'PlaySessionProof.Setup', stepMethod: 'PlaySessionProof.Step', checkMethod: 'PlaySessionProof.Check', teardownMethod: 'PlaySessionProof.Teardown' }));
  assert.equal(play.ok, true, JSON.stringify(play));
  const sessionId = play.data.id;
  let session;
  const until = Date.now() + 90000;
  do {
    await pause(500);
    session = await completed(a, await call(a, 'unity_play_status', { id: sessionId }));
  } while (!['completed', 'failed', 'cancelled'].includes(session.data.state) && Date.now() < until);
  assert.equal(session.data.state, 'completed', JSON.stringify(session));
  assert.equal(session.data.checkRan, true); assert.equal(session.data.checkPassed, true);
  assert.equal(session.data.cleanup, 'restored');
  assert.ok(session.data.unfocusedFrames > 0);
  const restored = await completed(a, await call(a, 'unity_status'));
  assert.equal(restored.data.playing, false);
  assert.equal(restored.data.runInBackground, initialBackground);
  assert.equal(restored.data.editorFocused, false);
  const profiler = await completed(a, await call(a, 'unity_profiler', { action: 'status' }));
  assert.equal(profiler.ok, true, JSON.stringify(profiler));
  const released = await call(a, 'unity_lease_release', { leaseToken });
  assert.equal(released.ok, true); leaseToken = null;
  const next = await call(b, 'unity_lease_acquire', { owner: 'release-proof-b', ticket: waiting.ticket });
  assert.equal(next.ok, true); waitingTicket = null; await call(b, 'unity_lease_release', { leaseToken: next.lease.token });
  evidence.ok = true;
  console.log(JSON.stringify({ ok: true, tools: evidence.tools.length, refresh: refreshed.id, play: sessionId, unfocusedFrames: session.data.unfocusedFrames }));
} finally {
  if (waitingTicket && clients[1]) await call(clients[1], 'unity_lease_cancel', { owner: 'release-proof-b', ticket: waitingTicket });
  if (leaseToken && clients[0]) {
    const current = await completed(clients[0], await call(clients[0], 'unity_play_status'));
    if (current.data?.id && !['completed', 'failed', 'cancelled'].includes(current.data.state))
      await completed(clients[0], await call(clients[0], 'unity_play_stop', { id: current.data.id, leaseToken }));
    await call(clients[0], 'unity_lease_release', { leaseToken });
  }
  for (const client of clients) await client.close();
  writeFileSync(join(project, 'mcp-proof.json'), JSON.stringify(evidence, null, 2) + '\n');
}
