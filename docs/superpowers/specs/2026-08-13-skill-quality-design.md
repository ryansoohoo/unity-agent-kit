# Skill quality program — design

**Date:** 2026-08-13. **Approved by:** Ryan (design conversation, this date).
**Research basis:** `2026-08-13-skill-quality-research-notes.md` (36 sourced findings; citations below use its section IDs).

## Problem

The kit's five skills are well-formed (skill-lint passes, ~214 resting tokens) but their quality is unmeasured and three concrete defects were found by audit:

1. **Duplication:** the epoch-wait protocol appears near-verbatim in `unity-verify` (Tier 2) and `unity-recipes` (Recipe 1), already drifting apart; scene-ownership appears in both `unity-recipes` (Recipe 5) and `unity-merge`.
2. **Description/body contradiction:** `unity-recipes`' description disclaims "topology decisions" while Recipe 5 is one.
3. **Semantic overlap is invisible to current tooling:** exact duplication would be caught by a shingle check, but polysemy is not — "build" means compilation in `unity-verify`'s domain, yet "build me a Windows exe" (player build) shares the word and no skill owns it, so misfires are likely. (Ryan's example; the research's vocabulary-map finding A8/E8.)

Beyond the defects: nothing measures whether the right skill fires on realistic prompts (trigger accuracy, coexistence — B1/B2/D5), skill bodies carry unvalidated environment contracts that rot silently (vendor CLI syntax, machine-measured timings — E1), and the "Use when…" description form is the weakest measured phrasing (76% activation vs 97% directive; collapses to 37% under competing hook instructions — A6/A7). Ryan's sessions run hooks (superpowers), so the interaction is live.

Explicitly settled by research: **five skills is not too many** (degradation starts ~50 tools — C1); narrow skills are the recommended starting shape (B4); the CLI does not count against the agent surface (C8/F1).

## Workstreams

### W1 — Dedup and moves (content fixes)

- The epoch-wait protocol's canonical home becomes `unity-verify` Tier 2 (it is a verification protocol). Content merged from both copies, keeping the stricter/newer wording where they drifted.
- `unity-recipes` Recipe 1 shrinks to the BAD/GOOD pattern pair (its format identity) plus one pointer line: "Full protocol: unity-verify Tier 2." No duplicated paragraphs remain.
- Recipe 5 (scene-edit ownership) **moves** to `unity-topology` (it is an ownership/parallelism rule). This simultaneously fixes the description/body contradiction in `unity-recipes`. `unity-merge`'s prevention list keeps its one-line form with a pointer to unity-topology for the ownership rule.
- Cross-references use the sibling skill's name explicitly (B5 pattern), never inlined content.

### W2 — Description hardening

- **Polysemy disambiguators now:** `unity-verify` description gains "(compile/typecheck — NOT player/exe builds)" or equivalent; any other polysemous term surfaced by W4's vocabulary table gets the same treatment. Player-build coverage itself is out of scope (backlog: unclaimed territory).
- **Directive variants drafted for all five** descriptions (form: "ALWAYS invoke when … Do not ⟨alternative⟩ directly"), stored as variants alongside the eval sets. W2 only drafts; nothing ships here beyond the polysemy disambiguators — the improvement and adoption happen in W6, gated on held-out data (E3: the gate prevents overfitting, not caution).
- All five skills are in scope including `unity-claude-md` (its concurrent-session wave landed as `da864a3`).

### W3 — Eval sets (per skill)

- `skills/<name>/evals.json`: 8–10 should-trigger + 8–10 near-miss should-NOT-trigger queries. Schema per entry: `{ "query": str, "expect": "<skill-name>"|"none", "note": str }` — one flat list per skill file; "none" marks queries no kit skill should claim.
- Near-misses must share domain keywords with the skill (A5); include the polysemous cases ("make a Windows build", "build the game for Steam" → expect "none").
- **Authorship-diversity rule (anti-overfitting, D4):** at least half the queries per skill must be written in vocabulary/registers other than Ryan's own transcripts — different console habits, different project layouts, junior phrasing, typos, casual speech.
- Excluded from the plugin build (`build-plugin.mjs` filter learns to skip `evals.json`) so the shipped plugin stays lean; the UPM build is unaffected (skills/ is not mirrored there).

### W4 — skill-lint extensions (static, detect-only)

New sub-checks inside the existing `skill-lint` check, each with focused unit tests:

1. **Body near-duplicate:** shingle similarity (k≈8 word shingles, Jaccard ≥ 0.6 between any two paragraphs of different skills) → fail with the two file:line locations. Pins W1 against regression.
2. **Vocabulary table:** term frequency across all descriptions; a content term claimed by ≥2 descriptions is flagged (shadowing risk); a curated polysemy list (starting: "build") requires a disambiguator in any description using the term.
3. **Contract lint:** version strings, CLI flag tokens (`--\w+`), `unity command` invocations, and machine-measured numbers (`~?\d+(\.\d+)?\s*(ms|s|GB|MB)`) in bodies must sit on a line containing the word `measured` (the annotation convention the bodies already use, e.g. "measured 90+ s") or appear in a small allowlist inside the check; unannotated occurrences are findings. Detect-only; the fix is human annotation or removal.
4. **Description form:** first/second-person POV, procedure language (`then`, `step 1`, numbered chains), and "When to use" headings inside bodies (A2/A3/A10) are findings.

Evidence strings name file:line for every finding, matching the kit's style. skill-lint stays `canApply: false`.

### W5 — Behavioral harness + measurement

- `scripts/skill-evals.mjs` (node, repo idiom; roughly 150–250 lines):
  - Builds a temp project dir, installs the five skills into `<tmp>/.claude/skills/` (copy, not symlink — Windows), optionally substituting description variants from `skills/<name>/evals-variants.json`.
  - Runs `claude -p "<query>" --output-format json` per query with cwd = temp project; parses the transcript/output for a Skill invocation and which skill fired. Requires the `claude` CLI logged in (present on this machine); absence → the run reports **indeterminate**, never pass/fail (D8's three-valued lesson).
  - Scoring: exact match on which skill fired; false-positive counts per sibling; a 5×N coexistence matrix (B1: run with ALL skills installed, always). Repetitions: 3 per query (D3). Output: JSON + console table; exit 0 only when all repetitions are determinate, every skill's should-trigger rate is ≥ 90%, and there are zero cross-fires (a should-not query firing any kit skill, or a should query firing the wrong sibling — any cross-fire fails the run).
  - Flags: `--skills <subset>`, `--model <id>` (default: the session's configured default), `--variant <name>`, `--runs N`.
  - **Never wired into CI** (needs auth + spends tokens); documented in the README's contributor section with expected cost per full run (~300 calls).
- **Measurement protocol:** W5 delivers the harness plus the baseline matrix on current descriptions; the improvement loop and adoption decisions are W6's job.
- Harness smoke test (unit): the output parser against canned `claude -p` JSON fixtures — no live-model calls in the suite.

### W6 — Description improvement pass (final)

The wave's closing act, run only after W1–W5 have landed (their outputs are its inputs):

1. For each skill, gather: its baseline eval failures (W5), the W2 directive variant's scores, the W4 vocabulary table (keyword coverage + polysemy hits), and cross-skill terminology consistency (research E8).
2. Run an improvement loop in skill-creator's shape (research D3): propose description edits from the specific failures — form, missing user-vocabulary keywords, sharper negative triggers, disambiguators — re-score on the 60/40 train/held-out split, at most 5 iterations per skill, adopt strictly by held-out score (never train score).
3. Final full-set coexistence run with all five adopted descriptions to confirm no sibling regressed (research B2) — a green solo matrix with a red full-set matrix reverts the offending adoption.
4. Land the final descriptions (skills/ + rebuilt plugin copies in the same commit) with before/after trigger matrices recorded in BUILD-LEDGER.

## Error handling

- Harness: setup failure (no claude CLI, temp-dir failure) → indeterminate with reason, exit 2; a query timeout counts as under-trigger for that repetition, not a crash.
- Lint additions degrade like every check: unreadable file → finding with evidence, never a throw (the engine guard from v0.4.0 backstops).

## Testing

- New lint sub-checks: unit tests with fixture skill sets (duplicated paragraphs, polysemy hits, unmarked contracts) — RED first per repo discipline.
- Harness: parser fixtures only. The live-model path is exercised by running the harness itself, whose results are data, not suite assertions.
- Full suite green at every head; expected count grows with the new lint tests.

## Constraints (inherited, binding)

- `npm test` from repo root is the only runner; suite green twice before any tag.
- Freshness gates: any `skills/` change requires `npm run build:plugin` with `plugin/skills` staged in the same commit; `packages/core` changes (skill-lint lives there) require `npm run build:upm` + `upm/Core~` staged.
- Explicit-path staging only. LF/UTF-8/no BOM. Version bump only if a release is cut from this wave (not required by this spec).

## Out of scope

- A player-build skill or recipe (backlog; this wave only disambiguates the term).
- Drill-style multi-turn scenario evals (revisit if W5 data shows mid-session drift — E4).
- Retrieval-gating of skills (C11; irrelevant at n=5).
- Description-budget monitoring beyond a documented manual `/context` spot-check (C4).

## Definition of done

- W1 landed: no cross-skill near-duplicate paragraphs (W4 check green proves it); recipes/topology contradiction gone.
- skill-lint extended with the four sub-checks, unit-tested, kit's own skills pass (after W1/W2 fixes).
- Five eval sets exist meeting count + authorship-diversity rules; polysemous negatives present.
- Harness runs end-to-end on this machine; baseline coexistence matrix recorded in BUILD-LEDGER.
- W6 improvement loop run for all five skills; final descriptions adopted by held-out score with a clean full-set coexistence confirmation; before/after matrices in BUILD-LEDGER.
- Suite green twice locally; CI green on push; plugin rebuilt in the same commits that touch skills/.
