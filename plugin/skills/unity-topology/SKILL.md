---
name: unity-topology
description: Hot editor, cold worktrees. Use when planning parallel agents, a second Unity editor, or scene/prefab edit ownership. Do NOT use for verifying code (unity-verify) or merge conflicts (unity-merge).
---

# One Editor checkout, parallel code work

An Editor sees files in its own checkout. A method invoked there cannot verify another branch's edits merely because that agent owns a lease. Identify that checkout from the project's MCP configuration and confirm it with `unity_status` before planning integration.

Prepare code and run offline tests in isolated worktrees first. If the starting work includes uncommitted changes, select the needed tracked and untracked files deliberately; a new worktree alone does not contain them. Preserve the user's originals and inspect the resulting diff.

When the changes are ready, acquire an Editor lease just before integrating reviewed commits or selected patches into its checkout. Inspect the combined diff, run `unity-verify`, complete cleanup and release. Do not hold the lease for unrelated coding or offline tests. Do not shorten the lease by editing the shared checkout before acquiring it. The bridge does not switch branches, cherry-pick commits or merge changes for you.

Do not switch the user's dirty Editor checkout to another branch or copy its `Library` into a worker checkout. Preserve uncommitted user changes. If independent scene or Play work requires a second Editor, use a separate project checkout with its own `Library` and channel, account for import cost, and name which Editor each operation targets.

## Reserve integration and verification

Here `kit` means `node <kit-checkout>/packages/cli/bin/kit.js`. Prefer the project's configured MCP server and copied skills. Find its launcher in `.codex/config.toml`, `.mcp.json` or `.cursor/mcp.json` before searching global homes or versioned plugin caches.

When MCP is connected, use `unity_lease_acquire`, `unity_lease_status`, `unity_lease_renew`, `unity_lease_release`, and `unity_lease_cancel` with their advertised arguments. Codex, Claude Code and Cursor share this same per-project queue. Reuse a returned ticket when retrying acquisition. Use a distinct task owner ID and only the token returned for that owner.

```text
kit lease acquire <project> --owner <task-id> --json
kit lease acquire <project> --owner <task-id> --ticket <queued-ticket> --wait --json
kit lease status <project> --json
kit lease renew <project> --lease <token> --json
kit lease release <project> --lease <token> --json
```

Acquisition without `--wait` returns either ownership or a queued ticket and position. Resume that same ticket with the same owner; do not create a new queue entry each poll. A waiting agent can continue code or review in its own worktree, but must not edit the shared Editor's files. Withdraw a queued request with `kit lease cancel <project> --ticket <queued-ticket> --json`.

Retain the lease through integration, refresh, invoke/check, Play restoration and profiler cleanup. Renew it for longer work. Expiry does not transfer ownership while tracked operations, Play work or profiler captures are still active; release likewise refuses active work. Inspect operations and complete cleanup before handing off.

Leases fence cooperating protocol requests, not filesystem writes, legacy clients, raw Editor actions or arbitrary game code. Scene and prefab ownership still needs an explicit agreement between collaborators. Give one owner each serialized asset while its work is in progress. See `unity-merge` if integration produces Unity YAML conflicts.

The command details and supported guarantees are in `docs/operations.md` in the kit checkout.
