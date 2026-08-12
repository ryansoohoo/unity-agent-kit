import { register } from '../registry.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

export const DENY_RULES = [
  'Bash(git clean:*)',
  'Bash(git reset --hard:*)',
  'Bash(rm -rf:*)',
  'Bash(rm -r:*)',
  'Bash(rmdir /s:*)',
  'PowerShell(Remove-Item -Recurse:*)',
];

register({
  id: 'blast-radius', layer: 'hygiene', title: 'Destructive-command deny rules installed',
  explain: () =>
    'Agents have deleted user files in the wild. In a Unity repo the stakes are higher: git clean silently ' +
    'deletes .meta files (GUID corruption — every reference repoints), and deleting Library/ under a live ' +
    'editor costs hours of reimport. These deny rules make the worst commands require explicit human approval. ' +
    'They are per-project (.claude/settings.json) and preserved alongside your existing rules.',
  detect: async (ctx) => {
    const p = join(ctx.root, '.claude', 'settings.json');
    if (!existsSync(p)) return { status: 'fail', evidence: 'no .claude/settings.json — no deny rules protect Assets/, .meta files, or Library/' };
    let s;
    try { s = JSON.parse(readFileSync(p, 'utf8')); } catch { return { status: 'warn', evidence: '.claude/settings.json is not valid JSON — fix it by hand first' }; }
    const deny = s?.permissions?.deny ?? [];
    const missing = DENY_RULES.filter(r => !deny.includes(r));
    return missing.length === 0
      ? { status: 'pass', evidence: `all ${DENY_RULES.length} blast-radius deny rules present` }
      : { status: 'fail', evidence: `missing deny rules: ${missing.join(', ')}` };
  },
  apply: async (ctx) => {
    const p = join(ctx.root, '.claude', 'settings.json');
    const prev = existsSync(p) ? readFileSync(p, 'utf8') : null;
    const s = prev ? JSON.parse(prev) : {};
    s.permissions = s.permissions ?? {};
    s.permissions.deny = Array.from(new Set([...(s.permissions.deny ?? []), ...DENY_RULES]));
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(s, null, 2) + '\n');
    return { changed: [p], undo: [{ kind: 'restore-file', path: p, previous: prev }] };
  },
});
