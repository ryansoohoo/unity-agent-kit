import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContext } from '../src/context.js';
import '../src/checks/index.js';
import { getCheck } from '../src/registry.js';

const kanabo = getCheck('kanabo');

function withSnap(snap) {
  const dir = mkdtempSync(join(tmpdir(), 'uak-kbc-'));
  if (snap) {
    mkdirSync(join(dir, 'Temp', 'unity-agent-kit'), { recursive: true });
    writeFileSync(join(dir, 'Temp', 'unity-agent-kit', 'epoch.json'), JSON.stringify(snap));
  }
  return createContext(dir);
}

test('kanabo: registered detect-only, integration layer, never fails', () => {
  assert.equal(kanabo.layer, 'integration');
  assert.equal(kanabo.apply, undefined);
});

test('kanabo: na with install guidance when no signal exists', async () => {
  const r = await kanabo.detect(withSnap(null));
  assert.equal(r.status, 'na');
  assert.match(r.evidence, /no epoch signal/i);
});

test('kanabo: pass with epoch + revision on a fresh ready signal', async () => {
  const r = await kanabo.detect(withSnap({ schema: 1, pid: 5, sessionId: 's', epoch: 12, heartbeatMs: Date.now(), state: 'ready', worldRevision: 40, probePresent: false, probeValue: -1 }));
  assert.equal(r.status, 'pass');
  assert.match(r.evidence, /epoch 12/);
  assert.match(r.evidence, /revision 40/);
});

test('kanabo: pass with state named while compiling (transient is not a defect)', async () => {
  const r = await kanabo.detect(withSnap({ schema: 1, pid: 5, sessionId: 's', epoch: 12, heartbeatMs: Date.now(), state: 'compiling', worldRevision: 40, probePresent: false, probeValue: -1 }));
  assert.equal(r.status, 'pass');
  assert.match(r.evidence, /compiling/);
});

test('kanabo: na when the heartbeat is stale (editor closed)', async () => {
  const r = await kanabo.detect(withSnap({ schema: 1, pid: 5, sessionId: 's', epoch: 12, heartbeatMs: Date.now() - 60000, state: 'ready', worldRevision: 40, probePresent: false, probeValue: -1 }));
  assert.equal(r.status, 'na');
  assert.match(r.evidence, /not running|stale/i);
});
