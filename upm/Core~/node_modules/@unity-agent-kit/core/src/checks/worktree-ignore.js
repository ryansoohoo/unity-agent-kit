import { register } from '../registry.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SNIPPET = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'gitignore-worktrees.txt'), 'utf8');

const IGNORED_RE = /^\/?\.claude\/worktrees\/\r?$/m;

register({
  id: 'worktree-ignore', layer: 'hygiene', title: '.claude/worktrees/ gitignored',
  explain: () => 'Claude Code creates worktrees at .claude/worktrees/ inside the repo by default, un-gitignored. `git clean -xdf` — the most-recommended fix in every "Library corrupt" thread — would delete every agent\'s uncommitted work in one command.',
  detect: async (ctx) => {
    if (!ctx.git('rev-parse', '--is-inside-work-tree').ok) return { status: 'na', evidence: 'not a git repo' };
    const p = join(ctx.root, '.gitignore');
    const has = existsSync(p) && IGNORED_RE.test(readFileSync(p, 'utf8'));
    return has ? { status: 'pass', evidence: '.gitignore covers /.claude/worktrees/' }
      : { status: 'fail', evidence: '.claude/worktrees/ not ignored — one git clean -xdf from data loss' };
  },
  apply: async (ctx) => {
    const p = join(ctx.root, '.gitignore');
    const prev = existsSync(p) ? readFileSync(p, 'utf8') : null;
    // Same anchored check as detect() — a non-anchored substring match (e.g. a
    // line like ".claude/worktrees/foo") must not fool this into skipping the
    // append, or detect would still fail right after apply "succeeded".
    if (!IGNORED_RE.test(prev ?? '')) writeFileSync(p, (prev ?? '') + SNIPPET);
    return { changed: [p], undo: [{ kind: 'restore-file', path: p, previous: prev }] };
  },
});
