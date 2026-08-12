import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'kit.js');

function run(args, cwd) {
  try { return { code: 0, out: execFileSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' }) }; }
  catch (e) { return { code: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }; }
}

test('doctor --json emits parseable rows and exit 1 on failures', () => {
  const dir = mkdtempSync(join(tmpdir(), 'uak-'));
  execFileSync('git', ['init', '-q', dir]);
  const r = run(['--json'], dir);
  const rows = JSON.parse(r.out);
  assert.ok(Array.isArray(rows) && rows.length >= 5);
  assert.ok(rows.every(x => ['pass', 'warn', 'fail', 'na'].includes(x.status)));
  assert.equal(r.code, rows.some(x => x.status === 'fail') ? 1 : 0);
});

test('human output lists every check with a status glyph', () => {
  const dir = mkdtempSync(join(tmpdir(), 'uak-'));
  execFileSync('git', ['init', '-q', dir]);
  const r = run([], dir);
  assert.match(r.out, /merge-driver/);
  assert.match(r.out, /longpaths/);
});

// All wizard tests scope to --only hygiene: the unity-mcp check lives in the
// `integration` layer and its apply() shells out to the REAL `unity` CLI —
// a vendor call that must never run inside a unit test on a machine that has
// the CLI installed. --only exercises the same code paths.
test('--fix --yes repairs everything repairable, then doctor is clean of fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'uak-'));
  execFileSync('git', ['init', '-q', dir]);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 't@t.t']);
  const fix = run(['--fix', '--yes', '--only', 'hygiene'], dir);
  assert.equal(fix.code, 0, fix.out);
  const after = JSON.parse(run(['--json', '--only', 'hygiene'], dir).out);
  assert.ok(!after.some(x => x.status === 'fail'), JSON.stringify(after.filter(x => x.status === 'fail')));
});

test('--undo restores pre-fix state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'uak-'));
  execFileSync('git', ['init', '-q', dir]);
  run(['--fix', '--yes', '--only', 'hygiene'], dir);
  const u = run(['--undo'], dir);
  assert.equal(u.code, 0);
  const rows = JSON.parse(run(['--json', '--only', 'hygiene'], dir).out);
  assert.ok(rows.some(x => x.status === 'fail'), 'failures return after undo');
});

test('--fix without --yes on non-TTY exits 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'uak-'));
  execFileSync('git', ['init', '-q', dir]);
  assert.equal(run(['--fix'], dir).code, 2);
});
