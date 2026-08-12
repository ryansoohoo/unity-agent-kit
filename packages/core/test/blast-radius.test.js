import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createContext } from '../src/context.js';
import '../src/checks/index.js';
import { doctor, applyOne } from '../src/engine.js';
import { DENY_RULES } from '../src/checks/blast-radius.js';

function repo() { const d = mkdtempSync(join(tmpdir(), 'uak-')); execFileSync('git', ['init', '-q', d]); return d; }

test('fail without settings; apply merges deny rules preserving existing content', async () => {
  const ctx = createContext(repo());
  mkdirSync(join(ctx.root, '.claude'), { recursive: true });
  writeFileSync(join(ctx.root, '.claude', 'settings.json'),
    JSON.stringify({ permissions: { allow: ['Bash(npm test:*)'], deny: ['WebFetch'] } }, null, 2));
  assert.equal((await doctor(ctx, { only: 'blast-radius' }))[0].status, 'fail');
  await applyOne(ctx, 'blast-radius');
  const s = JSON.parse(readFileSync(join(ctx.root, '.claude', 'settings.json'), 'utf8'));
  assert.ok(s.permissions.allow.includes('Bash(npm test:*)'), 'existing allow preserved');
  assert.ok(s.permissions.deny.includes('WebFetch'), 'existing deny preserved');
  for (const rule of DENY_RULES) assert.ok(s.permissions.deny.includes(rule), rule);
  assert.equal((await doctor(ctx, { only: 'blast-radius' }))[0].status, 'pass');
});

test('apply refuses to overwrite an invalid .claude/settings.json — throws instead of clobbering it', async () => {
  const ctx = createContext(repo());
  mkdirSync(join(ctx.root, '.claude'), { recursive: true });
  const p = join(ctx.root, '.claude', 'settings.json');
  writeFileSync(p, '{ not valid json');
  await assert.rejects(() => applyOne(ctx, 'blast-radius'), /not valid JSON/);
  assert.equal(readFileSync(p, 'utf8'), '{ not valid json', 'file must be left untouched');
});
