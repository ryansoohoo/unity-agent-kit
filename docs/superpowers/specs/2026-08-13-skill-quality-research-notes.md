# Agent Skill Quality — Research Findings

Compiled 2026-08-13 for auditing a Unity-focused kit: 5 Claude Code skills (descriptions in
"Use when X. Do NOT use for Y" form), a CLI that agents shell out to, and a file-based
editor-state signal.

**Source-type tags:** `[OFFICIAL]` Anthropic docs/blog/repos · `[RESEARCH]` peer-reviewed or
arXiv preprint · `[COMMUNITY]` third-party practitioner work, single-author experiments,
OSS project conventions.

**Headline for this kit:** the published degradation research on tool/skill *count* does not
bite until roughly 50+ entries. At 5 skills, count is almost certainly not the problem.
Every high-relevance finding below points at **description discrimination** (overlap,
near-miss boundaries) and **resting context cost**, not at pruning features. See §C.

---

## §A — Trigger and description design (highest relevance)

### A1. The description is the *only* thing that decides triggering; it must state both what the skill does and when to use it
`[OFFICIAL]` https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
> "The `description` is what Claude matches your request against when determining whether to
> trigger the Skill, so it must say both what the Skill does and when to use it."

Only `name` + `description` are resident at startup (~100 tokens/skill). Nothing in the body
influences whether the skill fires.

**Mechanical check:** assert every `description` contains a what-clause AND a when-clause
(regex for `/\b(use when|use this|trigger|whenever)\b/i`). Fail CI if a description is only a
capability summary.

---

### A2. All "when to use" information belongs in the description, never in the body
`[OFFICIAL]` https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md

A "When to use this skill" section inside SKILL.md is dead weight — it is only read *after*
the routing decision has already been made.

**Mechanical check:** grep skill bodies for `## When to use` / `## When not to use` headings
and flag them for promotion into frontmatter.

---

### A3. Write descriptions in third person; mixed POV measurably hurts discovery
`[OFFICIAL]` https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
> "**Always write in third person**. The description is injected into the system prompt, and
> inconsistent point-of-view can cause discovery problems."
Good: "Processes Excel files…". Avoid: "I can help you…", "You can use this to…".

**Mechanical check:** regex descriptions for `^(I |I'll|You can|We )` and first/second-person
pronouns; fail on match.

---

### A4. Negative triggers ("Do NOT use for Y") are validated by Anthropic's own shipped skills
`[OFFICIAL]` https://github.com/anthropics/skills/blob/main/skills/xlsx/SKILL.md
The public `xlsx` skill's description ends with a verbatim exclusion clause:
> "Do NOT trigger when the primary deliverable is a Word document, HTML report, standalone
> Python script, database pipeline, or Google Sheets API integration, even if tabular data is
> involved."
The `docx` skill uses the same construction. **Note the asymmetry:** the written best-practices
doc never *prescribes* negative triggers — it is a pattern Anthropic demonstrates in practice
rather than documents. This kit's "Do NOT use for Y" convention is therefore well-founded but
un-blessed by prose guidance; the prose route to the same goal is A5.

**Mechanical check:** for each skill, assert the exclusion clause names *sibling skills' domains
by keyword*, not generic non-goals. A "Do NOT use for" that excludes something no sibling skill
handles is decoration, not disambiguation.

---

### A5. The documented way to sharpen boundaries is near-miss *negative eval queries*, not longer prose
`[OFFICIAL]` https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md
skill-creator's eval design asks for **8–10 should-trigger and 8–10 should-not-trigger queries
per skill**, and explicitly says negatives should be **near-misses that share keywords with the
skill's domain**, not obviously-irrelevant content. This "trains descriptions to distinguish from
adjacent domains rather than relying on explicit exclusions."

**Mechanical check:** require an `evals.json`/`eval_set.json` per skill with ≥8 negatives, at
least half of which contain a keyword that also appears in that skill's description.

---

### A6. Claude systematically *under*-triggers; descriptions should be assertive
`[OFFICIAL]` https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md
> "Claude has a tendency to 'undertrigger' skills — to not use them when they'd be useful"
Recommended remedy: phrasing like "Make sure to use this skill whenever the user mentions
[key terms], even if they don't explicitly ask."

**Mechanical check:** trigger-rate eval (A5 harness). If a skill's should-trigger rate is below
~90% across 3 repetitions, the description is too passive, not the model's fault.

---

### A7. Empirically, directive phrasing beats the canonical "Use when…" by ~21 points
`[COMMUNITY]` https://medium.com/@ivan.seleznov1/why-claude-code-skills-dont-activate-and-how-to-fix-it-86f679409af1
650 automated trials, 3×4 factorial (3 description variants × 4 environment conditions,
3 skills, 18 queries, N=3 per cell), ground truth from parsed session logs (Skill tool call
required; reading SKILL.md manually counted as a failure):

| Description style | Mean activation |
|---|---|
| Directive — "ALWAYS invoke … Do not [alternative] directly" | **97.2%** |
| Expanded — keyword-rich | 91.7% |
| Passive — "Use when …" | 76.1% |

Passive descriptions collapsed to **37%** when a hook injected competing instructions.

**Caveat:** single author, 3 skills, one CLI version — treat as directional. But it converges
with A6 (official), which is why it is worth acting on. **Directly relevant to this kit:** the
"Use when X" convention is the *weakest* of the three measured forms in isolation, and the
"Do NOT use for Y" half is precisely the escape-path-blocking that made the directive variant win.

**Mechanical check:** A/B the two description forms through the skill-creator optimizer (D3) and
keep whichever scores higher on the held-out split.

---

### A8. Descriptions must use the words the user actually types, not the words the author prefers
`[COMMUNITY]` https://happyskills.ai/blog/why-your-skill-never-fires/ ·
`[OFFICIAL]` https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
("Be specific and include key terms"). If users say "review my code" but the description says
"audit software artefacts," the skill will not fire.

**Mechanical check for a Unity kit:** mine real transcripts for the vocabulary users use
(`play mode`, `domain reload`, `.meta`, `prefab`, `NullReferenceException`, `Library/`), then
assert each term appears in exactly one skill description. Terms in zero descriptions =
under-trigger risk; terms in two = shadowing risk (§B).

---

### A9. Description wording is a first-class tunable parameter, not cosmetics
`[RESEARCH]` https://arxiv.org/abs/2602.20426 — *Learning to Rewrite Tool Descriptions for
Reliable LLM-Agent Tool Use* (Guo, Dong, Gao, Das; Feb 2026, rev. Apr 2026).
> "Tool descriptions are often written for human developers and tolerate ambiguity that agents
> cannot resolve, particularly as the number of candidate tools grows."
Their rewriting framework yields a 29.23% reduction in accuracy degradation and 60.89%
improvement in query-level success on StableToolBench. (Numbers are for the full framework, not
wording alone.)

**Mechanical check:** version descriptions separately from bodies and re-run trigger evals on any
description diff — treat a description edit as a behavior change requiring a passing eval.

---

### A10. Do not summarize the workflow in the description — agents follow the summary instead of reading the body
`[COMMUNITY]` https://github.com/obra/superpowers/blob/main/skills/writing-skills/SKILL.md
Documented failure: a description mentioning "code review between tasks" caused an agent to
perform *one* review when the skill body required a two-stage review. The description must
describe *triggering conditions only*.

**Mechanical check:** flag descriptions containing step/procedure language (`then`, `first`,
`step 1`, numbered lists, imperative verb chains).

---

### A11. Descriptions cap at 1,024 characters; names at 64, lowercase-hyphen only, and cannot contain "claude"/"anthropic"
`[OFFICIAL]` https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
Community convention (obra) is tighter: **under 500 characters**.

**Mechanical check:** trivial length/charset lint in CI. Also see C4 — long descriptions have a
*collective* cost beyond the per-skill cap.

---

### A12. Prefer gerund or noun-phrase names; avoid `helper`/`utils`/`tools`
`[OFFICIAL]` https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
Good: `processing-pdfs`, `analyzing-spreadsheets`. Acceptable: `pdf-processing`.
Avoid vague, overly generic, and **inconsistent patterns within one collection**.

**Mechanical check:** assert all 5 skill names match one morphological pattern (all gerund, or
all noun-phrase — not a mix), and none appear on a denylist of vague stems.

---

### A13. A skill should exist only where the agent actually fails without it
`[OFFICIAL]` https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md ·
https://claude.com/blog/lessons-from-building-claude-code-how-we-use-skills
> "Skills should address tasks Claude cannot easily handle alone; simple one-step queries may not
> trigger regardless of description quality."
Claude Code's own team: stateless skills that restate what Claude already knows "add context
without practical value."

**Mechanical check:** the A/B baseline run (D2). If with-skill ≈ without-skill on the skill's own
evals, the skill is dead weight regardless of how well it triggers.

---

## §B — Overlap, shadowing, and decomposition

### B1. Overlapping descriptions are the named cause of wrong-skill firing
`[OFFICIAL]` https://platform.claude.com/docs/en/agents-and-tools/agent-skills/enterprise
The enterprise guide names **Coexistence** as a required eval dimension, with the canonical
failure: *"New Skill's description is too broad, stealing triggers from existing Skills."*
Prescribed remedies when coexistence evals fail: *"Consolidate overlapping Skills or narrow
descriptions."*

**Mechanical check:** run each skill's should-trigger set with the *whole* skill set installed,
not in isolation, and record which skill actually fired. Any cross-firing is a coexistence bug.
This is the single highest-value check for a 5-skill kit.

---

### B2. Adding a skill must not regress the others — test in isolation AND in company
`[OFFICIAL]` https://platform.claude.com/docs/en/agents-and-tools/agent-skills/enterprise
> "Require evaluations in isolation (Skill alone) and alongside existing Skills (coexistence
> testing)."

**Mechanical check:** two eval passes per PR — solo and full-set — and diff the trigger matrix.
A green solo run with a red full-set run is exactly the overlap failure.

---

### B3. The best skills fit cleanly into one category; ones that straddle several confuse the agent
`[OFFICIAL]` https://claude.com/blog/lessons-from-building-claude-code-how-we-use-skills
Anthropic runs hundreds of internal skills clustered into **nine categories** specifically to
prevent overlap and confusion.
> "The best skills fit cleanly into one; the ones that try to do too much straddle several and
> confuse the agent."

**Mechanical check:** assign each of the 5 skills exactly one category label. Two skills sharing
a label are consolidation candidates; one skill needing two labels is a split candidate.

---

### B4. Start narrow and workflow-specific; consolidate only when evals prove equivalence
`[OFFICIAL]` https://platform.claude.com/docs/en/agents-and-tools/agent-skills/enterprise
> "Merge narrow Skills into a broader one only when the consolidated Skill's evaluations confirm
> equivalent performance to the individual Skills it replaces."
Example progression given: `formatting-sales-reports` + `querying-pipeline-data` +
`updating-crm-records` → `sales-operations`.

**Practical read for this kit:** 5 narrow Unity skills is the *recommended starting shape*.
Consolidation is the later move, gated on evidence — not a default virtue.

---

### B5. Cross-reference between skills rather than duplicating or force-loading content
`[COMMUNITY]` https://github.com/obra/superpowers/blob/main/skills/writing-skills/SKILL.md
Skills live in a flat namespace. Use explicit `REQUIRED SUB-SKILL` / `REQUIRED BACKGROUND`
markers instead of `@`-inlining another skill's content.

**Mechanical check:** detect near-duplicate paragraphs across SKILL.md files (shingle/hash
similarity ≥ ~0.8) and replace with a reference.

---

### B6. Same-name skills silently shadow each other by source precedence
`[OFFICIAL]` https://code.claude.com/docs/en/skills
Resolution order: personal `~/.claude/skills/` beats project `.claude/skills/` beats bundled;
project skills replace bundled ones of the same name; plugin skills are namespaced
`plugin-name:skill-name` and cannot collide across levels. A stale personal copy silently wins
over the project copy you are editing.
`[COMMUNITY]` corroboration: https://happyskills.ai/blog/why-your-skill-never-fires/

**Mechanical check:** at test time, enumerate `~/.claude/skills/`, `.claude/skills/`, and plugin
dirs and assert no name appears twice. Shipping as a namespaced plugin (as this kit does)
structurally eliminates the collision — worth stating as a deliberate design win.

---

### B7. Don't offer many alternatives inside a skill — give a default with one escape hatch
`[OFFICIAL]` https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
Listed under "Anti-patterns to avoid." Applies to the routing layer too: five skills each
offering three approaches is fifteen paths.

**Mechanical check:** flag bodies containing `or you could` / `alternatively` / lists of ≥3
interchangeable tools for the same job.

---

## §C — Surface size: how many skills and tools

### C1. Published degradation thresholds start around 50 tools — 5 is nowhere near them
`[RESEARCH]` Kate et al., stress tests at 49–741 tools, reporting **7–85% performance drops** as
catalogue size grows; summarized in https://arxiv.org/pdf/2606.17519 (*Scaling Enterprise Agent
Routing: Degradation, Diagnosis, and Recovery*, Gillespie & Perry, Jun 2026).
Widely-reported shape: ~50 tools → 84–95% selection accuracy; ~200 tools → 41–83%;
~740 tools → near-random. Degradation is **non-linear** (sharp falls between thresholds, e.g.
207→417 tools) rather than smooth.

**Confidence note:** the tidy 50/200/740 table circulates via secondary aggregators; the
49–741 range and 7–85% figure trace to the primary stress test. Directionally solid, precise
numbers uncertain.

**Mechanical check:** none needed at n=5. Record the count as a budget with a documented ceiling
so growth is a deliberate decision.

---

### C2. Anthropic's own recall guidance is empirical, not a fixed number
`[OFFICIAL]` https://platform.claude.com/docs/en/agents-and-tools/agent-skills/enterprise
> "Use your evaluation suite to measure recall accuracy as you add Skills, and stop adding when
> performance degrades."
The one hard number in the docs: **the Claude API accepts a maximum of 8 Skills per request.**
That is a useful psychological ceiling for a shippable bundle.

**Mechanical check:** track full-set recall accuracy over time as a CI metric; the number to
watch is the trend, not the count.

---

### C3. "More tools don't always lead to better outcomes" — overlapping tools distract agents
`[OFFICIAL]` https://www.anthropic.com/engineering/writing-tools-for-agents
> "Too many tools or overlapping tools can also distract agents from pursuing efficient
> strategies."
Recommends "building a few thoughtful tools targeting specific high-impact workflows" and shows
consolidation examples (`list_users` + `list_events` + `create_event` → `schedule_event`).
Namespacing choice (prefix vs suffix) had "non-trivial effects" on evals.

**Mechanical check:** for the CLI, count subcommands and ask per-subcommand whether an agent
would ever call it in isolation; fold single-use intermediates into the composite command.

---

### C4. Skill *descriptions* share a cumulative system-prompt budget in Claude Code — and overflow drops them silently
`[COMMUNITY/BUG REPORT]` https://github.com/anthropics/claude-code/issues/59921
Reported on v2.1.143 with 63 user skills + 90 plugin SKILL.md files: **36 entries** rendered as
bare names with descriptions stripped. Reproduced by adding ~800 chars to one skill's
description, which made an *unrelated, unmodified* skill's description vanish; shortening it back
to ~250 chars restored it. The budget is cumulative across the whole available-skills section,
the drop happens at render (YAML validates fine), and there is no warning. Plugin skills, which
appear later in the list, are disproportionately affected. **Closed as duplicate** — known issue.

**Why it matters here:** this kit's skills are plugin skills with long two-part descriptions, and
they compete with everything else the user has installed. Verbosity is not free even at n=5.

**Mechanical check:** sum all description lengths across the *user's whole installed set*, and
spot-check the rendered available-skills section (`/context`) to confirm all 5 descriptions
survived. Keep each well under the 1,024 cap.

---

### C5. An invoked skill's body stays in context for the rest of the session
`[OFFICIAL]` https://code.claude.com/docs/en/skills
> "the rendered `SKILL.md` content enters the conversation as a single message and stays there
> for the rest of the session… every line is a recurring token cost."
Claude Code does not re-read the file on later turns. Re-invoking an unchanged skill now adds a
short "already loaded" note instead of a second copy (v2.1.202+).

**Mechanical check:** measure worst-case resident cost = sum of all 5 bodies (the case where a
session triggers everything), not just the per-skill body size.

---

### C6. Level-1 metadata costs ~100 tokens/skill; Level 2 bodies should stay under 5k tokens / 500 lines
`[OFFICIAL]` https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview and
.../best-practices. Level 3 bundled files cost **zero** until read; scripts run via bash and only
their *output* enters context.

**Mechanical check:** line-count lint at 500; token-count lint at 5k; assert reference files are
linked from SKILL.md and not inlined.

---

### C7. Keep reference files exactly one level deep from SKILL.md
`[OFFICIAL]` https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
Nested references (SKILL.md → advanced.md → details.md) cause partial reads —
Claude may `head -100` a file reached indirectly and act on incomplete information.
Reference files over 100 lines should carry a table of contents for the same reason.

**Mechanical check:** parse markdown links; fail if any file reachable only via a second hop.
Assert a `## Contents` block in every reference file over 100 lines.

---

### C8. Prefer scripts/CLI over inlined instructions for deterministic work — the code never enters context
`[OFFICIAL]` https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices ·
https://www.anthropic.com/engineering/code-execution-with-mcp
Pre-made scripts are "more reliable than generated code," save tokens and time, and ensure
consistency. The MCP post quantifies the general principle: a workflow costing **150,000 tokens**
via direct tool calls dropped to **2,000 tokens** (98.7% reduction) when expressed as code.
Corollary: make execution intent explicit — *"Run `analyze_form.py`…"* (execute) vs
*"See `analyze_form.py` for the algorithm"* (read).

**Relevance:** this kit's CLI is the *endorsed* shape. A CLI the agent shells out to is cheaper
than equivalent prose, and it is not part of the "too many agent-facing features" problem the way
extra skills would be.

**Mechanical check:** grep bodies for script references and assert each is phrased as run-vs-read
unambiguously; assert `allowed-tools` pre-approves the exact command form so it doesn't prompt.

---

### C9. High retrieval "success" at depth can be statistically indistinguishable from random
`[RESEARCH]` https://arxiv.org/abs/2605.18857 — *The 99% Success Paradox: When Near-Perfect
Retrieval Equals Random Selection* (Repantis et al., May 2026).
Introduces **Bits-over-Random**, BoR = log₂(P_obs/P_rand). On 20 Newsgroups, BM25 and SPLADE both
report >99% coverage at K=100 yet BoR ≈ 0 — random-level selectivity. Selectivity collapses once
the expected coverage ratio K·R̄_q/N exceeds 3–5, and downstream RAG accuracy degrades in step.

**Transfer to skills:** a trigger metric that looks great can be measuring the wrong thing if the
candidate set is small relative to the metric's tolerance. With 5 skills, "the right skill was
among those considered" is a ~random-level claim; only "the right skill fired and the wrong four
did not" is informative.

**Mechanical check:** score trigger evals as exact-match on *which* skill fired plus explicit
false-positive counts for the other four — never as "a skill fired."

---

### C10. Adaptive/short candidate lists beat fixed long ones for selection accuracy
`[RESEARCH]` https://arxiv.org/html/2605.24660v1 — *How Many Tools Should an LLM Agent See?
A Chance-Corrected Answer* (Repantis, Gawde, Singh, Blackwell; Meta).
With Claude Sonnet 4.6, adaptive depth gave **93.1%** selection accuracy vs **87.1%** when always
shown 5 tools; the widest gap was on medium-difficulty queries (**76.8% vs 60.9%**). On BFCL,
90.3% coverage at K≈7.4 nearly matched fixed K=50's 90.8% at 7× less depth. The paper explicitly
declines to recommend a universal threshold — optimal K varies with query difficulty, registry
size, and scorer quality.

**Mechanical check:** none directly actionable at n=5; the takeaway is that the honest answer to
"how many is too many" is measured, not decreed (matches C2).

---

### C11. Retrieval-gating tools recovers most of what scale destroys
`[RESEARCH]` https://arxiv.org/abs/2505.03275 — *RAG-MCP: Mitigating Prompt Bloat in LLM Tool
Selection via Retrieval-Augmented Generation* (May 2025). Semantic retrieval before the LLM sees
tool definitions **more than tripled** selection accuracy (**43.13% vs 13.62%**) while cutting
prompt tokens by over 50%.

**Relevance:** this is the escape hatch *if* the kit ever grows past ~dozens of skills. It is not
needed at 5, and citing it is mostly useful for arguing the ceiling is high.

---

## §D — Evaluating skills

### D1. Build evaluations before writing the documentation
`[OFFICIAL]` https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
The prescribed loop: (1) run Claude on representative tasks *without* the skill and record
failures, (2) build three scenarios testing those gaps, (3) measure the no-skill baseline,
(4) write the minimum content that passes, (5) iterate.
> "Create evaluations BEFORE writing extensive documentation."
Ships an eval JSON shape: `{skills, query, files, expected_behavior[]}`. Anthropic notes there is
**no built-in runner** — you build your own.

**Mechanical check:** require ≥3 evals per skill in CI; the checklist item is literal ("At least
three evaluations created").

---

### D2. Always measure against a baseline: no-skill for new skills, previous version for edits
`[OFFICIAL]` https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md
Run both arms in parallel — "spawn two subagents in the same turn — one with the skill, one
without" — so they finish together and don't cross-contaminate. Grading uses a `grading.json`
with exact fields `text` / `passed` / `evidence`; aggregate with
`python -m scripts.aggregate_benchmark`. Output includes pass rates with **mean ± standard
deviation per assertion** and deltas between configurations.

**Mechanical check:** every skill PR reports Δ vs baseline. A skill with Δ≈0 fails A13.

---

### D3. Trigger-rate measurement: 60/40 train/test split, 3 repetitions per query, ≤5 optimizer iterations
`[OFFICIAL]` https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md ·
https://claude.com/blog/improving-skill-creator-test-measure-and-refine-agent-skills
The description improver splits the eval set 60% train / 40% held-out test, runs **each query 3
times** for a reliable trigger rate, has Claude propose description edits from the failures,
re-scores on both splits, iterates up to 5 times, and picks `best_description` **by test score**
to avoid overfitting the description to its own eval set. Reported outcome: improved triggering
on **5 of 6** public skills. Command:
`python -m scripts.run_loop --eval-set <path> --skill-path <path> --model <id> --max-iterations 5`

**This is the single most directly applicable tool for this kit** — it is off-the-shelf, it
optimizes exactly the "Use when / Do NOT use for" string, and it reports false positives and
false negatives separately.

---

### D4. Eval queries must read like real user input, not benchmark prose
`[OFFICIAL]` https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md
Queries should be "realistic and something a Claude Code or Claude.ai user would actually type" —
include file paths, project-specific names, column names, URLs; mix lengths; include lowercase,
typos, and casual speech; avoid abstract requests. Include uncommon phrasings and cases where the
skill should win against a competing skill.

**Anti-overfitting note for this kit:** eval queries drawn only from the maintainer's own
transcripts will encode the maintainer's own phrasing. Deliberately author queries in *other
people's* Unity vocabulary (different console habits, different project layouts, different
seniority) — that is the cheapest available test of workflow overfitting.

---

### D5. Anthropic's five required eval dimensions
`[OFFICIAL]` https://platform.claude.com/docs/en/agents-and-tools/agent-skills/enterprise
**Triggering accuracy** (fires for the right queries, stays quiet otherwise) ·
**Isolation behavior** (works alone) · **Coexistence** (doesn't degrade siblings) ·
**Instruction following** · **Output quality**. Each has a named example failure.
Evaluation suites should be **3–5 representative queries per skill** covering should-trigger,
should-not-trigger, and **ambiguous edge cases**, tested across every model the org uses.

**Mechanical check:** structure the audit as a 5-column scorecard, one row per skill.

---

### D6. Test with every model you ship for — Haiku needs more guidance than Opus
`[OFFICIAL]` https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
> "What works perfectly for Opus might need more detail for Haiku."
Explicit checklist item: "Tested with Haiku, Sonnet, and Opus."

**Mechanical check:** parameterize the eval runner over models; report a per-model trigger matrix.

---

### D7. Log skill invocations via a PreToolUse hook to find over- and under-triggering in the wild
`[OFFICIAL]` https://claude.com/blog/lessons-from-building-claude-code-how-we-use-skills
Anthropic runs a PreToolUse hook that logs skill usage "to identify popular or undertriggering
skills." Complements offline evals with real usage distribution.

**Mechanical check:** ship an optional logging hook with the kit; a skill with near-zero
invocations over weeks of real use is either mis-described or unnecessary.

---

### D8. Behavioral eval harness for workflow compliance: Drill / Quorum
`[COMMUNITY]` https://github.com/prime-radiant-inc/superpowers-evals ·
https://github.com/obra/superpowers/blob/main/docs/testing.md
Two-LLM design: a **Gauntlet-Agent** (QA driver + grader) drives a **Coding-Agent** (system under
test) through a scenario, then deterministic post-checks run. Three-valued verdict —
pass / fail / **indeterminate** (setup or capture failure) — with exit codes 0/1/2, so infra
flakes don't masquerade as behavioral failures. Scenarios are YAML at `evals/scenarios/*.yaml`
plus a `story.md` (frontmatter: `quorum_max_time`, `quorum_tier`, `status`) and a `setup.sh`;
post-checks use a bare-verb DSL (`file-exists`, `file-contains`, `command-succeeds`, `git-*`,
`assert-checkout-clean`, `not`). Explicitly scoped to "workflow compliance: **skill triggering**,
worktree behavior, subagent coordination, verification reflexes." Runs across Claude Code, Codex,
Gemini and others.
Usage: `uv run drill run triggering-test-driven-development -b claude`

**Caveats:** scenarios take **3–30+ minutes each** and are not in CI today (the stated plan is a
tiered model — fast subset on PR, full sweep nightly). The README does **not** document explicit
support for negative "should not fire" scenarios — its focus is capability compliance, so pair it
with D3 for negative-trigger coverage.

---

### D9. Test the skill with a fresh agent instance, not the one that wrote it
`[OFFICIAL]` https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
The "Claude A / Claude B" pattern: Claude A authors and refines, Claude B (fresh context, skill
loaded) executes real tasks, and observations of B's behavior drive A's next edit. Anthropic
stresses using *actual* tasks, not test scenarios, and watching for four tells: unexpected
exploration paths, missed references, over-reliance on one file, and files never accessed at all.

**Mechanical check:** a bundled file never read across N eval runs is a deletion candidate; a file
read on every run belongs in SKILL.md.

---

### D10. Test-first is the community's hard rule for skill edits
`[COMMUNITY]` https://github.com/obra/superpowers/blob/main/skills/writing-skills/SKILL.md
> "NO SKILL WITHOUT A FAILING TEST FIRST" — applies to edits as well as new skills, with no
> exemption for "simple additions" or "documentation updates."
RED: run pressure scenarios *without* the skill and record the agent's rationalizations verbatim.
GREEN: write the minimum that counters those specific failures. REFACTOR: harvest the new
rationalizations and counter them. For wording changes specifically: **5+ samples per variant**
against a no-guidance control, with every flagged match read manually rather than trusting a
programmatic score.

---

## §E — Documented failure modes

### E1. Skills carry implicit *environment contracts* that silently expire
`[RESEARCH]` https://arxiv.org/html/2605.10990 — *Skill Drift Is Contract Violation: Proactive
Maintenance for LLM Agent Skill Libraries* (Fan, Tian, Li, Lu; May 2026).
A contract is `(type, role, value, evidence_span)` where **role** distinguishes *operational*
(execution depends on it) from *incidental* (mentioned in passing). Only operational contracts
are validated. SkillGuard extracts 15 mention families by regex (URLs, versions, Docker images,
env vars, API paths, GitHub Actions versions, config formats…), classifies role via an LLM, then
validates against package registries, live HTTP status, and ecosystem metadata.
**Numbers:** contract-free CI probes produce a **40% false-positive rate**; SkillGuard achieves
**0%** (95% CI [0%, 0.6%]) over 599 negative controls. Controlled drift: **100% precision,
76% recall**. Open-world on 49 real skills: 86% precision, 55% recall. DriftBench = 880
skill/drift pairs across 8 drift categories. Localizing the violated contract raised one-round
repair success from **10% → 78%** at ~10K tokens vs ~18K for three-round iteration.

**Direct application to a Unity kit:** the operational contracts are Unity versions, package
manifest entries, editor menu paths, `Library/` layout assumptions, and CLI flag names. These are
exactly the values that rot when Unity ships a new LTS.

**Mechanical check:** extract every version string, path, and CLI flag from the skills, mark each
operational vs incidental, and add a scheduled job that validates the operational ones against
the current Unity/package reality. Pin what you depend on; don't CI-probe everything (40% FP).

---

### E2. Two distinct rot vectors: the world drifts, *and* the model improves
`[COMMUNITY]` https://natesnewsletter.substack.com/p/ai-agent-maintenance
The second is the less obvious one: scaffolding written to compensate for an older model's
weaknesses becomes dead weight — actively costing context — once the model no longer needs it.
Aligns with the official "Claude is already very smart / does this paragraph justify its token
cost?" test.

**Mechanical check:** on each model upgrade, re-run the D2 baseline. Any skill whose no-skill arm
has caught up to its with-skill arm should shrink or be retired.

---

### E3. Optimized skills transfer better than expected — overfitting fear may be overstated, but validation gating is what prevents it
`[RESEARCH]` https://www.microsoft.com/en-us/research/blog/skillopt-agent-skills-as-trainable-parameters/
SkillOpt treats skills as trainable parameters outside a frozen model. Findings:
cross-model transfer (GPT-5.4-mini with optimized skills scored 64.3, beating GPT-5.4's 59.7
baseline); **cross-harness transfer** — a spreadsheet skill trained in Codex, moved to Claude Code
with no further optimization, went from **22.1 → 81.8**, nearly matching direct training (80.4).
Final skills stayed compact (**~920 tokens median**). Critically: removing the validation gate on
proposed edits **degraded performance across all benchmarks**.

**Read for this kit:** the mechanism that keeps a skill from overfitting to one workflow is a
*held-out validation gate on every edit* (same idea as D3's 60/40 split), not stylistic caution.

---

### E4. Skill instructions stop steering behavior mid-session — and it isn't a context-eviction problem
`[OFFICIAL]` https://code.claude.com/docs/en/skills
> "If a skill seems to stop influencing behavior after the first response, the content is usually
> still present and the model is choosing other tools or approaches."
Remedies in order: strengthen the description and instructions; use **hooks** to enforce
deterministically; re-invoke after compaction. Because content persists, write standing
instructions rather than one-time steps.

**Mechanical check:** multi-turn eval scenarios (turn 1 triggers, turns 3–5 verify the skill still
governs) — superpowers' suite has explicit multi-turn variants for this.

---

### E5. Side-effectful skills should be user-invoked only
`[OFFICIAL]` https://code.claude.com/docs/en/skills
`disable-model-invocation: true` removes the skill from Claude's autonomous reach (and removes its
description from context entirely — a real token saving). Docs: *"You don't want Claude deciding
to deploy because your code looks ready."* The mirror, `user-invocable: false`, is for pure
background knowledge that isn't a meaningful command.

**Directly relevant:** any Unity skill that mutates the project, forces a domain reload, or
drives the editor is a `disable-model-invocation` candidate — and each one so marked *reduces*
the resting description budget (C4) without deleting a feature. This is the cheapest available
answer to "are there too many agent-facing features."

---

### E6. Enterprise lifecycle: separation of duties, a registry, and periodic re-evaluation
`[OFFICIAL]` https://platform.claude.com/docs/en/agents-and-tools/agent-skills/enterprise
Six stages — Plan / Create-and-review / Test / Deploy / Monitor / Iterate-or-deprecate.
Named requirements: *"Skill authors should not be their own reviewers"*; maintain a registry with
purpose, owner, version, dependencies, and **last evaluation date**; *"Rerun evaluations
periodically to detect drift."* Deprecation triggers are explicit: persistent eval failures
across updates, or the workflow being retired.

**Relevance to a solo-maintained kit:** "authors should not be their own reviewers" is precisely
the overfitting guard the maintainer is worried about. With one human, the substitute is a
fresh-context agent grading against externally-authored eval queries (D4 + D9).

---

### E7. Avoid time-sensitive statements in skill bodies
`[OFFICIAL]` https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
"Before/after August 2025, use the old API" becomes wrong on its own. Use a collapsed
`## Old patterns` section for historical context instead.

**Mechanical check:** grep bodies for absolute dates, "currently", "as of", "the latest version"
and for Unity version numbers used as prose rather than as pinned requirements.

---

### E8. Inconsistent terminology across a skill set degrades parsing
`[OFFICIAL]` https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
Pick one term and hold it — don't mix "field/box/element/control" or "extract/pull/get/retrieve".

**Mechanical check for 5 sibling skills:** build a term frequency table across all descriptions
and bodies; flag synonym clusters (e.g. `play mode` vs `playmode` vs `runtime`) used
inconsistently across skills. Inconsistency across siblings is worse than within one skill —
it is a direct cause of the wrong sibling matching.

---

### E9. Match the documentation form to the observed failure — prohibitions backfire on shaping problems
`[COMMUNITY]` https://github.com/obra/superpowers/blob/main/skills/writing-skills/SKILL.md
Rule violations under pressure → prohibition + rationalization table + red-flag list.
Wrong-*shaped* output → a positive recipe stating what the output IS.
Omitted elements → structural template with REQUIRED fields.
Conditional behavior → rules keyed to observable predicates, not exemption clauses.
Applying a prohibition to a shaping problem makes it worse.

---

### E10. Skills are an untrusted-code surface; a skill can grant itself broad tool access
`[OFFICIAL]` https://code.claude.com/docs/en/skills ·
https://platform.claude.com/docs/en/agents-and-tools/agent-skills/enterprise
Project-level `allowed-tools` takes effect once the workspace trust dialog is accepted —
*"a skill can grant itself broad tool access."* The enterprise risk table rates code execution,
instruction manipulation, MCP references, network calls, and hardcoded credentials as **High**.

**Mechanical check:** assert `allowed-tools` grants are the narrowest command forms that work
(`Bash(${CLAUDE_SKILL_DIR}/scripts/x.sh *)`, not `Bash(*)`). For a public kit this is also a
trust-signal worth documenting in the README.

---

## §F — Notes specific to the CLI and the file-based editor-state signal

### F1. A CLI is the endorsed shape for deterministic agent-facing work
See C8. Scripts are "more reliable than generated code," cost only their output in tokens, and
the code itself never enters context. A CLI is **not** the same category of cost as an extra
skill; it does not compete for the resident description budget at all.

### F2. Consolidate CLI subcommands the way you'd consolidate tools
`[OFFICIAL]` https://www.anthropic.com/engineering/writing-tools-for-agents
Merge commands whose only purpose is to feed another command — the article's own examples fold
`get_customer_by_id` + `list_transactions` + `list_notes` into one `get_customer_context`,
explicitly to "reduce the context that would have otherwise been consumed by intermediate
outputs." Same logic applies to a Unity CLI: prefer one command returning the composite answer
over three the agent must chain.

### F3. Pre-approve the exact command form so the CLI doesn't generate permission prompts
`[OFFICIAL]` https://code.claude.com/docs/en/skills
`${CLAUDE_SKILL_DIR}` / `${CLAUDE_PLUGIN_ROOT}` are substituted in **both** the body and the
`allowed-tools` Bash rules — using the same variable in both places lets a bundled script run
without prompting. Mismatched forms silently reintroduce prompts.

**Mechanical check:** assert every command string in a body has a matching `allowed-tools` rule.

### F4. A file-based state signal is a legitimate progressive-disclosure Level 3 resource
`[OFFICIAL]` https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
Bundled files cost zero context until read; the filesystem *is* the intended disclosure
mechanism. Claude Code also supports dynamic context injection (`` !`command` `` lines) to inline
live state at invocation time — worth comparing against a file the agent must remember to read.
Caveat from the same docs: `!` lines do **not** execute in several session types
(claude.ai-synced skills, `disableSkillShellExecution`), reaching Claude as literal text — so a
plain file read is the more portable signal.

### F5. Persistent per-plugin state has a blessed location
`[OFFICIAL]` https://claude.com/blog/lessons-from-building-claude-code-how-we-use-skills
`${CLAUDE_PLUGIN_DATA}` is the documented env var for data that must survive across sessions,
substituted in both body text and `allowed-tools` rules.

### F6. Hooks are the deterministic enforcement layer when a skill's instructions aren't enough
`[OFFICIAL]` https://code.claude.com/docs/en/skills · https://claude.com/blog/lessons-from-building-claude-code-how-we-use-skills
On-demand hooks give "opinionated guardrails without constant overhead."
**But** — see A7 — a hook injecting competing instructions dropped passively-described skills to
**37%** activation. Hooks and passive descriptions interact badly; if the kit ships hooks, the
descriptions need to be directive.

---

## Source ledger

**Official Anthropic (primary):**
- platform.claude.com/docs/en/agents-and-tools/agent-skills/{overview, best-practices, enterprise}
- code.claude.com/docs/en/skills
- anthropic.com/engineering/{equipping-agents-for-the-real-world-with-agent-skills, writing-tools-for-agents, code-execution-with-mcp}
- claude.com/blog/{lessons-from-building-claude-code-how-we-use-skills, improving-skill-creator-test-measure-and-refine-agent-skills}
- github.com/anthropics/skills — skill-creator/SKILL.md, xlsx/SKILL.md

**Research (arXiv / MSR):**
- 2605.10990 Skill Drift Is Contract Violation (May 2026)
- 2605.24660 How Many Tools Should an LLM Agent See? (Meta)
- 2605.18857 The 99% Success Paradox (May 2026)
- 2606.17519 Scaling Enterprise Agent Routing (Jun 2026)
- 2505.03275 RAG-MCP (May 2025)
- 2602.20426 Learning to Rewrite Tool Descriptions (Feb 2026)
- Microsoft Research — SkillOpt

**Community:**
- github.com/obra/superpowers — skills/writing-skills/SKILL.md, docs/testing.md
- github.com/prime-radiant-inc/superpowers-evals — Drill/Quorum
- github.com/anthropics/claude-code/issues/59921 — description budget bug (closed as duplicate)
- medium.com/@ivan.seleznov1/… — 650-trial activation study
- happyskills.ai/blog/why-your-skill-never-fires/

## Confidence caveats

1. **A7's 650-trial study** is a single author, 3 skills, one CLI version. Directionally
   corroborated by Anthropic's own "descriptions should be pushy" guidance (A6), but the exact
   97.2/91.7/76.1 split should not be quoted as settled.
2. **C1's 50/200/740-tool table** circulates via secondary aggregators. The primary-traceable
   claim is Kate et al.'s 49–741 tool stress test with 7–85% drops. Treat exact thresholds as
   uncertain; the non-linear shape is the reliable part.
3. **C9 (BoR / 99% paradox)** is an information-retrieval result. Its application to skill
   routing is my extension, not the authors' claim — though the underlying statistic
   (chance-correct your success metric) transfers cleanly.
4. **D8's Drill/Quorum negative-trigger support** is unconfirmed. The README emphasizes
   capability compliance and does not document should-not-fire scenarios; verify against
   `docs/scenario-authoring.md` before relying on it for negative testing.
5. **C4's description budget** is a closed-as-duplicate bug report from v2.1.143. The exact
   threshold is undocumented and may have changed; the reproduction was clean, so the *mechanism*
   is credible even if the current numbers differ.
6. Anthropic's **"Complete Guide to Building Skills for Claude"** PDF
   (resources.anthropic.com/hubfs/The-Complete-Guide-to-Building-Skill-for-Claude.pdf) could not
   be extracted — the fetch returned undecodable binary. It may contain additional decomposition
   guidance not captured here.
