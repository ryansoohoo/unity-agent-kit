import { register } from '../registry.js';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// Injectable for tests — the real process table is nondeterministic.
export const _deps = {
  processes() {
    try {
      const out = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      return out.split(/\r?\n/)
        .map(l => l.match(/^"([^"]+)","(\d+)"/))
        .filter(Boolean)
        .map(m => ({ name: m[1], pid: Number(m[2]) }));
    } catch { return null; }
  },
};

register({
  id: 'orphans', layer: 'hygiene', title: 'No orphaned Unity/dotnet processes or stale locks',
  explain: () =>
    'Dead sub-tasks leave orphans behind: extra Unity.exe processes fighting over one Library/, dotnet ' +
    'compile servers pinning files, Temp/UnityLockfile in trees whose editor died, and locked git worktree ' +
    'admin dirs. The topology rule is ONE hot editor; everything else here is a stall waiting to happen. ' +
    'Detect-only: killing processes is a human decision — the kit lists PIDs and you stop only the ones ' +
    'you own (kill-by-PID, never kill-by-name).',
  detect: async (ctx) => {
    if (ctx.platform !== 'win32') return { status: 'na', evidence: 'verified on Windows only' };
    const procs = _deps.processes();
    if (!procs) return { status: 'na', evidence: 'tasklist unavailable — cannot inspect processes' };
    const unity = procs.filter(p => /^Unity(\.exe)?$/i.test(p.name));
    const dotnet = procs.filter(p => /^dotnet(\.exe)?$/i.test(p.name));
    const wt = ctx.git('worktree', 'list', '--porcelain');
    const roots = wt.ok && wt.out ? [...wt.out.matchAll(/^worktree (.+)$/gm)].map(m => m[1]) : [ctx.root];
    const staleLocks = unity.length === 0 ? roots.filter(r => existsSync(join(r, 'Temp', 'UnityLockfile'))) : [];
    const adminDir = join(ctx.root, '.git', 'worktrees');
    let adminLocks = [];
    try {
      if (existsSync(adminDir) && statSync(adminDir).isDirectory())
        adminLocks = readdirSync(adminDir).filter(n => existsSync(join(adminDir, n, 'locked')));
    } catch { /* .git may be a FILE in linked worktrees — skip the admin-lock scan */ }
    const bits = [];
    if (unity.length > 1) bits.push(`${unity.length} Unity processes (PIDs ${unity.map(p => p.pid).join(', ')}) — topology wants ONE hot editor`);
    if (staleLocks.length) bits.push(`stale Temp/UnityLockfile with no Unity running: ${staleLocks.join(', ')}`);
    if (adminLocks.length) bits.push(`locked git worktrees: ${adminLocks.join(', ')} (git worktree unlock <name>)`);
    if (dotnet.length >= 6) bits.push(`${dotnet.length} dotnet processes — possible orphaned compile servers`);
    return bits.length
      ? { status: 'warn', evidence: bits.join(' | ') } // advisory: never fail
      : { status: 'pass', evidence: `${unity.length} Unity, ${dotnet.length} dotnet process(es), no stale locks` };
  },
});
