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

register({
  id: 'test-git-config', layer: 'hygiene', title: 'Git config key exists',
  detect: async (ctx) => {
    try {
      execFileSync('git', ['config', 'test.key'], { cwd: ctx.root });
      return { status: 'pass', evidence: 'key set' };
    } catch { return { status: 'fail', evidence: 'key not set' }; }
  },
  explain: () => 'test git config check',
  apply: async (ctx) => {
    execFileSync('git', ['config', 'test.key', 'value'], { cwd: ctx.root });
    return { changed: ['git config test.key'], undo: [{ kind: 'git-config-unset', key: 'test.key' }] };
  },
});

test('undoAll handles already-unset git config gracefully', async () => {
  const ctx = createContext(tmpRepo());
  // Apply the check to set the git config
  const res = await applyOne(ctx, 'test-git-config');
  assert.equal(res.changed.length, 1);
  assert.equal(loadAudit(ctx).applied.length, 1);

  // First undo succeeds and unsets the key
  let u = undoAll(ctx);
  assert.equal(u.undone.length, 1);
  assert.match(u.undone[0], /test.key/);

  // Manually create an audit entry with a git-config-unset op for a key that doesn't exist
  const data = loadAudit(ctx);
  data.applied.push({
    id: 'test-git-config',
    at: new Date().toISOString(),
    changed: [],
    undo: [{ kind: 'git-config-unset', key: 'test.nonexistent' }]
  });
  writeFileSync(join(ctx.root, '.unity-agent-kit', 'applied.json'), JSON.stringify(data, null, 2) + '\n');

  // Second undo should handle "already unset" gracefully (exit status 5)
  u = undoAll(ctx);
  assert.equal(u.undone.length, 1);
  assert.match(u.undone[0], /already unset/);
});

test('doctor rows expose canApply and pass detect() detail through', async () => {
  register({
    id: 't-detail', layer: 'hygiene', title: 't', explain: () => 'x',
    detect: async () => ({ status: 'warn', evidence: 'e', detail: { findings: [{ n: 1 }] } }),
  });
  register({
    id: 't-applyable', layer: 'hygiene', title: 't', explain: () => 'x',
    detect: async () => ({ status: 'pass', evidence: 'e' }),
    apply: async () => ({ changed: [], undo: [] }),
  });
  const rows = await doctor(createContext(tmpRepo()), {});
  const d = rows.find(r => r.id === 't-detail');
  const a = rows.find(r => r.id === 't-applyable');
  assert.equal(d.canApply, false);
  assert.deepEqual(d.detail, { findings: [{ n: 1 }] });
  assert.equal(a.canApply, true);
  assert.ok(!('detail' in a));
  assert.ok(rows.every(r => typeof r.canApply === 'boolean'));
});
