import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
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

// Which of the driver's two contracts this machine can prove. Mirrors the
// search order in assets/unity-yaml-merge.sh (UNITY_YAML_MERGE override, else
// the Hub editor root) so the tests assert what the kit will ACTUALLY do here:
// with Unity the suite merges 5/5, without it the driver refuses and the kit
// degrades honestly. CI runners have no Unity, so both branches are asserted —
// never skipped. Node 20 floor: plain readdirSync, no fs.globSync (v22+).
function unityYamlMergeAvailable() {
  const override = process.env.UNITY_YAML_MERGE;
  if (override) return existsSync(override);
  const hubRoot = process.env.UNITY_HUB_EDITOR_ROOT || 'C:/Program Files/Unity/Hub/Editor';
  let versions;
  try {
    versions = readdirSync(hubRoot);
  } catch {
    return false; // no Hub install on this machine (the CI case)
  }
  return versions.some(v => existsSync(join(hubRoot, v, 'Editor', 'Data', 'Tools', 'UnityYAMLMerge.exe')));
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

test('apply installs script + config; with Unity detect passes and verify proves 5/5, without it detect warns on a failed proof', async () => {
  const ctx = createContext(tmpRepo());
  const fs = await import('node:fs');
  fs.writeFileSync(join(ctx.root, '.gitattributes'), '*.unity merge=unityyamlmerge\n*.meta merge=unityyamlmerge\n');
  const res = await applyOne(ctx, 'merge-driver');
  assert.ok(existsSync(join(ctx.root, 'tools', 'unity-yaml-merge.sh')));
  assert.equal(ctx.git('config', '--get', 'merge.unityyamlmerge.driver').ok, true);
  const detected = (await doctor(ctx, { only: 'merge-driver' }))[0];
  if (unityYamlMergeAvailable()) {
    assert.equal(detected.status, 'pass');
    assert.equal(res.verify.ok, true, res.verify.proof);
  } else {
    assert.equal(res.verify.ok, false, 'no UnityYAMLMerge on this machine, yet the suite claimed to pass');
    assert.match(res.verify.proof, /suite failed|FAIL/);
    assert.equal(detected.status, 'warn');
    assert.match(detected.evidence, /proof FAILED/);
  }
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

test('a relative project root still installs an absolute driver path; verify proves 5/5 with Unity, records an honest failed proof without', async () => {
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
    if (unityYamlMergeAvailable()) {
      assert.equal(res.verify.ok, true, res.verify.proof);
    } else {
      assert.equal(res.verify.ok, false, 'no UnityYAMLMerge on this machine, yet the suite claimed to pass');
      assert.match(res.verify.proof, /suite failed|FAIL/);
    }
  } finally {
    process.chdir(originalCwd);
  }
});
