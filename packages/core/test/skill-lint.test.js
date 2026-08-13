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

// description === null writes front matter without a description line.
function skillDirB(root, name, description, body) {
  const d = join(root, '.claude', 'skills', name);
  mkdirSync(d, { recursive: true });
  const fm = description === null ? `---\nname: ${name}\n---\n` : `---\nname: ${name}\ndescription: ${description}\n---\n`;
  writeFileSync(join(d, 'SKILL.md'), `${fm}${body}\n`);
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
  assert.notEqual(NEAR_PARA, LONG_PARA); // a LONG_PARA edit must not silently make this an exact-copy test
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

test('skill-lint: unannotated machine numbers and unknown flags in bodies are contract findings', async () => {
  const root = mkdtempSync(join(tmpdir(), 'uak-sl-'));
  skillDirB(root, 'contract', 'Use when doing C-work in editors. Do NOT use for D-work.',
    '# c\n\nCold init costs about 103 s on a typical machine.\n\nRun the tool with --frobnicate to begin.');
  const r = await lint.detect(createContext(root));
  assert.equal(r.status, 'warn');
  assert.match(r.evidence, /contract: unannotated measurement "103 s"/);
  assert.match(r.evidence, /contract: unallowlisted flag "--frobnicate"/);
});

test('skill-lint: measured-annotated numbers and allowlisted flags pass', async () => {
  const root = mkdtempSync(join(tmpdir(), 'uak-sl-'));
  skillDirB(root, 'contract-ok', 'Use when doing C-work in editors. Do NOT use for D-work.',
    '# c\n\nCold init costs ~103 s (measured) on this rig.\n\nWait with `kit --wait-ready` before probing.');
  const r = await lint.detect(createContext(root));
  assert.equal(r.status, 'pass', r.evidence);
});

test('skill-lint: first-person POV and body when-to-use headings are form findings', async () => {
  const root = mkdtempSync(join(tmpdir(), 'uak-sl-'));
  skillDirB(root, 'pov', 'I can help you merge Unity scenes. Use when merging scenes. Do NOT use for code.',
    '# p\n\n## When to use\n\nWhenever.');
  const r = await lint.detect(createContext(root));
  assert.equal(r.status, 'warn');
  assert.match(r.evidence, /pov: first\/second-person description/);
  assert.match(r.evidence, /pov: "When to use" belongs in the description/);
});

// "measured" annotates the NUMBER on its line. If it skipped the whole line it
// would be a check-evasion path: write the word, smuggle any flag past the scan.
test('skill-lint: a "measured" line still has its flags scanned', async () => {
  const root = mkdtempSync(join(tmpdir(), 'uak-sl-'));
  skillDirB(root, 'evade', 'Use when doing C-work in editors. Do NOT use for D-work.',
    '# e\n\nCold init costs ~103 s (measured with `kit --frobnicate`).');
  const r = await lint.detect(createContext(root));
  assert.equal(r.status, 'warn');
  assert.match(r.evidence, /evade: unallowlisted flag "--frobnicate"/);
  assert.doesNotMatch(r.evidence, /unannotated measurement/); // the number stays exempt
});

// A description-less skill is the least-linted kind there is (every
// description sub-check skips it), so the body-level checks must still see it.
test('skill-lint: a description-less skill is still linted for duplication and contracts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'uak-sl-'));
  skillDirB(root, 'has-desc', 'Use when doing A-work in editors. Do NOT use for B-work.', `# a\n\n${LONG_PARA}`);
  skillDirB(root, 'no-desc', null, `# b\n\n${LONG_PARA}\n\nRun the tool with --frobnicate to begin.`);
  const r = await lint.detect(createContext(root));
  assert.equal(r.status, 'warn');
  assert.match(r.evidence, /has-desc and no-desc: near-duplicate paragraph/);
  assert.match(r.evidence, /no-desc: unallowlisted flag "--frobnicate"/);
});

// The disambiguator is the word "exe", not the letters: "execute" must not
// satisfy it, a standalone "exe" must.
test('skill-lint: the build disambiguator matches "exe" but not "execute"', async () => {
  const root = mkdtempSync(join(tmpdir(), 'uak-sl-'));
  skillDir(root, 'exec', 'Use when you execute build steps in Unity projects. Do NOT use for merges.');
  const r = await lint.detect(createContext(root));
  assert.equal(r.status, 'warn');
  assert.match(r.evidence, /exec: "build" is polysemous/);

  const root2 = mkdtempSync(join(tmpdir(), 'uak-sl-'));
  skillDir(root2, 'exe-ok', 'Use when producing a standalone exe build for QA. Do NOT use for merges.');
  const r2 = await lint.detect(createContext(root2));
  assert.equal(r2.status, 'pass', r2.evidence);
});

// The polyseme is the compile-adjacent word and its re-/pre- forms; "buildings"
// is a different word that happens to start with it.
test('skill-lint: "rebuild" needs a disambiguator, "buildings" does not', async () => {
  const root = mkdtempSync(join(tmpdir(), 'uak-sl-'));
  skillDir(root, 'rebuilder', 'Use when a rebuild of the project pipeline is needed. Do NOT use for merges.');
  const r = await lint.detect(createContext(root));
  assert.equal(r.status, 'warn');
  assert.match(r.evidence, /rebuilder: "build" is polysemous/);

  const root2 = mkdtempSync(join(tmpdir(), 'uak-sl-'));
  skillDir(root2, 'level-art', 'Use when placing buildings across a level layout. Do NOT use for code changes.');
  const r2 = await lint.detect(createContext(root2));
  assert.equal(r2.status, 'pass', r2.evidence);
});

// Frontmatter may quote the description — a variant opening `NON-NEGOTIABLE:`
// has to. Every check must read the VALUE a YAML parser delivers, not the
// serialization: the two quote characters otherwise eat the length budget.
test('skill-lint: a quoted description is measured by its value, not its quotes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'uak-sl-'));
  const value = 'Use when auditing Unity shader nodes and material property blocks. Do NOT use for lightmap bakes.'.padEnd(199, 'y');
  assert.equal(value.length, 199);
  skillDir(root, 'quoted', `'${value}'`); // 201 chars on the line, 199 of description
  const r = await lint.detect(createContext(root));
  assert.equal(r.status, 'pass', r.evidence);
});

// Quoting doubles internal apostrophes, which hid `don''t` from the
// negative-trigger regex (and a leading quote hid first-person from the POV check).
test('skill-lint: quoting does not hide a "don\'t" negative trigger', async () => {
  const root = mkdtempSync(join(tmpdir(), 'uak-sl-'));
  skillDir(root, 'apostrophe', "'Use when Unity YAML conflicts appear in a merge. Don''t use for C# source files.'");
  const r = await lint.detect(createContext(root));
  assert.equal(r.status, 'pass', r.evidence);
});
