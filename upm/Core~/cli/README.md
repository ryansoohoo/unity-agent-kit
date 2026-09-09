# Unity Agent Kit CLI

Use the CLI to inspect a Unity Editor, refresh changed source, run checks, coordinate leases, drive Play scenarios and inspect CPU profiler captures.

Start with the [public setup guide](https://github.com/ryansoohoo/unity-agent-kit/blob/main/docs/setup.md). It installs the Unity package, local MCP connection and skills for Codex, Claude Code or Cursor.

From a kit checkout:

```sh
node packages/cli/bin/kit.js --help
node packages/cli/bin/kit.js status "/path/to/UnityProject" --json
node packages/cli/bin/kit.js capabilities "/path/to/UnityProject" --json
node packages/cli/bin/kit.js doctor "/path/to/UnityProject" --json
```

For Editor mutations, hold a lease through refresh, checks and cleanup. Use refresh receipts to require the expected loaded code, and inspect operation state before retrying a timeout. See [Editor operations](https://github.com/ryansoohoo/unity-agent-kit/blob/main/docs/operations.md) and [profiler commands](https://github.com/ryansoohoo/unity-agent-kit/blob/main/docs/profiler.md).

Requires Node.js 20 or newer. Native Editor verification covers Windows with Unity 6000.5.5f1. [Source and release notes](https://github.com/ryansoohoo/unity-agent-kit).
