import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createContext } from '../src/context.js';
import '../src/checks/index.js';
import { getCheck } from '../src/registry.js';
import { doctor, applyOne } from '../src/engine.js';

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
