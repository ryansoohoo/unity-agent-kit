import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createContext } from '../src/context.js';
import { loadVerify, recordVerify } from '../src/audit.js';
import { register } from '../src/registry.js';
import { applyOne } from '../src/engine.js';
import '../src/checks/index.js';
import { getCheck } from '../src/registry.js';

test('recordVerify/loadVerify round-trip; corrupt file degrades to empty', () => {
  const ctx = createContext(mkdtempSync(join(tmpdir(), 'uak-v-')));
  assert.deepEqual(loadVerify(ctx), {});
  recordVerify(ctx, 'merge-driver', { ok: false, proof: 'suite failed' });
  assert.equal(loadVerify(ctx)['merge-driver'].ok, false);
  assert.match(loadVerify(ctx)['merge-driver'].at, /^\d{4}-\d{2}-\d{2}T/);
  writeFileSync(join(ctx.root, '.unity-agent-kit', 'verify.json'), '{corrupt');
  assert.deepEqual(loadVerify(ctx), {});
});

test('applyOne records the verify outcome', async () => {
  register({
    id: 't-verify-log', layer: 'hygiene', title: 't', explain: () => 'x',
    detect: async () => ({ status: 'pass', evidence: '' }),
    apply: async () => ({ changed: [], undo: [] }),
    verify: async () => ({ ok: false, proof: 'nope' }),
  });
  const ctx = createContext(mkdtempSync(join(tmpdir(), 'uak-v-')));
  await applyOne(ctx, 't-verify-log');
  assert.equal(loadVerify(ctx)['t-verify-log'].ok, false);
});

test('merge-driver detect down-ranks to warn when the last recorded proof failed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'uak-v-'));
  execFileSync('git', ['init', '-q', dir]);
  writeFileSync(join(dir, '.gitattributes'), '*.unity merge=unityyamlmerge\n');
  execFileSync('git', ['-C', dir, 'config', 'merge.unityyamlmerge.driver', "sh 'C:/x/unity-yaml-merge.sh' %O %A %B %P"]);
  const ctx = createContext(dir);
  const md = getCheck('merge-driver');
  assert.equal((await md.detect(ctx)).status, 'pass');
  recordVerify(ctx, 'merge-driver', { ok: false });
  const r = await md.detect(ctx);
  assert.equal(r.status, 'warn');
  assert.match(r.evidence, /proof FAILED/);
  recordVerify(ctx, 'merge-driver', { ok: true });
  assert.equal((await md.detect(ctx)).status, 'pass');
});
