# Handoff: Unity Agent Kit v1.1

**Written:** 2026-08-12, at the end of the session that shipped v1.0.
**For:** a fresh Claude Code session with zero prior context.
**Your mission:** plan and build v1.1 using the same process that built v1.0
(superpowers:writing-plans → superpowers:subagent-driven-development), then
update the plan website.

Read this file completely before doing anything. It is the context handoff —
everything below was learned the hard way and is verified, not speculative.

---

## 1. What this project is

**Unity Agent Kit** — a downloadable kit that makes any Unity project
agent-ready in one guided setup. It packages the layer *below* the
agent↔editor adapter (git/repo correctness) and the layer *above* it
(workflow skills), and wraps Unity's own official CLI + free MCP for the
middle rather than competing with it.

- **This repo** (`C:\Users\Ryan\unity-agent-kit`): the kit. MIT. v1.0 is
  complete: tagged `v0.1.0`, 27 commits, **35/35 tests green**.
- **Kintarō** (`C:\Users\Ryan\Kintarō`): the user's Unity 6000.5.5f1 HDRP
  game project. It is the dogfood target and the first consumer. Its
  `docs/superpowers/specs/2026-08-11-unity-agent-kit-design.md` is the
  approved product spec (READ IT — v1.1 scope is defined there, in
  "Shipping order" and both "Amendments" sections). Plans live at
  `docs/superpowers/plans/` in Kintarō by convention.
- **Build ledger for v1.0**: `docs/BUILD-LEDGER.md` in this repo — the full
  task-by-task record including every review finding and adjudication.

**CRITICAL SAFETY FACT:** Kintarō's working tree carries ~26 uncommitted
user game files (scene edits, HDRP settings churn). They are the user's
in-progress work. NEVER stage with `git add -A` in Kintarō, never commit
them, never clean them. v1.0's migration commit (`0029667`) was scoped to
exactly 4 paths for this reason. Also: the permission system denies `rm -rf`
commands — split any cleanup into explicit per-file removals or ask the user.

## 2. Architecture you must not break (v1.0, all verified)

One zero-dependency Node checks engine; thin doors render it.

```
packages/core/src/check.js      validateCheck(), STATUSES=['pass','warn','fail','na']
                                layers: 'hygiene'|'workflow'|'template'|'integration'
packages/core/src/context.js    createContext(projectRoot) → {
                                  root,      // ABSOLUTE (resolve()'d — a dogfood-caught bug; keep it)
                                  platform,  // process.platform
                                  git(...args) → {ok, out, code}  // never throws;
                                }            // strips TRAILING whitespace only — leading spaces are
                                             // load-bearing for `git status --porcelain` parsing
packages/core/src/registry.js   register(check) / checks / getCheck(id)
packages/core/src/checks/index.js  the manifest — every check module imported here, nowhere else
packages/core/src/engine.js     doctor(ctx,{only}) → [{id,layer,title,status,evidence}]
                                applyOne(ctx,id) → {changed, verify|null}   // records audit BEFORE verify
packages/core/src/audit.js      recordApply / loadAudit→{applied:[]} / undoAll→{undone:[]}
                                Audit file: <target>/.unity-agent-kit/applied.json (TARGET repo, never this one)
                                Undo op kinds (exactly three):
                                  {kind:'git-config-unset',   key}                    // exit 5 = already unset, tolerated
                                  {kind:'restore-file',       path, previous|null}   // null → delete on undo
                                  {kind:'git-config-restore', key,  previous|null}   // null → unset; else restore VALUE
                                Config-mutating applies MUST capture prior values and emit git-config-restore.
packages/cli/bin/kit.js         thin wrapper ONLY (parse/render/consent — zero check logic):
                                [root] [--json] [--only <layer|id>] [--fix] [--yes] [--undo]
                                exit 1 iff any 'fail'; --json rows include an `explain` field
                                (machine door must stay a superset of the human door);
                                wizard applies only checks with status==='fail' AND an apply()
skills/                         5 skills (single source; plugin/skills is a build COPY):
                                unity-verify, unity-merge, unity-topology, unity-recipes, unity-claude-md
                                descriptions ≤200 chars, each with "Use when..." AND "Do NOT use..."
plugin/                         .claude-plugin/plugin.json + skills copy via `npm run build:plugin`
template/CLAUDE.md              starter with PERSONALIZE blocks + behavioral guards
packages/core/assets/           unity-yaml-merge.sh (the flagship merge driver; resolves
                                UnityYAMLMerge.exe dynamically by globbing Hub editors, newest
                                first, honors $UNITY_YAML_MERGE; fail-safe exit 1 → UU, never
                                corrupts) + test-merge-driver.sh (5-case suite, honors $UAK_DRIVER)
```

The 8 checks: `merge-driver` (verify() runs the real 5-case suite),
`longpaths`, `worktree-ignore`, `unity-version`, `path-headroom`,
`editor-churn`, `blast-radius` (exports `DENY_RULES`), `unity-mcp`
(exports `_deps={which,configure}` for test injection — tests must NEVER
invoke the real `unity` CLI).

**Global constraints (binding, from the spec):** zero runtime npm deps in
core+cli; ESM; `node:test` only; detect() never mutates; the kit never runs
`git commit` and never uploads anything; every apply() undoable; wrappers
stay dumb; **Windows + Unity 6.x verified only** — everything else returns
`na`, never a guess; LF/UTF-8/no BOM (root `.gitattributes` enforces);
MIT — no code from CC BY-NC (swax), GPL (emeryporter), or unlicensed repos.

## 3. Hard-won platform gotchas (do not relearn these)

1. `node --test <dir>` is BROKEN on this machine (Node v24.18.1, Windows) —
   both slash forms fail. Use globs. The root test script is
   `node --test --test-concurrency=1 packages/core/test/**/*.test.js packages/cli/test/**/*.test.js`.
2. `--test-concurrency=1` is REQUIRED: the merge-driver verify test spawns
   real git merges and flakes under parallel test files.
3. Cheap (haiku) implementer subagents repeatedly hallucinated a
   "pre-existing merge-driver test failure" (4 separate times). It does not
   exist. If a subagent reports it, verify yourself with `npm test` before
   believing anything. Controller-verifies-green-at-every-head is the rule.
4. `git status --porcelain` lines for unstaged changes START WITH A SPACE.
   context.js strips trailing whitespace only — never re-introduce `.trim()`.
5. Use `-c core.quotepath=false` for any git call whose paths you parse
   (Kintarō has a non-ASCII `ō` in its path; it round-trips fine).
6. Editor-churn WARN on Kintarō is CORRECT behavior (user's uncommitted
   scenes) — not a bug. Kintarō also has only ~9 chars of MAX_PATH headroom.
7. `sort -rV` in the merge driver is MSYS/Git-Bash-specific — fine for the
   Windows-verified scope; don't "fix" it to plain sort.
8. Tests that `process.chdir` MUST restore cwd in a `finally`.
9. The published `npx unity-agent-kit` does NOT work yet (not on npm).
   Run from clone: `node packages/cli/bin/kit.js <project>`. The README
   documents this honestly — keep it honest.

## 4. v1.1 scope (from the spec + final-review backlog)

Primary features (spec: Amendments I #3, Amendments II #8–11, Shipping order):

1. **UPM door** — `upm/` package (working name `com.unity-agent-kit.doctor`
   or similar; decide and record): editor-only asmdef, an Editor window
   (`Window > Unity Agent Kit`) that renders the SAME checks by shelling out
   to the bundled Node core (`kit.js --json`, parse rows; `--fix --yes --only <id>`
   per-check apply after a consent click). One code path — the C# side must
   contain ZERO check logic (wrappers-stay-dumb applies to it fully).
   Open question the spec left: require Node on PATH vs bundle — decide,
   document in README, and have the window degrade gracefully (clear
   instructions) when Node is absent.
   *Proof:* a stock Unity project → add package (local path or git URL) →
   window shows all checks → apply → doctor green, no terminal touched.
   Dogfood: install into Kintarō itself.
2. **Transcript failure-audit check** (`audit`, detect-only, layer
   `workflow` or new `audit` — keep it out of the wizard's fix path):
   scans local Claude Code transcript JSONL (`~/.claude/projects/...`) for
   Unity failure signatures: blind sleeps after edits, dead-port retry
   storms, writes without refresh, accepted empty responses, oversized
   console dumps, huge-diff-with-no-measurement, runaway sub-agent spawn
   chains, destructive-command near-misses. Reports which kit rule/skill
   would have prevented each. CONTRACTS: local-only (reads disk, uploads
   nothing — stated in explain()); degrades gracefully when the undocumented
   transcript format changes (never crashes the doctor).
3. **Triage-report output** — ranked, classified findings
   (fix-now / needs-attention / safe-to-ignore / superseded) with confidence
   and clickable file/line links; a per-completed-task tokens-and-retries
   tally in the audit's output; document a "daily sweep" usage pattern.
4. **Skill-description lint** (doctor check): sums resting token cost of all
   installed skill descriptions, flags overlap/overlong, verifies
   firing-condition phrasing with negative triggers.
5. **Orphan/stall cleanup check** (detect-only): orphaned Unity.exe/dotnet
   processes and stale worktree locks left by dead sub-tasks.

Carry-over fixes from the v1.0 final review (small, do them early):
- CRLF edge: `worktree-ignore`'s anchored regex (and editor-churn's `$`) can
  miss a correct line in a CRLF-written .gitignore (`$` sits before `\r`).
  Make the regexes CRLF-tolerant (`\r?$`).
- Persist merge-driver verify results so detect can down-rank a config whose
  proof last FAILED (right now detect regex-matches the config string only —
  doctor can read green while the proof fails on machines without the exe).
- `plugin/skills` is a committed build copy — add a freshness check
  (doctor or npm script) that fails when it drifts from `skills/`.
- Document unity-mcp's undo as best-effort (vendor may write outside
  `.mcp.json`); add a comment in audit.js about undoAll non-atomicity.
- Cosmetics if touching those files anyway: recipes description grammar;
  README already fixed.

## 5. Process to follow

1. Read the spec (`C:\Users\Ryan\Kintarō\docs\superpowers\specs\2026-08-11-unity-agent-kit-design.md`)
   and this repo's `docs/BUILD-LEDGER.md` (skim the adjudications).
2. Invoke **superpowers:writing-plans** → write
   `C:\Users\Ryan\Kintarō\docs\superpowers\plans\<date>-unity-agent-kit-v1.1.md`
   (bite-sized TDD tasks, verbatim code in the plan, interfaces blocks — the
   v1.0 plan in the same folder is the model). Commit it in Kintarō.
3. Execute via **superpowers:subagent-driven-development**: fresh implementer
   per task + task review + scoped re-reviews + ledger + final whole-branch
   review (most capable model). Model selection per that skill; note gotcha
   #3 above when using cheap implementers. Work happens in THIS repo
   (already on `main`, which is this project's working branch — v1.0 was
   built directly on it; continue that unless the user says otherwise).
4. Dogfood: UPM door installed into Kintarō; audit check run against the
   real transcript dir; NEVER commit the user's game files.
5. Tag `v0.2.0`. Update `docs/BUILD-LEDGER.md` with the v1.1 run.
6. **Update the website** (the user asked for this after every milestone):
   - Source of truth: `C:\Users\Ryan\Kintarō\docs\research\2026-08-11-unity-agent-kit-plan.html`
     (synced with the v1.0-shipped state).
   - Edit it (roadmap: mark v1.1 shipped; capability matrix: the two
     "v1.1"-marked doctor rows flip to ✓ today; add UPM door to quick facts),
     then publish with the Artifact tool using
     `url: https://claude.ai/code/artifact/6d6aa021-bfbd-4d99-ac8c-0371ed654b0b`
     (REQUIRED — a new conversation mints a new URL without it), favicon 🧰.
   - Commit the updated HTML back to Kintarō docs/research/.
   - The research-evidence artifact (do not touch) is
     https://claude.ai/code/artifact/8242a508-bd43-4790-b8a8-d74dc116e312.

## 6. State snapshot (2026-08-12)

- Kit repo HEAD: `3e8323e` (docs: archive build ledger); tag `v0.1.0` at
  `6237a96`; suite 35/35; branch `main`.
- Kintarō HEAD: `ffa4555`; migration commit `0029667`; user's ~26 game
  files uncommitted BY DESIGN (theirs). A git-ignored leftover
  `.superpowers/sdd/2026-08-11-unity-agent-kit-v1/` scratch dir may exist
  in Kintarō — harmless; removal needs the user (rm -rf is denied).
- Unity CLI v1.0.0-beta.3 installed at `%LOCALAPPDATA%\Unity\bin\unity.exe`
  (real `unity` on PATH — hence the `_deps` injection rule for tests).
  `com.unity.pipeline` is NOT installed in Kintarō.
- Node v24.18.1; git with Git Bash; UnityYAMLMerge.exe present under
  `C:\Program Files\Unity\Hub\Editor\6000.5.5f1\...`.
- Open product questions (fine to leave open): final package name, npm
  publish, Node-for-UPM decision (must be decided in v1.1).

## 7. Definition of done for v1.1

- All v1.1 features + carry-over fixes implemented, TDD, suite fully green
  (twice) with `--test-concurrency=1`.
- UPM dogfood proof on Kintarō recorded in the ledger.
- Whole-branch final review clean (fix wave + scoped re-review if needed).
- `v0.2.0` tagged; BUILD-LEDGER updated; website updated at the SAME
  artifact URL; user's Kintarō working tree untouched by any commit.
