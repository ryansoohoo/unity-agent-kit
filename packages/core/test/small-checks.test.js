import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createContext } from '../src/context.js';
import '../src/checks/index.js';
import { doctor, applyOne } from '../src/engine.js';

function repo() { const d = mkdtempSync(join(tmpdir(), 'uak-')); execFileSync('git', ['init', '-q', d]); return d; }

test('longpaths: fail → apply → pass, undoable', async () => {
  const ctx = createContext(repo());
  assert.equal((await doctor(ctx, { only: 'longpaths' }))[0].status, 'fail');
  await applyOne(ctx, 'longpaths');
  assert.equal(ctx.git('config', '--get', 'core.longpaths').out, 'true');
  assert.equal((await doctor(ctx, { only: 'longpaths' }))[0].status, 'pass');
});

test('worktree-ignore: appends once, idempotent, pass after apply', async () => {
  const ctx = createContext(repo());
  writeFileSync(join(ctx.root, '.gitignore'), 'node_modules/\n');
  assert.equal((await doctor(ctx, { only: 'worktree-ignore' }))[0].status, 'fail');
  await applyOne(ctx, 'worktree-ignore');
  await applyOne(ctx, 'worktree-ignore'); // second apply must not duplicate
  const gi = readFileSync(join(ctx.root, '.gitignore'), 'utf8');
  assert.equal((gi.match(/\.claude\/worktrees/g) || []).length, 1);
  assert.equal((await doctor(ctx, { only: 'worktree-ignore' }))[0].status, 'pass');
});
