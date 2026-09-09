# Editor operations

The kit's protocol 2 connects the Node CLI or local MCP server to the installed UPM Editor service. See [setup](setup.md) for Codex, Claude Code and Cursor installation. Read the project's MCP configuration to locate the installed launcher before searching global plugin caches. Run `node <kit-checkout>/packages/cli/bin/kit.js --help`; CLI examples below abbreviate that command to `kit`. Pass the target Unity project path explicitly.

## MCP tools

The installed `unity-agent-kit` server is bound to the configured project. Start with `unity_status` and `unity_capabilities`. Prepare the change and run offline tests in an isolated worktree. Then acquire ownership, integrate the selected source into the Editor's checkout, and verify it:

```text
unity_lease_acquire {"owner":"my-task"}
unity_refresh {"leaseToken":"<token>","files":["Assets/Example.cs"]}
unity_check {"leaseToken":"<token>","method":"Example.Proof.Check","after":"<refresh-operation-id>"}
unity_lease_release {"leaseToken":"<token>"}
```

Use the returned token and successful refresh operation ID. If acquisition queues, resume it with the same owner and returned ticket; wait for a token before starting Editor work. Mutating MCP calls require ownership; read-only status, capability, console and operation queries do not. Calls can return `accepted: true` with an ID while work remains pending. Use `unity_operation_status` or `unity_operation_wait` to obtain completion before starting dependent work. The initial MCP wait is bounded to at most five seconds.

The server also exposes `unity_play_*` for Play lifecycle, `unity_profiler` for capture and queries, and `unity_profiler_compare` for comparisons. These use the same underlying operation, lease and evidence rules as the CLI below.

## Read operation responses

CLI and MCP Editor operation results share `id`, `state`, `ok` and `pending`. Check `pending` before interpreting `ok`; accepted work is not complete. `data` contains the bridge or service's structured response. Invocation results also include `returnValue`, its .NET `returnType`, and `returnValueKnown`. A returned string stays a string, even if it looks like JSON or `"False"`. Older receipts without typed return metadata retain display text with an unknown type; do not infer a boolean assertion from it.

Use `check` for assertions. A generic `invoke` can succeed while its returned value describes failure. Profiler commands combine invocation success with the profiler service's own `ok` result. Receipts created by 0.6.1 retain the method identity needed for the same handling after polling; older receipts without that identity cannot provide equivalent profiler recovery. Keep the distinction between operation completion and the project behavior you intended to verify.

For `op cancel`, top-level `ok` reports whether cancellation succeeded and matches `cancelled`. The nested `operation.ok` stays false because cancelled work did not complete. Successful cancellation therefore exits 0 in the CLI and is a successful MCP tool call.

Routine responses omit duplicated JSON fields. `rawReceiptPath` points to the durable receipt with the original diagnostics and payload. Request CLI `--details` or MCP `details: true` for expanded receipt fields; presented bridge metadata still removes ownership tokens. Lease acquisition returns the ownership token at `lease.token`; supply it as `leaseToken` to MCP mutations or `--lease` to CLI commands.

## Discover the running installation

```text
kit status <project> --json
kit capabilities <project> --json
kit status <project> --details --json
kit methods <project> --filter Namespace.Type --json
```

Status reports the selected project, session and readiness alongside CLI package path, version and protocol. Detailed CLI status also includes a source hash. `sourceHashPath` and `sourceHashScope` identify the exact hashed file; this hash does not cover the full CLI or its dependencies. Status and capabilities summarize assembly inventories by default, with `assemblyCount`, `assembliesIncluded` and `detailsAvailable`. Run a fresh status or capabilities request with details to inspect loaded assembly identities. Expanding an old compact receipt cannot reconstruct an inventory it never recorded. Use these to identify stale copies before diagnosing code behavior. A responsive Editor is not proof that a recent edit compiled.

Detailed local skill candidates report paths, SHA-256 hashes and available version metadata for unity-verify, unity-recipes and unity-topology. Discovery checks known project, user, source and plugin-cache locations, with at most four cached versions per provider. Routine status summarizes that inventory. These are candidates, not evidence of which skill text was injected into an agent. `injectionKnown` remains false. Prefer the project's copied skills, and inspect details when a stale installation is suspected.

## Own a sequence of operations

```text
kit lease acquire <project> --owner <task-id> --wait --json
kit lease status <project> --json
kit lease renew <project> --lease <token> --json
kit lease release <project> --lease <token> --json
```

Prepare source changes and run offline tests in isolated worktrees first. Acquire the token just before integration into the Editor's checkout and retain it through refresh, checks, Play, profiling and restoration. Release before returning to unrelated offline work. The default lease lifetime is 300000 ms; use `--ttl-ms` and renew for longer Editor work. Editing the shared checkout before acquisition does not safely shorten the lease.

Without `--wait`, acquisition returns ownership or `reason: "queued"` with a ticket and queue position. Resume with `lease acquire --owner <same-owner> --ticket <ticket>`, optionally adding `--wait`. A queued result has exit code 1, so inspect its reason rather than treating it as a failed Editor action. Cancel a ticket with `lease cancel --ticket <ticket>`. Tickets have deadlines; a new request is needed after expiry.

An expired lease remains reserved while tracked operations, a Play session or a profiler capture are active. Release refuses active work. The lease does not guard raw filesystem writes, legacy clients or actions outside this protocol. Assign serialized scene and prefab ownership separately.

The Editor sees only its own checkout. Integrate reviewed commits or selected patches before verification. If the starting work includes uncommitted edits, deliberately include the required tracked and untracked files; creating a worktree alone does not copy them. Preserve unrelated user changes, do not switch a dirty user checkout, and do not copy its `Library` to another project. The bridge has no automatic branch-switching or integration service.

## Prove a refresh, then invoke

```text
kit refresh <project> --file Assets/Example.cs --file Assets/Other.cs --lease <token> --json
kit check <project> --method Example.Proof.Check --after <receipt-id> --lease <token> --json
kit invoke <project> --method Example.Tools.Run --arg value --after <receipt-id> --lease <token> --json
```

The CLI hashes paths supplied with `--file`. The refresh receipt records compilation diagnostics, source-to-assembly mapping, reload epochs, loaded assembly identities and final hash checks. `--files manifest.json` instead accepts precomputed records as a JSON array, each with `path` and `sha256` fields. The Editor checks those supplied hashes against disk. Prefer repeated `--file` unless you already have such a manifest. `--probe proof.json` adds a loaded static-field assertion:

```json
{"type":"Example.Proof","field":"Revision","expected":"7"}
```

`expected` is a string compared with the field's invariant string representation. Use a field whose value distinguishes the expected code. The assertion proves that field value, not arbitrary behavior.

There is no Alt-Tab step in this workflow. The bridge explicitly calls `AssetDatabase.Refresh` and requests script compilation instead of depending on Unity regaining focus to notice changed files. The receipt still requires compilation and reload evidence. The bridge does not use window-focus APIs to make progress. [Unity's refresh documentation](https://docs.unity3d.com/6000.5/Documentation/Manual/AssetDatabaseRefreshing.html) distinguishes focus-triggered refresh from an explicit call; [the compilation API](https://docs.unity3d.com/6000.5/Documentation/ScriptReference/Compilation.CompilationPipeline.RequestScriptCompilation.html) schedules recompilation and assembly reload after success.

Background verification was exercised in a disposable graphical Editor on Windows with Unity 6000.5.5f1. The Editor stayed unfocused through a refresh that loaded changed code, a Play scenario, and a Game-view PNG capture. A source reload during Play also restored the original scene, time scale and run-in-background value. This is evidence for that tested Editor configuration, not a guarantee of progress through modal dialogs or arbitrary callback failures.

Take the receipt ID from a successful refresh result. `--after` rejects changed session, epoch, asset revision, requested content or assembly identity. If it is stale, investigate and refresh the current inputs again. An asset-only import or no-op does not prove C# compilation. A `check` returning boolean false or structured `ok: false` fails; `invoke` is available for static methods and menu actions, but successful invocation alone does not assert behavior.

For configuration and behavior claims, use a project proof method that inspects the intended loaded component, serialized asset or runtime system. A returned settings draft or getter may describe a different copy from the one the game consumes. Apply the change, check that actual state, and report the assertion performed. A bridge receipt proves the code and inputs that reached Unity; it cannot infer whether a project-specific setting took effect.

## Observe or cancel work

```text
kit op list <project> --json
kit op status <project> --id <operation-id> --json
kit op wait <project> --id <operation-id> --timeout-ms 120000 --json
kit op cancel <project> --id <operation-id> --json
kit console <project> --errors --last 30 --json
```

Ordinary requests wait for a bounded result. `--async` returns an accepted operation ID before completion. A request timeout attempts to cancel work still queued; inspect the cancellation result and operation state before retrying a mutation. `op wait` times out without cancelling. `op cancel` prevents queued work from starting but cannot undo a running static method. Do not remove request files manually.

Operations retain queued, running and terminal records under `Temp/unity-agent-kit`. Session identity prevents requests from silently crossing Editor restarts. These records support recovery, not rollback of arbitrary code. Use each feature's stop or cancel operation and observe cleanup before releasing its lease.

## Drive a bounded Play scenario

```text
kit session start <project> --lease <token> --config scenario.json --wait --json
kit session status <project> --lease <token> --id <session-id> --json
kit session stop <project> --lease <token> --id <session-id> --json
kit session cancel <project> --lease <token> --id <session-id> --json
```

Example `scenario.json`:

```json
{
  "scene": "Assets/Scenes/Test.unity",
  "durationSeconds": 10,
  "warmupSeconds": 0.5,
  "setupMethod": "Example.Scenario.Setup",
  "stepMethod": "Example.Scenario.Step",
  "checkMethod": "Example.Scenario.Check",
  "teardownMethod": "Example.Scenario.Teardown"
}
```

Callbacks must already exist in an assembly compiled from project `Assets`. Setup, check and teardown are static parameterless methods returning void, bool or string. The step callback is static `void Step(int frame)`. Its argument is the driver step index, not a deterministic simulation tick. The service does not add a virtual keyboard, infer game controls or run Unity Test Framework suites.

Start requires edit mode, clean loaded scenes and no compilation/import in progress. Duration is positive and at most 600 seconds; warmup is between zero and 60 seconds. A false check fails the session. Inspect `checkRan`: omitting a check gives lifecycle evidence only. A wait timeout can leave a session active; use status and stop/cancel to finish it.

Optional `screenshotPath` captures the actual Game view to a new PNG outside `Assets`. This requires a graphical Editor. Batch-mode sessions reject screenshot requests before changing Play or scene state; omit the screenshot option for batch verification.

The service temporarily enables `Application.runInBackground` for its owned Play session, and restores the previous value with the scene setup and time scale. While unfocused, a graphical session queues a player-loop update at most every 100 ms. A pending screenshot repaints existing Game views without opening or focusing a window. These calls do not promise a fixed simulation rate. Teardown owns game-specific state, spawned objects, input injection and other changes made by callbacks. The service cannot promise rollback of arbitrary callback effects. Do not discard or save user scene changes to bypass the dirty-scene rejection without existing authorization.

## Profile with scenario context

Use `kit profiler start <project> --context scenario-context.json --lease <token>` and keep ownership until recording ends. The context JSON can describe seed, workload, tunables and warmup. The CLI adds source identity; the Editor captures scene, resolution and settings. Bookmarks accept an optional caller-supplied `--tick` and event context. See [Profiler capture and analysis](profiler.md) for exports and matched comparisons. Measured deltas remain available when context differs, but `comparable: false` or unknown does not support a regression claim.
