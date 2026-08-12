import { register } from '../registry.js';
import { readEpoch, isFresh } from '../kanabo.js';

register({
  id: 'kanabo', layer: 'integration', title: 'Reload-boundary epoch signal (v2)',
  explain: () =>
    'The kit\'s UPM package writes Temp/unity-agent-kit/epoch.json from inside the editor: a per-reload ' +
    'epoch, a 0.5 s heartbeat, compile/reload state, and an asset world-revision. Agents poll it (kit ' +
    '--epoch, or kanabo.waitReady) instead of blind-sleeping after edits — the file stays readable through ' +
    'the exact reload window where every socket and port is dead, and the epoch makes stale reads ' +
    'detectable instead of silent. Detect-only: an absent or idle editor is a state, not a defect.',
  detect: async (ctx) => {
    const snap = readEpoch(ctx.root);
    if (!snap) return { status: 'na', evidence: 'no epoch signal — install the kit\'s UPM package and open the project in the editor once (v2)' };
    if (!isFresh(snap)) return { status: 'na', evidence: `editor not running (heartbeat stale; last epoch ${snap.epoch})` };
    return { status: 'pass', evidence: `epoch ${snap.epoch} · revision ${snap.worldRevision} · state ${snap.state}` };
  },
});
