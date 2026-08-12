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
