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

function skillDirB(root, name, description, body) {
  const d = join(root, '.claude', 'skills', name);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`);
  return d;
}

const LONG_PARA =
  'Wait on the epoch signal never on a clock poll the epoch file on a short loop until fresh and ready and the epoch has bumped past its pre-edit value because a poll started right after the trigger can land inside the editor scan cadence and read the old snapshot before the request was noticed.';

test('skill-lint: near-verbatim paragraph shared by two skills is flagged', async () => {
  const root = mkdtempSync(join(tmpdir(), 'uak-sl-'));
  skillDirB(root, 'dupe-a', 'Use when doing A-work in editors. Do NOT use for B-work.', `# a\n\n${LONG_PARA}\n\nUnique a-tail content here.`);
  skillDirB(root, 'dupe-b', 'Use when doing B-work in pipelines. Do NOT use for A-work.', `# b\n\nTotally different opener for b.\n\n${LONG_PARA}`);
  const r = await lint.detect(createContext(root));
  assert.equal(r.status, 'warn');
  assert.match(r.evidence, /dupe-a and dupe-b: near-duplicate paragraph/);
});

test('skill-lint: distinct bodies do not trip the duplicate check', async () => {
  const root = mkdtempSync(join(tmpdir(), 'uak-sl-'));
  skillDirB(root, 'solo-a', 'Use when doing A-work in editors. Do NOT use for B-work.', `# a\n\n${LONG_PARA}`);
  skillDirB(root, 'solo-b', 'Use when handling render pipelines. Do NOT use for editor tooling.', '# b\n\nA completely different paragraph about render pipelines that shares no phrasing at all with the other skill, beyond the handful of ordinary English words any two sentences inevitably have in common.');
  const r = await lint.detect(createContext(root));
  assert.equal(r.status, 'pass', r.evidence);
});

// LONG_PARA with four words reworded in its closing span. Measured against the
// shipped helpers at 0.7455 (75%) shingle similarity: genuinely *near*-duplicate
// rather than byte-identical, so an implementation that only compared paragraphs
// for string equality would miss it and fail this test.
const NEAR_PARA = LONG_PARA.replace(
  'read the old snapshot before the request was noticed',
  'read the stale capture before that call was observed');

test('skill-lint: a reworded near-duplicate paragraph is still flagged', async () => {
  const root = mkdtempSync(join(tmpdir(), 'uak-sl-'));
  skillDirB(root, 'near-a', 'Use when doing A-work in editors. Do NOT use for B-work.', `# a\n\n${LONG_PARA}`);
  skillDirB(root, 'near-b', 'Use when handling render pipelines. Do NOT use for editor tooling.', `# b\n\n${NEAR_PARA}`);
  const r = await lint.detect(createContext(root));
  assert.equal(r.status, 'warn');
  assert.match(r.evidence, /near-a and near-b: near-duplicate paragraph/);
});

// Two words below are load-bearing: "shader" sits in BOTH positive clauses (the
// shadowing to catch), and "profiling" sits in shadow-a's positive but shadow-b's
// negative, so an implementation ignoring the do-NOT split would over-flag it.
// The pair measures 0.4118 description-jaccard on the shipped helpers — under the
// 0.5 overlap threshold, so the warn below can only come from the vocabulary check.
test('skill-lint: a content term claimed by two positive clauses is flagged as shadowing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'uak-sl-'));
  skillDir(root, 'shadow-a', 'Use when profiling shader compilation output. Do NOT use for gameplay work.');
  skillDir(root, 'shadow-b', 'Use when editing shader graphs in the node editor. Do NOT use for profiling.');
  const r = await lint.detect(createContext(root));
  assert.equal(r.status, 'warn');
  assert.match(r.evidence, /"shader" claimed by shadow-a and shadow-b/);
});

test('skill-lint: polysemous term without a disambiguator is flagged', async () => {
  const root = mkdtempSync(join(tmpdir(), 'uak-sl-'));
  skillDir(root, 'poly', 'Use when running build checks in Unity projects. Do NOT use for merges.');
  const r = await lint.detect(createContext(root));
  assert.equal(r.status, 'warn');
  assert.match(r.evidence, /poly: "build" is polysemous/);
});

test('skill-lint: polysemous term with a disambiguator passes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'uak-sl-'));
  skillDir(root, 'poly-ok', 'Use when verifying changes compile cleanly. Do NOT use for player/exe builds.');
  const r = await lint.detect(createContext(root));
  assert.equal(r.status, 'pass', r.evidence);
});

// "Not for …" is one of the three negative-trigger forms the description check
// accepts, so the positive-clause splitter has to recognise it too — otherwise
// nf-b's negative clause is read as a claim and "profiling" looks shared. The
// pair measures 0.3125 description-jaccard, so a warn here could only be the
// shadowing false positive this pins against.
test('skill-lint: a term in a "Not for" negative clause is not a positive claim', async () => {
  const root = mkdtempSync(join(tmpdir(), 'uak-sl-'));
  skillDir(root, 'nf-a', 'Use when profiling shader compilation output. Do NOT use for gameplay work.');
  skillDir(root, 'nf-b', 'Use when authoring lightmap bakes for a level. Not for profiling.');
  const r = await lint.detect(createContext(root));
  assert.equal(r.status, 'pass', r.evidence);
});
