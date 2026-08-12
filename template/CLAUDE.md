# <PROJECT NAME> — agent guide

<!-- PERSONALIZE: one short paragraph, written in your own voice like a letter:
     who you are, what this game is, engine version, render pipeline, target
     platforms, and the one or two things this project never compromises on
     (frame budget? determinism? load times?). Models tone-match — write how
     you want the agent to talk back. Run unity-claude-md to fill by interview. -->

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

## Runtime environment
<!-- PERSONALIZE (interview asks these): target platforms & input; frame budget
     (e.g. 16.6 ms); render pipeline & quality tiers; display assumptions. -->

## Glossary
"You" = the agent editing this project. "We" = <PERSONALIZE: you/your team>.
<!-- PERSONALIZE: project nouns the agent must use when talking to you.
     Keep Unity terms exact: scene, prefab, asset, .meta, domain reload,
     asmdef, ScriptableObject. -->

## Code style — game code, not web code
If this C# would pass review at a SaaS company, look again. A game is a
frame-budget economy: allocation is a gameplay bug, indirection is a tax, and
architecture that makes code harder to find is not architecture.
- Simple, concrete, editable. Small classes, direct [SerializeField] references,
  code a tired human can change fast. No interface-with-one-implementation, no
  DI framework, no factory ceremony.
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
- [SerializeField] private over public fields; tuning values in
  ScriptableObjects, not consts, not hand-rolled JSON.
- No GameObject.Find / FindObjectOfType / SendMessage at runtime — serialize or
  register the reference.
- Coroutines or Awaitable over raw Task / async void: Tasks outlive destroyed
  objects and Unity APIs are main-thread-only.
- Tests are good; test slop is not. Few focused tests on real behavior beat
  smoke-test padding.
- Comments say how a thing is used, sit above the definition, and move with the
  code. Don't narrate lines.

## Behavioral guards
- Questions are read-only: when I ask "what/why/how", investigate and answer —
  do not change anything until I ask for a change.
- Scope ceiling: before writing code, state the smallest change that solves
  the problem; if what you are about to build is meaningfully bigger, say why
  in one line and let me decide. Tests proportional to blast radius. Don't
  preserve complexity because it exists; don't add machinery because it looks
  impressive.
- Verify before you assert: "I verified X" means you ran something that would
  have failed if X were false. Follow unity-verify (cheapest tier first, stop
  when answered); if you cannot check it, say the assumption out loud.
- Hit every surface: the classic defect is a change that works where you tested
  it and nowhere else. Before calling it done, say which you checked: other
  scenes, prefab variants, after a domain reload, in a build (not just Play Mode).
- Reverse states: if you added a way in, add the way out and the way to see
  it. OnEnable subscribes ⇒ OnDisable unsubscribes; pause needs unpause; a
  pooled spawn needs its despawn reset. A one-way door is a bug.

## Build & test
<!-- PERSONALIZE: exact commands: dotnet build target, test filter, how to
     launch the editor, where logs live (Logs/Editor.log at project root). -->
