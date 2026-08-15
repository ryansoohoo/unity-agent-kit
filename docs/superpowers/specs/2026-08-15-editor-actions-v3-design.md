# Editor actions v3 — the kit runs the editor, drives simple play tests, and reads outcomes

**Date:** 2026-08-15. **Origin:** `docs/HANDOFF-editor-bridge-gaps.md` (Kintarō character-foundation
session: every place the human had to click a menu, play the game, or read a log for the agent).
**Ryan's direction, verbatim in spirit:** *"the kit should run the tools by itself next time; we need
a solution to simulate inputs in-engine; project-agnostic, as broad as possible; a reliable way to do
QA; simple input tests in an isolated environment — not an AI playing the game — but the agent must
know it can do this."*

## 1. Goal and non-goals

**Goal.** After this milestone an agent working in any Unity project with the kit installed can, with
no human step: run an editor menu item or static method; enter Play in a scene, feed a *scripted,
open-loop* stream of keyboard/mouse/gamepad input, sample game state, capture matching console lines
and (rarely) screenshots, exit Play; read the console structurally; and learn from the epoch signal
*why* the editor is stuck (modal dialog) instead of just *that* it is.

**Non-goals.** Closed-loop / reactive play (no per-frame decisions, no "dodge", no RTS micro). Scene or
prefab serialization / set-property-by-path (write an editor script and `invoke` it — proven right in
the Kintarō session). Depending on `com.unity.pipeline` (Unity's own CLI cannot simulate input or see the
Game view in Play, drops its token across the Play domain reload, and is blocked by modals — measured
by [Vindler](https://vindler.solutions/blog/unity-cli-agent-automation); the kit's file channel is the
residual). `add-package` verb (one `invoke` line once invoke exists — add it only if it bites twice).

**Ceilings honoured (Kintarō `docs/kanabo/KILL-CRITERIA.md`):** under ten verbs (this adds 3: `invoke`,
`play`, `console`); editor-side well under 2000 lines; one Unity line (6000.x, Input System 1.x); no
sidecar. The KanaboEpoch.cs "zero tool surface, that's all this will ever be" comment is rewritten
honestly, not left lying.

## 2. Vendor / prior-art findings (why this shape)

- **Unity CLI + Pipeline** (experimental, 2026): eval, `[CliCommand]`, parsed console read, enter Play,
  scene-graph queries. No input simulation, no Game-view capture, 401 after Play's domain reload,
  ~0.8 s/call, modals block. → The kit builds exactly what it lacks, on a channel that survives reload.
- **Unity Automated QA package**: recorded input playback; development halted Dec 2021, unsupported on
  current Unity. Dead.
- **AltTester** (GPLv3): the mature reference — find object → act → screenshot, both input systems.
  Legacy Input Manager trick: a global-namespace `Input` class shadows `UnityEngine.Input` behind a
  define. Not vendorable (GPL); the technique is public and we re-implement independently.
- **Input System runtime API**: `InputSystem.AddDevice<T>()` creates virtual devices;
  `InputSystem.QueueStateEvent(device, state)` is consumed by the player loop on the next input update
  — no `InputTestFixture`, no manual `InputSystem.Update()`. Works in editor Play and in builds. Virtual
  devices don't fight real hardware; `Mouse.current` follows last-used, so the driver calls
  `MakeCurrent()` on its virtual mouse when it writes to it.

## 3. Channel protocol (extends the v2 file channel; nothing else changes)

Directory: `<project>/Temp/unity-agent-kit/`. Editor side is the existing `KanaboEpoch.Tick` (0.5 s).

- **Request:** `req/<id>.json` — `{ "id", "verb": "invoke"|"play"|"console", ...args }`. `id` is a
  ULID-ish string from the CLI. The CLI writes to `req/<id>.json.tmp` then renames (atomic).
- **Result:** `res/<id>.json` — `{ "id", "ok", "error"?, "startedEpoch", "finishedEpoch", ...payload }`.
  Written once, atomically. Editor deletes the request file *before* starting work; a crash mid-work
  leaves no result → the CLI's bounded wait reports `timeout` with the last epoch snapshot attached.
- **Progress (play only):** `res/<id>.progress.json` rewritten each heartbeat: `{elapsed, step, probes-so-far-count, errors}` so a 60 s run isn't a black box.
- **Domain reload survival:** in-flight request ids live in `SessionState`; on reload the editor either
  resumes (play: continues collecting; the play driver object is `DontSave` and re-found by name) or
  writes `{ok:false, error:"interrupted by domain reload at epoch N"}`. Never silently drops.
- **Epoch snapshot gains** `blocked: null | {kind:"modal", title, sinceMs}` and `busy: null | {verb,id}`.
- CLI helper `packages/core/src/actions.js`: `request(root, verb, args)`, `awaitResult(root, id, {timeoutMs})` built on the same poll loop as `waitReady` (bounded, reason-coded: `done|timeout|no-editor|blocked`).

## 4. Verbs

### 4.1 `kit invoke` (the easy first fix)
`kit invoke --menu "Kintarō/Build Sandbox (scene + prefabs)"` or `kit invoke --method Kintaro.SandboxBuilder.Build [--arg x …]`.
Editor: `EditorApplication.ExecuteMenuItem(path)` (result false → error "no such menu item"), or reflection: resolve `Namespace.Type.Method` across loaded assemblies, static, public or non-public, parameters bound from string args by `Convert.ChangeType`. Wraps in try/catch; captures `Application.logMessageReceivedThreaded` for the duration into `log[]` (type, message, first stack line). If the call triggers compilation/import, the result records `finishedEpoch` so the caller chains `--wait-ready --since-epoch`. Exit 0/1; JSON to stdout with `--json`.

### 4.2 `kit play` (the QA loop)
`kit play --scene Assets/Kintaro/Scenes/Sandbox.unity --script test.json [--seconds 20] [--out dir]`.
Sequence editor-side: assert not already playing; remember current scene setup; open `--scene` (if given) *without* saving the current one when it's dirty → error `"scene dirty; save or pass --discard-scene-changes"` (isolation: never lose the user's work, never write assets); spawn `UakPlayDriver` (`HideFlags.HideAndDontSave`) carrying the script; `EditorApplication.EnterPlaymode()`; the driver runs the script on `Time.unscaledTime`; at end or on `--seconds`, `ExitPlaymode()`; on exit restore the previous scene setup; write result. Anything the game changed in Play is discarded by Unity — that *is* the isolation.

**Script format** (JSON, one array of timed steps; `t` seconds from Play start; open-loop only):
```json
{
  "steps": [
    {"t":0.0, "keys":["W"]},                       // hold W from now
    {"t":2.0, "keys":[]},                          // release all
    {"t":2.0, "mouse":{"pos":[960,540]}},           // absolute screen px
    {"t":2.5, "mouse":{"button":"left","down":true}},
    {"t":2.6, "mouse":{"button":"left","down":false}},
    {"t":3.0, "tap":"F2"},                          // press+release next frame
    {"t":3.0, "gamepad":{"leftStick":[0,1]}},
    {"t":4.0, "click":"Canvas/StartButton"},        // uGUI/UI Toolkit element by path/name → resolved to screen centre → mouse click
    {"t":5.0, "snapshot":true},                     // hierarchy+components JSON at this instant
    {"t":5.0, "screenshot":true}                    // PNG, downscaled to maxWidth
  ],
  "probe": {"everyMs":100, "paths":["Player/transform.position", "Player.Kintaro.SimulationDriver.Tick"]},
  "expect": [{"at":3.0, "probe":"Player/transform.position.y", "lt":-1}],
  "console": {"match":"\\[SelfTest\\]", "keep":"all|errors"},
  "screenshots": {"maxWidth":640, "onExpectFail":true, "onFirstException":true},
  "seconds": 6
}
```
Probe path grammar: `GameObjectPath/transform.field` or `GameObjectPath.Namespace.Component.member[.member…]` — resolved once via `GameObject.Find` + reflection (fields and properties, public or not), re-resolved if null (spawned later). Unresolvable → recorded as `null` series with a warning, never a crash. Values serialize as numbers/arrays/strings.

**Input tiers** (auto-detected per project; recorded in result `inputTier`):
- *Input System present:* virtual `Keyboard`, `Mouse`, `Gamepad` added at Play start, removed at exit; state built from the step model and queued with `QueueStateEvent` every frame while any key/button held (so hold semantics are exact). uGUI with `InputSystemUIInputModule` and UI Toolkit runtime bindings see the same devices — `click` works for UI.
- *Legacy Input Manager only:* opt-in shim. Kit ships `Runtime~/UakInputShim/Input.cs` — a global-namespace `Input` class compiled only under `UAK_INPUT_SHIM`, forwarding every `UnityEngine.Input` member to the real one unless a script is active, in which case keys/axes/mouse come from the driver's state (`GetAxis` derives from held keys via the project's InputManager axis definitions for the common `Horizontal`/`Vertical` names). uGUI's `StandaloneInputModule` gets a kit `BaseInput` override that reads the same state. `kit play` on a legacy project without the define → error naming the one-line fix; `kit doctor` shows the check. **Reverse state:** removing the define fully removes the shim from the build.
- *Both/neither:* Input System wins if present; a project with only a custom seam is out of scope (wrap either tier).

**Result** `res/<id>.json`:
`{ ok, inputTier, seconds, summary:{errors, exceptions, expectsFailed, stepsRun}, probes:{path:[[t,value]…]}, expects:[{at,probe,op,want,got,pass}], matches:[{t,frame,type,msg}], console:[…kept], snapshots:[{t,hierarchy}], screenshots:[relpath…], warnings:[…] }`.
`ok` = no exceptions ∧ all expects pass ∧ (errors allowed unless `--fail-on-errors`). CLI prints a compact summary; `--json` dumps all. Deterministic check is a CLI convenience: `kit play … --repeat 2` hashes each run's `probes` and reports `deterministic: true|false`.

### 4.3 `kit console`
`kit console [--errors] [--since-epoch E] [--last N] [--clear]`. Editor keeps a ring buffer (default 2000) of `Application.logMessageReceived` entries tagged with epoch, frame, time, type, message, first stack line — persisted to `Temp/unity-agent-kit/console.jsonl` on each write so it survives domain reload and the CLI can read it *even when the editor is mid-reload*. Result = the filtered entries. Also documents that the authoritative log file is `<project>/Logs/Editor.log`, not `%LOCALAPPDATA%\Unity\Editor\Editor.log`.

### 4.4 `blocked` in the epoch signal
Detection: `EditorApplication.update` stopped ticking (heartbeat writer is on `update`) → replaced by a *thread* heartbeat: a background timer stamps `threadHeartbeatMs` every 500 ms while the main-thread `Tick` stamps `heartbeatMs`. Thread alive + main-thread stale ≥ 2 s + `!isCompiling && !isUpdating` ⇒ main thread is in a modal pump; on Windows the foreground window title is read via `GetForegroundWindow/GetWindowText` when it belongs to the editor PID → `blocked:{kind:"modal", title}`. Otherwise `blocked:{kind:"main-thread-stalled"}`. `--wait-ready` surfaces it in `reason: "blocked"` with the title. No auto-dismiss in v3 (consent design later); the *diagnosis* was the missing piece.

## 5. Doctor additions
- `pipeline`: Unity Pipeline package installed & `unity status` reachable — **informational** (kit doesn't need it; Tier 0 `eval` exists only if this is green).
- `input-shim`: when the project has no `com.unity.inputsystem` and `UAK_INPUT_SHIM` isn't defined → warn with the fix.
- Existing orphan-Unity check gets a note that orphans are harmless to the file channel (pid in snapshot disambiguates).

## 6. Skill layer — the agent must know it can do this
- `unity-verify`: new Tier 3 "behavioural check": `kit play` with probes/expects; state plainly *"you can enter Play, feed scripted input, sample state, and read the console yourself — do not ask the human to play-test simple things"*; note Tier 1 (`dotnet build`) only covers files Unity already imported; name `Logs/Editor.log`.
- `unity-recipes`: recipes "run my editor script" (`invoke`), "play test with a script" (probe-first, screenshot on failure), "read the console structurally", "editor stuck? read `blocked`".
- Description/trigger evals for the changed skills re-run through the existing harness (`scripts/skill-evals.mjs`), gated on the held-out set as before.

## 7. Testing
- **JS (node:test, no Unity):** request/result file protocol round-trip with a fake editor; bounded wait reason codes; script JSON validation with precise errors; probe series hashing; CLI exit codes.
- **Editor-side proof (live editor, recorded in BUILD-LEDGER like the 100/100 epoch proof):** `invoke` a menu item and a static method 20/20; `play` a kit-shipped fixture scene (`upm/Tests~/UakPlayFixture.unity`: a cube moved by Input System `Move`, a uGUI button that logs on click) — expects on position, `click` on the button, one screenshot — 20/20 across editor focused/unfocused; console ring survives a domain reload; `blocked` detected against a deliberately opened `EditorUtility.DisplayDialog`.
- **Acceptance (the point):** Kintarō Tasks 6–8 human steps re-run agent-side — build sandbox via `invoke`; play test with WASD/mouse script + probes (camera-relative move, aim, fall off edge, console clean); rollback self-test via `--repeat 2` determinism + `[SelfTest]` matches (with `SelfTestEnabled` toggled through an `invoke`d one-line editor method, saved); F1/F2/F3 frame-rate independence via probe speed comparison. Zero human steps = pass.

## 8. Out-of-scope follow-ons (recorded, not built)
Consent-gated auto-answer of known-safe modals; `add-package`; closed-loop scripts; build-player play (the driver is runtime code, so a dev build could host it later); Mac/Linux modal-title detection.
