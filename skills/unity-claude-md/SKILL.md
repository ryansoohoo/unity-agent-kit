---
name: unity-claude-md
description: Use when a Unity CLAUDE.md or AGENTS.md needs writing, extending, or trimming, or a rule or footgun must be written down so agents stop repeating it. Do NOT use for verification, merges, or topology.
---

# Generate a Unity project's CLAUDE.md by interview

The value of instruction text comes from encoding THIS project's reality, not
from copying a template. This file is a letter to the agent, not a README — a
README sells the project to humans; this file tells the agent how to change
the code. Interview the user (one question at a time, short answers fine),
then write CLAUDE.md from the template structure.

Ask, in order:
1. What is this project? (one sentence, genre/purpose, Unity version, pipeline)
   And what does it never compromise on? (2-4: frame budget, feel, save
   compatibility, determinism — these become What we never compromise on.)
2. Runtime targets: platforms, input, frame budget, quality tiers? (Also fills
   the platforms-and-input line of Hit every surface.)
3. How does the game work, in one paragraph? Core loop, where state lives, how
   systems talk. And the 4-6 folders that matter, including which third-party
   dirs are read-only. (These become How it works and Where code lives.)
4. Project vocabulary: 5-10 nouns I should use YOUR way (systems, scene names,
   abbreviations). These become the Glossary.
5. What has burned you before? (agent or human mistakes to guard against —
   the worst become numbered footguns, the rest extra Behavioral guards.)
6. Exact build/test commands you actually run — and the sanctioned test data:
   which test scene, how to seed a save. (Becomes Test scenes & data.)
7. Anything in the template's Code style you'd override for THIS project
   (DOTS/ECS, UniTask, no singletons, custom pooling)? The defaults assume
   classic MonoBehaviour architecture.

Then: write CLAUDE.md preserving the template's Behavioral guards verbatim,
replace every <angle-bracket placeholder>, delete the setup comment, and write
the opening paragraph in the user's own voice — models tone-match, and the
file reads back in the register it was written in. Keep "The three ways to hurt
yourself" first after the intro — pre-flight rules at the top get obeyed,
buried rules don't — and turn the worst burns from question 5 into numbered
footguns there, each with the sanctioned alternative next to the ban. Show
the user the diff.
Maintenance loop to teach the user: Notice (agent did something odd — ask it
why it decided that; if a 5-minute task took 30, have it bucket its own tool
calls into helpful/wasted) → Audit (which context caused it) → Codify (one
line here) → Simplify (delete lines that stopped earning their tokens).
