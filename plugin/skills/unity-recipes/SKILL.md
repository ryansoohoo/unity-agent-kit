---
name: unity-recipes
description: Good-vs-bad recipes for Unity agent operations. Use when doing compile-wait, console read, refresh, or perf probe work. Do NOT use for scene ownership (unity-topology) or merges (unity-merge).
---

# Unity operation recipes

Use `node <kit-checkout>/packages/cli/bin/kit.js` for `kit` below. Commands accept the Unity project path, which must identify the Editor's checkout.

Prefer the connected `unity-agent-kit` MCP tools when available. `unity_console` reads errors, `unity_operation_status` recovers operation state, and the `unity_play_*` tools run and restore bounded scenarios. Consult the advertised schemas for profiler tools. Keep your `leaseToken` through all mutations and cleanup; pending operation IDs still need observation before another dependent call.

## Waiting for changed code

An arbitrary sleep or a fresh epoch can still leave the old assembly running. Follow `unity-verify` for a lease, content-aware refresh receipt, then a check tied to that receipt. `--wait-ready` is useful for responsiveness, not for proving a particular edit reached the loaded assembly. Discover callable types with `kit methods <project> --filter Namespace.Type --json` before inventing method names.

## Reading errors

```text
kit console <project> --errors --last 30 --json
kit op status <project> --id <operation-id> --json
```

Use the structured console and operation result. Text searching Editor.log may pick up old failures, while an empty console cannot establish successful compilation. Keep the refresh diagnostics and receipt for that claim. Clear a console only when the task calls for clearing it.

## Recovering from a timeout

Query the operation ID before submitting another mutating call. A queued operation can be cancelled with `kit op cancel <project> --id <operation-id> --json`. Running work must finish or use its supported stop path. For Play, use `kit session stop <project> --lease <token> --id <session-id> --json` and observe restoration before handing off ownership. A blocked modal needs the specific dialog resolved; a stale heartbeat does not identify a process that is safe to kill.

## Measuring a workload

```text
kit profiler start <project> --label baseline --seconds 30 --context scenario.json --lease <token> --json
kit profiler mark <project> --label shot --tick 1234 --lease <token> --json
kit profiler stop <project> --lease <token> --json
kit profiler analyze <project> --session <capture-id> --out baseline.json --json
kit profiler compare --before baseline.json --after changed.json --out comparison.json --json
```

Supply the same seed, workload, tunables, warmup and other relevant scenario fields for both captures. The CLI adds source identity. The bridge records scene, resolution and runtime/profiler settings, but cannot infer actor counts or game state. A bookmark's tick is caller-supplied and does not synchronize the game.

Inspect `comparable`, `mismatches`, coverage warnings and `sourceChanges` before interpreting deltas. Keep Editor focus and background settings consistent across runs. Missing context means unknown comparability; changed scenarios make it false. Editor measurements include Editor overhead and background scheduling effects. See `docs/profiler.md` in the kit checkout for capture limits, exports and comparison semantics.

For repeatable setup and cleanup, a Play session can call project-owned static setup, step, check and teardown methods. It has no built-in virtual keyboard or Unity Test Framework runner. The scenario schema is in `docs/operations.md`.
