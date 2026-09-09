# Unity Agent Kit

Connect a local coding agent to Unity through MCP. Check which code the Editor loaded, run project checks and Play scenarios, and inspect CPU profiler captures without switching to the Unity window.

Works with **Codex, Claude Code and Cursor**. The same bridge is available as a CLI. Unity's separate Pipeline/MCP package is optional.

## Get started

You need Git, Node.js 20 or newer, an existing Unity 6 project, and one of the supported local coding clients.

```sh
git clone https://github.com/ryansoohoo/unity-agent-kit.git
cd unity-agent-kit
git checkout v0.6.0
npm ci
node scripts/setup.mjs --project "/path/to/UnityProject" --client codex
```

Replace the project path and choose `codex`, `claude`, `cursor`, or `all`. On Windows, a path such as `"C:/Projects/My Game"` works. Keep this clone in place: the project and MCP configuration reference it.

Open the Unity project once and let the package finish importing. Open the same project in your coding client, trust or enable its `unity-agent-kit` MCP server, and start a new task. See the [client setup guide](docs/setup.md) for the exact files, connection checks and uninstall command.

Try this prompt:

> Use Unity Agent Kit to report the connected Editor's project, version and state. Discover the available checks before running any project code.

For GPT models, use a local Codex desktop, CLI or IDE session. This setup does not connect browser ChatGPT directly to a local stdio process.

## What the bridge does

| Task | Evidence or control |
| --- | --- |
| Verify changed C# | Refresh receipts link requested file hashes to compilation, reload and loaded assemblies. A follow-up check can require that receipt. |
| Coordinate agents | FIFO leases reserve an Editor sequence through refresh, checks, Play, profiling and cleanup. |
| Recover from waits | Durable operation IDs distinguish queued, running and completed work. Queued operations can be cancelled. |
| Exercise gameplay | Bounded Play sessions call your static setup, step, check and teardown methods, with optional Game-view PNG capture. |
| Investigate CPU cost | Native captures preserve caller paths, threads, allocations and archive history. Comparisons report scenario and focus mismatches. |
| Check project setup | The doctor inspects repository hygiene, Unity YAML merge setup, package state and agent skills. |

Parallel agents can work in separate checkouts. One owner integrates their changes into the checkout the Editor actually opened, then verifies them. A lease does not merge branches or block direct filesystem writes.

Background refresh and Play have been verified on Windows with Unity **6000.5.5f1**. Other Unity 6 versions and native Editor behavior on macOS/Linux have not received the same native verification. A responsive Editor does not prove compilation, and a completed Play session does not prove game behavior without a check. See [operation verification](docs/operations-verification.md).

## Read more

- [Setup, client configuration and removal](docs/setup.md)
- [Editor operations, receipts and Play callbacks](docs/operations.md)
- [Profiler capture, comparisons and limits](docs/profiler.md)
- [Profiler verification evidence](docs/profiler-verification.md)
- [Release notes](CHANGELOG.md)

Play sessions restore scene setup, time scale and their temporary background setting. Your callbacks own their other effects. The profiler measures recorded CPU samples; it does not provide memory object snapshots, GPU hardware analysis or automatic game-input injection.

## Develop the kit

```sh
npm ci
npm run build:plugin
npm run build:upm
npm test
```

Native proof fixtures belong in disposable Unity projects. The verification guides describe the tested scope. This project is [MIT licensed](LICENSE).
