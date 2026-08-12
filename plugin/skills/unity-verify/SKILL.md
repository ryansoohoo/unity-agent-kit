---
name: unity-verify
description: Use when verifying Unity C# changes compile or behave - picks the cheapest of three tiers. Do NOT use for merge conflicts (unity-merge) or deciding where agents run (unity-topology).
---

# Unity verification: three tiers, cheapest first

STOP CONDITION: answer at the cheapest tier that resolves the question, stop after
it passes, and ask before escalating to Tier 2. Sweet-spot effort, not max effort.

## Tier 0 — eval (~300 ms, no reload)
`unity command eval "<expr>"` (Unity CLI) runs Roslyn-compiled C# in the live
editor with NO recompile and NO domain reload. Use for: scene queries, asset
lookups, probes, "did my change take?". Mono only.

## Tier 1 — headless typecheck (~0.6 s, no editor)
`dotnet build Assembly-CSharp.csproj` gives Roslyn compile errors with no editor.
A pass means "types are sound", NOT "Unity will accept this" (no Burst, source
generators, or ScriptedImporters; csproj is stale until Unity regenerates it).
Default loop for code-only work in worktrees.

## Tier 2 — real compile + domain reload (~2.2 s+, serialized)
Needed only when: a new type must become attachable, an asmdef changed, or
scene/asset mutation follows. Protocol:
1. Trigger explicitly (`unity command recompile`). An UNFOCUSED editor never
   auto-imports — measured 90+ seconds of nothing. Never write-and-wait.
2. DISCARD the trigger call's response. The reload kills the connection carrying
   it; a killed request can return a well-formed EMPTY 200 (silent false success).
3. Wait on the epoch signal, never on a clock: `kit --epoch` (or read
   `Temp/unity-agent-kit/epoch.json`) until `fresh && state == "ready"` and
   the epoch has bumped past its pre-edit value. The file stays readable
   through the reload window where every port is dead. Absent signal → fall
   back to `recompile_status` polling; NEVER a bare sleep.
4. Retry on wall-clock budget, never on error codes: dead local ports TIME OUT
   on Windows (SYN dropped), they do not refuse.

If the state passed through "compiling" but returned to "ready" WITHOUT an
epoch bump, the compile almost certainly FAILED — stop waiting and read the
console/Editor.log for errors instead of running out the deadline. Caveat: a
bump proves a reload happened after your capture, not that it contains YOUR
edit — trustworthy only when you are the sole import trigger; with a human
also using the editor, verify content (eval a probe) or wait for a second
bump / a worldRevision advance.

## Never
- Never trust an empty response body as success.
- Never `sleep` as a compile wait — poll status.
- Never claim a perf fix without before/after numbers captured at real settings
  (bad: rewrite the suspected system from code-reading; good: eval-inject debug
  toggles and binary-search suspects against live profiler/frame numbers).
- Before handing back, re-read your own diff against the bad patterns in
  unity-recipes; report hits as triage notes, not blockers.
