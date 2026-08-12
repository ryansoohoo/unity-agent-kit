import { register } from '../registry.js';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

register({
  id: 'unity-version', layer: 'hygiene', title: 'Unity version in the verified support matrix',
  explain: () => 'The kit\'s claims are measured on Unity 6.x on Windows. Other versions may work; the kit does not claim they do.',
  detect: async (ctx) => {
    const p = join(ctx.root, 'ProjectSettings', 'ProjectVersion.txt');
    if (!existsSync(p)) return { status: 'na', evidence: 'no ProjectSettings/ProjectVersion.txt — not a Unity project root' };
    const m = readFileSync(p, 'utf8').match(/m_EditorVersion:\s*(\S+)/);
    if (!m) return { status: 'warn', evidence: 'ProjectVersion.txt unreadable' };
    return m[1].startsWith('6000.')
      ? { status: 'pass', evidence: `Unity ${m[1]} (verified matrix)` }
      : { status: 'warn', evidence: `Unity ${m[1]} — outside the verified Windows + Unity 6.x matrix` };
  },
});
