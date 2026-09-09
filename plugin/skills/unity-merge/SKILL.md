---
name: unity-merge
description: Unity YAML conflicts. Use when git shows conflicts (UU) or merges involving .unity/.prefab/.meta/.mat/.asset files. Do NOT use for compile verification (unity-verify) or normal code merges.
---

# Unity YAML merges: what the driver did and what you do now

This project's merge driver (tools/unity-yaml-merge.sh, installed by
unity-agent-kit) auto-merges disjoint Unity YAML edits and stops conflicting
ones as `UU` with the file left as valid YAML. Conflict markers never reach a
`guid:` line: Unity would treat that as corrupt and may regenerate the GUID,
silently repointing every reference.

## When you see UU on a Unity file

1. Decide the winner. `git checkout --ours <file>` or `--theirs <file>` when
   one side should win; otherwise merge by hand, because the conflict is
   semantic (same object or field changed twice).
2. A `.meta` guid conflict means two assets claim one identity. Keep the side
   whose references you keep; the guid is never invented fresh.
3. Confirm the file parses (open it in the editor or run the kit's doctor)
   and commit.

**Done when:** no Unity YAML file in the commit contains `<<<<<<<`, every
`.meta` guid matches the references that survive, and the editor loads the
merged scene or prefab.

## Prevention (you, the agent, enforce these)

- Additive work merges; shared-scene edits do not. Ownership rules live in
  unity-topology.
- Switch branches only when no Unity editor has the checkout open; otherwise
  asset refresh restarts mid-import and state tears.
- Modified, uncommitted scene or prefab files are unreconstructable if lost.
  Surface them to the human before starting risky work (the kit's doctor
  warns on this too).
