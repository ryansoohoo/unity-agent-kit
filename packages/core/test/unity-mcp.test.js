import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createContext } from '../src/context.js';
import '../src/checks/index.js';
import { doctor, applyOne } from '../src/engine.js';
import { _deps } from '../src/checks/unity-mcp.js';

function repo() { const d = mkdtempSync(join(tmpdir(), 'uak-')); execFileSync('git', ['init', '-q', d]); return d; }

test('na when unity CLI absent', async () => {
  _deps.which = () => null;
  const r = (await doctor(createContext(repo()), { only: 'unity-mcp' }))[0];
  assert.equal(r.status, 'na');
});

test('fail when CLI present but .mcp.json lacks unity; apply calls configure', async () => {
  _deps.which = () => 'C:/fake/unity.exe';
  let called = false;
  _deps.configure = () => { called = true; return { ok: true, out: 'configured' }; };
  const ctx = createContext(repo());
  assert.equal((await doctor(ctx, { only: 'unity-mcp' }))[0].status, 'fail');
  writeFileSync(join(ctx.root, '.mcp.json'), JSON.stringify({ mcpServers: { unity: { command: 'unity', args: ['mcp'] } } }));
  assert.equal((await doctor(ctx, { only: 'unity-mcp' }))[0].status, 'pass');
});
