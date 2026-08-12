import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createContext } from '../src/context.js';
import { register } from '../src/registry.js';
import { doctor, applyOne } from '../src/engine.js';
import { undoAll, loadAudit } from '../src/audit.js';

function tmpRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'uak-'));
  execFileSync('git', ['init', '-q', dir]);
  return dir;
}

register({
  id: 'test-marker', layer: 'hygiene', title: 'Marker file exists',
  detect: async (ctx) => existsSync(join(ctx.root, 'marker.txt'))
    ? { status: 'pass', evidence: 'marker.txt present' }
    : { status: 'fail', evidence: 'marker.txt missing' },
  explain: () => 'test check',
  apply: async (ctx) => {
    const p = join(ctx.root, 'marker.txt');
    writeFileSync(p, 'hi');
    return { changed: [p], undo: [{ kind: 'restore-file', path: p, previous: null }] };
  },
  verify: async (ctx) => ({ ok: existsSync(join(ctx.root, 'marker.txt')), proof: 'file exists after apply' }),
});

test('doctor reports fail then pass around applyOne; undoAll restores', async () => {
  const ctx = createContext(tmpRepo());
  let rows = await doctor(ctx, { only: 'test-marker' });
  assert.equal(rows[0].status, 'fail');

  const res = await applyOne(ctx, 'test-marker');
  assert.equal(res.verify.ok, true);
  assert.equal(loadAudit(ctx).applied.length, 1);

  rows = await doctor(ctx, { only: 'test-marker' });
  assert.equal(rows[0].status, 'pass');

  const u = undoAll(ctx);
  assert.equal(u.undone.length, 1);
  rows = await doctor(ctx, { only: 'test-marker' });
  assert.equal(rows[0].status, 'fail');
});
