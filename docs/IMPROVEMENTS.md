# Improvements backlog

A prioritized plan of things that could improve the kit, written 2026-08-12 after
v2 (Kanabō minimal) shipped. Sources: the v1.0/v1.1/v2 build-ledger deferrals,
per-task and whole-branch review findings that were triaged as non-blocking, the
spec items deliberately left out of scope, and product gaps observed at dogfood.
Each item carries where it came from, so none of this is invented work.

Statuses here are proposals — nothing below is committed roadmap until it gets a
plan file of its own.

## Now (small, sharp, provably useful)

1. **Publish to npm + push to GitHub.** The README honestly labels `npx
   unity-agent-kit` and the git-URL UPM install as "once published" — publishing
   is the single highest-leverage unlock (three install paths go from
   clone-only to one-liners). Includes: repo remote, `v0.3.0` release notes from
   the build ledger, npm `files` allowlist so the package ships lean.
   *(Source: v1.0 Task 16 honesty fix; README caveats.)*
2. **Engine-level detect() guard.** `worktree-ignore`, `unity-version`, and
   merge-driver's `routed()` do unguarded `readFileSync` after `existsSync` — a
   permission-denied file crashes the whole doctor. One try/catch in
   `engine.doctor()` turning a throwing detect into
   `{status:'na', evidence:'detect crashed: …'}` makes the doctor unkillable.
   *(Source: v1.1 final review, minor #8.)*
3. **`--wait-ready` CLI verb.** v2 shipped `--epoch` (poll-yourself) and
   `waitReady()` (importable), but an agent in a bash loop still has to write
   the poll. `kit.js <proj> --wait-ready [--since-epoch N] [--timeout-ms M]`
   exposing the bounded waiter's {ok, reason} as exit-code + JSON would make the
   no-blind-sleep pattern a one-liner everywhere.
   *(Source: v2 Task 6 — the recipe currently teaches a manual loop.)*
4. **Drive-root arg quoting in KitDoctor.cs.** A project at `D:\` breaks the
   quoted `ProjectRoot()` argument (`"D:\"` escapes its own closing quote).
   `TrimEnd('\\')` before quoting.
   *(Source: v1.1 final review, minor #5.)*
5. **BOM-tolerant skill-lint.** A UTF-8-BOM'd SKILL.md is mis-reported as
   "missing description" — strip `\uFEFF` before the frontmatter match.
   *(Source: v1.1 Task 9 review minor.)*

### Added by the 2026-08-12 installation paper-test

- **Ship a `.claude-plugin/marketplace.json`.** Today the plugin door is
  `claude --plugin-dir ./plugin` only; a ~10-line marketplace catalog would
  unlock `/plugin marketplace add` + `/plugin install` straight from the repo
  once it's public. Verify the current marketplace schema against Claude Code
  docs before shipping — do not guess it.
- **Undo button in the UPM window.** Window-applied fixes are undoable only
  via the CLI door today (now documented in the README); a consented
  "Undo all kit changes" button calling `kit.js --undo` would keep the
  no-terminal promise end-to-end.

## Next (medium effort, clear payoff)

6. **CI.** The suite is already CI-shaped (temp repos, `--test-concurrency=1`,
   freshness gates, no vendor-CLI calls). A GitHub Actions matrix (Windows
   first, per the support matrix) that runs `npm test` on push turns every
   invariant this project enforces by discipline into one enforced by a robot.
   *(Blocked on: item 1's remote.)*
7. **Surface triage detail in the UPM window.** The audit check's ranked
   findings flow through `--json` `detail`, but `KitDoctorWindow` renders only
   the evidence line. A foldout per audit row listing findings (class,
   confidence, message) would make the window the daily-sweep surface, not just
   the fix surface. C# stays dumb — it renders fields the core already computed.
   *(Source: v1.1 Task 8; the detail contract exists precisely for this.)*
8. **Op journal (Amendment II #12).** Append-before-execute journal (id, epoch,
   world-revision, payload hash) so a crashed session can report the last
   journaled-but-unacknowledged operation and verify-or-retry instead of
   guessing. Deliberately left out of v2-minimal because the kit doesn't own a
   dispatch pipeline; the epoch file's `sessionId`/`epoch` fields are the hooks
   it would build on. Needs a design pass on WHERE ops enter (skill-taught
   convention vs a wrapper script).
   *(Source: spec Amendments II #12, deferred at v2 planning.)*
9. **Proof-run trend artifact.** `kanabo-proof.mjs` prints one JSON report;
   writing it to `docs/proofs/<date>-<unity-version>.json` and asserting the
   wait-median hasn't regressed would catch vendor drift (new Unity versions
   changing reload behavior) the day it lands.
   *(Source: v2 Task 8 run — the numbers exist, they're just not kept.)*
10. **Vendor-drift watch for unity-mcp.** The `unity mcp configure` behavior
    changed under us once already (project `.mcp.json` → user-scope via the
    `claude` CLI). A doctor evidence line that names the CLI version it probed
    (`unity --version`) plus a ledgered re-check whenever that version changes
    would make the next drift a warn, not a dogfood surprise.
    *(Source: v1.1 Task 15 dogfood record.)*

## Later (bigger, or gated)

11. **Per-root orphan precision.** The stale-lock scan is machine-wide by
    design (`tasklist` can't map PID→cwd); an opt-in WMI query
    (`Win32_Process.CommandLine`) could scope Unity processes to worktrees and
    catch a dead worktree's lock while another editor runs. Parked with a
    ruling at v1.1 Task 10 — revisit only if multi-worktree users hit it.
12. **Kanabō beyond minimal — only with a game to measure.** The kill-criteria
    still govern anything past the epoch signal: retry budgets, envelopes,
    worker guards. Phase 0 (ten baselined Kintarō tasks + vendor bake-off)
    remains the gate for every further line of bridge code. The v2-minimal
    proof harness is the measurement tool Phase 0 would reuse.
    *(Source: docs/kanabo/KILL-CRITERIA.md in the Kintarō project, still binding for the un-built remainder.)*
13. **Claude Code plugin marketplace listing** once the plugin door has outside
    users; includes plugin.json metadata polish and screenshots.
14. **Public-repo hygiene:** CONTRIBUTING.md (the zero-dep/verbatim-proof house
    rules), issue templates that ask for `kit --json` output, and a SECURITY
    note (the kit reads transcripts locally — say so loudly).

## Cosmetics ledgered along the way (batch into any passing commit)

- Retry-storm message says "consecutive" though non-bash calls can interleave
  (v1.1 Task 6 minor); `Start-Sleep` regex unanchored by design tradeoff.
- `unity-verify` Tier 2 wait text omits `fresh` while the recipes text includes
  it (v2 Task 6 minor).
- `median()` takes the upper-middle on even N; `waitMs.min/max` serialize as
  `null` on an all-fail run (diagnostic-only, v2 Task 5 minors).
- Kanabo pass evidence lacks a `?? 0` fallback on `worldRevision` (v2 Task 3
  minor).
- The warn-repair CLI test proves the offer but not post-fix `status === pass`
  (v1.1 final re-review note).
- Test temp-dirs are never cleaned (suite-wide convention; OS temp).
