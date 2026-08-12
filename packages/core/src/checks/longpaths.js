import { register } from '../registry.js';

register({
  id: 'longpaths', layer: 'hygiene', title: 'git core.longpaths enabled (Windows MAX_PATH)',
  explain: () => 'Unity\'s Library/PackageCache nests paths past 200 characters; with worktree prefixes the 260-char Windows MAX_PATH limit is close. core.longpaths=true prevents git failing on deep paths.',
  detect: async (ctx) => {
    if (ctx.platform !== 'win32') return { status: 'na', evidence: 'not Windows' };
    if (!ctx.git('rev-parse', '--is-inside-work-tree').ok) return { status: 'na', evidence: 'not a git repo' };
    const r = ctx.git('config', '--get', 'core.longpaths');
    return r.out === 'true' ? { status: 'pass', evidence: 'core.longpaths=true' }
      : { status: 'fail', evidence: 'core.longpaths unset — deep PackageCache paths can break git operations' };
  },
  apply: async (ctx) => {
    const prev = ctx.git('config', '--get', 'core.longpaths');
    ctx.git('config', 'core.longpaths', 'true');
    return { changed: ['git config core.longpaths=true'], undo: [{ kind: 'git-config-restore', key: 'core.longpaths', previous: prev.ok ? prev.out : null }] };
  },
});
