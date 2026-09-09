# Bridge operation verification

Native verification ran September 8, 2026 on Windows with Unity 6000.5.5f1 and Node 24.18.1. Tests used a disposable Unity project that referenced the kit checkout. The results below cover the Editor bridge before the 0.6.0 client installer and MCP adapter were added; they are not evidence of native Editor support on other operating systems.

## Native evidence

The test run inspected full operation responses and durable Play/profiler artifacts under `Logs/UnityAgentKit` in its disposable project. The checked-in fixture callbacks are in [PlaySessionProof.cs](../scripts/fixtures/PlaySessionProof.cs). A temporary proof class supplied compiled constants and controlled side effects. Machine-specific response files are not distributed with this repository.

| Behavior | Observed result |
| --- | --- |
| Runtime discovery | Correct project, Editor PID/session, protocol 2, package path, loaded assemblies, and reflected method signatures. |
| Source receipt | Editing a compiled constant, refreshing its declared file, then invoking with the receipt returned the new value. Both explicit loaded-field probes and refresh without a probe passed. A later disk edit invalidated the receipt. |
| Compile failure and recovery | Invalid C# returned compiler diagnostics and `compile_failed`; corrected source produced a successful receipt and newly loaded constant. |
| Completion semantics | `invoke` returning false remained a successful call; `check` returning false failed. A Task was awaited. A started Task outlived a short caller timeout and the same operation ID later completed. |
| Cancellation and ownership | A cancelled queued mutation left its counter unchanged. Wrong Editor session and wrong lease tokens prevented mutations. |
| Play lifecycle | Success, boolean failure, exception, cancellation and lease expiry restored the original scene and time scale. Source reload during Play reported failure and restored the same state. |
| Windows atomic publication | Thirty sequential native replacements passed with rapid result polling. An exclusive destination lock produced a bounded error naming the file and preserved the previous content. |
| Capture ownership | Recording retained ownership after lease expiry, refused release and displacement, and rejected another token's cancellation. Cleanup cleared ownership after restoring profiler settings. |
| Profiler context | Scenario JSON and tick 42 bookmark survived in archives. A time-scale change invalidated a capture. Two real analysis exports with different actor counts produced `comparable: false` and a `scenario.actors` mismatch. |
| Unfocused execution | A graphical Editor reported `editorFocused: false`. A source refresh loaded changed code. A two-second Play session recorded 1,454 unfocused frames and 21 loop nudges, completed a 1287 by 724 PNG, then restored `runInBackground` from true to its prior false value. Source reload during unfocused Play also restored the scene, time scale and background setting. These counts describe this proof machine, not a frame-rate guarantee. |

The PNG was opened and inspected. It contains the expected gray fixture cube against its blue camera background. It proves graphical capture completion, not correctness of any game's UI.

## Automated checks

A fresh-project release rehearsal used the setup command for all three clients,
then connected two real MCP SDK clients to a graphical Windows Editor with Unity
6000.5.5f1. All 22 tools were discoverable. FIFO ownership, rejection of another
token, a compiled source receipt with a loaded-field probe, receipt-gated checks,
false-check failure, Play callbacks and profiler status passed. The Play scenario
completed with 1,792 unfocused frames and restored its background setting. This
tests the common stdio protocol and generated configuration, not each client's UI.

To repeat it, install the kit into a disposable Unity project, copy
`scripts/fixtures/PlaySessionProof.cs` into `Assets/Editor`, open that project in a
graphical Editor, and leave it in the background. Run
`node scripts/mcp-proof.mjs <absolute-project-path>` from the kit clone. The proof
writes `Assets/Editor/McpReleaseProof.cs` and local `mcp-proof.json` evidence.

The pre-release bridge suite passed all 186 JavaScript tests. It covers request claiming/cancellation, FIFO tickets, expiry and active-work protection, bounded polling, CLI validation, profiler parsing/comparison and the existing doctor/merge checks. The complete package and Play fixture also typechecked against the installed Unity managed assemblies. Run `npm test` for the current release suite, which also covers installer and MCP changes.

## Boundaries

- Leases fence cooperating kit operations. Raw filesystem writes, manual Editor actions and separate legacy MCP clients can bypass them.
- A lease does not copy branch contents. Integrate changes into the Editor's checkout before its source receipt and checks.
- Cancellation prevents queued execution. It cannot preempt a synchronous Unity call or forcibly stop arbitrary Tasks.
- Play teardown owns game-specific changes. The session restores its recorded scenes, time scale and background flag; it does not roll back arbitrary callback effects.
- Background runs use explicit game callbacks. They do not send physical keyboard/mouse input to an unfocused application. Focus, background mode and loop nudging are profiler context; comparisons across different settings are rejected.
- Game-view PNG capture needs a graphical Editor. Batch mode rejects a capture request before changing the scene or entering Play.
- Structured `check` supports explicit assertions and Task completion. This release does not add a Unity Test Framework adapter, package manager jobs, memory snapshots or GPU analysis.


## Existing-project smoke check

A separate smoke check loaded protocol 2 into an existing Windows Unity project while its Editor remained unfocused. A lease/invoke/release sequence passed, profiler status reported context schema 2 with recording off, and no new console errors appeared. The project's tracked diff remained unchanged. This check supplements the disposable fixtures; it does not establish correctness of any game's behavior.
