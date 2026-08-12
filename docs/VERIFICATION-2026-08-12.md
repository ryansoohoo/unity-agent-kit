# Unity Agent Kit — cold-start capability verification

**Auditor:** fresh agent, zero prior context. Nothing below is taken on the repo's word;
every row cites a command I ran or a file I read in my own clone.

- **Clone:** `C:\Users\Ryan\AppData\Local\Temp\claude\C--\1881d466-e39d-4da4-8907-471c667faf8a\scratchpad\kit-verify\unity-agent-kit` (from `C:\Users\Ryan\unity-agent-kit`, commit `0ea82b7`, v0.3.0)
- **Victim repo:** `...\scratchpad\kit-verify\victim` (disposable `git init`, fake `ProjectVersion.txt` = 6000.5.5f1)
- **Scratch Unity project:** `...\scratchpad\uak-proof-proj`, editor `6000.5.5f1`
- **Toolchain:** Node v24.18.1, npm 11.16.0, git 2.55.0.windows.3
- **Suite:** `npm test` → **102 pass / 0 fail** (102 total, duration 33.0 s) — matches the README/BUILD-LEDGER claim exactly.
- **Live proof (3 iters):** `{"ok":true,"iters":3,"completed":3,"falseSuccesses":0,"staleReads":0,"timeouts":0,"waitMs":{"min":1820,"median":2071,"max":2072}}`
- **Unity login:** never performed. No Unity account was used at any point.
- **Editor hygiene:** `tasklist` before = 0 Unity processes; after = 0 Unity processes. Harness killed its own child.

## Verdict counts

| Verdict | Count |
|---|---|
| VERIFIED | 19 |
| VERIFIED-AS-INHERITED | 8 |
| PARTIAL | 0 |
| NOT VERIFIED | 0 |

---

## Row-by-row

| # | Row | Claimed | Verdict | Evidence |
|---|---|---|---|---|
| 1 | Free, no subscription | ✓ | **VERIFIED** | `head -5 LICENSE` → "MIT License / Copyright (c) 2026 Ryan Soohoo". `npm install` → "added 2 packages… found 0 vulnerabilities"; `ls node_modules/` → only `@unity-agent-kit`, `unity-agent-kit` (workspace links). No payment, signup, or auth prompt anywhere in clone→install→run. |
| 2 | No Unity account / login | ~ | **VERIFIED** (kit column) | Every kit operation in this audit ran with zero Unity login: doctor, `--json`, `--fix --yes`, `--undo`, merge-driver proof, skill-lint, and a live headless editor. `grep -rniE "auth login\|unity auth\|login\|credential\|api[_-]?key\|token" packages/core/src packages/cli/bin upm/Editor` → only LLM *token-counting* hits (`audit.js`, `skill-lint.js`, `transcripts.js`); zero authentication code. The `~` is honest — it belongs to the vendor MCP door. |
| 3 | Open source | ✓ | **VERIFIED** | All 12 checks, engine, CLI and C# readable in-clone. `find . \( -name "*.min.js" -o -name "*.dll" -o -name "*.exe" -o -name "*.so" \)` → empty. MIT + `NOTICE` crediting adapted ideas (no code copied). |
| 4 | Maintained by "you + vendor core" | descriptive | **VERIFIED** (architecture) | `packages/core/src/checks/unity-mcp.js:13` — `execFileSync('unity', ['mcp','configure','claude-code'], …)`. The kit shells to the vendor CLI; it ships no competing bridge (see rows 6/20 — zero socket or HTTP code anywhere). |
| 5 | MCP door (agent-native) | ✓ via vendor registration | **VERIFIED** (check read, real configure NOT run) | `unity-mcp.js` detect reads `.mcp.json` then `~/.claude.json` for a `/unity/i` server; apply calls the vendor configure and captures `restore-file` undo. Confirmed I never ran it: `ls victim/.mcp.json` → "No such file or directory". 6 unit tests for this check pass in the suite. |
| 6 | Remote / Streamable-HTTP MCP | ✗ (absence) | **VERIFIED** | `grep -rE "createServer\|\.listen\(\|node:http\|WebSocket\|net\.Server\|dgram\|Socket\("` over `packages/` → **No matches found**. Also `fetch\|axios\|https\|http://` over `packages/core/src` → **No matches found**. The "never uploads anything" README claim holds. |
| 7 | Human & CI CLI door | ✓ | **VERIFIED** | Human: `node packages/cli/bin/kit.js <victim>` → 12 rows, "4 failing", `EXITCODE=1`. Machine: `--json` → 12-element array, keys `id,layer,title,status,evidence,canApply,explain`, `JSON_EXITCODE=1`. Clean tree → exit 0 (`--only editor-churn` → "No failures", exit 0). *Nit: `--json` is a bare top-level array; README documents only "machine-readable output".* |
| 8 | Warm machine protocol (ndjson) | inherited | **VERIFIED-AS-INHERITED** | Vendor present and login-free: `where unity` → `C:\Users\Ryan\AppData\Local\Unity\bin\unity.exe`; `unity --version` → `1.0.0-beta.3` with no login. Kit reimplements nothing: `grep -rniE "ndjson\|daemon\|persistent process"` over `packages/core/src upm/Editor` → no implementation hits. README:5-7 states it "wraps Unity's own official CLI and MCP server rather than competing with them." |
| 9 | Parallel subagents (no cap) | inherited + kit skill | **VERIFIED-AS-INHERITED** (kit's skill VERIFIED) | `skills/unity-topology/SKILL.md` exists and encodes the rule: "Unity permits exactly ONE editor per project folder (Temp/UnityLockfile…)", HOT serialize vs COLD parallelize split, with costs (~2.5 GB + ~103 s cold init; editorless worktree verifies in ~0.6 s) and bounded-dispatch rules. The no-cap concurrency itself is the vendor MCP's. |
| 10 | Eval without domain reload | inherited + skill | **VERIFIED-AS-INHERITED** | `skills/unity-verify/SKILL.md:11` — "## Tier 0 — eval (~300 ms, no reload)", "`unity command eval "<expr>"` (Unity CLI) runs Roslyn-compiled C# in the live editor with NO recompile and NO domain reload." Vendor CLI presence confirmed (row 8); eval itself is login-gated, so presence-check only — not executed. |
| 11 | Console · tests · screenshots · play mode | inherited | **VERIFIED-AS-INHERITED** | README:5-7 wrapping stance (quoted row 8). Kit implements none of these: the twelve checks are git/repo/process/transcript reads only (`--json` layer listing: hygiene ×7, integration ×2, audit ×1, workflow ×1). |
| 12 | Profiler | ~ (inherited gap) | **VERIFIED-AS-INHERITED** | `grep -rniE "profiler\|ProfilerRecorder\|deep profile"` over `packages/ upm/ skills/ README.md` → 2 hits, both *advisory prose* in skills (`unity-recipes:50`, `unity-verify:50` — "re-measure against live profiler/frame numbers"). Zero profiler tooling shipped; the `~` is an honestly-claimed gap. |
| 13 | Custom tools via C# attribute | inherited; kit adds none | **VERIFIED-AS-INHERITED** | `grep -nE "\[McpTool\|MenuItem\|Attribute\]\|Reflection\.Emit\|Activator"` over `upm/` → exactly one hit: `KitDoctorWindow.cs:14 [MenuItem("Window/Unity Agent Kit")]`. `KanaboEpoch.cs:17-18` states the ceiling: "ZERO tool surface by design: no scene ops, no eval, no serializers. A status file out, one refresh verb in. That's all this will ever be." |
| 14 | Multi-editor routing | inherited | **VERIFIED-AS-INHERITED** (kit door VERIFIED) | `packages/cli/bin/kit.js:13` — `const root = args.find(a => !a.startsWith('--') && a !== opt('--only')) ?? process.cwd();` — explicit positional project root on every invocation. Proven in use: I drove three different roots (victim, scratch project, the clone itself) in one session. |
| 15 | Undo groups + confirm/dry-run gates | KIT'S OWN | **VERIFIED** | `--fix --yes --only hygiene` applied 3 fixes (longpaths, worktree-ignore, blast-radius), each printing evidence + why. `.unity-agent-kit/applied.json` written with per-fix `undo` entries (`git-config-restore`, `restore-file` with `previous: null`). `--undo` → "undid: restored …settings.json / …gitignore / git config --unset core.longpaths"; post-state: `git config --get core.longpaths` empty, both files gone, `applied.json` = `{"applied": []}`, and the doctor reports the same 4 FAILs again. Clean round trip. |
| 16 | Explicit compile trigger + pollable status | KIT'S OWN (v2) | **VERIFIED** (live) | `node scripts/kanabo-proof.mjs --project <scratch> --unity <6000.5.5f1> --iters 3 --launch` → `ok: true`, `completed: 3`. `refresh.request` is the trigger (`KanaboEpoch.cs:96-108` deletes it, sets `state="compiling"`, calls `AssetDatabase.Refresh()`); `--epoch` is the poll door → JSON with `"state":"ready"`, exit 0. |
| 17 | Survives reload without blind waits | KIT'S OWN | **VERIFIED** (live) | Same run: `timeouts: 0`, `waitMs {min:1820, median:2071, max:2072}` — bounded, sub-2.1 s, no sleeps. Consistent with the developers' recorded 100/100 (min 1774 / median 2272 / max 2306), so the mechanism reproduces cold on a different clone. |
| 18 | Staleness / epoch signal | KIT'S OWN | **VERIFIED** (live) | Same run: `staleReads: 0`, `falseSuccesses: 0`. Post-run `Temp/unity-agent-kit/epoch.json` → `"epoch":4` (1 boot + 3 reloads), `"probePresent":true,"probeValue":3`, and `Assets/UAK/EpochProbe.cs` = `Value = 3` — the epoch bump is corroborated by live-reflected new code, not just a counter. |
| 19 | Unfocused-editor refresh trap | KIT'S OWN | **VERIFIED** (live) | The proof editor is spawned `-batchmode -nographics -projectPath <root>` (`kanabo-proof.mjs` launchEditor) — headless, never focused. Imports still occurred: `worldRevision: 3` (one `OnPostprocessAllAssets` batch per iteration) and `refresh.request` was consumed (only `epoch.json` remains in `Temp/unity-agent-kit/`). |
| 20 | Editor-port auth on by default | inherited | **VERIFIED-AS-INHERITED** | The kit itself opens no ports to secure: JS grep (row 6) → no matches; `grep -nE "HttpListener\|TcpListener\|Socket\|WebRequest\|UnityWebRequest\|HttpClient\|\.Bind\(\|Listen\("` over `upm/` → **No matches found**. The signal is a file, so there is no kit port surface; port auth is the vendor's. |
| 21 | CoreCLR-ready design | code inspection | **VERIFIED** | `KanaboEpoch.cs` usings: `System`, `System.IO`, `System.Reflection`, `UnityEditor`, `UnityEditor.Compilation`, `UnityEngine` — standard APIs (`SessionState`, `EditorApplication.update`, `AssemblyReloadEvents`, `AssetPostprocessor`), signal is plain `File.WriteAllText`. Reflection is **read-only** (`Type.GetType` → `GetField` → `GetRawConstantValue`), no `Reflection.Emit`/`DynamicMethod`/`AppDomain`. `KitDoctor.cs` adds only `System.Diagnostics.Process` (shells to Node); no `DllImport`/`Marshal`/`unsafe`. |
| 22 | Merge-safe parallel output | KIT'S OWN | **VERIFIED** | After adding `*.unity merge=unityyamlmerge` to the victim, `--fix --yes --only merge-driver` printed verbatim: `verify: PROVEN — 5/5 regression cases pass (disjoint scene/prefab/meta merge clean; guid & same-field conflicts stop as valid YAML)`. Not a config-string check — `assets/test-merge-driver.sh` builds a real repo per case, branches twice, runs `timeout 60 git merge sideA`, and asserts on `git status` **and** `grep -c '<<<<<<<'` (markers are never acceptable). Persisted to `.unity-agent-kit/verify.json` → `{"merge-driver":{"ok":true,…}}`. |
| 23 | Worktree / branch safety on Windows | KIT'S OWN | **VERIFIED** | Post-hygiene-wizard: `git config --get core.longpaths` → `true`; `cat .gitignore` → `/.claude/worktrees/` under a comment explaining it must survive `git clean -xdf`. Both reverted by `--undo` (row 15). |
| 24 | Editor-churn detection | KIT'S OWN | **VERIFIED** | Committed `Assets/X.unity`, then modified it. `--only editor-churn` → `WARN editor-churn uncommitted scene files (unreconstructable if lost): Assets/X.unity — commit these before agent sessions`. Names the exact file; exit 0 (a warn, not a block) — consistent with "the kit never commits for you". |
| 25 | Workflow skills | ✓ | **VERIFIED** | 5 `SKILL.md` present (unity-verify, unity-merge, unity-topology, unity-recipes, unity-claude-md). Every description has both a firing condition and a negative trigger — e.g. unity-merge: "Use when git shows conflicts (UU)… **Do NOT use for** compile verification (unity-verify) or normal code merges." Dogfood: `node packages/cli/bin/kit.js . --only skill-lint` → `OK skill-lint 5 skill(s), ~214 resting tokens, all descriptions well-formed`, exit 0. |
| 26 | Windows lifecycle hazards verified & checked | ✓ | **VERIFIED** | All three exist and produced real, non-guessed output on the scratch project: `orphans` → `WARN stale Temp/UnityLockfile with no Unity running` (it caught the residue of my *own* killed proof editor); `path-headroom` → `WARN longest Library path 253 chars → ~-31 chars of worktree-name headroom under MAX_PATH` (a real measurement, and genuinely negative); `kanabo` → `-- editor not running (heartbeat stale; last epoch 4)`. |
| 27 | Guided setup doctor with real verification | ✓ | **VERIFIED** | The end-to-end flow in this audit: doctor (12 rows, 4 FAIL, exit 1) → consent wizard `--fix --yes` (3 hygiene fixes, each with evidence + why + ledger entry) → **real** proof (merge-driver 5/5 real git merges; Kanabō 3/3 live headless editor) → `--undo` (full reversal, doctor shows the failures again). Nothing in the chain was a self-assertion; each green came from an executed check. |

---

## What did NOT hold up

Nothing failed. Every ✓/~/✗ in the Kit column survived the audit. Three asterisks worth recording:

1. **`--undo` leaves `.unity-agent-kit/` behind.** The project's own files revert exactly (files deleted, git config unset, tree clean), and `applied.json` is correctly emptied to `{"applied": []}` — but the ledger *directory* remains as new untracked content (`git status --porcelain` → `?? .unity-agent-kit/`). Defensible (it's the audit trail, and `verify.json` lives there too), but "returns to its prior state" carries this one asterisk. It is untracked and harmless.
2. **`--json` shape is undocumented.** It emits a bare top-level array, not an object. My first parse attempt assumed `{checks: [...]}` and threw. A CI consumer will hit the same thing once. One README line would fix it.
3. **`merge-driver` reports `na`, not `fail`, when no `.gitattributes` routing exists.** On first read this looks like a skipped check. It is actually the "never a false pass" design working: the check only fires once you have routed YAML to a driver named `unityyamlmerge`. Confirmed by construction — adding the routing flipped it `na` → `FAIL` → (after fix) proven. Correct, but momentarily confusing cold.

## Friction following the README cold

Very little. The quick start worked verbatim on the first try: clone → `npm install` → `node packages/cli/bin/kit.js <project>`. Specific notes:

- **`npx unity-agent-kit` does not work** — the package is unpublished. The README says so plainly in the same breath ("until then, run it from a clone… only the npm publish step is pending"), so this is disclosed, not a trap. The clone path is the only working Door 1 today.
- **The README's honesty is load-bearing and it held.** "Verified: Windows + Unity 6.x" matched my platform, and checks that didn't apply reported `na` rather than guessing (`path-headroom` `na` before the project had a `Library/`; `kanabo` `na` with no editor). I never saw a false pass.
- **The proof harness repoints the scratch project's manifest at whatever clone you run it from** — `--dry` showed `"com.unity-agent-kit.doctor": "file:../../kit-verify/unity-agent-kit/upm"`, i.e. my clone, not the original repo. That is what made a genuinely cold verification possible; worth knowing it mutates `Packages/manifest.json`.
- **`unity --version` is `1.0.0-beta.3`.** Every VERIFIED-AS-INHERITED row rests on beta vendor software. That's a property of the ecosystem today, not of the kit, but it bounds how much those ✓s are worth.
- The stale `Temp/UnityLockfile` left by the killed proof editor is normal post-kill residue, and the kit's own `orphans` check flagged it — the tool caught its own harness's leftovers.

## Exact commands run

```sh
git clone C:/Users/Ryan/unity-agent-kit <dest>/unity-agent-kit
npm install
npm test                                                  # 102 pass / 0 fail

# victim repo
git init -q; git config user.email/user.name
printf 'm_EditorVersion: 6000.5.5f1\n...' > ProjectSettings/ProjectVersion.txt
git add -A && git commit -m "initial victim project"

# CLI door (row 7)
node packages/cli/bin/kit.js <victim>                      # exit 1, 4 failing
node packages/cli/bin/kit.js <victim> --json                # 12-element array, exit 1

# undo round trip (rows 15, 23)
node packages/cli/bin/kit.js <victim> --fix --yes --only hygiene
git config --get core.longpaths; cat <victim>/.gitignore
cat <victim>/.unity-agent-kit/applied.json
node packages/cli/bin/kit.js <victim> --undo
node packages/cli/bin/kit.js <victim>                       # failures return

# merge driver (row 22)
printf '*.unity merge=unityyamlmerge\n*.prefab merge=unityyamlmerge\n' > <victim>/.gitattributes
node packages/cli/bin/kit.js <victim> --only merge-driver    # na -> FAIL
node packages/cli/bin/kit.js <victim> --fix --yes --only merge-driver   # PROVEN 5/5

# editor churn (row 24)
git commit Assets/X.unity; modify it
node packages/cli/bin/kit.js <victim> --only editor-churn    # WARN names the file

# live Kanabo proof (rows 16-19)
node scripts/kanabo-proof.mjs --project <scratch> --unity "C:/Program Files/Unity/Hub/Editor/6000.5.5f1/Editor/Unity.exe" --iters 3 --dry
node scripts/kanabo-proof.mjs --project <scratch> --unity "…/Unity.exe" --iters 3 --launch
tasklist /FI "IMAGENAME eq Unity.exe"                        # before and after: none
cat <scratch>/Temp/unity-agent-kit/epoch.json
node packages/cli/bin/kit.js <scratch> --epoch               # exit 0

# hazard + skill rows (25, 26)
node packages/cli/bin/kit.js . --only skill-lint             # OK, exit 0
node packages/cli/bin/kit.js <scratch> --only orphans|--only path-headroom|--only kanabo
```

## Cleanup state

- **Unity processes: none.** `tasklist /FI "IMAGENAME eq Unity.exe"` → "No tasks are running which match the specified criteria"; a broader `tasklist | grep -i unity` also returned nothing.
- Victim repo and clone are temp dirs under the session scratchpad; left in place as instructed.
- `C:\Users\Ryan\Kintarō` was never read, written, or referenced.
- The scratch project retains a stale `Temp/UnityLockfile` (normal after a killed editor; the kit's `orphans` check reports it).
