import { register } from '../registry.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// Injectable for tests. Returns null when the unity CLI is not on PATH,
// otherwise the trimmed stdout of `unity status` ('' = no editors).
export const _deps = {
  unityStatus() {
    try { return execFileSync('unity', ['status'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000 }).trim(); }
    catch (e) { return e && e.code === 'ENOENT' ? null : ''; }
  },
};

register({
  id: 'pipeline', layer: 'integration', title: 'Unity Pipeline package (Tier 0 eval) — informational',
  explain: () =>
    'com.unity.pipeline lets Unity\'s own CLI run `unity command eval` in the live editor (unity-verify Tier 0). ' +
    'The kit does NOT depend on it — invoke/console/wait-ready ride the kit\'s file channel — but when it is ' +
    'installed and reachable, Tier 0 exists; when it is absent, `unity command …` fails with "No Unity Editor ' +
    'instances found with reachable Pipeline servers" and agents should not keep trying it. Detect-only.',
  detect: async (ctx) => {
    let deps = {};
    try { deps = JSON.parse(readFileSync(join(ctx.root, 'Packages', 'manifest.json'), 'utf8')).dependencies ?? {}; }
    catch { return { status: 'na', evidence: 'no Packages/manifest.json — not a Unity project root' }; }
    if (!deps['com.unity.pipeline']) return { status: 'na', evidence: 'com.unity.pipeline not installed — Tier 0 eval unavailable; the kit does not need it (unity pipeline install to add)' };
    const status = _deps.unityStatus();
    if (status === null) return { status: 'warn', evidence: `com.unity.pipeline ${deps['com.unity.pipeline']} installed but the unity CLI is not on PATH` };
    if (!status) return { status: 'warn', evidence: `com.unity.pipeline ${deps['com.unity.pipeline']} installed; unity status: no reachable editor (open the project, or the server did not start)` };
    return { status: 'pass', evidence: `com.unity.pipeline ${deps['com.unity.pipeline']} reachable — ${status.split('\n')[0]}` };
  },
});
