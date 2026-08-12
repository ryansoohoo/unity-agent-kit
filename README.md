# Unity Agent Kit

Unity Agent Kit makes any Unity project agent-ready in one guided setup — checked git/repo
hygiene, split workflow skills for coding agents, and a tailored `CLAUDE.md` — with the goal
of being the best agent↔Unity workflow, one download. It wraps Unity's own official CLI and
MCP server rather than competing with them, and everything it does is either a read-only
check or a consented, undoable fix.

## Support matrix

**Verified: Windows + Unity 6.x.** That's the only platform/version combination this kit has
actually been run and tested against. Checks that don't apply to your machine or project
report `na`, not a guess — you'll never see a false pass. macOS/Linux and pre-6.x Unity are
untested; some checks will correctly report `na` there (e.g. `longpaths` and `path-headroom`
are Windows-only concerns), others simply haven't been verified yet.

## Quick start

### Door 1: npx CLI

The published `npx unity-agent-kit` form ships with the npm release; until then, run it from
a clone (below) — the CLI itself is fully working today, only the npm publish step is pending.

```
# From a clone of this repo (works today):
npm install
node packages/cli/bin/kit.js /path/to/your/unity/project          # doctor
node packages/cli/bin/kit.js --fix /path/to/your/unity/project     # wizard
```

Once published to npm:

```
npx unity-agent-kit
```

Runs the doctor: read-only, safe to run on any tree. It never changes anything by itself.

```
npx unity-agent-kit --fix
```

Runs the per-step consent wizard: walks each failing check, shows you the evidence and the
one-line why, and asks `Apply? [y/N/a/q]` before touching anything.

Other flags (same for both forms above):
- `--yes` — apply without prompting (for CI; still per-check, just non-interactive)
- `--only <layer|id>` — scope to one layer (e.g. `hygiene`) or one check id (e.g. `merge-driver`)
- `--undo` — reverse everything the kit has applied in this project
- `--json` — machine-readable output

Exit code is `1` if and only if at least one check is failing; `0` otherwise.

### Door 2: Claude Code plugin

Clone this repo, then load the plugin directory to get the five skills below available
inside Claude Code:

```
claude --plugin-dir ./plugin
```

This repo doesn't ship a marketplace catalog (`.claude-plugin/marketplace.json`), so
`/plugin install` isn't an available install path — `--plugin-dir` is what works today.
The plugin ships the skills only; the doctor/wizard still comes from the CLI door above.

### Door 3: UPM — coming in v1.1

A Unity Package Manager door (install via `manifest.json`, no Node required) is planned for
v1.1. It doesn't exist yet — don't add it to a `manifest.json` expecting it to resolve.

## What the doctor checks

Eight checks, each with `detect` (read-only) and `explain` (why it matters). Five of them —
`merge-driver`, `longpaths`, `worktree-ignore`, `blast-radius`, `unity-mcp` — also have
`apply` (consented, undoable). `merge-driver` additionally has `verify`: a 5-case regression
suite that proves the fix, not just a re-check of the same detect logic.

| id | why |
|---|---|
| `merge-driver` | Routes Unity YAML (scenes, prefabs, `.meta`, materials) to a tested merge driver instead of git's default text merge, which can write conflict markers into a `guid:` line — Unity treats that as a corrupt `.meta` and may regenerate the GUID, silently repointing every reference. Proven by a 5-case regression suite, not just "config looks right." |
| `longpaths` | Enables `core.longpaths` so Windows' 260-character `MAX_PATH` doesn't break git operations on Unity's deeply nested `Library/PackageCache` paths. |
| `worktree-ignore` | Gitignores `.claude/worktrees/` so `git clean -xdf` — the most commonly recommended fix for a corrupt `Library/` — can't delete an agent's uncommitted work along with it. |
| `unity-version` | Reports your Unity version against the verified support matrix (Windows + Unity 6.x) — honesty about what's actually been tested, not a compatibility promise. |
| `path-headroom` | Measures how much `MAX_PATH` headroom is left once a worktree prefix is added on top of Unity's already-deep `Library/` paths, so imports don't fail with confusing native errors. |
| `editor-churn` | Warns on uncommitted scene files and editor reserialization churn (`ProjectSettings/`, `Assets/Settings/`) before an agent session starts — the kit never commits for you. |
| `blast-radius` | Installs destructive-command deny rules (`git clean`, `git reset --hard`, `rm -rf`, etc.) into `.claude/settings.json` so the commands that can nuke `.meta` files or `Library/` require explicit human approval. |
| `unity-mcp` | Registers Unity's own free MCP server with Claude Code via `unity mcp configure claude-code` — the kit wraps the vendor's tooling instead of shipping a competing bridge. |

## What the skills teach

Five skills, installed by the Claude Code plugin:

- **unity-verify** — three-tier verification, cheapest first: Roslyn eval with no reload, a
  headless `dotnet build` typecheck, or a full editor recompile — pick the cheapest tier that
  answers the question.
- **unity-merge** — how to read and resolve Unity YAML conflicts left by the merge driver
  (`UU` files stay valid YAML, never corrupted `.meta` guids).
- **unity-topology** — one hot editor for anything touching the asset graph, many cold
  worktrees for code-only work, so parallel agents don't corrupt shared state.
- **unity-recipes** — five common agent operations (compile-wait, console read, asset
  refresh, perf investigation, scene edit ownership) as bad-pattern/good-pattern pairs.
- **unity-claude-md** — interviews you about your project, then generates a `CLAUDE.md`
  tailored to it instead of a generic template.

## What the kit never does

- Never runs `git commit` for you.
- Never uploads anything — there is no network call anywhere in the checks engine.
- `detect()` never mutates your project — it only reads files and git config.
- Every `apply()` is undoable via `--undo`.

## Evidence

The regression suite ships in this repo (`packages/core/test/merge-driver.test.js` and
`packages/core/assets/test-merge-driver.sh`) and runs as part of `npm test`. The design and
research docs behind these claims live in the Kintarō repo's `docs/research/`.

## License

MIT — see `LICENSE` and `NOTICE`.
