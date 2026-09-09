import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmp } from '../../core/test/tmp.js';
import { epochPath } from '../../core/src/kanabo.js';
import { reqDir, resDir } from '../../core/src/actions.js';
import { skillOrigins } from '../../core/src/bridge-cli.js';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'kit.js');
function run(args, cwd, timeout = 3000) {
  try { return { code: 0, out: execFileSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', timeout, stdio: 'pipe' }) }; }
  catch (e) { return { code: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }; }
}

test('invalid expected epochs and conflicting session wait modes cannot enqueue work', () => {
  const root = tmp('uak-cli-validation-');
  for (const epoch of ['NaN', '-1', '1.5', '2147483648', 'Infinity', '']) {
    const r = run(['invoke', root, '--method', 'Proof.Run', '--async', '--expected-epoch', epoch], root);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /expected-epoch/);
    assert.equal(existsSync(reqDir(root)), false);
  }
  const conflict = run(['session', 'start', root, '--async', '--wait'], root);
  assert.equal(conflict.code, 2, conflict.out);
  assert.match(conflict.out, /--async and --wait/);
  assert.equal(existsSync(reqDir(root)), false);

  const valid = run(['invoke', root, '--method', 'Proof.Run', '--async', '--expected-epoch', '9'], root);
  assert.equal(valid.code, 0, valid.out);
  const request = JSON.parse(readFileSync(join(reqDir(root), readdirSync(reqDir(root))[0]), 'utf8'));
  assert.equal(request.expectedEpoch, 9);
});

test('profiler context files enforce object shape and size after source metadata is added', () => {
  const root = tmp('uak-profiler-context-'), context = join(root, 'context.json');
  for (const [action, json, expected] of [
    ['start', '[]', /JSON object/],
    ['mark', 'null', /JSON object/],
    ['mark', JSON.stringify({ data: 'x'.repeat(65536) }), /64 KiB/],
    ['start', JSON.stringify({ data: 'x'.repeat(65500) }), /64 KiB/],
  ]) {
    writeFileSync(context, json);
    const r = run(['profiler', action, root, '--context', context, '--label', 'proof'], root);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, expected);
    assert.equal(existsSync(reqDir(root)), false, 'invalid context must not reach the Editor');
  }
});

test('session config must be an object before any request is queued', () => {
  const root = tmp('uak-session-config-'), config = join(root, 'scenario.json');
  writeFileSync(config, '[]');
  const r = run(['session', 'start', root, '--config', config, '--async'], root);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /config must be a JSON object/);
  assert.equal(existsSync(reqDir(root)), false);
});

test('refresh omits an optional probe and rejects malformed probes before queueing', () => {
  const root = tmp('uak-refresh-probe-');
  const noProbe = run(['refresh', root, '--async'], root);
  assert.equal(noProbe.code, 0, noProbe.out);
  const queued = JSON.parse(readFileSync(join(reqDir(root), readdirSync(reqDir(root))[0]), 'utf8'));
  assert.equal(Object.hasOwn(JSON.parse(queued.payloadJson), 'probe'), false);

  const invalidRoot = tmp('uak-invalid-probe-'), path = join(invalidRoot, 'probe.json');
  for (const probe of [null, {}, [], { type: 'Proof' }, { type: 'Proof', field: 'Value' }, { type: 'Proof', field: 'Value', expected: 7 }]) {
    writeFileSync(path, JSON.stringify(probe));
    const rejected = run(['refresh', invalidRoot, '--probe', path, '--async'], invalidRoot);
    assert.equal(rejected.code, 2, rejected.out);
    assert.match(rejected.out, /--probe/);
    assert.equal(existsSync(reqDir(invalidRoot)), false);
  }
  writeFileSync(path, JSON.stringify({ type: 'Proof', field: 'Value', expected: '' }));
  const emptyExpected = run(['refresh', invalidRoot, '--probe', path, '--async'], invalidRoot);
  assert.equal(emptyExpected.code, 0, emptyExpected.out);
});

test('skill discovery reports bounded file candidates without claiming agent injection', () => {
  const root = tmp('uak-skill-origins-'), kitRoot = join(root, 'kit'), codexHome = join(root, 'codex'), claudeHome = join(root, 'claude');
  const put = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
  put(join(kitRoot, 'plugin/.claude-plugin/plugin.json'), JSON.stringify({ version: '0.5.0' }));
  const sourcePath = join(kitRoot, 'skills/unity-verify/SKILL.md');
  put(sourcePath, 'source verification recipe');
  put(join(kitRoot, 'skills/unrelated/SKILL.md'), 'must not be reported');
  for (const version of ['0.1.0', '0.2.0', '0.3.0', '0.4.0', '0.9.0', '0.10.0'])
    put(join(codexHome, 'plugins/cache/unity-agent-kit/unity-agent-kit', version, 'skills/unity-verify/SKILL.md'), `cached ${version}`);
  const result = skillOrigins(root, { kitRoot, codexHome, claudeHome });
  assert.equal(result.injectionKnown, false);
  assert.equal(result.truncated, true);
  assert.equal(result.candidates.length, 5);
  const source = result.candidates.find(c => c.origin === 'kit-source');
  assert.equal(source.path, sourcePath);
  assert.equal(source.version, '0.5.0');
  assert.equal(source.sha256, createHash('sha256').update('source verification recipe').digest('hex'));
  assert.deepEqual(result.candidates.filter(c => c.origin === 'codex-plugin-cache').map(c => c.version), ['0.10.0', '0.9.0', '0.4.0', '0.3.0']);
});

test('poll interval cannot extend a shorter operation timeout', () => {
  const root = tmp('uak-cli-poll-'), started = Date.now();
  const r = run(['invoke', root, '--method', 'Proof.Run', '--json', '--timeout-ms', '100', '--poll-ms', '5000'], root, 2500);
  assert.equal(r.code, 3, r.out);
  assert.equal(JSON.parse(r.out).reason, 'no-editor');
  assert.ok(Date.now() - started < 2200);
});

// Acknowledges start, then stops responding. The CLI must retain the Play id
// and respect the overall wait deadline instead of adding a five-second RPC.
const SILENT_SESSION = `
const { readdirSync, readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const [req, res] = process.argv.slice(1);
const seen = new Set();
const timer = setInterval(() => {
  let names; try { names = readdirSync(req).filter(n => n.endsWith('.json')); } catch { return; }
  for (const name of names) {
    if (seen.has(name)) continue;
    let r; try { r = JSON.parse(readFileSync(join(req, name), 'utf8')); } catch { continue; }
    seen.add(name);
    if (JSON.parse(r.payloadJson).action !== 'start') continue;
    mkdirSync(res, { recursive: true });
    writeFileSync(join(res, r.id + '.json'), JSON.stringify({ id: r.id, ok: true, state: 'completed',
      dataJson: JSON.stringify({ id: 'bounded-proof', state: 'running' }), log: [] }));
  }
}, 10);
setTimeout(() => clearInterval(timer), 10000).unref();
`;

test('session wait remains bounded when status stops responding and preserves recovery identity', () => {
  const root = tmp('uak-session-wait-');
  mkdirSync(dirname(epochPath(root)), { recursive: true });
  writeFileSync(epochPath(root), JSON.stringify({ protocol: 2, sessionId: 'proof', epoch: 1,
    heartbeatMs: Date.now(), state: 'ready' }));
  const editor = spawn(process.execPath, ['-e', SILENT_SESSION, reqDir(root), resDir(root)], { stdio: 'ignore' });
  try {
    const started = Date.now();
    const r = run(['session', 'start', root, '--lease', 'proof-token', '--wait', '--timeout-ms', '800', '--poll-ms', '10'], root, 2500);
    assert.equal(r.code, 1, r.out);
    assert.ok(Date.now() - started < 2200, 'overall session wait exceeded its bound');
    const result = JSON.parse(r.out);
    assert.equal(result.sessionId, 'bounded-proof');
    assert.equal(result.session.state, 'running');
    assert.match(result.error, /inspect or cancel/);
  } finally { editor.kill(); }
});
