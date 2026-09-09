# Unity Agent Kit

The Editor bridge for [Unity Agent Kit](https://github.com/ryansoohoo/unity-agent-kit).
It supplies compilation receipts, discovery, checks, scoped Play sessions,
console access, and profiler operations through a local file transport.

For Codex, Claude Code, or Cursor, follow the [setup guide](https://github.com/ryansoohoo/unity-agent-kit/blob/v0.6.0/docs/setup.md).
The setup command installs this package, configures the shared MCP server, and
copies the client skills. Installing this UPM package alone does not configure MCP.

Requires Unity 6. Native Editor verification currently covers Windows with
Unity 6000.5.5f1. The CLI and MCP server require Node.js 20 or later.

After importing, open **Window > Unity Agent Kit** to inspect the project.
The bridge runs without making the Editor the foreground application. Play checks
temporarily enable background execution and restore the previous setting afterward.

Each Editor serves its own project checkout. Use the bridge lease queue to share
one Editor across agents, and integrate branch changes into that checkout before
requesting verification.
