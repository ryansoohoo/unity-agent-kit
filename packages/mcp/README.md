# Unity agent kit MCP server

A local STDIO adapter for MCP clients such as Codex, Claude Code and Cursor. It uses the same Unity package, durable request files and FIFO leases as the CLI. It does not launch Unity or install its package.

From a repository checkout after `npm ci`, configure your client to launch:

```text
node /absolute/path/to/unity-agent-kit/packages/mcp/bin/server.js --project /absolute/path/to/UnityProject
```

On Windows, use absolute Windows paths in the client's argument array. The project must contain `Assets`, `Packages/manifest.json` and `ProjectSettings/ProjectVersion.txt`. Each server process binds to one project. Standard output carries only MCP messages; startup errors go to standard error. See the repository's [setup guide](../../docs/setup.md) for client configuration.

This requires a client that can launch local STDIO MCP servers. The ChatGPT website cannot launch this local process directly. The server runs with your local account's permissions. Leases coordinate trusted tools; they are not an access-control sandbox for arbitrary invoked C#.

## Working sequence

1. Call `unity_status` to inspect the bound project, bridge heartbeat and loaded runtime. It reports an absent Editor without creating requests.
2. Call `unity_lease_acquire` with `{"owner":"your-task-id"}`. Save `lease.token` as `leaseToken`. If queued, retry with the same `owner` and returned `ticket`.
3. After integrating files into the Editor's checkout, call `unity_refresh` with `{"leaseToken":"...","files":["Assets/Foo.cs"]}`.
4. Poll `unity_operation_status` or `unity_operation_wait` with its `id` until the refresh completes successfully. Use that ID as `after` in `unity_check`, `unity_invoke` or Play start.
5. Keep the lease through verification, Play, profiling and restoration. Renew it when needed, then call `unity_lease_release` with `{"leaseToken":"..."}` after all cleanup finishes.

Editor requests wait at most five seconds per MCP call. `pending:true` and `accepted:true` mean a request has an operation ID, not that verification succeeded. The `timeoutMs` argument sets the Editor's dispatch deadline; it cannot interrupt code that already started. MCP cancellation, client timeout and disconnect never cancel Unity work or release its lease. Inspect the operation before retrying a mutation.

`unity_operation_cancel` atomically removes a queued request when it can. A running synchronous call or Task cannot be forcibly interrupted. Use `unity_play_stop` or `unity_play_cancel` for owned Play sessions and profiler `stop` or `cancel` for captures. These services must finish restoration before lease release succeeds.

## Tools

| Tools | Purpose |
| --- | --- |
| `unity_status`, `unity_capabilities` | Project/runtime identity and method discovery. Capabilities accepts `filter`, `offset` and `limit` up to 200. A nonempty filter needs at least three characters. |
| `unity_lease_acquire`, `unity_lease_status`, `unity_lease_renew`, `unity_lease_release`, `unity_lease_cancel` | FIFO ownership. Cancel takes the queued `ticket` and its `owner`. Renew/release take `leaseToken`. |
| `unity_refresh` | Hash changed files and request import/compilation evidence. Optional `probe` has string `type`, `field` and `expected` fields. |
| `unity_invoke`, `unity_check` | Exact static method calls and assertions. Invoke also accepts a menu path. Returning false or an object with `ok:false` is still a successful generic invocation; check interprets assertions. |
| `unity_operation_status`, `unity_operation_wait`, `unity_operation_list`, `unity_operation_cancel` | Durable operation results, bounded waits and queued cancellation. |
| `unity_play_start`, `unity_play_status`, `unity_play_stop`, `unity_play_cancel` | Bounded scenarios with named project callbacks and restoration. The start request completing only acknowledges the session. |
| `unity_console`, `unity_console_clear` | Read or clear the bridge console mirror. Clearing the mirror does not clear Unity's Console window. |
| `unity_profiler` | Existing profiler actions with typed `options`. Capture start automatically records the checkout path, Git revision and branch alongside supplied scenario context. |
| `unity_profiler_compare` | Compare two saved analyze JSON exports inside the bound project, including source/context differences. |

All Editor mutations require a matching `leaseToken`. Observing status, capabilities, operations, Play status and console does not require a lease. Profiler `status`, `targets`, `sessions`, `frames`, `threads`, `frame` and `sample` are read-only; other profiler actions require ownership. `analyze` can load archived frames into the live buffer and therefore requires a lease. An expired owner may request Play/profiler cleanup while its active work still holds ownership; renew before starting additional work.

Operation results preserve the Editor's invocation outcome and expose returned data separately. For a completed profiler operation, inspect the profiler response's own `data.ok` too. Malformed result JSON keeps its operation ID and raw receipt, with `dataError` describing the parsing failure.

## Development

The adapter uses the published v1 [official MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/). Its Node integration tests launch the actual STDIO server with an SDK client and a simulated Editor; they do not launch Unity.

```text
npm test --workspace @unity-agent-kit/mcp
```

The repository's native verification scripts exercise the same MCP server against an installed Unity Editor. Simulated Editor tests establish transport and dispatch behavior; they do not establish that a source change compiled or that a Play check passed in Unity.
