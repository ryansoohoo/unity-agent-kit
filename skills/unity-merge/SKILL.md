---
name: unity-merge
description: Use when git shows conflicts (UU) or merges involving .unity/.prefab/.meta/.mat/.asset files. Do NOT use for compile verification (unity-verify) or normal code merges.
---

# Unity YAML merges: what the driver did and what you do now

This project's merge driver (tools/unity-yaml-merge.sh, installed by
unity-agent-kit) auto-merges DISJOINT Unity YAML edits and stops CONFLICTING
ones as `UU` with the file left as VALID YAML — conflict markers never reach a
`guid:` line (Unity would treat that as corrupt and may regenerate the GUID,
silently repointing every reference).

## When you see UU on a Unity file
1. `git checkout --ours <file>` or `--theirs <file>` if one side should win, OR
   merge manually: the conflict is semantic (same object/field changed twice).
2. NEVER commit a Unity YAML file containing `<<<<<<<` markers.
3. A `.meta` guid conflict means two assets claim one identity — pick the side
   whose references you keep; never invent a new guid.

## Prevention rules (you, the agent, enforce these)
- Additive work merges; shared-scene edits do not. One owner per scene/prefab
  per wave of parallel work.
- Never switch branches in a checkout while a Unity editor has it open — asset
  refresh restarts mid-import and state tears.
- Scene/prefab files sitting modified-uncommitted are unreconstructable if
  lost: surface them to the human before starting risky work (the kit's doctor
  warns on this too).
