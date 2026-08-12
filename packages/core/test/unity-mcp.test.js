import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createContext } from '../src/context.js';
import '../src/checks/index.js';
import { doctor, applyOne } from '../src/engine.js';
import { loadAudit } from '../src/audit.js';
import { _deps } from '../src/checks/unity-mcp.js';

function repo() { const d = mkdtempSync(join(tmpdir(), 'uak-')); execFileSync('git', ['init', '-q', d]); return d; }

// Snapshot the real implementations once, restore them after every test so a
// stub set by one test (which/configure/home/whichClaude) can never leak into
// the next — detect() now reaches home()/whichClaude() any time the project
// .mcp.json check doesn't pass, so every test below pins what it needs itself.
const REAL_DEPS = { ..._deps };
afterEach(() => { Object.assign(_deps, REAL_DEPS); });

test('na when unity CLI absent', async () => {
  _deps.which = () => null;
  const r = (await doctor(createContext(repo()), { only: 'unity-mcp' }))[0];
  assert.equal(r.status, 'na');
});

test('fail when CLI present but .mcp.json lacks unity; apply calls configure', async () => {
  _deps.which = () => 'C:/fake/unity.exe';
  _deps.home = () => mkdtempSync(join(tmpdir(), 'uak-home-'));  // empty dir: no ~/.claude.json
  _deps.whichClaude = () => '/fake/claude';
  let called = false;
  _deps.configure = () => { called = true; return { ok: true, out: 'configured' }; };
  const ctx = createContext(repo());
  assert.equal((await doctor(ctx, { only: 'unity-mcp' }))[0].status, 'fail');
  writeFileSync(join(ctx.root, '.mcp.json'), JSON.stringify({ mcpServers: { unity: { command: 'unity', args: ['mcp'] } } }));
  assert.equal((await doctor(ctx, { only: 'unity-mcp' }))[0].status, 'pass');
});

test('apply invokes configure and captures undo; failure throws', async () => {
  _deps.which = () => 'C:/fake/unity.exe';
  let called = false;
  _deps.configure = () => { called = true; return { ok: true, out: 'configured' }; };
  const ctx = createContext(repo());
  const res = await applyOne(ctx, 'unity-mcp');
  assert.equal(called, true);                       // configure actually ran
  assert.ok(res.changed.some(c => c.includes('.mcp.json')));
  const audit = loadAudit(ctx);                      // undo entry captured, previous:null (file didn't exist)
  const undo = audit.applied.at(-1).undo[0];
  assert.equal(undo.kind, 'restore-file');
  assert.equal(undo.previous, null);
  // failure path throws
  _deps.configure = () => ({ ok: false, out: 'boom' });
  await assert.rejects(() => applyOne(createContext(repo()), 'unity-mcp'), /configure failed|boom/);
});

test('pass when unity registered user-scope via ~/.claude.json (no project .mcp.json)', async () => {
  const home = mkdtempSync(join(tmpdir(), 'uak-home-'));
  writeFileSync(join(home, '.claude.json'), JSON.stringify({
    mcpServers: { 'unity-editor-mcp': { type: 'stdio', command: 'unity', args: ['mcp'] } },
  }));
  _deps.which = () => '/fake/unity';
  _deps.home = () => home;
  const ctx = createContext(mkdtempSync(join(tmpdir(), 'uak-')));  // plain temp dir, not a git repo
  const r = (await doctor(ctx, { only: 'unity-mcp' }))[0];
  assert.equal(r.status, 'pass');
  assert.match(r.evidence, /user-scope/);
});

test('fail with claude-CLI-missing install instructions when unregistered and claude is not on PATH', async () => {
  _deps.which = () => '/fake/unity';
  _deps.home = () => mkdtempSync(join(tmpdir(), 'uak-home-'));  // empty dir: no ~/.claude.json
  _deps.whichClaude = () => null;
  const ctx = createContext(repo());  // no .mcp.json written
  const r = (await doctor(ctx, { only: 'unity-mcp' }))[0];
  assert.equal(r.status, 'fail');
  assert.match(r.evidence, /claude.*CLI|npm i -g/i);
});

test('fail with plain not-registered evidence when unregistered but claude is on PATH', async () => {
  _deps.which = () => '/fake/unity';
  _deps.home = () => mkdtempSync(join(tmpdir(), 'uak-home-'));  // empty dir: no ~/.claude.json
  _deps.whichClaude = () => '/fake/claude';
  const ctx = createContext(repo());  // no .mcp.json written
  const r = (await doctor(ctx, { only: 'unity-mcp' }))[0];
  assert.equal(r.status, 'fail');
  assert.equal(r.evidence, 'Unity CLI installed but its MCP is not registered in this project');
});
