import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Run only against a disposable Unity project with fixtures/ProfilerProof.cs
// copied into Assets/Editor and this checkout installed as its kit package.
const project = process.argv[2];
if (!project) throw new Error('Supply the disposable proof project path');
const cli = fileURLToPath(new URL('../packages/cli/bin/kit.js', import.meta.url));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function command(args) {
  return JSON.parse(execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
}
function profiler(action, ...args) {
  const response = command(['profiler', action, project, ...args]);
  assert.equal(response.ok, true, response.error);
  return response.data;
}
function invoke(method) {
  const response = command(['invoke', project, '--method', method, '--json', '--timeout-ms', '5000']);
  assert.equal(response.ok, true);
}
async function finished(id) {
  const until = Date.now() + 20000;
  while (Date.now() < until) {
    const session = profiler('sessions').sessions.find(s => s.id === id);
    if (session && !['recording', 'stopping'].includes(session.state)) return session;
    await sleep(250);
  }
  throw new Error('Capture did not finalize');
}

const initial = profiler('status');
assert.equal(initial.recording, false, 'Proof requires recording off');
assert.equal(initial.loadedPath, '', 'Proof requires no loaded-history lease');
let session;
try {
  invoke('ProfilerProof.Begin');
  session = profiler('start', '--editor', '--seconds', '4', '--max-mb', '512', '--checkpoint-frames', '100', '--allocations', '--label', 'bridge-proof');
  profiler('mark', '--label', 'known nested workload');
  const live = profiler('frames', '--limit', '1000');
  assert.ok(live.frames.length > 0, 'Live frame query was empty');
  session = await finished(session.id);
  invoke('ProfilerProof.Stop');
  assert.notEqual(session.state, 'failed', session.error);
  assert.ok(session.chunks.length > 1, 'Proof must exercise multiple archive chunks');
  assert.equal(session.gaps.length, 0, 'Archive dropped frames');
  const archiveFrames = profiler('frames', '--session', session.id, '--limit', '1000');
  assert.equal(archiveFrames.matched, session.indexedFrames);
  const retained = profiler('status');
  const analyzed = profiler('analyze', '--session', session.id, '--filter', 'Proof', '--limit', '1000', '--timeout-ms', '30000');
  assert.equal(analyzed.frameCount, session.indexedFrames, 'Overlapping chunks were duplicated or omitted');
  const parent = analyzed.markers.find(m => m.path.endsWith('/Proof.Parent'));
  const child = analyzed.markers.find(m => m.path.endsWith('/Proof.Parent/Proof.Child'));
  const worker = analyzed.markers.find(m => m.thread === 'Worker' && m.path.endsWith('/Proof.Worker'));
  assert.ok(parent && child && worker, 'Missing nested/main/worker markers');
  assert.equal(child.calls, parent.calls * 3);
  assert.equal(child.frames, parent.frames, 'Repeated calls counted as separate frames');
  assert.ok(parent.selfMs > 0 && parent.selfMs < parent.totalMs / 2);
  assert.ok(child.selfMs > 0 && child.selfMs < child.totalMs * .8);
  assert.ok(analyzed.markers.some(m => m.path.endsWith('/GC.Alloc') && m.gcBytes > 0));
  const afterAnalysis = profiler('status');
  assert.equal(afterAnalysis.firstFrame, retained.firstFrame);
  assert.equal(afterAnalysis.lastFrame, retained.lastFrame);
  const loaded = profiler('load', '--session', session.id, '--frame', String(session.chunks[0].first));
  assert.ok(loaded.inspectFrame >= loaded.ownedFirstFrame && loaded.inspectFrame <= loaded.ownedLastFrame);
  const frame = profiler('frame', '--frame', String(loaded.inspectFrame + 3), '--thread', '0', '--filter', 'Proof', '--limit', '1000');
  const alloc = frame.samples.find(s => s.name === 'GC.Alloc');
  assert.ok(alloc, 'No allocation sample in known workload');
  const detail = profiler('sample', '--frame', String(frame.frame), '--thread', '0', '--sample', String(alloc.index));
  assert.ok(detail.metadata.length > 0 && detail.callstack.length > 0, 'Allocation metadata/call stack missing');
  const threads = profiler('threads', '--frame', String(frame.frame));
  assert.ok(threads.threads.some(t => t.name === 'Worker' && t.index > 0));
  profiler('unload');
  const restored = profiler('status');
  for (const key of ['recording', 'profileEditor', 'cpuEnabled', 'allocationMode', 'target']) assert.equal(restored[key], initial[key], `Did not restore ${key}`);
  assert.equal(restored.firstFrame, retained.firstFrame);
  assert.equal(restored.lastFrame, retained.lastFrame);
  const result = { ok: true, session: session.id, frames: session.indexedFrames, chunks: session.chunks.length,
    parentCalls: parent.calls, childCalls: child.calls, workerCalls: worker.calls,
    allocationStackDepth: detail.callstack.length, checkpointMs: session.checkpointMs, maxCheckpointMs: session.maxCheckpointMs };
  invoke('ProfilerProof.Begin');
  const manual = profiler('start', '--editor', '--seconds', '60', '--checkpoint-frames', '1000', '--label', 'manual-stop-proof');
  await sleep(300);
  const stopped = command(['invoke', project, '--method', 'UnityEditorInternal.ProfilerDriver.set_enabled', '--arg', 'false', '--json', '--timeout-ms', '5000']);
  assert.equal(stopped.ok, true);
  const manualResult = await finished(manual.id);
  assert.equal(manualResult.state, 'recording-stopped');
  assert.ok(manualResult.indexedFrames > 0, 'Manual Record-off lost the uncheckpointed tail');
  const cancelled = profiler('start', '--editor', '--seconds', '60', '--label', 'cancel-proof');
  profiler('cancel');
  assert.equal((await finished(cancelled.id)).state, 'cancelled');
  const reload = profiler('start', '--editor', '--seconds', '60', '--label', 'reload-proof');
  const epoch = command([project, '--epoch']).epoch;
  invoke('UnityEditor.EditorUtility.RequestScriptReload');
  const ready = command([project, '--wait-ready', '--since-epoch', String(epoch), '--timeout-ms', '30000']);
  assert.equal(ready.ok, true);
  const reloaded = await finished(reload.id);
  assert.equal(reloaded.state, 'domain-reload');
  const restoredAfterReload = profiler('status');
  for (const key of ['recording', 'profileEditor', 'cpuEnabled', 'allocationMode', 'target']) assert.equal(restoredAfterReload[key], initial[key], `Reload did not restore ${key}`);
  result.manualStopFrames = manualResult.indexedFrames;
  result.cancelRestored = true; result.reloadRestored = true;
  writeFileSync(join(project, 'profiler-proof-result.json'), JSON.stringify(result, null, 2));
  writeFileSync(join(project, 'profiler-proof-analysis.json'), JSON.stringify({ ok: true, data: analyzed }, null, 2));
  console.log(JSON.stringify(result));
} finally {
  invoke('ProfilerProof.Stop');
  const status = profiler('status');
  if (status.captureActive) { profiler('cancel'); await finished(status.capture.id); }
  if (profiler('status').loadedPath) profiler('unload');
}
