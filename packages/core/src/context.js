import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

export function createContext(projectRoot) {
  const root = resolve(projectRoot);
  return {
    root,
    platform: process.platform,
    git(...args) {
      try {
        const out = execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        return { ok: true, out: out.replace(/[\r\n]+$/, ''), code: 0 };
      } catch (e) {
        return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}`.replace(/[\r\n]+$/, ''), code: e.status ?? 1 };
      }
    },
  };
}
