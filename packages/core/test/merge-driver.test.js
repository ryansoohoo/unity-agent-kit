import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createContext } from '../src/context.js';
import '../src/checks/index.js';
import { getCheck } from '../src/registry.js';
import { doctor, applyOne } from '../src/engine.js';
import { undoAll } from '../src/audit.js';

function tmpRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'uak-'));
  execFileSync('git', ['init', '-q', dir]);
  return dir;
}

test('detect: na without .gitattributes routing; fail when routed but driver unset', async () => {
  const ctx = createContext(tmpRepo());
  let r = (await doctor(ctx, { only: 'merge-driver' }))[0];
  assert.equal(r.status, 'na');
  execFileSync('git', ['-C', ctx.root, 'config', 'user.email', 't@t.t']);
  const fs = await import('node:fs');
  fs.writeFileSync(join(ctx.root, '.gitattributes'), '*.unity merge=unityyamlmerge\n');
  r = (await doctor(ctx, { only: 'merge-driver' }))[0];
  assert.equal(r.status, 'fail');
});

test('apply installs script + config; detect passes; verify runs the 5-case suite', async () => {
  const ctx = createContext(tmpRepo());
  const fs = await import('node:fs');
  fs.writeFileSync(join(ctx.root, '.gitattributes'), '*.unity merge=unityyamlmerge\n*.meta merge=unityyamlmerge\n');
  const res = await applyOne(ctx, 'merge-driver');
  assert.ok(existsSync(join(ctx.root, 'tools', 'unity-yaml-merge.sh')));
  assert.equal(ctx.git('config', '--get', 'merge.unityyamlmerge.driver').ok, true);
  assert.equal((await doctor(ctx, { only: 'merge-driver' }))[0].status, 'pass');
  assert.equal(res.verify.ok, true, res.verify.proof);
});

test('undo restores a pre-existing git config value instead of wiping it', async () => {
  const ctx = createContext(tmpRepo());
  const fs = await import('node:fs');
  fs.writeFileSync(join(ctx.root, '.gitattributes'), '*.unity merge=unityyamlmerge\n*.meta merge=unityyamlmerge\n');
  ctx.git('config', 'merge.unityyamlmerge.driver', 'custom-driver');
  await applyOne(ctx, 'merge-driver');
  undoAll(ctx);
  assert.equal(ctx.git('config', '--get', 'merge.unityyamlmerge.driver').out, 'custom-driver');
});

test('a relative project root still installs an absolute driver path and verify() passes', async () => {
  const dir = tmpRepo();
  const originalCwd = process.cwd();
  try {
    process.chdir(dir);
    const ctx = createContext('.');
    const fs = await import('node:fs');
    fs.writeFileSync(join(ctx.root, '.gitattributes'), '*.unity merge=unityyamlmerge\n*.meta merge=unityyamlmerge\n');
    const res = await applyOne(ctx, 'merge-driver');
    const drv = ctx.git('config', '--get', 'merge.unityyamlmerge.driver');
    assert.equal(drv.ok, true);
    const m = drv.out.match(/^sh '(.+)' %O %A %B %P$/);
    assert.ok(m, `unexpected driver config format: ${drv.out}`);
    assert.equal(isAbsolute(m[1]), true, `driver path is not absolute: ${m[1]}`);
    assert.equal(res.verify.ok, true, res.verify.proof);
  } finally {
    process.chdir(originalCwd);
  }
});
