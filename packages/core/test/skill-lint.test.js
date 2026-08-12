import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext } from '../src/context.js';
import '../src/checks/index.js';
import { getCheck } from '../src/registry.js';

const lint = getCheck('skill-lint');
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function skillDir(root, name, description) {
  const d = join(root, '.claude', 'skills', name);
  mkdirSync(d, { recursive: true });
  const fm = description === null ? '---\nname: ' + name + '\n---\n' : `---\nname: ${name}\ndescription: ${description}\n---\n`;
  writeFileSync(join(d, 'SKILL.md'), fm + '# body\n');
  return d;
}

test('skill-lint: na when no skills are installed', async () => {
  const r = await lint.detect(createContext(mkdtempSync(join(tmpdir(), 'uak-sl-'))));
  assert.equal(r.status, 'na');
});

test('skill-lint: well-formed descriptions pass with a resting-cost estimate', async () => {
  const root = mkdtempSync(join(tmpdir(), 'uak-sl-'));
  skillDir(root, 'a-skill', 'Use when doing A-things in Unity. Do NOT use for B-things.');
  skillDir(root, 'b-skill', 'Use when handling B-problems in pipelines. Do NOT use for A-work.');
  const r = await lint.detect(createContext(root));
  assert.equal(r.status, 'pass', r.evidence);
  assert.match(r.evidence, /~\d+ resting tokens/);
});

test('skill-lint: flags overlong, missing firing condition, missing negative trigger, missing description', async () => {
  const root = mkdtempSync(join(tmpdir(), 'uak-sl-'));
  skillDir(root, 'long', 'Use when X. Do NOT use for Y. ' + 'z'.repeat(200));
  skillDir(root, 'nofire', 'Handles Unity merges nicely. Do NOT use for topology.');
  skillDir(root, 'noneg', 'Use when merging Unity scenes and prefabs together.');
  skillDir(root, 'nodesc', null);
  const r = await lint.detect(createContext(root));
  assert.equal(r.status, 'warn');
  assert.match(r.evidence, /long: description \d+ chars \(>200\)/);
  assert.match(r.evidence, /nofire: no "Use when"/);
  assert.match(r.evidence, /noneg: no negative trigger/);
  assert.match(r.evidence, /nodesc: missing description/);
});

test('skill-lint: near-duplicate descriptions are flagged as overlap', async () => {
  const root = mkdtempSync(join(tmpdir(), 'uak-sl-'));
  skillDir(root, 'twin-a', 'Use when merging Unity scene files with git. Do NOT use for code merges.');
  skillDir(root, 'twin-b', 'Use when merging Unity scene files with git. Do NOT use for text merges.');
  const r = await lint.detect(createContext(root));
  assert.equal(r.status, 'warn');
  assert.match(r.evidence, /twin-a .* twin-b: descriptions \d+% overlapping/);
});

test('skill-lint: the kit repo itself lints clean (dogfood)', async () => {
  const r = await lint.detect(createContext(REPO));
  assert.equal(r.status, 'pass', r.evidence);
});
