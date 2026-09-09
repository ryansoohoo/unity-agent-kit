---
name: unity-claude-md
description: CLAUDE.md by interview. Use when a Unity CLAUDE.md or AGENTS.md needs writing, extending, or trimming, or a rule or footgun must be written down. Do NOT use for verification, merges, or topology.
---

# Generate a Unity project's CLAUDE.md by interview

The value of instruction text comes from encoding this project's reality, not
from copying a template. The file is a letter to the agent, not a README: a
README sells the project to humans; this file tells the agent how to change
the code and what the team cares about. Interview the user (one question at a
time, short answers fine), then write CLAUDE.md from the template structure.

Every line is loaded on every turn, so the bar is high. A line earns its
place by changing behavior versus the model's default, by being true today,
and by saying something `ls` or a config file cannot.

## If the project already has a CLAUDE.md or AGENTS.md

Read it first. Ask only the questions below whose answers are missing or
outgrown, and amend in place: headings, their order, and the file's voice
stay, and a new rule or footgun joins the section that already owns that
content. Trim by the maintenance loop's Simplify step, not by rewrite. Show
the user the diff.

## Interview, in order

1. What is this project? (one sentence: genre or purpose, Unity version,
   pipeline) And what does it never compromise on? (2 to 4: frame budget,
   feel, save compatibility, determinism). These become **What we never
   compromise on**, and they do more work than any rule below: an agent that
   shares your values makes fewer of the small mistakes the rules exist for.
2. Runtime targets: platforms, input, frame budget, quality tiers? (Also fills
   the platforms-and-input line of Hit every surface.)
3. How does the game work, in one paragraph? Core loop, where state lives, how
   systems talk. And the 4 to 6 folders that matter, including which
   third-party dirs are read-only. (These become How it works and Where code
   lives.)
4. Project vocabulary: 5 to 10 nouns the agent should use your way (systems,
   scene names, abbreviations). These become the **Glossary**, the shared
   language that stops the agent inventing its own terms.
5. What has burned you before? (agent or human mistakes to guard against).
   For each burn, ask first whether a lint rule, a test, or an editor guard
   could remove it outright; a rule in this file is the fallback when code
   cannot catch it. The worst survivors become numbered footguns, the rest
   extra Behavioral guards.
6. Exact build and test commands you actually run, and the sanctioned test
   data: which test scene, how to seed a save. (Becomes Test scenes and data.)
7. Anything in the template's Code style you would override for this project
   (DOTS/ECS, UniTask, no singletons, custom pooling)? The defaults assume
   classic MonoBehaviour architecture.

## Write the file

- Preserve the template's Behavioral guards verbatim, replace every
  `<angle-bracket placeholder>`, delete the setup comment.
- Write the opening paragraph in the user's own voice. Models tone-match, and
  the file reads back in the register it was written in.
- Keep "The three ways to hurt yourself" first after the intro. Pre-flight
  rules at the top get obeyed; buried rules do not. Turn the worst burns from
  question 5 into numbered footguns there, each stating the sanctioned
  alternative beside the ban, so the agent reads what to do and not only what
  to avoid.
- Phrase every new rule as the target behavior ("cache GetComponent in
  Awake") rather than the prohibition alone.
- Show the user the diff.

**Done when:** every placeholder is replaced, every rule names its positive
alternative, no line restates something the repo's config or layout already
says, and the user has seen the diff.

## Maintenance loop to teach the user

Notice (the agent did something odd: ask it why it decided that; if a
5-minute task took 30, have it bucket its own tool calls into helpful and
wasted). Audit (which context caused it). Codify (one line here, after
checking that a lint, test, or guard could not remove it instead). Simplify
(delete lines that stopped earning their tokens; a good file gets shorter as
it gets better).
