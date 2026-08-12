import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createContext } from '../src/context.js';

test('git() returns ok:true with output in a repo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'uak-'));
  execFileSync('git', ['init', '-q', dir]);
  const ctx = createContext(dir);
  const r = ctx.git('rev-parse', '--is-inside-work-tree');
  assert.equal(r.ok, true);
  assert.equal(r.out, 'true');
});

test('git() returns ok:false, never throws, outside a repo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'uak-'));
  const r = createContext(dir).git('rev-parse', '--is-inside-work-tree');
  assert.equal(r.ok, false);
});
