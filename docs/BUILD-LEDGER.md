# SDD ledger — plan: docs/superpowers/plans/2026-08-11-unity-agent-kit-v1.md

Pre-flight: amended plan before execution (commit in Kintarō) — Task 11 tests scoped to --only hygiene to avoid real vendor CLI calls; Task 17 commit staged by explicit path so the user's uncommitted working tree is never swept.
Task 1: fix round 1/5 pending (2 Important open — test-script scope creep, no-op placeholder test)
Task 1: adjudication — implementer's glob form vindicated by measurement (node --test <dir> fails on Node 24/Windows, both slash forms; glob passes). Plan amended; reviewer finding 1's exact-string requirement superseded by measured reality.
Task 1: complete (commits 8d69f93..23f7ff2, review clean after 1 fix round)
Task 2: fix round 1/5 (1 addressed, 0 open — gitattributes LF enforcement; commits 0d8d0f6..f34b4c1)
Task 2: complete (commits 23f7ff2..f34b4c1, review clean after 1 fix round)
Task 2: minor (deferred): registry register/getCheck have no dedicated test file (brief-scoped; later tasks exercise them)
Task 3: fix round 1/5 (1 addressed, 0 open — unset error surfacing; commits b5da086..bb9ddc3)
Task 3: complete (commits f34b4c1..bb9ddc3, review clean after 1 fix round)
Task 3: minor (deferred): undoAll not atomic on mid-loop throw (audit file keeps done entries); loadAudit reverse-mutation latent trap
Task 4: adjudication — reviewer finding 1 was plan-mandated (verbatim brief code loses pre-existing config values on undo); plan amended with git-config-restore op kind across Tasks 3/4/5. Finding 2 (CLI wiring) resolved by controller: Task 10's planned kit.js already imports checks/index.js. Minors deferred: unused writeFileSync/getCheck imports, posix-path asymmetry in verify().
Task 4: fix round 1/5 (1 addressed, 0 open — git-config-restore undo pattern; commits a15087a..a27ff0e)
Task 4: complete (commits bb9ddc3..a27ff0e, review clean after 1 fix round)
Watch: merge-driver verify suite flaked once during Task 5 run (implementer mislabeled it pre-existing); 2x controller re-runs green at 429cd66. If it recurs: suspect parallel node:test files racing the real-git-merge suite.
Task 5: complete (commits a27ff0e..429cd66, review Approved; report-rigor finding adjudicated — controller verified 2x green, no code defect)
Task 5: minor (deferred, plan-inherited): worktree-ignore apply's substring guard looser than detect's anchored regex — can fail to converge on adversarial .gitignore content
Task 6: complete (commits 429cd66..afc6196, review Approved, no code findings; report's phantom-failure claim noted)
Systemic: flake recurred across two implementer runs -> adjudicated as real parallel-execution flake; plan amended so Task 7 adds --test-concurrency=1 to root test script.
Task 7: fix round 1/5 dispatched — CRITICAL porcelain false-negative (context.js out.trim strips leading space off unstaged status lines; churn check silently passes on dirty ProjectSettings). Root cause in shared context.js (Task 2 infra); fix = trailing-only strip. Plus IMPORTANT quotepath escaping (editor-churn uses -c core.quotepath=false). Two regression tests added. Reviewer reproduced the Critical directly.
Task 7: fix round 1/5 (3 addressed, 0 open — porcelain trailing-only strip, quotepath off, 2 regression tests; commits 7c5b171..74c405c)
Task 7: complete (commits afc6196..74c405c, review clean after 1 fix round). context.js shared-infra hardened. Suite now 20/20 green twice.
Systemic: 4th haiku implementer (Task 8) falsely reported merge-driver 'pre-existing fail'; controller verified 21/21 green + isolated pass. Pattern: haiku implementers misreport suite state on this repo. Mitigation in force: controller independently verifies green at every head before review. Code correctness unaffected.
Task 8: complete (commits 74c405c..13bda5f, review Approved, no Critical/Important code findings)
Task 8: minor (deferred): apply() lacks try/catch around JSON.parse(prev) — unreachable via wizard (fixes 'fail' only; invalid-JSON is 'warn'), guard when Task 11 wires applyOne. Also no repeat-apply idempotency test.
Task 9: fix round 1/5 dispatched — add real applyOne test for unity-mcp (review found dead 'called' flag; apply/throw/undo paths uncovered; Task 11 drives applyOne so cover now). Plan-inherited gap.
Task 9: fix round 1/5 (1 addressed, 0 open — real applyOne apply/undo/throw test; commits 21dcd57..aac2d28)
Task 9: complete (commits 13bda5f..aac2d28, review clean after 1 fix round). All 8 checks done; suite 24/24 green.
Task 10: complete (commits aac2d28..cf08694, review Approved). CLI works end-to-end vs real repo; unity-mcp detects the real installed Unity CLI. Suite 26/26.
Task 10: minor (deferred): --json omits explain() 'why' text (human-only); no committed --only disambiguation test (covered indirectly by Task 11 wizard tests).
Task 11: complete (commits cf08694..962ee0c, review Approved). Live --fix/--undo round-trip verified: applies with evidence, doctor green, undo restores files+config, audit in target repo. Both CLI doors done. Suite 29/29.
Task 11: minor (deferred): add a source comment noting --undo intentionally precedes doctor().
Task 8 minor now relevant: Task 11 wizard fixes 'fail' checks only; blast-radius invalid-JSON is 'warn' so apply's unguarded JSON.parse stays unreachable via wizard. No action needed.
Task 12: complete (commits 962ee0c..3a5a71e, review clean, ZERO findings). unity-verify + unity-merge skills; descriptions 182/167 chars, firing+negative triggers, content technically verified.
Task 13: fix round 1/5 dispatched — unity-recipes description was 208 chars (plan defect, implementer honestly flagged); trimmed to 193 keeping firing+negative trigger. Plan amended.
Task 13: fix round 1/5 (1 addressed — description trim to 193; commits 3a5a71e..1e0dbad)
Task 13: complete (commits 3a5a71e..1e0dbad, review Approved). All 4 workflow skills done.
Task 13: minor (deferred, cosmetic): recipes description slightly ungrammatical post-trim; "perf probe" vs "Perf investigation" heading naming.
Task 14: complete (commits 1e0dbad..a841c01, review clean, ZERO findings). Template + interview-generator skill; cross-file consistency vs deny rules & skills verified. 5 skills total now.
Task 15: complete (commits a841c01..50fb55c, review clean). Plugin door done: plugin.json + build-plugin.mjs; all 5 skills packaged into plugin/skills; build idempotent; 29/29.
Task 15: minor (deferred): committed plugin/skills is generated output — could drift from skills/ if edited without running build:plugin. Consider a CI freshness check post-v1.
Task 16: fix round 1/5 dispatched — README presented npx unity-agent-kit as working today but package unpublished (404); kit's own honesty principle requires the run-from-source path + 'once published' labeling. Implementer had already caught a verify() overclaim and the plugin-dir path independently.
Task 16: fix round 1/5 (1 addressed — run-from-source honesty; commits 50fb55c..ff913f5)
Task 16: complete (commits 50fb55c..ff913f5, review Approved, zero overclaims — every claim source-verified). README done.
Task 16: minor (deferred): evidence section says regression suites live in Kintarō docs/research/ but they're in the kit repo; tiny wording fix for final-review triage.

Task 17: BLOCKED on a real bug the dogfood exposed, then fix-looped.
- BUG: invoking `kit .` (relative root) makes merge-driver install a RELATIVE git config driver path (`sh 'tools/unity-yaml-merge.sh'`), which breaks real merges from other cwds AND makes verify() fail (suite can't find the driver from its temp repos). detect() still PASSes because it only regex-matches the filename — so doctor falsely reads green on a broken config.
- Root cause: createContext(projectRoot) does not absolutize root; '.' propagates into every path.
- FIX: context.js resolve(projectRoot) so root is always absolute. Kintaro restored to exact pre-Task-17 state (user worktree verified identical) before fixing.
Task 17: fix round 1/5 (context.js absolutize; commits ff913f5..be93c76) — re-review CONFIRMED, cwd-leak mitigated, suite 32/32.
Task 17: COMPLETE. Dogfood acceptance PASSED: Kintaro reached doctor-green via kit alone (merge-driver PROVEN 5/5, absolute config). Migration committed (0029667 in Kintaro) scoped to 4 paths; user's 26 game files verified untouched. Kit tagged v0.1.0.
ALL 17 TASKS COMPLETE. Proceeding to whole-branch final review.

FINAL WHOLE-BRANCH REVIEW (Opus): found 2 Important cross-cutting bugs a per-task review couldn't see:
  #1 merge driver hardcoded UnityYAMLMerge.exe to build 6000.5.5f1 -> flagship no-ops on other Unity 6.x patches;
  #2 verify() inherited the same pin -> doctor could read green while proof fails.
Final fix wave (1 dispatch, 7 items incl 5 minors): dynamic Hub-glob resolver, context cwd, --json explain superset, worktree-ignore anchored guard, blast-radius JSON guard, README wording. Commit 6237a96. Scoped re-review: ALL ADDRESSED, no new breakage. Suite 35/35 green twice.
v1.0 COMPLETE. Tag v0.1.0 at 6237a96. 8 checks, 5 skills, 2 CLI doors, plugin, template+generator, README. Dogfood PASSED.
v1.1 backlog: worktree-ignore/editor-churn regex $ anchor mismatches CRLF-terminated .gitignore lines (pre-existing, Windows edge); persist verify result so detect can down-rank a failed proof; UPM door.

---

# SDD ledger — plan: docs/superpowers/plans/2026-08-12-unity-agent-kit-v1.1.md (v1.1 run, 2026-08-12)

Executed same process as v1.0: fresh implementer per task, per-task review, scoped re-reviews, controller-verified suite green at every head, final whole-branch review (most capable model) + one fix wave. 15 tasks, suite 35/35 → 86/86.

Task 1: complete (50035a8..9f73364, clean) — CRLF-tolerant worktree-ignore regex + editor-churn porcelain split; unity-mcp/audit undo caveat docs; recipes grammar. Note: JS multiline $ already treats CR as a terminator, so half the RED didn't fire — fix kept as defense-in-depth.
Task 2: complete (..3dc4ebe, clean) — verify.json persistence (loadVerify/recordVerify); applyOne records outcomes; merge-driver detect down-ranks a failed proof (green means proven, not configured).
Task 3: complete (..bb2e43b, clean) — fstree treesEqual/listFiles + build-plugin --check freshness gate.
Task 4: complete (..e920d25, clean) — doctor rows carry canApply + detail passthrough (json door superset).
Task 5: complete (..7f8707a, 1 fix round) — defensive transcript reader. Adjudication: never-throws contract governs over plan's literal snippet; helpers made null-safe, junk-shape fixtures added; plan amended (Kintarō 762835a).
Task 6: complete (..8b161fd, 1 fix round, opus review) — audit check: new 'audit' layer, signature framework, 4 signatures, ranked triage detail. Fix round: guarded blast-radius dep, throw-proof cmd(), per-session tally guard, weird-session coverage, case-insensitive destructive regexes, deterministic sort, empty-env fallback. Implementer caught a Write-tool escape-literal gotcha (backslash-u escapes in a fixture became raw NUL/SOH control bytes) via byte-level verification; fixed with heredoc. (The controller then hit the same gotcha writing THIS ledger — it is real.)
Task 7: complete (..7cb2d25, clean) — signatures 5-8 (write-without-refresh, accepted-empty, huge-diff-no-measurement, runaway-subagent-chain) + real tokens/retries tally. Reviewer hand-traced run-length scanner boundary cases clean.
Task 8: complete (..beef9c5, clean) — human door renders ranked triage with clickable transcript file:line + session tally; daily-sweep README.
Task 9: complete (..b7a8802, clean) — skill-lint check (resting cost, Use-when/negative triggers, jaccard overlap). Kit's own 5 skills lint clean (dogfood test).
Task 10: complete (..d22d005, 1 fix round) — orphans check (multi-Unity, stale UnityLockfile, locked worktrees, dotnet pileups; _deps injection). Adjudications: machine-wide stale-lock proxy ACCEPTED (tasklist can't map PID to cwd; evidence wording measures exactly what's measured); multi-worktree porcelain parse got coverage.
Task 11: complete (..43fe280, 1 fix round + pre-review concern, opus review) — UPM scaffold com.unity-agent-kit.doctor with committed Core~ bundle (bare specifiers resolve via internal node_modules; zero source rewriting). EXECUTION-FOUND PLAN DEFECT: unanchored node_modules/ gitignore silently dropped the 25-file bundle from commits — anchored to /node_modules/. Fix round: hermetic E2E (bundle staged OUTSIDE the repo; workspace-junction blind spot closed), treesEqual fail-loud on missing trees, no rmSync of the committed bundle during tests. Reviewer proved bundle resolution hermetically before approving.
Task 12: complete (..a7ceb8c, 1 fix round, opus review) — zero-logic C# door (KitDoctor runner, IMGUI window, batch proof). Fix round (plan defects): concurrent pipe drain + load-bearing timeout (the sequential ReadToEnd pair was deadlock-prone with an unreachable timeout), deferred IMGUI fix flow + ExitGUI (mid-layout row swap desyncs control counts), delayCall first refresh, exit-2 coverage, Win32Exception-gated PATH advice.
Task 13: complete (..ecb0d2a, 1 fix round) — README door 3 + new checks + verify persistence + MAX_PATH note. Fix round: once-published honesty caveat (the implementer's report had falsely claimed it was present — caught by the reviewer), Eleven-checks count.
Task 14: complete (..0fbe073, clean) — 0.2.0 across core/cli/plugin/upm + rebuilt bundle + version-sync test.
Task 15 DOGFOOD (kit ..724065b + metas; Kintarō 6da4b5f):
- orphans check flagged Kintarō's real stale UnityLockfile live (porcelain-parse path) before the batch run; read clean after it (lock released) — the check's first real-world catch.
- Batch proof: Unity 6000.5.5f1 -batchmode compiled the package and ran all 11 checks through the C# door (spawn, JSON parse, rows logged); exit contract honest.
- VENDOR DRIFT FOUND: unity mcp configure now delegates to `claude mcp add --scope user` (writes ~/.claude.json, not project .mcp.json), and the claude CLI is absent on desktop-app installs — spawn ENOENT; the kit surfaced the vendor error with the project untouched (failed-apply contract held). Fix 2ce7f37: detect learns user-scope registration + the claude-missing fail carries install instructions (spec rule: a missing dependency is a detect failure with instructions, never a mid-apply crash). The implementer also root-caused a Windows nested-execFileSync stderr leak corrupting --json output (whichClaude stdio fix).
- unity-mcp fail-with-instructions is the honest terminal state on THIS machine (no claude CLI) — batch exit 1 is machine-honest, not a kit defect.
- Audit vs 3 REAL transcript sessions: 15 findings — 2 needs-attention (a 66k-char console dump; 46 sub-agent dispatches in one session, i.e. the v1.0 SDD run itself), 13 superseded (v1.0-session destructive commands, now covered by the installed deny rules). Ranked render, clickable transcript links, 412-tool-call / 1.56M-output-token tally. The Amendments-IV pipeline validated end-to-end on real data.
- Kintarō commit 6da4b5f scoped to Packages/manifest.json + packages-lock.json; the user's game files untouched; .mcp.json left absent (user's call).
FINAL WHOLE-BRANCH REVIEW (most capable model): verdict With fixes — one cross-task seam defect (the failed-proof warn state had no working repair path: detect promised --fix while all three doors offered fail-only rows), package-lock.json missed by the version sync, the queued which() stderr leak, two doc one-liners. Every other ledger deferral was triaged and BLESSED (including the parked stale-lock ruling). FIX WAVE 7ba797a: fix eligibility widened to warn+apply (wizard apply wrapped in try/catch, which guards blast-radius's now-reachable throwing apply; C# gate kept in parity), lockfile at 0.2.0 + test assertions, stderr hygiene on all four vendor probes, docs. Scoped re-review: ALL ADDRESSED (Core~ parity byte-verified), no new Critical/Important breakage.
v1.1 COMPLETE. Tag v0.2.0. 11 checks, 3 doors (CLI, plugin, UPM window), triage audit validated on real transcripts, dogfood PASSED (door proof + real-data audit; unity-mcp honestly blocked by machine state, with instructions). Suite 86/86 twice.
Concurrent-session note: skills/unity-claude-md/SKILL.md (+plugin copy) and template/CLAUDE.md carried uncommitted edits from another session throughout this run — deliberately untouched and uncommitted by every dispatch.

# SDD ledger — plan: docs/superpowers/plans/2026-08-12-unity-agent-kit-v2.md (v2 run, 2026-08-12)

Kanabō minimal (epoch signal + reload survival), built under the kill-criteria scope ceiling with the Phase-0 gate explicitly superseded by the user's 2026-08-12 instruction. 8 tasks; suite 86/86 → 102/102.

Task 1: complete (b84ff4e..f5e8df4, clean) — kanabo.js: epochPath/readEpoch/isFresh/requestRefresh + waitReady (bounded poll, never throws, never past deadline; reviewer traced timeout arithmetic + timing tolerances).
Task 2: complete (..88a50e9, clean) — --epoch machine door (JSON report, exit 0 always).
Task 3: complete (..f136f51, clean) — kanabo doctor row (integration, pass/na only).
Task 4: complete (..d080437, 1 fix round; opus reviewer COMPILED the C# against real 6000.5.5f1 assemblies, 0 errors) — KanaboEpoch.cs [InitializeOnLoad]: per-reload epoch (SessionState), 0.5s heartbeat, ready/compiling/reloading state, worldRevision, probe reflection, refresh.request verb. Fix round: import-worker guard (workers run InitializeOnLoad and would stomp the file with BACKWARDS epochs), isCompiling||isUpdating seed+busy, 5s grace latch through Unity's compile-queue gap (Refresh() returns before isCompiling goes true), committed meta w/ unique guid, cached pid, guarded ctor (TypeInitializationException cascade).
Task 5: complete (..b25a303, 1 fix round) — proof harness. Fix round (reviewer verified empirically): process.exit inside try bypassed the finally that kills the spawned editor → bootFailure restructure; spawn-error guard + existsSync pre-flight.
Task 6: complete (..7410b2d, clean) — skills teach the real signal (kit --epoch / epoch-bump-after-edit / worldRevision for asset-only refreshes / refresh.request; never a bare sleep); descriptions byte-unchanged.
Task 7: complete (..7a41ef7, clean) — README Kanabō section + 0.3.0 across all six version sources + lockfile + bundle.
Task 8 PROOF RUN (2026-08-12, controller-led):
- Scratch project: blank 6000.5.5f1 -createProject in the session scratchpad (never Kintarō; kill-criteria line honored).
- Smoke 3/3 clean, then FULL RUN: **100/100 iterations, falseSuccesses 0, staleReads 0, timeouts 0; waitMs min 1774 / median 2272 / max 2306** — headless -batchmode -nographics editor, EditorApplication.update confirmed ticking (heartbeat live), refresh.request verb driving imports unfocused, epoch bumping once per reload, probe const verified live post-reload every iteration.
- The spec's acceptance bar ("100-iteration edit-compile-verify loop, zero false successes, zero stale-epoch reads") is MET, measured. Contrast: the ecosystem's stateful bridges cope with this window via reconnect loops and up-to-20s blind waits; the file signal rode through it at a 2.27s median with state visible the whole way.
- Harness killed its own editor (verified: no Unity.exe after exit; orphans check clean).
Paper-test docs commit 25c9144 (installation pass) rode along before the final review.
FINAL WHOLE-BRANCH REVIEW (most capable model): With fixes — three docs-drift Importants (check count, foreign-trigger epoch-bump honesty, compile-error cliff teaching) + two minors (ASCII evidence across the C# pipe, --epoch verdict shadowing). Fix wave f70a33e; scoped re-review: ALL ADDRESSED, parity byte-verified. All deferrals BLESSED. Suite 102/102 twice.
v2 COMPLETE. Tag v0.3.0. 12 checks, the epoch signal proven 100/100 on a live editor, skills teach the honest contract.

# Ship train (docs/HANDOFF-SHIP.md run, 2026-08-12)

Same discipline: implementer subagent per task, task review, scoped re-reviews, controller-verified green at every head. Suite 102/102 → 105/105.

SHIPPED — v0.4.0 (tag at 0c87419, one review + one fix round):
- `--wait-ready` verb (bounded wait as a one-liner for agents) + engine-level detect guard (a throwing detect() degrades to an honest na row) + drive-root quoting in KitDoctor.cs + npm publish metadata.
- Review caught a defect in the handoff's own verbatim A2 block: bare Number() on --timeout-ms/--poll-ms/--since-epoch turns a typo into a NaN hot-loop, contradicting the "bounded!" contract. Ryan authorized the deviation; num() helper validates all three, exit 2 naming the flag. RED evidence reproduced the hang in the act (child still hot-looping when the 5s exec timeout killed it).

SHIPPED — GitHub: ryansoohoo/unity-agent-kit PUBLIC, main + all four tags pushed, four releases (v0.4.0 = Latest), placeholders patched (6c48d45), README's git-URL UPM install now real.

SHIPPED — CI: .github/workflows/test.yml, windows-latest, Node 20+24 matrix. GREEN: https://github.com/ryansoohoo/unity-agent-kit/actions/runs/31641887644 — both jobs. Two measured Windows-runner surprises, each fixed forward under review:
1. Node 20's test runner does not glob-expand --test positionals (Node 21+ feature; cmd.exe/pwsh don't expand either) → literal `**` pattern, exit 1. Fix 2f32a55: scripts/run-tests.mjs enumerates the 24 test files explicitly (coverage identity vs the old glob PROVEN by set comparison), keeps --test-concurrency=1. Directory args remain forbidden (measured broken on Node 24/Windows, v1.0 ledger).
2. GitHub runners have no Unity → UnityYAMLMerge absent → driver honestly exits 1 → all 5 verify cases UU → failed proof recorded → detect warns. Product behavior correct; two tests assumed Unity. Fix 075dcf6: dual-contract tests branch on real tool availability (helper mirrors the driver's search incl. no-fallback-on-bad-override) — with Unity assert the 5/5 pass path, without assert the honest-degradation path (previously pinned by no test). Proven locally in both directions via UNITY_YAML_MERGE / UNITY_HUB_EDITOR_ROOT overrides at nonexistent paths.

NOT SHIPPED — npm (Ryan's call at gate G2, 2026-08-12): machine not npm-authed; publish + npx end-to-end verify + README npm-caveat cleanup deferred to a future session. Prereqs recorded: `npm login`; create the `unity-agent-kit` org on npmjs.com (Ryan chose org over user-scope rename); CLI name `unity-agent-kit` verified free (E404, 2026-08-12). Publish order: core before cli (exact-pin dependency). README's "once published" npx framing intentionally retained — it is still true.

Known minors deferred (triage when convenient): --wait-ready exit 2 undocumented in README flag bullet; num() accepts negative values (bounded either way); OPT_FLAGS is a hand-maintained registry (comment the invariant); core package publishes with no README (empty npm page) and cli README references files outside its tarball (LICENSE/NOTICE/test paths); run-tests.mjs could reuse fstree.listFiles(); engines ">=20" vs readdirSync-recursive's 20.1.0 floor (inert: workflow resolves latest 20.x, roots flat); merge-driver test helper duplicates the driver's discovery in JS (drift → loud red, never silent pass); unity-yaml-merge.sh resolves UnityYAMLMerge before the .meta text-merge branch, so .meta merges fail without Unity though they don't need the tool (product call).

# Skill quality wave (2026-08-13) — baseline measurement

Plan: docs/superpowers/specs/2026-08-13-skill-quality-design.md. Matrix: docs/superpowers/specs/2026-08-13-skill-eval-baseline.json (all 300 records, each carrying its own cost, terminal reason and stdout tail).

WHAT THIS MEASURES — the definition is baked into every number below and must travel with them: whether the right skill fires as the model's FIRST action. maxTurns is 1, so a query that routes on turn 2 scores identically to one that never routes at all. Note also that --allowedTools is an auto-approve list, NOT a restriction: the model reached for Bash/Glob/Read freely and permission_denials came back empty; it simply is not scored on anything after turn 1. This is arguably the sharpest available definition of trigger quality — a skill that fires only after the model has already started guessing has not done its job — but it is a floor, not the whole picture.

Harness: `node scripts/skill-evals.mjs --runs 3`. 100 queries x 3 runs = 300 calls, 2705s (45 min), **$32.73 actual** (mean $0.109/call, max $0.152; the run self-reports spend as of e9e8e97). claudeVersion 2.1.228, effectiveModel claude-opus-5[1m], runs 3, maxTurns 1, settingSources project.

**indeterminate: 0 of 300.** Every call landed a determinate verdict. (289 terminated max_turns, 11 completed — under a 1-turn cap both are normal, and turn exhaustion is determinate by design because the routing decision is made before the budget runs out.)

PER-SKILL, keyed by the EXPECTED skill — not by the eval set the query came from. Each bucket aggregates that skill's positives across all five sets, so every set's near-miss and polysemy queries land in the bucket of whatever should have fired:

| bucket (expected) | hit | miss | rate |
|---|---|---|---|
| none | 72 | 0 | 100% |
| unity-merge | 38 | 7 | 84.4% |
| unity-topology | 38 | 7 | 84.4% |
| unity-recipes | 40 | 8 | 83.3% |
| unity-verify | 27 | 21 | 56.3% |
| unity-claude-md | 10 | 32 | 23.8% |
| **overall** | **225** | **75** | **75.0%** |

`none` at 72/72 is the headline defensive result: across 24 distinct polysemy and unclaimed-territory queries, three runs each, the kit never once fired a skill it should not have. There are no false positives to fix.

MISS ANATOMY — the misses are overwhelmingly SILENCE, not misrouting. Of 75 misses, **68 fired nothing at all** and only 7 fired something wrong:

| bucket | silent | wrong |
|---|---|---|
| unity-claude-md | 32 | 0 |
| unity-verify | 16 | 5 |
| unity-merge | 7 | 0 |
| unity-recipes | 7 | 1 |
| unity-topology | 6 | 1 |

The descriptions are not losing arguments to each other; they are failing to raise their hand. That points Task 8 at trigger surface, not at disambiguation.

CROSS-FIRES: **7 run-instances across 4 distinct queries** — the count is run-instances, not distinct queries, so a query that cross-fires on all three runs counts three times. Every one is kit-vs-kit; **no ambient skill won a single query in 300 calls**, which is the isolation working.

- 3x expect=unity-verify, fired=unity-recipes — "after the refresh, how do i confirm the new type is attachable"
- 2x expect=unity-verify, fired=unity-recipes — "unity went back to ready but my change still isnt there, did the compile fail" [CONTESTED, see below]
- 1x expect=unity-topology, fired=unity-topology+unity-recipes — "two agents both want to trigger a refresh at the same time, who gets the..."
- 1x expect=unity-recipes, fired=unity-merge — "after resolving, whats the right way to make unity reimport the file"

Note the direction: 5 of the 7 are unity-recipes poaching a unity-verify query, both on post-refresh "is my change really there" phrasings. That boundary is the one real disambiguation defect in the set.

CONTESTED PAIR — tagged in-file, reported separately because a miss here indicts the two descriptions, not the router:

- skills/unity-verify/evals.json:23 "how long should I wait after saving a script before assuming Unity compiled it" (expects unity-recipes): **3/3 hit**. The adjudication holds under measurement.
- skills/unity-recipes/evals.json:21 "unity went back to ready but my change still isnt there, did the compile fail" (expects unity-verify): **1/3 hit** — fired unity-recipes twice, unity-verify once. Genuinely contested rather than simply wrong, and it supplies 2 of the 7 cross-fires. The compile-wait / did-it-land boundary is unresolved on the description surface and Task 8 should settle it in one direction or the other.

WHERE THE TWO WEAK BUCKETS FAIL — both patterns are crisp enough to act on:

- **unity-claude-md (23.8%)** splits cleanly on verb. Creation phrasings fire ("set up a CLAUDE.md" 3/3, "generate the agent instructions file" 3/3, "what should even go in a unity claude.md" 3/3); every modification phrasing is silent 0/3 ("add our one-owner-per-scene rule to the project's AGENTS.md", "trim our CLAUDE.md", "write these bad and good patterns into our CLAUDE.md", "document the footguns that burned us last sprint", "put the never-commit-conflict-markers rule into our CLAUDE.md"). The description covers authoring a new instructions file and not editing an existing one.
- **unity-verify (56.3%)** is silent on symptom-shaped and read-back positives ("check whether my new ScriptableObject type is attachable" 0/3, "i added a new MonoBehaviour but it wont show up in the Add Component menu" 0/3, "i tweaked the gravity value in code, can you read back what the editor actually has" 0/3) while scoring 3/3 on every explicitly compile-flavored ask. Symptoms stated as complaints do not reach it.

CAVEAT — one query is excluded from trigger-quality conclusions: "we're about to demo, double check nothing under Assets/_Project/Scripts is broken" (expects unity-verify) scored 0/3, but the harness's stub Unity project creates Assets/Scripts, not Assets/_Project/Scripts, so that query's premise is false in the eval environment and the silence is not attributable to the description. Its raw outcome is recorded here and in the matrix; excluding it, unity-verify is **27/45 = 60.0%**. The other two path-naming queries (PlayerController.cs, Boss.prefab) are covered by the stub shape.

HARNESS FIXES THIS RUN — the first live smoke returned 10 of 20 records indeterminate and was NOT used as a baseline; the run above is on a fixed harness (99b2bd6, e9e8e97, 38c60bb):

- Turn exhaustion is determinate. --max-turns is a budget we set, not a fault, and the router's choice is already in the stream when it runs out. The old code mapped every non-zero exit to indeterminate, discarding real answers — one captured record had fired=["superpowers:verification-before-completion"] sitting behind a verdict of indeterminate — and discarding them unevenly: queries that route then investigate exhausted the budget, queries that route then answer did not, so the loss fell hardest on the strongest positives.
- The temp project was inheriting user-level plugins: 38 skills and 1 plugin visible, with superpowers skills winning kit queries. --setting-sources project brings it to 24 skills and 0 plugins — the kit's 5 plus the CLI's own built-ins, which no flag removes short of disabling skills outright. The universe is now pinned to claudeVersion instead of moving with whatever is installed on the machine. It is NOT "the kit's 5 alone": built-in verify and debug skills are in the pool, so 0 ambient wins in 300 calls is a measured result against real competition, not an absence of it.
- The temp project gained a minimal Unity shape (PlayerController.cs, OutdoorsScene.unity, Boss.prefab, ProjectVersion.txt, git init). Against an empty dir the queries' premises are false and a model that looks before routing correctly answers "there is nothing to verify" — scoring as a trigger miss while actually measuring the scratch dir. Verified in the act before the shape existed.
- Records carry cost, terminal_reason and a stdout tail; meta carries maxTurns, settingSources, effectiveModel and spendUsd. The CLI reports its failures as JSON on stdout, so during the auth outage earlier in this wave every record's stderr was empty and the results file preserved no cause at all.

Session note: the auth outage at the start of this task was real — `claude -p` returned exit 1 "Not logged in - Please run /login" on both shell paths at $0 cost, the run was blocked rather than attempted, and Ryan restored login before any measurement proceeded.
