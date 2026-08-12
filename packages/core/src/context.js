import { execFileSync } from 'node:child_process';

export function createContext(projectRoot) {
  return {
    root: projectRoot,
    platform: process.platform,
    git(...args) {
      try {
        const out = execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        return { ok: true, out: out.replace(/[\r\n]+$/, ''), code: 0 };
      } catch (e) {
        return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}`.replace(/[\r\n]+$/, ''), code: e.status ?? 1 };
      }
    },
  };
}
