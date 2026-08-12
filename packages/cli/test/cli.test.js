import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
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

test('doctor --json rows include a non-empty explain string (superset of human render)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'uak-'));
  execFileSync('git', ['init', '-q', dir]);
  const rows = JSON.parse(run(['--json'], dir).out);
  assert.ok(rows.length > 0);
  for (const r of rows) {
    assert.equal(typeof r.explain, 'string', `${r.id} missing explain`);
    assert.ok(r.explain.length > 0, `${r.id} explain is empty`);
  }
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

test('--json rows include a boolean canApply (UPM door contract)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'uak-'));
  execFileSync('git', ['init', '-q', dir]);
  const rows = JSON.parse(run(['--json'], dir).out);
  for (const r of rows) assert.equal(typeof r.canApply, 'boolean', `${r.id} missing canApply`);
  assert.equal(rows.find(r => r.id === 'merge-driver').canApply, true);
  assert.equal(rows.find(r => r.id === 'editor-churn').canApply, false);
});

test('human output renders ranked triage findings with clickable file:line', () => {
  const fx = mkdtempSync(join(tmpdir(), 'uak-fx-'));
  const entry = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'Bash', input: { command: 'git clean -fdx' } }], usage: { input_tokens: 1, output_tokens: 1 } } };
  writeFileSync(join(fx, 's.jsonl'), JSON.stringify(entry) + '\n');
  const dir = mkdtempSync(join(tmpdir(), 'uak-'));
  execFileSync('git', ['init', '-q', dir]);
  const r = (() => {
    try { return { code: 0, out: execFileSync(process.execPath, [BIN, dir, '--only', 'audit'], { encoding: 'utf8', env: { ...process.env, UAK_TRANSCRIPTS: fx } }) }; }
    catch (e) { return { code: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }; }
  })();
  assert.equal(r.code, 0, r.out); // warn never breaks exit codes
  assert.match(r.out, /\[fix-now\]/);
  assert.match(r.out, /s\.jsonl:1/);
  assert.match(r.out, /prevented by: blast-radius/);
  assert.match(r.out, /sessions: 1 ·/);
});

test('a warn from a failed recorded proof is repairable via --fix (not stuck)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'uak-'));
  execFileSync('git', ['init', '-q', dir]);
  writeFileSync(join(dir, '.gitattributes'), '*.unity merge=unityyamlmerge\n');
  execFileSync('git', ['-C', dir, 'config', 'merge.unityyamlmerge.driver', "sh 'C:/x/unity-yaml-merge.sh' %O %A %B %P"]);
  mkdirSync(join(dir, '.unity-agent-kit'), { recursive: true });
  writeFileSync(join(dir, '.unity-agent-kit', 'verify.json'), JSON.stringify({ 'merge-driver': { ok: false, at: '2026-08-12T00:00:00.000Z' } }));
  const before = JSON.parse(run(['--json', '--only', 'merge-driver'], dir).out);
  assert.equal(before[0].status, 'warn');
  const fix = run(['--fix', '--yes', '--only', 'merge-driver'], dir);
  assert.match(fix.out, /\[merge-driver\]/); // offered, no longer stuck
  assert.equal(fix.code, 0, fix.out);
});

test('--epoch is a machine-readable report: absent editor and live file both exit 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'uak-'));
  execFileSync('git', ['init', '-q', dir]);
  const absent = run(['--epoch'], dir);
  assert.equal(absent.code, 0, absent.out);
  const a = JSON.parse(absent.out);
  assert.equal(a.present, false);
  assert.equal(a.fresh, false);
  mkdirSync(join(dir, 'Temp', 'unity-agent-kit'), { recursive: true });
  writeFileSync(join(dir, 'Temp', 'unity-agent-kit', 'epoch.json'),
    JSON.stringify({ schema: 1, pid: 1, sessionId: 'x', epoch: 9, heartbeatMs: Date.now(), state: 'ready', worldRevision: 2, probePresent: false, probeValue: -1 }));
  const live = run(['--epoch'], dir);
  const l = JSON.parse(live.out);
  assert.equal(l.present, true);
  assert.equal(l.fresh, true);
  assert.equal(l.epoch, 9);
});

test('--wait-ready: ok on a fresh ready signal, no-editor exit 1 when absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'uak-'));
  execFileSync('git', ['init', '-q', dir]);
  const miss = run(['--wait-ready', '--timeout-ms', '400', dir], dir);
  assert.equal(miss.code, 1);
  assert.equal(JSON.parse(miss.out).reason, 'no-editor');
  mkdirSync(join(dir, 'Temp', 'unity-agent-kit'), { recursive: true });
  writeFileSync(join(dir, 'Temp', 'unity-agent-kit', 'epoch.json'),
    JSON.stringify({ schema: 1, pid: 1, sessionId: 'x', epoch: 3, heartbeatMs: Date.now(), state: 'ready', worldRevision: 1, probePresent: false, probeValue: -1 }));
  const hit = run(['--wait-ready', '--timeout-ms', '2000', dir], dir);
  assert.equal(hit.code, 0);
  assert.equal(JSON.parse(hit.out).epoch, 3);
});

// A typo'd option value (here: the project path where a number belongs) used to
// reach waitReady as NaN — and NaN >= timeoutMs is false forever, so the bounded
// wait became a permanent hot poll loop. The exec timeout below is load-bearing:
// it is what stops a regression from hanging the whole suite instead of failing.
test('--wait-ready: a non-numeric option value exits 2 instead of waiting forever', () => {
  const dir = mkdtempSync(join(tmpdir(), 'uak-'));
  execFileSync('git', ['init', '-q', dir]);
  const r = (() => {
    try { return { code: 0, out: execFileSync(process.execPath, [BIN, '--wait-ready', '--timeout-ms', dir], { cwd: dir, encoding: 'utf8', timeout: 5000 }) }; }
    catch (e) { return { code: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }; }
  })();
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /--timeout-ms/);
});
