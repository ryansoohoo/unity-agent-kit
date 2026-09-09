---
name: unity-verify
description: Three-tier verification, cheapest first. Use when verifying Unity C# changes compile or behave, or a new type became attachable. Do NOT use for merge conflicts, placement, or player/exe builds.
---

# Verify the code Unity is running

Choose the cheapest tier that answers the task. Here `kit` means `node <kit-checkout>/packages/cli/bin/kit.js`; always name the target Unity project. Use project-installed skills and find the configured launcher in the project's client MCP configuration before searching global plugin caches.

When the `unity-agent-kit` MCP server is connected, prefer its typed tools: `unity_status`, `unity_capabilities`, `unity_lease_acquire`, `unity_refresh`, `unity_check`, and `unity_lease_release`. Supply the acquired `leaseToken` on mutations and the successful refresh ID as `after` on the check. Tools are bound to the configured Editor checkout. A pending result requires `unity_operation_status` or `unity_operation_wait` before continuing. The CLI examples below describe the same workflow when MCP is unavailable.

## Tier 0: inspect existing evidence

Use `kit status <project> --json`, `kit capabilities <project> --json`, or `kit methods <project> --filter Namespace.Type --json` to discover the running Editor and callable methods. Check project path, session, CLI/package versions and protocol before relying on a cached installation. Status defaults to a compact summary; request `--details` or MCP `details: true` when diagnosing assembly or skill-version differences. Fresh `ready` state only says the Editor is responsive. It does not prove the current source was compiled.

## Tier 1: check code without the Editor

Prepare edits and run the project's compiler or focused tests in an isolated worktree before requesting the shared Editor lease. A generated Unity project file may omit a new script until Unity imports it. Offline compilation does not prove attachment, serialization, scene behavior, or what the running Editor loaded.

## Tier 2: refresh, then check in the Editor

For authorized Editor work, acquire a lease immediately before integrating the selected changes into its checkout. Hold it through refresh, checks, Play work and cleanup, then release before returning to unrelated offline work. Source edits in the shared checkout also require ownership. See `unity-topology` for preparing uncommitted deltas and coordinating integration.

```text
kit lease acquire <project> --owner <task-id> --wait --json
kit refresh <project> --file Assets/Example.cs --lease <token> --json
kit check <project> --method Example.Proof.Check --after <receipt-id> --lease <token> --json
kit lease release <project> --lease <token> --json
```

Take the token from acquisition and the receipt ID from the successful refresh result. Repeat `--file` for every changed input. For a source-specific loaded-code assertion, add `--probe proof.json` with `{"type":"Example.Proof","field":"Revision","expected":"7"}`. This compares an existing static field in the loaded type; it does not establish behavior by itself.

The receipt correlates requested hashes with import/compilation, reload and loaded assembly identities. `check` or `invoke` with `--after` rejects a receipt whose session, epoch, source hashes or asset revision has changed. A boolean `false` or structured `ok: false` from a check is failure. An asset-only refresh or no-op is not a C# compilation proof. Use this explicit refresh while Unity remains in the background; do not add an Alt-Tab or window-focus step to trigger imports.

A draft configuration, getter or successful setter call does not prove the game uses that value. For a behavior claim, run a project proof check against the intended live component, serialized asset or runtime system after applying the change. Report what it inspected and asserted. Use typed `returnValue` and `returnType` when available; an unknown return type or the string `"False"` is not a boolean assertion.

For behavior requiring Play, use `kit session start <project> --lease <token> --config scenario.json --wait --json` with existing static callbacks under `Assets`. Inspect `checkRan` and the check result. A session that only entered and exited Play proves lifecycle completion. The service restores scenes, time scale and its temporary run-in-background setting; callbacks must undo their own other state. Clean up before releasing the lease.

## When work stops responding

Use `kit op status <project> --id <operation-id> --json` to distinguish queued, running and terminal work. `kit op cancel` can prevent queued work from starting; it cannot undo a running method. A timeout is not proof of cancellation. Inspect the operation before retrying a mutation, and renew a lease before it expires if the session needs longer. Do not delete inbox files or kill every Unity process as a recovery shortcut.

Report the tier and actual evidence obtained. Full command and scenario schemas are in `docs/operations.md` in the kit checkout.
