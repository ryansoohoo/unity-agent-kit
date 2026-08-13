# Skill Quality Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the audited skill defects (duplication, contradiction, polysemy), extend skill-lint to keep them fixed, and make trigger quality measured — ending with a data-gated description improvement pass.

**Architecture:** Content fixes land first (the dogfood lint test pins the kit's own skills green at every head), then detect-only lint sub-checks with fixture TDD, then eval sets + a node harness that drives `claude -p` headless and scores which skill fired, then a live baseline, then the W6 improvement loop that adopts descriptions by held-out score.

**Tech Stack:** Node ≥20 ESM (no `fs.globSync` — v22+; CI runs Node 20), `node:test`, the repo's existing check/registry pattern, the `claude` CLI (harness only, never CI).

**Spec:** `docs/superpowers/specs/2026-08-13-skill-quality-design.md` (+ research notes beside it, cited as A1–F6).

## Global Constraints

- Test ONLY with `npm test` from repo root (`node --test` direct is broken on this machine; the runner script + `--test-concurrency=1` are required). Suite green at every commit.
- Freshness gates: any commit touching `skills/` runs `npm run build:plugin` and stages `plugin/skills` in the same commit; any commit touching `packages/core` runs `npm run build:upm` and stages `upm/Core~` in the same commit.
- Stage by explicit path only; NEVER `git add -A` or `git add .`.
- All new files LF, UTF-8, no BOM. Match sibling file style.
- skill-lint stays detect-only (`canApply: false` — no apply key). All new lint code must be Node-20-compatible.
- Skill descriptions must stay ≤200 chars and keep "Use when…" + a negative trigger (existing lint enforces).
- The harness (`scripts/skill-evals.mjs`) is NEVER wired into CI or `npm test` — it needs a logged-in `claude` CLI and spends real tokens.
- Do not create tags; no version bump in this wave.

---

### Task 1: Content fixes — dedup, moves, disambiguators, `--wait-ready` teaching

**Files:**
- Modify: `skills/unity-verify/SKILL.md`
- Modify: `skills/unity-recipes/SKILL.md`
- Modify: `skills/unity-topology/SKILL.md`
- Modify: `skills/unity-merge/SKILL.md`
- Regenerate: `plugin/skills/**` (via `npm run build:plugin`)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: skill bodies with zero cross-file near-duplicate paragraphs and `measured`-annotated machine numbers — Task 2's dedup check and Task 4's contract check are written against exactly this content. Descriptions below are the exact strings Task 5's eval sets target.

Whole-file targeted edits. Every changed region is given verbatim; do not restyle untouched text.

- [ ] **Step 1: `unity-verify/SKILL.md` — description + annotated tier headings + canonical Tier 2**

Replace the frontmatter `description:` line with exactly:

```
description: Use when verifying Unity C# changes compile or behave - picks the cheapest of three tiers. Do NOT use for merge conflicts (unity-merge), agent placement (unity-topology), or player/exe builds.
```

Replace the two tier headings to carry the `measured` annotation (Task 4's contract lint requires machine numbers to sit on a line containing "measured"):

```
## Tier 0 — eval (~300 ms measured, no reload)
```
```
## Tier 1 — headless typecheck (~0.6 s measured, no editor)
```

Replace the entire `## Tier 2` section (heading through the end of the caveat paragraph, i.e. everything before `## Never`) with:

```
## Tier 2 — real compile + domain reload (~2.2 s+ measured, serialized)
Needed only when: a new type must become attachable, an asmdef changed, or
scene/asset mutation follows. This is the canonical wait protocol — other
skills point here.
1. Trigger explicitly (`unity command recompile`). An UNFOCUSED editor never
   auto-imports — measured 90+ seconds of nothing. Never write-and-wait. With
   the editor unfocused or headless, writing `Temp/unity-agent-kit/refresh.request`
   (any content) also forces an import.
2. DISCARD the trigger call's response. The reload kills the connection carrying
   it; a killed request can return a well-formed EMPTY 200 (silent false success).
3. Wait on the epoch signal, never on a clock. One-liner:
   `kit --wait-ready --since-epoch <pre-edit epoch> --timeout-ms 120000`
   (exit 0 = fresh+ready with the epoch bumped; exit 1 = a JSON reason).
   Or poll `kit --epoch` (or read `Temp/unity-agent-kit/epoch.json`) on a
   quarter-second loop until `fresh && state == "ready"` AND the epoch has
   bumped past its pre-edit value — not `ready` alone: a poll started right
   after the trigger can land inside the editor's half-second scan cadence
   and read the old snapshot. After an asset-only refresh, watch
   `worldRevision` advance instead — it bumps every import batch, C# or not,
   while `epoch` only bumps on a domain reload. Hard deadline always (the
   120-second default): on timeout, say so and stop — a hung wait reported
   honestly beats a sleep that lies.
   Absent signal file → the editor isn't running the kit's UPM package; fall
   back to `recompile_status` polling, NEVER a bare sleep.
4. Retry on wall-clock budget, never on error codes: dead local ports TIME OUT
   on Windows (SYN dropped), they do not refuse.

If the state passed through "compiling" but returned to "ready" WITHOUT an
epoch bump, the compile almost certainly FAILED — stop waiting and read the
console/Editor.log for errors instead of running out the deadline. Caveat: a
bump proves a reload happened after your capture, not that it contains YOUR
edit — trustworthy only when you are the sole import trigger; with a human
also using the editor, verify content (eval a probe) or wait for a second
bump / a worldRevision advance.
```

- [ ] **Step 2: `unity-recipes/SKILL.md` — description, shrunken Recipe 1, Recipe 5 removed**

Replace the frontmatter `description:` line with exactly:

```
description: Use when doing common Unity agent operations (compile-wait, console read, refresh, perf probe); each recipe pairs bad and good patterns. Do NOT use for scene ownership (unity-topology) or merges (unity-merge).
```

Replace the entire `## 1. Compile wait` section (heading through the "One honest caveat" paragraph inclusive) with:

```
## 1. Compile wait
BAD:  edit Foo.cs → `sleep 5` → assume compiled. (Unfocused editors never
      auto-import; measured 90+ s of nothing. Sleeps waste ~12 s per loop.)
GOOD: one bounded call that blocks until the editor is provably ready:
    node <kit>/packages/cli/bin/kit.js . --wait-ready --since-epoch <N>
      (exit 0 = fresh+ready with the epoch bumped past N; exit 1 = a JSON
      reason). Capture <N> from `kit --epoch` BEFORE your edit. Asset-only
      refreshes bump `worldRevision`, not `epoch` — poll `kit --epoch` for
      that. Full protocol (trigger, discard-response, wait, retry, failure
      tells, no-signal fallback): unity-verify Tier 2.
```

Delete the entire `## 5. Scene edit ownership` section (heading and both lines). Recipes 2–4 keep their numbers; do not renumber.

- [ ] **Step 3: `unity-topology/SKILL.md` — description + ownership section + annotations**

Replace the frontmatter `description:` line with exactly:

```
description: Use when planning parallel agents, worktrees, a second Unity editor, or scene/prefab edit ownership. Do NOT use for verifying code (unity-verify) or merge conflicts (unity-merge).
```

In the intro paragraph, replace the two sentences carrying numbers with:

```
A second editor requires a second directory — a git worktree — and costs
~2.5 GB + ~103 s cold init (measured). A worktree with NO editor costs
~nothing and verifies in ~0.6 s (measured) via dotnet build.
```

Append after the `## The split` section (before `## Bounded dispatch`):

```
## Scene/prefab ownership (parallel waves)
BAD:  two parallel tasks both "just tweak" OutdoorsScene.unity.
GOOD: one owner per scene/prefab per wave; everyone else reads. Additive work
      (new files) parallelizes freely — shared mutable YAML does not.
```

- [ ] **Step 4: `unity-merge/SKILL.md` — pointer instead of duplicate**

Replace the prevention-rules bullet `- Additive work merges; shared-scene edits do not. One owner per scene/prefab per wave of parallel work.` with:

```
- Additive work merges; shared-scene edits do not (ownership rules: unity-topology).
```

- [ ] **Step 5: Rebuild plugin copies and verify freshness + suite**

Run: `npm run build:plugin` then `npm test` (repo root).
Expected: `plugin/skills refreshed from skills/`; suite 105/105, `pretest` freshness green. The dogfood lint test must still pass (descriptions stay ≤200 chars with both trigger clauses — if `skill-lint` warns, shorten the offending description without losing the disambiguator).

- [ ] **Step 6: Verify no duplicate paragraphs remain (manual, pinned by Task 2)**

Run: `grep -c "scan cadence" skills/unity-verify/SKILL.md skills/unity-recipes/SKILL.md` — expected 1 and 0. `grep -c "one owner per scene" skills/unity-recipes/SKILL.md skills/unity-topology/SKILL.md` — expected 0 and 1.

- [ ] **Step 7: Commit**

```bash
git add skills/unity-verify/SKILL.md skills/unity-recipes/SKILL.md skills/unity-topology/SKILL.md skills/unity-merge/SKILL.md plugin/skills
git commit -m "fix(skills): one canonical epoch protocol, ownership moves to topology, build-polysemy disambiguator, --wait-ready taught"
```

---

### Task 2: skill-lint — body collection + cross-skill near-duplicate sub-check

**Files:**
- Modify: `packages/core/src/checks/skill-lint.js`
- Test: `packages/core/test/skill-lint.test.js` (append)
- Regenerate: `upm/Core~` (via `npm run build:upm`)

**Interfaces:**
- Consumes: Task 1's deduplicated skill content (the dogfood test runs against it).
- Produces: `collectSkills` entries gain a `body` field (string, text after frontmatter); a `shingleSet(text)` and `paraDupes(skills)` helper Tasks 3–4 sit beside (same file, same evidence style: `flags.push(...)` strings).

- [ ] **Step 1: Write the failing tests (append to `packages/core/test/skill-lint.test.js`)**

The existing `skillDir` helper only writes a stub body — extend it with an optional body argument (keep the default so existing tests stand):

```js
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
  skillDirB(root, 'solo-b', 'Use when doing B-work in pipelines. Do NOT use for A-work.', '# b\n\nA completely different paragraph about pipelines that shares no phrasing with the other skill at all beyond common words.');
  const r = await lint.detect(createContext(root));
  assert.equal(r.status, 'pass', r.evidence);
});
```

- [ ] **Step 2: Run to verify RED**

Run: `npm test`
Expected: the first new test FAILS (`r.evidence` has no `near-duplicate paragraph`; status is `pass`). The second may already pass — that is fine; the RED evidence is the first.

- [ ] **Step 3: Implement in `packages/core/src/checks/skill-lint.js`**

Extend `collectSkills` — replace the `out.push` line and the two lines above it with:

```js
        const raw = readFileSync(p, 'utf8');
        const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        const desc = fm?.[1].match(/^description:\s*(.+?)\s*$/m)?.[1] ?? null;
        const body = fm ? raw.slice(fm[0].length) : raw;
        out.push({ name, path: p, desc, body });
```

Add below the `jaccard` helper:

```js
// Paragraph-level duplication across skills: k-word shingles, Jaccard on the
// shingle sets. Catches copy-paste drift the description-level check cannot.
const SHINGLE_K = 8;
const paras = (body) => body.split(/\r?\n\s*\r?\n/).map(x => x.trim()).filter(x => x.length >= 120);
const shingleSet = (text) => {
  const words = text.toLowerCase().match(/[a-z0-9-]+/g) ?? [];
  const out = new Set();
  for (let i = 0; i + SHINGLE_K <= words.length; i++) out.add(words.slice(i, i + SHINGLE_K).join(' '));
  return out;
};
function paraDupes(skills) {
  const flags = [];
  for (let i = 0; i < skills.length; i++) for (let j = i + 1; j < skills.length; j++) {
    for (const pa of paras(skills[i].body ?? '')) for (const pb of paras(skills[j].body ?? '')) {
      const sim = jaccard(shingleSet(pa), shingleSet(pb));
      if (sim >= 0.6) {
        flags.push(`${skills[i].name} and ${skills[j].name}: near-duplicate paragraph (${Math.round(sim * 100)}% — "${pa.slice(0, 40)}…") — keep one canonical home and cross-reference`);
      }
    }
  }
  return flags;
}
```

In `detect`, after the existing pairwise description loop, add:

```js
    flags.push(...paraDupes(withDesc));
```

- [ ] **Step 4: Run to verify GREEN**

Run: `npm test`
Expected: all green including both new tests AND the dogfood test (Task 1 removed the real duplicates; if dogfood warns here, the duplication fix regressed — fix content, not the threshold).

- [ ] **Step 5: Rebuild Core~ and commit**

```bash
npm run build:upm
git add packages/core/src/checks/skill-lint.js packages/core/test/skill-lint.test.js upm/Core~
git commit -m "feat(skill-lint): cross-skill near-duplicate paragraph detection (8-word shingles)"
```

---

### Task 3: skill-lint — vocabulary shadowing + polysemy sub-check

**Files:**
- Modify: `packages/core/src/checks/skill-lint.js`
- Test: `packages/core/test/skill-lint.test.js` (append)
- Regenerate: `upm/Core~`

**Interfaces:**
- Consumes: Task 2's extended `collectSkills` (`desc` field) and evidence style.
- Produces: `POLYSEMES` and `SHADOW_ALLOW` exported-by-convention constants (module-local `const`, upper-snake) that Task 8's description edits must satisfy.

- [ ] **Step 1: Write the failing tests (append)**

```js
test('skill-lint: a content term claimed by two positive clauses is flagged as shadowing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'uak-sl-'));
  skillDir(root, 'shadow-a', 'Use when profiling shader compilation output. Do NOT use for gameplay work.');
  skillDir(root, 'shadow-b', 'Use when editing shader graphs visually. Do NOT use for profiling.');
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
```

- [ ] **Step 2: Run to verify RED** — `npm test`; the three new tests fail (no such evidence strings yet).

- [ ] **Step 3: Implement**

Add below `paraDupes`:

```js
// Vocabulary discipline across sibling descriptions. Shadowing: one content
// term claimed by two skills' POSITIVE clauses (before the negative trigger)
// leaves the router a coin-flip. Polysemy: terms with two Unity meanings must
// carry a disambiguator wherever they appear.
const STOP = new Set(['use', 'when', 'the', 'a', 'an', 'or', 'and', 'for', 'in', 'of', 'to', 'with', 'not', 'do', 'unity', 'agent', 'agents', 'skill', 'skills', 'this', 'each', 'its', 'into', 'via']);
const SHADOW_ALLOW = new Set(['scene', 'prefab']); // adjudicated: merge=conflict-time, topology=planning-time
const POLYSEMES = [
  { term: 'build', re: /player|exe|compil/i, meanings: 'player build vs compilation' },
];
function vocabFlags(skills) {
  const flags = [];
  const positive = (d) => d.split(/\bdo not\b|\bdon['’]t\b/i)[0];
  const claims = new Map();
  for (const s of skills) {
    const seen = new Set();
    for (const w of positive(s.desc).toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? []) {
      if (STOP.has(w) || SHADOW_ALLOW.has(w) || seen.has(w)) continue;
      seen.add(w);
      if (!claims.has(w)) claims.set(w, []);
      claims.get(w).push(s.name);
    }
    for (const p of POLYSEMES) {
      if (new RegExp(`\\b${p.term}`, 'i').test(s.desc) && !p.re.test(s.desc)) {
        flags.push(`${s.name}: "${p.term}" is polysemous (${p.meanings}) — add a disambiguator`);
      }
    }
  }
  for (const [w, names] of claims) {
    if (names.length >= 2) flags.push(`"${w}" claimed by ${names.join(' and ')} — positive clauses must not share content terms`);
  }
  return flags;
}
```

In `detect`, add after the `paraDupes` line: `flags.push(...vocabFlags(withDesc));`

- [ ] **Step 4: Run to verify GREEN** — `npm test`; all green including dogfood (Task 1's descriptions were written against these rules; if dogfood flags a shared term, resolve by rewording the offending positive clause or, if genuinely adjudicated-disjoint, adding it to `SHADOW_ALLOW` with a comment saying why).

- [ ] **Step 5: Rebuild + commit**

```bash
npm run build:upm
git add packages/core/src/checks/skill-lint.js packages/core/test/skill-lint.test.js upm/Core~
git commit -m "feat(skill-lint): vocabulary shadowing + polysemy disambiguator checks"
```

---

### Task 4: skill-lint — environment-contract + description-form sub-checks

**Files:**
- Modify: `packages/core/src/checks/skill-lint.js`
- Test: `packages/core/test/skill-lint.test.js` (append)
- Regenerate: `upm/Core~`

**Interfaces:**
- Consumes: `collectSkills` body field (Task 2).
- Produces: `CONTRACT_ALLOW` constant listing the kit-owned CLI flags and adjudicated vendor tokens; Task 1's `measured` annotations are what keep the dogfood green.

- [ ] **Step 1: Write the failing tests (append)**

```js
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
```

- [ ] **Step 2: Run to verify RED** — `npm test`; the new assertions fail.

- [ ] **Step 3: Implement**

Add below `vocabFlags`:

```js
// Environment contracts rot silently (research E1): machine-measured numbers
// must say so on the line; CLI flags must be kit-owned or adjudicated vendor
// tokens (re-verify vendor tokens against the Unity CLI on editor upgrades).
const CONTRACT_ALLOW = new Set([
  '--wait-ready', '--since-epoch', '--timeout-ms', '--poll-ms', '--epoch',
  '--only', '--fix', '--undo', '--json',            // kit-owned (version-locked to this repo)
  '--fallback',                                     // vendor: UnityYAMLMerge, proven by the merge-driver suite
]);
function contractFlags(skills) {
  const flags = [];
  for (const s of skills) {
    for (const line of (s.body ?? '').split(/\r?\n/)) {
      if (/\bmeasured\b/i.test(line)) continue;
      const num = line.match(/~?\d+(?:\.\d+)?\s*(?:ms|s|GB|MB)\b/);
      if (num) flags.push(`${s.name}: unannotated measurement "${num[0].trim()}" — add "measured" to the line or remove the number`);
      for (const f of line.match(/--[a-z][\w-]+/g) ?? []) {
        if (!CONTRACT_ALLOW.has(f)) flags.push(`${s.name}: unallowlisted flag "${f}" — kit flag? add to CONTRACT_ALLOW; vendor? adjudicate + comment`);
      }
    }
  }
  return flags;
}
function formFlags(skills) {
  const flags = [];
  for (const s of skills) {
    if (/(^|[\s"”(])(I|I'll|you|we)\b/i.test(s.desc)) flags.push(`${s.name}: first/second-person description — write third person (discovery degrades otherwise)`);
    if (/\bstep \d|\bfirst,|\bthen\b.*\bthen\b/i.test(s.desc)) flags.push(`${s.name}: procedure language in description — describe triggers, not workflow`);
    if (/^##\s+When (to|not to) use/mi.test(s.body ?? '')) flags.push(`${s.name}: "When to use" belongs in the description — bodies load only after routing`);
  }
  return flags;
}
```

In `detect`, add after the `vocabFlags` line:

```js
    flags.push(...contractFlags(withDesc), ...formFlags(withDesc));
```

- [ ] **Step 4: Run to verify GREEN** — `npm test`. The dogfood test is the sharp edge: every machine number in the five real bodies must now sit on a `measured` line (Task 1 placed them) and every flag mentioned must be in `CONTRACT_ALLOW`. If dogfood flags something Task 1 missed, fix the skill body (annotate or remove), rebuild plugin in the same commit — never widen the check to pass.

- [ ] **Step 5: Rebuild + commit** (if a skill body changed in Step 4, also `npm run build:plugin` and stage `plugin/skills` here)

```bash
npm run build:upm
git add packages/core/src/checks/skill-lint.js packages/core/test/skill-lint.test.js upm/Core~
git commit -m "feat(skill-lint): environment-contract and description-form checks"
```

---

### Task 5: Eval sets, directive variants, plugin-build exclusion

**Files:**
- Create: `skills/unity-verify/evals.json`, `skills/unity-merge/evals.json`, `skills/unity-recipes/evals.json`, `skills/unity-topology/evals.json`, `skills/unity-claude-md/evals.json`
- Create: `skills/unity-verify/evals-variants.json` (+ one per skill, same shape)
- Modify: `scripts/build-plugin.mjs`
- Regenerate: `plugin/skills`

**Interfaces:**
- Consumes: Task 1's final descriptions (queries are written against the shipped routing surface).
- Produces: the eval-set schema Task 6's harness reads: `{ "skill": "<name>", "queries": [ { "query": str, "expect": "<skill-name>"|"none", "note": str } ] }`. Variants file shape: `{ "directive": "<full replacement description>" }`.

- [ ] **Step 1: Modify `scripts/build-plugin.mjs` to exclude eval files from the shipped plugin**

Replace the whole file with:

```js
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { treesEqual } from './fstree.mjs';

// evals.json / evals-variants.json are harness inputs, not agent-facing
// content — the shipped plugin stays lean without them.
const filter = (src) => !/evals(-variants)?\.json$/.test(src);

if (process.argv.includes('--check')) {
  if (!treesEqual('skills', 'plugin/skills', filter)) {
    console.error('plugin/skills is out of date with skills/ — run: npm run build:plugin');
    process.exit(1);
  }
  console.log('plugin/skills fresh');
} else {
  rmSync('plugin/skills', { recursive: true, force: true });
  mkdirSync('plugin/skills', { recursive: true });
  cpSync('skills', 'plugin/skills', { recursive: true, filter });
  console.log('plugin/skills refreshed from skills/');
}
```

- [ ] **Step 2: Author the five eval sets**

Counts per skill: 8–10 `expect: "<own name>"` queries and 8–10 near-miss negatives (`expect` = a sibling or `"none"`). Rules (spec W3): near-misses share domain keywords; include the polysemy cases; ≥half of all queries per skill in vocabulary/registers other than Ryan's (junior phrasing, different console habits, typos, casual speech). `note` says what the query probes. Exemplars to copy the shape from (author the rest to the same standard — the task reviewer gates count + diversity):

```json
{
  "skill": "unity-verify",
  "queries": [
    { "query": "i changed PlayerController.cs, how do i know it actually compiled", "expect": "unity-verify", "note": "core positive, casual register" },
    { "query": "check whether my new ScriptableObject type is attachable in the editor", "expect": "unity-verify", "note": "tier-2 positive" },
    { "query": "verify the refactor didn't break anything before I push", "expect": "unity-verify", "note": "positive without Unity vocabulary" },
    { "query": "git says both of us touched Boss.prefab and now it's UU", "expect": "unity-merge", "note": "near-miss: verification vocabulary absent, conflict present" },
    { "query": "make a windows build of the game for the playtest", "expect": "none", "note": "polysemy: player build is unclaimed territory" },
    { "query": "can I run two editors so the second one verifies while I work", "expect": "unity-topology", "note": "near-miss: verify keyword, placement question" }
  ]
}
```

- [ ] **Step 3: Author the five variants files** — directive form, one full example to match (others follow its construction, preserving each skill's disambiguators and sibling references):

```json
{
  "directive": "ALWAYS invoke for any verification that a Unity C# change compiles or behaves — it picks the cheapest of three tiers. Do not hand-roll compile waits or sleeps. Not for merge conflicts (unity-merge), agent placement (unity-topology), or player/exe builds."
}
```

- [ ] **Step 4: Verify exclusion + suite**

Run: `npm run build:plugin && npm test`
Expected: `plugin/skills/` contains NO `evals*.json` (`ls plugin/skills/unity-verify/` shows only `SKILL.md`), freshness gate green, suite green.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-plugin.mjs skills/unity-verify/evals.json skills/unity-merge/evals.json skills/unity-recipes/evals.json skills/unity-topology/evals.json skills/unity-claude-md/evals.json skills/unity-verify/evals-variants.json skills/unity-merge/evals-variants.json skills/unity-recipes/evals-variants.json skills/unity-topology/evals-variants.json skills/unity-claude-md/evals-variants.json plugin/skills
git commit -m "feat(evals): per-skill trigger eval sets + directive variants; plugin build excludes them"
```

---

### Task 6: The behavioral harness

**Files:**
- Create: `scripts/skill-evals.mjs`
- Test: `packages/core/test/skill-evals-parser.test.js`
- Modify: `README.md` (contributor section addition)

**Interfaces:**
- Consumes: Task 5's `evals.json` / `evals-variants.json` schemas.
- Produces: `parseSkillInvocations(stdoutText) -> string[]` and `scoreRuns(records) -> {perSkill, crossFires, indeterminate}` exported from `scripts/skill-evals.mjs`; results JSON shape `{ meta: {model, runs, variant, startedAt}, records: [{skill, query, expect, fired, verdict}] }` consumed by Tasks 7–8.

- [ ] **Step 1: Write the failing parser test (`packages/core/test/skill-evals-parser.test.js`)**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSkillInvocations, scoreRuns } from '../../../scripts/skill-evals.mjs';

const LINE = (name) => JSON.stringify({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: name } }] },
});

test('parser: extracts Skill invocations from stream-json lines, ignores noise', () => {
  const out = ['{"type":"system","subtype":"init"}', LINE('unity-verify'), 'not json at all', '{"type":"result","result":"done"}'].join('\n');
  assert.deepEqual(parseSkillInvocations(out), ['unity-verify']);
});

test('parser: no Skill tool_use means empty list', () => {
  const out = '{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}';
  assert.deepEqual(parseSkillInvocations(out), []);
});

test('scoring: exact-match verdicts and cross-fire accounting', () => {
  const records = [
    { skill: 'unity-verify', expect: 'unity-verify', fired: ['unity-verify'], verdict: null },
    { skill: 'unity-verify', expect: 'none', fired: ['unity-merge'], verdict: null },
    { skill: 'unity-verify', expect: 'unity-verify', fired: [], verdict: null },
  ];
  const s = scoreRuns(records);
  assert.equal(s.perSkill['unity-verify'].hit, 1);
  assert.equal(s.perSkill['unity-verify'].miss, 1);
  assert.equal(s.crossFires.length, 1);
});
```

- [ ] **Step 2: Run to verify RED** — `npm test`; fails with module-not-found for `scripts/skill-evals.mjs`.

- [ ] **Step 3: Implement `scripts/skill-evals.mjs`**

```js
// Trigger-quality harness: runs each eval query through `claude -p` headless in
// a temp project carrying the five skills, and scores WHICH skill fired.
// Requires a logged-in `claude` CLI; spends real tokens. Never wired into CI.
//   node scripts/skill-evals.mjs [--skills a,b] [--model id] [--variant name] [--runs N] [--out path]
// Exit: 0 = all determinate, every should-trigger rate >= 0.9, zero cross-fires;
//       1 = thresholds missed; 2 = indeterminate (setup/CLI failure).
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export function parseSkillInvocations(stdoutText) {
  const fired = [];
  for (const line of stdoutText.split(/\r?\n/)) {
    let j; try { j = JSON.parse(line); } catch { continue; }
    for (const block of j?.message?.content ?? []) {
      if (block?.type === 'tool_use' && block?.name === 'Skill' && block?.input?.skill) fired.push(block.input.skill);
    }
  }
  return fired;
}

export function scoreRuns(records) {
  const perSkill = {}; const crossFires = []; let indeterminate = 0;
  for (const r of records) {
    if (r.verdict === 'indeterminate') { indeterminate++; continue; }
    const bucket = (perSkill[r.skill] ??= { hit: 0, miss: 0 });
    const firedRight = r.expect !== 'none' && r.fired.includes(r.expect);
    const firedWrong = r.fired.filter(f => f !== r.expect);
    if (r.expect === 'none' ? r.fired.length === 0 : (firedRight && firedWrong.length === 0)) bucket.hit++;
    else bucket.miss++;
    if (firedWrong.length) crossFires.push({ query: r.query, expect: r.expect, fired: r.fired });
  }
  return { perSkill, crossFires, indeterminate };
}

function arg(name, dflt) { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : dflt; }

function buildTempProject(skillNames, variant) {
  const proj = mkdtempSync(join(tmpdir(), 'uak-evals-'));
  for (const name of skillNames) {
    const src = join('skills', name); const dst = join(proj, '.claude', 'skills', name);
    mkdirSync(dst, { recursive: true });
    let md = readFileSync(join(src, 'SKILL.md'), 'utf8');
    if (variant) {
      const vp = join(src, 'evals-variants.json');
      if (existsSync(vp)) {
        const v = JSON.parse(readFileSync(vp, 'utf8'))[variant];
        if (v) md = md.replace(/^description:.*$/m, `description: ${v}`);
      }
    }
    writeFileSync(join(dst, 'SKILL.md'), md);
  }
  return proj;
}

async function main() {
  const allSkills = readdirSync('skills').filter(n => existsSync(join('skills', n, 'evals.json')));
  const skills = (arg('--skills', '') || allSkills.join(',')).split(',').filter(Boolean);
  const model = arg('--model', null); const variant = arg('--variant', null);
  const runs = Number(arg('--runs', '3'));
  const probe = spawnSync('claude', ['--version'], { encoding: 'utf8', shell: true });
  if (probe.status !== 0) { console.error('indeterminate: claude CLI unavailable'); process.exit(2); }
  const proj = buildTempProject(allSkills, variant); // coexistence: ALL skills always installed
  const records = [];
  for (const skill of skills) {
    const set = JSON.parse(readFileSync(join('skills', skill, 'evals.json'), 'utf8'));
    for (const q of set.queries) for (let r = 0; r < runs; r++) {
      const args = ['-p', '--output-format', 'stream-json', '--verbose', '--max-turns', '3', '--allowedTools', 'Skill'];
      if (model) args.push('--model', model);
      const res = spawnSync('claude', args, { cwd: proj, input: q.query, encoding: 'utf8', shell: true, timeout: 120000 });
      const verdict = (res.error || res.status === null) ? 'indeterminate' : null;
      records.push({ skill, query: q.query, expect: q.expect, fired: verdict ? [] : parseSkillInvocations(res.stdout ?? ''), verdict });
      console.log(`${skill} | ${verdict ?? 'ok'} | expect=${q.expect} fired=${records.at(-1).fired.join('+') || '-'} | ${q.query.slice(0, 50)}`);
    }
  }
  const score = scoreRuns(records);
  const out = arg('--out', join('.superpowers', `skill-evals-${variant ?? 'baseline'}.json`));
  writeFileSync(out, JSON.stringify({ meta: { model, runs, variant, startedAt: new Date().toISOString() }, records, score }, null, 2));
  console.log(JSON.stringify(score.perSkill, null, 2));
  console.log(`cross-fires: ${score.crossFires.length}, indeterminate: ${score.indeterminate}, results: ${out}`);
  rmSync(proj, { recursive: true, force: true });
  if (score.indeterminate) process.exit(2);
  const ok = Object.values(score.perSkill).every(b => b.hit / (b.hit + b.miss) >= 0.9) && score.crossFires.length === 0;
  process.exit(ok ? 0 : 1);
}
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('skill-evals.mjs')) await main();
```

- [ ] **Step 4: Run to verify GREEN** — `npm test`; the three parser/scoring tests pass (main() does not run under import — the guard checks argv).

- [ ] **Step 5: README contributor addition** — append to the development/contributor section:

```markdown
### Skill trigger evals (maintainers)

`node scripts/skill-evals.mjs` measures which skill fires for ~90 realistic
queries (all five skills installed — coexistence, not isolation). Needs a
logged-in `claude` CLI and spends real tokens (~300 headless calls per full
run at `--runs 3`); never wire it into CI. `--skills`, `--model`, `--runs`,
and `--variant <name>` (description variants from `evals-variants.json`)
subset a run. While here, spot-check `/context` in a real session to confirm
all five descriptions survive Claude Code's cumulative description budget.
```

- [ ] **Step 6: Commit**

```bash
git add scripts/skill-evals.mjs packages/core/test/skill-evals-parser.test.js README.md
git commit -m "feat(evals): headless trigger harness — coexistence scoring, variant support"
```

---

### Task 7: Baseline run

**Files:**
- Create: `docs/superpowers/specs/2026-08-13-skill-eval-baseline.json` (copied harness output)
- Modify: `docs/BUILD-LEDGER.md` (append)

**Interfaces:**
- Consumes: Task 6's harness; Task 5's eval sets.
- Produces: the baseline matrix Task 8 improves against.

- [ ] **Step 1: Smoke** — `node scripts/skill-evals.mjs --skills unity-verify --runs 1`. Expected: per-query lines print, results JSON written. If every record is `indeterminate` or `fired` is always empty against obviously-positive queries, the stream-json shape has drifted: fix `parseSkillInvocations` against one real captured output, update the parser-test fixtures to the real shape, re-run `npm test`, and note the shape in the fix commit.
- [ ] **Step 2: Full baseline** — `node scripts/skill-evals.mjs --runs 3`. Copy the results file to `docs/superpowers/specs/2026-08-13-skill-eval-baseline.json`.
- [ ] **Step 3: Ledger** — append to `docs/BUILD-LEDGER.md` under a `# Skill quality wave (2026-08-13)` heading: per-skill hit/miss, cross-fire list, indeterminate count, model + runs used.
- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-08-13-skill-eval-baseline.json docs/BUILD-LEDGER.md
git commit -m "docs: skill-eval baseline matrix (pre-improvement)"
```

---

### Task 8: W6 — description improvement loop and adoption

**Files:**
- Modify: `skills/*/SKILL.md` frontmatter descriptions (only where a variant wins), `skills/*/evals-variants.json` (iteration drafts)
- Regenerate: `plugin/skills`
- Modify: `docs/BUILD-LEDGER.md` (append before/after)

**Interfaces:**
- Consumes: baseline matrix (Task 7), harness `--variant` mode (Task 6), lint constraints (Tasks 2–4 — adopted descriptions must keep the dogfood test green).
- Produces: final shipped descriptions.

- [ ] **Step 1: Split** — for each skill, split its queries 60/40 train/held-out (deterministic: sort queries by text, every 3rd and 5th of each 5-block to held-out; record the split in the ledger entry).
- [ ] **Step 2: Loop per skill (max 5 iterations)** — evaluate current description and the `directive` variant on the TRAIN split (`--skills <skill> --runs 3 --variant directive` vs baseline records); from the specific failures (which queries missed, which cross-fired), write the next variant into `evals-variants.json` under `"iter2"`, `"iter3"`… keeping ≤200 chars, the disambiguators, and third-person form; re-run; stop when train stops improving or at 5.
- [ ] **Step 3: Adopt by held-out** — score the best candidate and the original on the HELD-OUT split only; adopt the winner (ties keep the original). Edit the skill's `description:` line if a variant won.
- [ ] **Step 4: Full-set coexistence confirmation** — `node scripts/skill-evals.mjs --runs 3` with all adoptions in place. Any skill whose held-out rate dropped vs baseline, or any new cross-fire, reverts that adoption (research B2).
- [ ] **Step 5: Lint + suite** — `npm run build:plugin && npm test`. Dogfood must pass with the adopted descriptions (length, clauses, vocabulary, polysemy).
- [ ] **Step 6: Ledger** — append before/after per-skill matrices, which descriptions changed and why (or why kept), and the held-out scores that decided each.
- [ ] **Step 7: Commit**

```bash
git add skills/unity-verify/SKILL.md skills/unity-merge/SKILL.md skills/unity-recipes/SKILL.md skills/unity-topology/SKILL.md skills/unity-claude-md/SKILL.md skills/unity-verify/evals-variants.json skills/unity-merge/evals-variants.json skills/unity-recipes/evals-variants.json skills/unity-topology/evals-variants.json skills/unity-claude-md/evals-variants.json plugin/skills docs/BUILD-LEDGER.md
git commit -m "feat(skills): descriptions adopted by held-out trigger data (W6)"
```

---

## Completion

After Task 8: full `npm test` green twice, push, CI green, and the spec's Definition of done walked line-by-line in the final report. No tag.
