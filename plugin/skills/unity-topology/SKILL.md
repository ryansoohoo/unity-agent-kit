---
name: unity-topology
description: Use when planning parallel agents, worktrees, a second Unity editor, or scene/prefab edit ownership. Do NOT use for verifying code (unity-verify) or merge conflicts (unity-merge).
---

# One hot editor, many cold checkouts

Unity permits exactly ONE editor per project folder (Temp/UnityLockfile;
deleting it is the documented corruption path).
A second editor requires a second directory — a git worktree — and costs
~2.5 GB + ~103 s cold init (measured). A worktree with NO editor costs
~nothing and verifies in ~0.6 s (measured) via dotnet build.

## The split
- HOT (serialize): everything touching the asset graph — scene/prefab edits,
  play mode, screenshots, real compiles — funnels through the one editor, one
  operation at a time.
- COLD (parallelize): code-only work in editorless worktrees. This is where
  parallel agents pay.

## Scene/prefab ownership (parallel waves)
BAD:  two parallel tasks both "just tweak" OutdoorsScene.unity.
GOOD: one owner per scene/prefab per wave; everyone else reads. Additive work
      (new files) parallelizes freely — shared mutable YAML does not.

## Bounded dispatch (every parallel sub-task)
- Pin model and effort explicitly; never inherit.
- No sub-agent may spawn further sub-agents unless the human asked.
- Hand a scoped, self-contained brief: files, verify tier, expected output
  shape, hard termination condition. Not a transcript dump.
- Every sub-task carries a timeout and a cleanup step (kill orphaned dotnet/
  Unity processes it started, release its worktree).
- Routing: frontier model owns the hot editor and mutations; cheap models fan
  out read-only breadth (audits, log analysis, categorization) across cold
  worktrees where mistakes are discardable.

## Worktree placement (Windows)
- Short paths, ideally outside the repo (path headroom under MAX_PATH is
  measured by the kit's doctor). Cap worktree names at ~20 chars.
- .claude/worktrees/ must be gitignored (doctor enforces) — else one
  `git clean -xdf` deletes every agent's uncommitted work.
