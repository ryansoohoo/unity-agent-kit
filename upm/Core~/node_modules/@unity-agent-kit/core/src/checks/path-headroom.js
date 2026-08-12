import { register } from '../registry.js';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function longestPath(dir, depthLeft, cap) {
  let max = dir.length;
  if (depthLeft === 0 || cap.n <= 0) return max;
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return max; }
  for (const e of entries) {
    if (cap.n-- <= 0) break;
    const p = join(dir, e.name);
    max = Math.max(max, e.isDirectory() ? longestPath(p, depthLeft - 1, cap) : p.length);
  }
  return max;
}

register({
  id: 'path-headroom', layer: 'hygiene', title: 'MAX_PATH headroom for worktree prefixes',
  explain: () => 'Windows caps unmarked paths at 260 chars. Unity\'s Library/PackageCache nests deep; a worktree prefix (.claude/worktrees/<name>/) adds ~20+ chars. Low headroom breaks imports in worktrees with confusing native errors. Mitigate by short worktree names or worktrees at a short path outside the repo.',
  detect: async (ctx) => {
    if (ctx.platform !== 'win32') return { status: 'na', evidence: 'not Windows' };
    const lib = join(ctx.root, 'Library');
    if (!existsSync(lib)) return { status: 'na', evidence: 'no Library/ yet (project not opened)' };
    const longest = longestPath(lib, 12, { n: 60000 });
    const worktreePrefix = '.claude/worktrees/'.length + 20;
    const headroom = 260 - (longest + worktreePrefix);
    return headroom < 40
      ? { status: 'warn', evidence: `longest Library path ${longest} chars → ~${headroom} chars of worktree-name headroom under MAX_PATH` }
      : { status: 'pass', evidence: `longest Library path ${longest} chars → ~${headroom} chars headroom` };
  },
});
