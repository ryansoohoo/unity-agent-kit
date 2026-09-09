# Profiler bridge

`kit profiler <action> [project-root] [options]` records Unity Profiler data and queries live or saved CPU samples. It uses the kit's existing Editor connection. In the examples, `kit` means `node <kit-checkout>/packages/cli/bin/kit.js`. For client installation, see [setup](setup.md). A successful command prints `{ "ok": true, "queryMs": ..., "data": ... }`. Failures return a nonzero exit code. All commands support `--out <new-file.json>` and `--timeout-ms`, default 10000. Exports never overwrite an existing file.

The implementation is verified against Unity 6000.5.5f1. The Editor package must be installed and loaded in the project. For a connected Development Player, the Editor receives the capture and answers queries; the bridge does not run inside the Player.

## Record gameplay

```text
kit lease acquire <project> --owner <task-id> --wait --json
kit profiler status <project>
kit profiler targets <project>
kit profiler start <project> --label workload --seconds 60 --max-mb 512 --context scenario.json --lease <token>
kit profiler mark <project> --label "hitch after firing" --lease <token>
kit profiler stop <project> --lease <token>
```

Take the token from the lease result and retain it through recording and cleanup. Inspect `profiler status` until `captureActive` is false before `kit lease release <project> --lease <token>`. A capture can stop at its duration limit before you issue `stop`; check status first.

Run these from the Unity project, or supply its path after the action. `start` uses the currently connected target. `--target` selects an ID returned by `targets`, including Unity's Editor ID `-1`. `--editor` includes Editor work; without it, use Play mode or a connected Player. The command does not enter Play mode or change scenes.

Captures stop after the duration or storage threshold. `stop` saves the remaining received frames. `cancel` also retains the partial archive and labels it cancelled. Both first return `state: stopping`; `status` exposes `captureActive` while the receive buffer drains. `sessions` shows the final state. Recording settings and the previous target are restored afterward. An existing human-started recording is not taken over.

`--allocations` enables managed/native allocation call stacks and increases overhead. Deep Profile is reported but never toggled automatically. Normal captures inherit existing allocation-stack settings, so check `status` before comparisons. The bridge enables CPU recording and restores its old state on completion. GPU recording remains as configured in Unity.

## Record the scenario

Supply `start --context <scenario.json>` or `--context-json '<object>'` to record the conditions of a run. The JSON object can contain project-specific fields; the bridge preserves them without interpreting game code. For example:

```json
{
  "scenario": "arena-fire-test",
  "seed": 41,
  "workload": { "actorCount": 16, "shooting": true, "shotsPerSecond": 8 },
  "warmup": { "seconds": 5, "completed": true },
  "tunables": { "effectsQuality": 2 },
  "source": { "revision": "commit-id", "worktree": "checkout-path", "filesHash": "optional-content-hash" }
}
```

The CLI records source identity at dispatch; optional file fingerprints and the scenario values describe the requested run. They do not prove that the Editor loaded those exact files. Warmup is metadata, not a delay or an automatic action. Extra fields, including callback names or results from your own setup, remain data; the bridge does not invoke them. Context must be an object of at most 64 KiB. Use the same scenario, warmup and tunables for an A/B comparison.

Each managed capture stores schema 2 `captureContext` with the supplied JSON, initial active scene and scene count, Game view dimensions, quality level, frame cap, VSync, time scale, fixed timestep, Editor focus, `Application.runInBackground`, owned Play-session background pump mode, and profiler settings. These properties are checked during capture without scanning source files or game objects each frame. A scene, resolution, focus, background mode, runtime setting or profiler setting change interrupts recording, marks context unstable, and discards the uncheckpointed tail. A focus event also catches transitions between capture ticks. The manifest retains the initial settings and change evidence.

`backgroundPumpMode: "unfocused-10Hz"` means an owned graphical Play session conditionally queues a player-loop update at most every 100 ms while the Editor is unfocused. It is a configured nudge, not a measured game frame rate. [Unity documents](https://docs.unity3d.com/6000.5/Documentation/ScriptReference/EditorApplication-update.html) that background operation can change the Editor's tick rate and that this tick is separate from the project's Play loop. Keep focus and background settings consistent between captures. Pre-schema-2 captures and exports missing these fields have unknown timing comparability.

The automatic scene and resolution belong to the Editor hosting the bridge. [Unity's Screen.width documentation](https://docs.unity3d.com/6000.5/Documentation/ScriptReference/Screen-width.html) states that Editor callbacks read Game view resolution, not a connected Player's resolution. Remote captures label these fields `host-editor`; comparison therefore reports their scenario comparability as unknown. Game state such as seed, actor counts and firing activity is supplied by the caller and is not automatically monitored.

Bookmarks accept `mark --label shot --tick 1234 --context-json '{"actor":2,"event":"fire"}'`. The optional tick and event payload survive in the session and analysis exports alongside the observed Profiler frame and local Unity frame. This records the tick you supplied; it does not infer tick synchronization or install game hooks.

## Inspect frames and callers

```text
kit profiler frames --min-ms 16.667 --limit 100
kit profiler threads --frame 1234
kit profiler frame --frame 1234 --thread 0 --filter Smoke --limit 100
kit profiler sample --frame 1234 --thread 0 --sample 87
kit profiler analyze --first 1200 --last 1250 --filter Smoke --out before.json
```

The numbers above are examples; use IDs from the preceding query. Frame and sample queries default to the latest frame and thread index 0. `threads` returns a frame-local index and a separate persistent thread ID. Use the index in `--thread`.

Raw sample pages include original sample indices, parent indices, depth, full caller paths, start time, duration, self time, and GC bytes on `GC.Alloc` samples. Filtering preserves those identities. `sample` resolves recorded call stacks where symbols exist and returns metadata and flow events. An empty stack means no stack was recorded, not that the call had no callers. Caller paths escape slashes inside marker names.

`analyze` aggregates by full caller path plus thread group/name, sorted by self time. It separates call count from the number of frames containing the marker. Total time includes children; self time subtracts direct children. Overlapping child durations are reported as `childOverlapMs`. `maxMs` is the longest individual call; `maxFrameMs` is the largest sum of those calls in one frame. Frame percentiles use nearest rank and are calculated from main-thread frame timing, never the sum of worker-thread durations. `--min-ms` is the frame-budget threshold for analysis, not a frame filter.

`--offset` and `--limit` page frames, samples, marker aggregates, and sessions. Truncation is explicit. Expired live ranges fail with the available range. GPU values carry availability information; unavailable values must not be interpreted as zero GPU cost. Long analysis requests fail after an Editor work budget and can be split into narrower frame ranges.

## Reopen and compare history

Archives live under `<project>/Logs/UnityAgentKit/Profiler/<session-id>/`. Each contains `session.json`, a `frames.jsonl` index, and native `.raw` checkpoints. `sessions` lists archive IDs. `save --label name` archives an existing retained buffer without starting recording. Such snapshots report `sourceContextKnown: false` because a buffer can contain earlier sessions or files loaded through Unity's UI. `unityVersion` identifies the Editor reading the data; a remote Player's build version is not inferred from it.

```text
kit profiler sessions
kit profiler frames --session SESSION_ID --min-ms 16.667
kit profiler load --session SESSION_ID --frame ORIGINAL_FRAME
kit profiler frame --frame INSPECT_FRAME --thread 0
kit profiler unload
kit profiler analyze --session SESSION_ID --filter Smoke --limit 1000 --out before.json
kit profiler compare --before before.json --after after.json --out comparison.json
```

`load` returns `inspectFrame`, the native loaded frame index to inspect. It also returns the chunk's owned frame range and `frameOffset`, which converts loaded indices back to original archive indices. Native chunks can overlap and contain earlier history; whole-session analysis only reads each chunk's owned interval, so it does not double count frames.

`load --path <capture.raw>` opens an external Unity capture. Loading backs up the existing Profiler history. `unload` restores it, and the backup survives a domain reload. Recording must be stopped before loading or analyzing an archive. Indexed `frames --session` queries work during recording. A whole-session analysis temporarily loads its chunks and restores the previous history automatically; unload an existing historical view first.

Comparisons normalize marker time, calls, and bytes by captured frame count. They retain full caller/thread identity. Partial marker exports produce coverage warnings; a marker missing from a partial page is never treated as zero. `captureContext` and bookmarks survive `frames --session` and `analyze --session`; analysis of a live range carries them only when the range belongs to an active managed capture. Use `analyze --session` after stopping to retain that provenance. Existing retained buffers and raw files without a session manifest have unknown context.

`compare` returns `comparable: true` only when the recorded scenario and environment match. Scenario/profiler differences, context changes during recording, differing query filters, incomplete marker pages and archive gaps produce `comparable: false` plus a `mismatches` list. Missing or older context, an absent caller-supplied scenario, and remote Player environment data produce `comparable: null` with `comparability: "unknown"` unless a known mismatch already makes the answer false. There is no override that turns mismatched measurements into a matched result.

The top-level `source` object in supplied context is treated separately: differing revisions, worktrees and optional fingerprints appear in `sourceChanges`, allowing intentional A/B code changes without invalidating the scenario. All other supplied fields must match. The result preserves both contexts and still returns measured deltas when comparability is false or unknown, with an explicit warning against claiming a regression or improvement. Matching recorded fields does not establish causality. Editor frame timings include Editor overhead, and the bridge does not infer shipped-player performance.

## Capture costs and limits

This version checkpoints Unity's rolling frame buffer with `ProfilerDriver.SaveProfile`, default every 300 newly received frames. `--checkpoint-frames` accepts 30..1000. Checkpointing is synchronous and can cause a hitch. The trace marker `UnityAgentKit.Profiler.Checkpoint` and manifest fields `checkpointMs`/`maxCheckpointMs` identify its work. Allocation-stack captures can make checkpoints expensive. Use clean captures without stacks to validate an optimization.

`maxMb` is a **stop threshold**, not a hard disk quota. The final native checkpoint can exceed it, and overlapping raw buffers consume extra storage. Existing archives are never automatically deleted. Smaller checkpoint intervals preserve history more often but increase I/O and duplication. Frames that expire before checkpointing are listed as gaps. Unexpected termination preserves completed checkpoints; the unsaved tail cannot be recovered. Lifecycle interruptions and an unsettled receive buffer are reported in the manifest.

The bridge cannot reconstruct code that was never instrumented, frames that were never recorded, or every variable's historical value. Markers, short Deep Profile captures, and source inspection are needed to isolate uninstrumented loops. Memory object snapshots, GPU hardware counters, automatic gameplay-event hooks, and a separate analysis process are not included in this core extension. `mark` adds a manual bookmark with the latest received Profiler frame and local Unity frame; it is not exact tick synchronization with a remote Player.

## Verify the bridge

Run `npm test` for parsing, transport, comparison, and existing kit tests. For native verification, create a disposable Unity 6000.5 project, install this checkout's `upm` package, copy `scripts/fixtures/ProfilerProof.cs` into its `Assets/Editor`, and open the project. Then run:

```text
node scripts/profiler-proof.mjs "/path/to/disposable-project"
```

The proof records known nested markers, a worker thread, and managed allocations. It checks caller/self-time accounting, repeated calls versus frame counts, archive overlap, stack retrieval, and restoring history/settings. It stops its own workload in a `finally` block. Do not run the fixture in a game project.
