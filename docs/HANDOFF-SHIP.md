# Handoff: Unity Agent Kit ship train (v0.4.0 → GitHub → CI → npm)

**Written:** 2026-08-12, after v2 shipped (`v0.3.0`, suite 102/102).
**For:** a fresh Claude Code session with zero prior context.
**Your mission:** four bounded chores that turn a finished local kit into a distributed one — a small code wave, the GitHub push, CI, and the npm publish — then the honesty cleanup those unlock. Nothing else. No new features beyond what's specified verbatim below.

Read this file completely before doing anything. Everything below was learned the hard way and is verified.

---

## 1. What this is

**Unity Agent Kit** (`C:\Users\Ryan\unity-agent-kit`, MIT): a kit that makes Unity projects agent-ready. Complete and proven: 12 checks, 5 skills, three doors (CLI, Claude Code plugin, UPM editor window with bundled `Core~`), a v2 file-based epoch signal proven 100/100 on a live editor. Tags `v0.1.0`–`v0.3.0`. Suite **102/102** via `npm test`. A cold-start audit verified all capability claims (`docs/VERIFICATION-2026-08-12.md`). Build history: `docs/BUILD-LEDGER.md`.

What it is NOT yet: on GitHub, on npm, or in CI. The README honestly carries "once published" caveats. This train removes them by making them true.

**OFF LIMITS:** `C:\Users\Ryan\Kintarō` (the user's game repo) is not part of this train. Do not touch it for any reason.

## 2. Hard rules and platform gotchas (do not relearn these)

1. Test ONLY with `npm test` from the repo root. `node --test <dir>` is BROKEN on this machine (Node v24.18.1/Windows); the script's globs + `--test-concurrency=1` are required (real git merges flake in parallel).
2. Controller verifies green at every head yourself. Cheap implementer subagents have repeatedly misreported suite state in this repo. There is NO pre-existing test failure; if you think you see one, re-run from a clean shell.
3. **Freshness gates:** `pretest` fails unless the committed build copies match sources. Any commit touching `packages/core` or `packages/cli` MUST run `npm run build:upm` and stage `upm/Core~` in the same commit. Any commit touching `skills/` must run `npm run build:plugin` and stage `plugin/skills`.
4. **Concurrent-session files:** `git status` may show unstaged modifications to `skills/unity-claude-md/SKILL.md`, `plugin/skills/unity-claude-md/SKILL.md`, and `template/CLAUDE.md`. They belong to the user's other session. NEVER stage or touch them. Stage every commit by explicit path; NEVER `git add -A` or `git add .`.
5. All new files LF, UTF-8, no BOM (root `.gitattributes` enforces).
6. Write-tool gotcha: literal `\uXXXX` escape text in file content can land as raw control bytes. For fixture-like strings, verify bytes or use bash heredocs.
7. Version sync is TEST-ENFORCED: `packages/core/test/version-sync.test.js` pins version.js + 4 manifests + cli dependency + lockfile entries. Bumping means: edit test first (RED), bump all six sources, `npm install --package-lock-only`, `npm run build:upm`, GREEN twice.
8. `rm -rf` is denied by the permission system — clean up with explicit per-file removals.

## 3. Ryan-gates (STOP and ask the user at each; do not improvise past them)

- **G1 (before Step B):** `gh auth status` must show a logged-in GitHub account. If not: ask Ryan to run `gh auth login` (or create the repo manually and give you the remote URL). Also confirm with him: repo owner/name (`<owner>/unity-agent-kit`) and public visibility.
- **G2 (before Step D):** `npm whoami` must succeed. If not: ask Ryan to `npm login` (OTP is his). 
- **G3 (before Step D):** the scoped package `@unity-agent-kit/core` needs the `unity-agent-kit` npm org to exist under Ryan's account (created at npmjs.com — ask him), OR his explicit choice of an alternative (e.g. publishing core under his user scope means renaming the scope across every import — large; recommend the org). Also check `npm view unity-agent-kit` — a 404/E404 means the CLI package name is free; if it is TAKEN, stop and ask.

## 4. The train (in this exact order)

### Step A — the code wave (use superpowers:subagent-driven-development; one implementer task, one review)

Version becomes **0.4.0** (a new CLI verb = a feature). Contents, all verbatim:

**A1. Engine-level detect guard** — a permission-denied file must not kill the doctor.
In `packages/core/src/engine.js`, wrap the detect call in the doctor loop:
```js
  for (const c of checks) {
    if (only && c.id !== only && c.layer !== only) continue;
    let res;
    try { res = await c.detect(ctx); }
    catch (e) { res = { status: 'na', evidence: `detect crashed safely: ${String(e?.message ?? e).slice(0, 120)}` }; }
    const row = { id: c.id, layer: c.layer, title: c.title, status: res.status, evidence: res.evidence, canApply: typeof c.apply === 'function' };
    if (res.detail !== undefined) row.detail = res.detail;
    rows.push(row);
  }
```
Test (append to `packages/core/test/engine.test.js` — it already has `register`, `doctor`, `createContext`, `tmpRepo()` in scope):
```js
test('a throwing detect() degrades to an na row instead of killing the doctor', async () => {
  register({
    id: 't-throws', layer: 'hygiene', title: 't', explain: () => 'x',
    detect: async () => { throw new Error('EACCES: permission denied'); },
  });
  const rows = await doctor(createContext(tmpRepo()), { only: 't-throws' });
  assert.equal(rows[0].status, 'na');
  assert.match(rows[0].evidence, /detect crashed safely: EACCES/);
});
```

**A2. `--wait-ready` verb** — the bounded wait as a one-liner for agents.
In `packages/cli/bin/kit.js`, extend the kanabo import to `import { readEpoch, isFresh, waitReady } from '@unity-agent-kit/core/src/kanabo.js';` and add directly below the `--epoch` branch:
```js
if (flag('--wait-ready')) {
  const r = await waitReady(ctx.root, {
    sinceEpoch: opt('--since-epoch') !== undefined ? Number(opt('--since-epoch')) : -1,
    requireEpochBump: opt('--since-epoch') !== undefined,
    timeoutMs: opt('--timeout-ms') !== undefined ? Number(opt('--timeout-ms')) : 120000,
    pollMs: opt('--poll-ms') !== undefined ? Number(opt('--poll-ms')) : 250,
  });
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
}
```
NOTE root-parsing trap: `kit.js` computes root as the first non-`--` arg not equal to `opt('--only')`. Numeric option VALUES (`--since-epoch 5`) would be mistaken for the root. Fix the root line to exclude all option values:
```js
const OPT_FLAGS = ['--only', '--since-epoch', '--timeout-ms', '--poll-ms'];
const root = args.find((a, i) => !a.startsWith('--') && !OPT_FLAGS.includes(args[i - 1])) ?? process.cwd();
```
(Existing behavior for `--only` is preserved; add a regression assertion if any existing test covered the old expression.)
Test (append to `packages/cli/test/cli.test.js` — `run`, `BIN`, `mkdtempSync`, `writeFileSync`, `mkdirSync` already imported):
```js
test('--wait-ready: ok on a fresh ready signal, no-editor exit 1 when absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'uak-'));
  execFileSync('git', ['init', '-q', dir]);
  const miss = run(['--wait-ready', '--timeout-ms', '400', dir], dir);
  assert.equal(miss.code, 1);
  assert.equal(JSON.parse(miss.out).reason, 'no-editor');
  mkdirSync(join(dir, 'Temp', 'unity-agent-kit'), { recursive: true });
  writeFileSync(join(dir, 'Temp', 'unity-agent-kit', 'epoch.json'),
    JSON.stringify({ schema: 1, pid: 1, sessionId: 'x', epoch: 3, heartbeatMs: Date.now(), state: 'ready', worldRevision: 1, probePresent: false, probeValue: -1 }));
  const hit = run(['--wait-ready', '--timeout-ms', '2000', dir], dir);
  assert.equal(hit.code, 0);
  assert.equal(JSON.parse(hit.out).epoch, 3);
});
```

**A3. Drive-root quoting in C#** — in `upm/Editor/KitDoctor.cs`, change `ProjectRoot()` to:
```csharp
        static string ProjectRoot() => Path.GetDirectoryName(Application.dataPath).TrimEnd('\\');
```
(No node test can cover C#; the reviewer gate carries it. One-line change; do not touch anything else in the file.)

**A4. npm publish prep** (same commit set):
- `packages/core/package.json` gains: `"files": ["src", "assets"]`, `"repository": { "type": "git", "url": "<the GitHub URL once known — placeholder git+https://github.com/OWNER/unity-agent-kit.git, patched in Step B>" }`, `"license": "MIT"`.
- `packages/cli/package.json` gains: `"files": ["bin", "README.md"]`, same `repository` + `"license": "MIT"`.
- Copy the root `README.md` to `packages/cli/README.md` (npm shows the package README; add one first line: `> This is the CLI door of the Unity Agent Kit monorepo — full docs and source at the repository link.`).
- README: add `--wait-ready` to the Door 1 flags list:
```markdown
- `--wait-ready [--since-epoch N] [--timeout-ms M] [--poll-ms P]` — block (bounded!) until the editor signal is fresh+ready; exit 0 on ready, 1 with a JSON reason otherwise
```

**A5. Version 0.4.0** per gotcha #7 (test-first), then `npm run build:upm`, suite green TWICE, commit everything by explicit path, and `git tag v0.4.0`.

Review gate: one task-reviewer pass over the wave diff (spec: exactly A1–A5, nothing more), fix-loop if findings, per the SDD skill.

### Step B — GitHub (after G1)

1. From the repo root: `gh repo create <owner>/unity-agent-kit --public --source . --push` (or add the remote Ryan gives you and `git push -u origin main`).
2. `git push origin v0.1.0 v0.2.0 v0.3.0 v0.4.0`.
3. Patch the placeholders now that the URL is real (one commit): README's git-URL UPM line (`USER` → real owner) and DELETE its "(The git URL works once the repo is published …)" caveat line; the `repository` fields from A4. Push.
4. Releases with short notes distilled from `docs/BUILD-LEDGER.md`:
   - `gh release create v0.1.0 --title "v1.0 — the doctor" --notes "..."`
   - `v0.2.0` ("v1.1 — UPM door + triage audit"), `v0.3.0` ("v2 — the epoch signal, proven 100/100"), `v0.4.0` ("ship polish — --wait-ready, crash-proof doctor").
5. Verify: `gh repo view --web` renders; the UPM git-URL form in the README now points at a real repo.

### Step C — CI (after B)

Create `.github/workflows/test.yml`:
```yaml
name: test
on:
  push: { branches: [main] }
  pull_request:
jobs:
  test:
    runs-on: windows-latest
    strategy:
      matrix: { node: [20, 24] }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "${{ matrix.node }}" }
      - run: npm ci
      - run: npm test
```
Commit (explicit path), push, then `gh run watch` until green. If Windows CI trips on anything (line endings, sh availability — both SHOULD be fine: runners ship Git Bash and `.gitattributes` forces LF), fix forward with the same review discipline and record what it was. A red CI you can't fix in two attempts is a STOP-and-report, not a bypass.

### Step D — npm (after G2 + G3)

1. Publish order matters (cli depends on core): from `packages/core`: `npm publish --access public`; then from `packages/cli`: `npm publish --access public`.
2. END-TO-END VERIFY from a location outside the repo: `cd $TEMP && npx unity-agent-kit@latest <some temp git repo> --json` — rows parse, exit code honest. This is the moment `npx unity-agent-kit` becomes literally true.
3. Honesty cleanup commit: README Door 1 — remove "The published npx form ships with the npm release; until then…" framing and the "Once published to npm:" split (the npx form is now primary; keep the run-from-clone block as the contributor path). Push.
4. Optional, only if everything above is green: update the two artifact sites to drop their "not on npm yet" caveats — publish via the Artifact tool with `url` https://claude.ai/code/artifact/6d6aa021-bfbd-4d99-ac8c-0371ed654b0b (plan site; source `C:\Users\Ryan\Kintarō\docs\research\2026-08-11-unity-agent-kit-plan.html`) and https://claude.ai/code/artifact/5880f641-b082-454a-86ad-4c15505ac7c2 (marketing site; source `...\2026-08-12-unity-agent-kit-site.html`), then commit the HTML sources in Kintarō BY EXPLICIT PATH (this is the one sanctioned Kintarō touch, docs/research only — its working tree carries the user's uncommitted game files; sweep nothing).

## 5. Definition of done

- v0.4.0 tagged; suite 102+/102+ green twice locally AND green in CI on GitHub.
- All four tags released on a public repo under Ryan's account; README placeholders and "once published" caveats gone — every install command in it works as written.
- `npx unity-agent-kit` verified end-to-end from a clean directory.
- `docs/BUILD-LEDGER.md` gains a short ship-train section (what shipped, CI run link, npm versions, any surprises).
- Kintarō untouched except the optional site-source commit in `docs/research/`.
- Anything that blocked: reported to Ryan with exactly what's needed, not worked around.
