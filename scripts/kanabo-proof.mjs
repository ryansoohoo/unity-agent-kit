// Kanabō proof harness — the spec's acceptance run:
//   N iterations of edit → refresh → reload → verify,
//   zero false successes, zero stale-epoch reads.
// Runs against a DISPOSABLE
// scratch project (never a real game project — scope rule). Controller-run; not a unit test.
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { readEpoch, isFresh, requestRefresh, waitReady } from '../packages/core/src/kanabo.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const flag = (f) => args.includes(f);

const project = opt('--project');
const unity = opt('--unity');
const iters = Number(opt('--iters') ?? 100);
if (!project || !unity || !Number.isInteger(iters) || iters < 1) {
  console.error('usage: kanabo-proof --project <path> --unity <Unity.exe> --iters N [--launch] [--dry]');
  process.exit(2);
}

if (!flag('--dry') && flag('--launch') && !existsSync(unity)) {
  console.error(`--unity path does not exist: ${unity}`);
  process.exit(2);
}

const root = resolve(project);
const probeFile = join(root, 'Assets', 'UAK', 'EpochProbe.cs');
const upmRel = relative(join(root, 'Packages'), join(REPO, 'upm')).replace(/\\/g, '/');
const manifestPatch = { 'com.unity-agent-kit.doctor': `file:${upmRel}` };

if (flag('--dry')) {
  console.log(JSON.stringify({ dry: true, root, iters, probeFile, unity, manifestPatch }, null, 2));
  process.exit(0);
}

function ensureManifest() {
  const p = join(root, 'Packages', 'manifest.json');
  const m = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : { dependencies: {} };
  m.dependencies ??= {};
  if (m.dependencies['com.unity-agent-kit.doctor'] !== manifestPatch['com.unity-agent-kit.doctor']) {
    m.dependencies['com.unity-agent-kit.doctor'] = manifestPatch['com.unity-agent-kit.doctor'];
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(m, null, 2) + '\n');
  }
}

function writeProbe(n) {
  mkdirSync(dirname(probeFile), { recursive: true });
  writeFileSync(probeFile, `namespace UAK { public static class EpochProbe { public const int Value = ${n}; } }\n`);
}

let child = null;
let spawnError = null;
function launchEditor() {
  child = spawn(unity, ['-batchmode', '-nographics', '-projectPath', root, '-logFile', join(root, 'uak-proof-editor.log')], { detached: false, stdio: 'ignore' });
  child.on('error', (e) => { spawnError = e.message; });
  child.on('exit', (c) => { if (c !== null && c !== 0) console.error(`editor exited ${c}`); });
}

const results = [];
let falseSuccesses = 0, staleReads = 0, timeouts = 0;
let bootFailure = null;

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

try {
  ensureManifest();
  if (flag('--launch')) launchEditor();

  const boot = await waitReady(root, { timeoutMs: 600000, pollMs: 500 });
  if (spawnError) bootFailure = `spawn: ${spawnError}`;
  else if (!boot.ok) bootFailure = boot.reason;
  if (!bootFailure) {
    for (let i = 1; i <= iters; i++) {
    const before = readEpoch(root);
    writeProbe(i);
    requestRefresh(root);
    const r = await waitReady(root, { sinceEpoch: before?.epoch ?? -1, requireEpochBump: true, timeoutMs: 180000, pollMs: 250 });
    if (!r.ok) { timeouts++; results.push({ i, ok: false, reason: r.reason, waitedMs: r.waitedMs }); continue; }
    const stale = !(r.snap.probePresent && r.snap.probeValue === i);
    if (stale) {
      // Ready was reported but the probe shows old code: that is exactly the
      // false-success / stale-read failure this layer exists to eliminate.
      falseSuccesses++; staleReads++;
      results.push({ i, ok: false, reason: 'stale-probe', sawValue: r.snap.probeValue, waitedMs: r.waitedMs });
      continue;
    }
    results.push({ i, ok: true, epoch: r.epoch, waitedMs: r.waitedMs });
    if (i % 10 === 0) console.error(`[kanabo-proof] ${i}/${iters} clean so far — median wait ${median(results.filter(x => x.ok).map(x => x.waitedMs))} ms`);
    }
  }
} finally {
  if (child && child.pid) { try { process.kill(child.pid); } catch { /* already gone */ } }
}

if (bootFailure) {
  console.log(JSON.stringify({ ok: false, phase: 'boot', reason: bootFailure }, null, 2));
  process.exit(1);
}

const okWaits = results.filter(x => x.ok).map(x => x.waitedMs);
const report = {
  ok: falseSuccesses === 0 && staleReads === 0 && timeouts === 0 && results.length === iters,
  iters, completed: results.filter(x => x.ok).length, falseSuccesses, staleReads, timeouts,
  waitMs: { min: Math.min(...okWaits, Infinity), median: median(okWaits), max: Math.max(...okWaits, -Infinity) },
  failures: results.filter(x => !x.ok),
};
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
