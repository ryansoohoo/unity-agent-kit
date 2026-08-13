# <PROJECT NAME> — agent guide

<!-- Run the unity-claude-md skill to fill this file by interview, then delete
     this comment. Write the intro in your own voice — models tone-match. -->
<Who you are, what this game is, engine version, pipeline, platforms.>

Everything below is good defaults, not hard rules. If the person prompting asks
for something that contradicts this file, do what they ask. And if a rule here
fights the task in front of you, say so loudly and get a sign-off before
breaking it.

## The three ways to hurt yourself (read first)

1. Killing by pattern. Never kill Unity.exe or dotnet by matching a name or a
   path — the hot editor, cold worktree editors, and your own bridge session
   all match. Stop only a PID you spawned, or the owner of a port you opened,
   after confirming its working directory is your worktree.
2. Touching a live editor's files. Never delete or modify Library/, Temp/, or
   .meta files while any editor has the project open — that is GUID corruption
   and hours of reimport. Before any recursive delete, resolve and echo the
   absolute path and assert it is inside the worktree root. Deny rules live in
   .claude/settings.json (kit-managed).
3. Committing broken YAML. Scenes and prefabs are unmergeable YAML: one owner
   per wave (parallel agents state file ownership up front), never commit
   conflict markers, and treat uncommitted .unity/.prefab edits as
   unreconstructable if lost.

## What we never compromise on

<2-4 things no change may damage. A change that hurts one of these is not
done, it's a regression. e.g. the frame budget (16.6 ms on min-spec, measured
in a build), game feel, save compatibility.>

## Runtime environment

<Target platforms & input; frame budget; render pipeline & quality tiers.>

## Glossary

"You" = the agent editing this project. "We" = <you / your team>.
<5-10 project nouns the agent must use your way. Keep Unity terms exact:
scene, prefab, .meta, domain reload, asmdef, ScriptableObject.>

## How it works

<One paragraph: the core loop, where game state lives, how systems talk,
what ticks what.>

## Where code lives

<The 4-6 folders that matter, one clause each. Mark third-party dirs
(Packages/, Assets/Plugins/) read-only: prefer their patterns, never edit.>

## Code style — game code, not web code

If this C# would pass review at a SaaS company, look again. A game is a
frame-budget economy: allocation is a gameplay bug, indirection is a tax, and
architecture that makes code harder to find is not architecture.
- Prefer concise, simple solutions over clever or heavy abstractions. YAGNI.
  Small classes, direct [SerializeField] references, code a tired human can
  change fast. No interface-with-one-implementation, no DI framework, no
  factory ceremony.
- If a substantially simpler approach exists, use it — or surface it and let
  me pick.
- Singletons and managers are idiomatic game code, not a smell. A GameManager
  with a static Instance is how shipped games work — never refactor one away
  unprompted.
- Per-frame code allocates nothing. No LINQ, closures, string concat, or new in
  Update/FixedUpdate/LateUpdate; cache GetComponent/Camera.main in Awake; pool
  anything spawned during gameplay.
  BAD:  void Update() { foreach (var e in FindObjectsOfType<Enemy>().Where(e => e.IsAlive)) ... }
  GOOD: enemies register in a list on spawn/despawn; Update walks the list.
- Unity null is special: ?. and ?? skip the destroyed-object check on
  UnityEngine.Object. Write if (thing != null).
- Everywhere else, trust the type system. Don't check what the compiler
  guarantees: no defensive null checks on non-nullables, no try/catch as
  control flow.
- [SerializeField] private over public fields; tuning values in
  ScriptableObjects, not consts, not hand-rolled JSON.
- No GameObject.Find / FindObjectOfType / SendMessage at runtime — serialize or
  register the reference.
- Coroutines or Awaitable over raw Task / async void: Tasks outlive destroyed
  objects and Unity APIs are main-thread-only.
- Tests are good; test slop is not. Few focused tests on real behavior beat
  endless smoke tests and "regression tests" for deleted features.
- Comments say how a thing is used, sit above the definition, and move with the
  code. Keep them current when the code changes. Don't narrate lines.

## Behavioral guards

- Questions are read-only. A question is a request for an answer, not for
  changes: "how hard would it be", "what are your thoughts", "why does",
  "should we", "is it possible", "can X do Y" — answer it, do not edit files.
  If the answer is obvious and the change trivial, still answer first and
  offer the change. Ask before making it.
- Be careful with destructive actions that are not explicitly requested. When
  a task sits next to something live, name what you are about to touch before
  touching it.
- Scope ceiling: before writing code, state the smallest change that solves
  the problem; if what you are about to build is meaningfully bigger, say why
  in one line and let me decide. Tests proportional to blast radius. Don't
  preserve complexity because it exists; don't add machinery because it looks
  impressive.
- Verify before you assert: "I verified X" means you ran something that would
  have failed if X were false. Follow unity-verify (cheapest tier first, stop
  when answered); if you cannot check it, say the assumption out loud.
- Reverse states: if you added a way in, add the way out and the way to see
  it. OnEnable subscribes ⇒ OnDisable unsubscribes; pause needs unpause; a
  pooled spawn needs its despawn reset. A one-way door is a bug.
- Don't be scared to propose bold ideas when they'd meaningfully benefit the
  game. Propose is the key word — the scope ceiling still applies to building
  them.

## Hit every surface

The classic defect is a change that works where you tested it and is missing
everywhere else. Before calling work done, walk this list and say which
entries applied:
- Scenes: every scene that hosts what you changed, plus prefab variants and
  their overrides — fixing one instance is not fixing the feature.
- Play Mode vs build: Play Mode lies about timing, init order, and stripped
  code. A real build is the truth.
- Domain reload: survive enter/exit Play Mode and a script recompile. Statics
  and event subscriptions usually don't.
- Platforms & input: <what every change must support — KBM + gamepad? touch?>
- Save/load: if it touches state, it round-trips through save and load.

## Test scenes & data

An empty scene is a bad test. <Which test scene to open, how to seed a save,
which configs are safe fixtures. Copy test data in; never point tests at your
live save.>

## Build & test

<Exact commands: build target, test filter, how to launch the editor, where
logs live (Logs/Editor.log at project root).>
