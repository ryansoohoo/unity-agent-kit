# Setup for Codex, Claude Code and Cursor

The kit runs a local MCP server over stdio. Your coding client starts that process, and it talks to the kit package in the Unity Editor through the project's file channel. You do not need Unity's separate Pipeline/MCP package or a hosted bridge service.

## Install once per project and machine

Install Git and Node.js 20 or newer, and have an existing Unity 6 project available locally. Use the Unity version required by that project. Native Editor verification currently covers Windows with Unity 6000.5.5f1; macOS/Linux native Editor behavior is not yet verified.

```sh
git clone https://github.com/ryansoohoo/unity-agent-kit.git
cd unity-agent-kit
git checkout v0.6.0
npm ci
node scripts/setup.mjs --project "/path/to/UnityProject" --client codex
```

Choose `codex`, `claude`, `cursor`, or `all`. Quote paths containing spaces. On Windows, use your actual path, for example `"C:/Projects/My Game"`.

Setup adds the local `com.unity-agent-kit.doctor` UPM dependency, the selected client's project MCP configuration, and five focused skills. It preserves unrelated configuration. Conflicting kit entries are reported; `--replace` explicitly replaces them and saves their previous values. `--no-skills` installs the connection without copying skills. Setup does not rewrite `AGENTS.md` or `CLAUDE.md`.

The saved paths are absolute and local. Keep the clone in place and run setup on every machine that uses it. Review generated project files before committing them, because another developer's checkout paths will differ.

Open the Unity project once and wait for its package import and C# compilation. Then open the same project in your coding client and enable the connection below. Unity can remain in the background after it is ready.

## Choose your client

| Client | Project MCP configuration | Copied skills |
| --- | --- | --- |
| Codex | `.codex/config.toml` | `.agents/skills/` |
| Claude Code | `.mcp.json` | `.claude/skills/` |
| Cursor | `.cursor/mcp.json` | `.agents/skills/` |

Cursor supports the shared `.agents/skills` directory as well as its own skill directory. See its [skill discovery reference](https://cursor.com/docs/skills).

### Codex and GPT models

Use a local Codex desktop, CLI or IDE session attached to the Unity project. Trust the project so its `.codex/config.toml` is eligible to load. Start a new session after setup; in the CLI, `codex mcp list` shows configured servers and `/mcp` shows active connections. The IDE extension also has MCP server settings. These clients support local stdio configuration as described in the [official Codex MCP guide](https://developers.openai.com/codex/mcp/).

This is the GPT setup path for the kit. The installer does not make your local Unity process available to browser ChatGPT or a cloud coding task. Client accounts, model selection and tool permissions remain client settings.

### Manual Codex setup for unsupported TOML

The helper refuses multiline TOML strings and inline or dotted MCP maps before changing files. It supports ordinary `[mcp_servers.unity-agent-kit]` tables and their child tables. If your existing Codex configuration uses an unsupported form, keep it intact and configure these three pieces manually:

1. In the Unity project's `Packages/manifest.json`, add `"com.unity-agent-kit.doctor": "file:/absolute/path/to/unity-agent-kit/upm"` inside the existing `dependencies` object. Keep the other dependencies. On Windows, the value can be `"file:C:/Tools/unity-agent-kit/upm"`.
2. Add or update this table in the project's `.codex/config.toml`. Replace every example path with an absolute path on your machine. `node -p "process.execPath"` reports the Node executable; use forward slashes for Windows paths in this example.

   ```toml
   [mcp_servers.unity-agent-kit]
   command = "/absolute/path/to/node"
   args = ["/absolute/path/to/unity-agent-kit/packages/mcp/bin/server.js", "--project", "/absolute/path/to/UnityProject"]
   ```

3. For the optional skills, copy each `skills/<name>/SKILL.md` from the kit into the project's `.agents/skills/<name>/SKILL.md`, preserving the five folder names.

Then open Unity and connect Codex as above. Manual changes are not recorded in the setup helper's backup, so remove or restore those entries and copied files yourself when uninstalling. The Editor status commands below still verify the live connection.

### Claude Code

Start Claude Code from the Unity project's directory. Accept its project MCP trust prompt for `unity-agent-kit`, then use `/mcp` to inspect the connection. A project `.mcp.json` requires approval before Claude Code uses its servers. See [Claude Code's MCP documentation](https://code.claude.com/docs/en/mcp).

The installer supplies both the connection and project skills. A separate marketplace skill installation is not required for this setup.

### Cursor

Open the Unity project as the workspace. Find `unity-agent-kit` in Cursor's MCP settings, enable it if needed, and start a new Agent task. Cursor discovers project servers from `.cursor/mcp.json` and starts local stdio servers itself. See [Cursor's MCP documentation](https://cursor.com/docs/mcp).

If a connection fails, inspect its MCP logs and the command shown in the generated configuration. The installer uses absolute executable and script paths to avoid relying on the terminal's working directory.

## Check the connection

From the kit clone, first verify the installed configuration:

```sh
node scripts/setup.mjs --project "/path/to/UnityProject" --client codex --check
```

`--check` reads the desired configuration and installed files. Exit code 0 means they match; code 1 means setup differs. It does not launch Unity, start an MCP connection or prove that C# compiled.

With Unity open, check the actual Editor:

```sh
node packages/cli/bin/kit.js status "/path/to/UnityProject" --json
node packages/cli/bin/kit.js capabilities "/path/to/UnityProject" --json
```

Confirm the project path, runtime version and protocol 2 response. In your client, ask the agent to call `unity_status` and `unity_capabilities`. A connected MCP server can exist while Unity is closed, so check both layers.

If the client has no tools, confirm that you opened the configured project, trusted its configuration and restarted the task. If the Editor does not answer, check its package import and compilation errors. If paths moved, rerun setup against the new clone location and review any reported conflict. Background operation does not bypass a modal dialog or an unrelated broken script.

## Use the connection

Ask agents to acquire one lease for their complete Editor sequence, refresh the changed files, check against the returned receipt, complete Play/profiler cleanup, then release. Waiting agents can continue code work in separate worktrees. They must integrate the selected changes into the Editor's checkout before verification. The bridge does not switch branches or merge worktrees for them.

Play callbacks are existing static C# methods under project `Assets`. They define game-specific setup, input, assertions and teardown. The service does not press physical keys or provide a Unity Test Framework runner. See [Editor operations](operations.md) for callback signatures and a scenario JSON example.

Profiler context records scene, resolution, focus, background settings and caller-supplied workload information. Keep those conditions matched when comparing changes. See [Profiler capture and analysis](profiler.md) for CPU sample queries, overhead and archive limits.

## Update or remove

For an update, fetch the desired release in the kit clone, check out its tag, run `npm ci`, and rerun setup for the project. Let Unity import the package and restart the coding session. Use `--replace` only after reviewing a conflicting kit entry or skill that setup reports.

To reverse this project's setup:

```sh
node scripts/setup.mjs --project "/path/to/UnityProject" --undo
```

Undo uses `.unity-agent-kit/setup-state.json` and its saved originals. It reverses entries and files only when they still match what setup installed, preserving unrelated edits. If any owned entry was edited, the entire undo stops before changing files and reports the conflict. Stop active Play/profiler work first, and remove setup before deleting or moving the kit clone.
