import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('upm manifest is a valid editor-only Unity 6 package', () => {
  const pkg = JSON.parse(readFileSync(join(REPO, 'upm', 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'com.unity-agent-kit.doctor');
  assert.match(pkg.unity, /^6000\./);
  assert.equal(pkg.displayName, 'Unity Agent Kit Doctor');
  const asmdef = JSON.parse(readFileSync(join(REPO, 'upm', 'Editor', 'UnityAgentKit.Doctor.Editor.asmdef'), 'utf8'));
  assert.deepEqual(asmdef.includePlatforms, ['Editor']);
  assert.equal(asmdef.name, 'UnityAgentKit.Doctor.Editor');
});

test('bundled Core~ runs the doctor end-to-end from OUTSIDE the repo (one code path, hermetic)', () => {
  const corePkg = join(REPO, 'upm', 'Core~', 'node_modules', '@unity-agent-kit', 'core', 'package.json');
  assert.ok(existsSync(corePkg), 'bundled engine is committed');
  assert.ok(!existsSync(join(REPO, 'upm', 'Core~', 'cli', 'test')), 'test dirs are excluded from the bundle');
  const stage = mkdtempSync(join(tmpdir(), 'uak-upm-'));
  cpSync(join(REPO, 'upm', 'Core~'), join(stage, 'Core~'), { recursive: true });
  const proj = mkdtempSync(join(tmpdir(), 'uak-'));
  execFileSync('git', ['init', '-q', proj]);
  let out;
  try { out = execFileSync(process.execPath, [join(stage, 'Core~', 'cli', 'bin', 'kit.js'), proj, '--json'], { encoding: 'utf8' }); }
  catch (e) { out = e.stdout; }
  const rows = JSON.parse(out);
  assert.ok(rows.some(r => r.id === 'merge-driver'));
  assert.ok(rows.every(r => typeof r.canApply === 'boolean'));
});

test('build-upm --check gates freshness', () => {
  execFileSync(process.execPath, [join(REPO, 'scripts', 'build-upm.mjs'), '--check'], { cwd: REPO });
});
