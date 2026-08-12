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
