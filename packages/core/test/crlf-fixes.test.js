import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createContext } from '../src/context.js';
import '../src/checks/index.js';
import { getCheck } from '../src/registry.js';

test('worktree-ignore: a correct line written with CRLF endings still passes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'uak-'));
  execFileSync('git', ['init', '-q', dir]);
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\r\n/.claude/worktrees/\r\n');
  const r = await getCheck('worktree-ignore').detect(createContext(dir));
  assert.equal(r.status, 'pass', r.evidence);
});

test('editor-churn: scene paths on CRLF-terminated porcelain lines are still caught', async () => {
  // context.git strips TRAILING output whitespace only; interior \r survives.
  const fake = {
    root: 'X:\\nowhere', platform: 'win32',
    git: () => ({ ok: true, out: ' M Assets/Scenes/A.unity\r\n M ProjectSettings/XRSettings.asset', code: 0 }),
  };
  const r = await getCheck('editor-churn').detect(fake);
  assert.equal(r.status, 'warn');
  assert.match(r.evidence, /uncommitted scene files/);
  assert.match(r.evidence, /A\.unity/);
  assert.doesNotMatch(r.evidence, /A\.unity\r/);
});
