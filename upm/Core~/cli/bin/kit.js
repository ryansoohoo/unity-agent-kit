#!/usr/bin/env node
import { createContext } from '@unity-agent-kit/core/src/context.js';
import '@unity-agent-kit/core/src/checks/index.js';
import { doctor, applyOne } from '@unity-agent-kit/core/src/engine.js';
import { getCheck } from '@unity-agent-kit/core/src/registry.js';
import { undoAll } from '@unity-agent-kit/core/src/audit.js';
import { readEpoch, isFresh, waitReady } from '@unity-agent-kit/core/src/kanabo.js';
import { writeRequest, awaitResult } from '@unity-agent-kit/core/src/actions.js';
import { readConsole, clearConsole } from '@unity-agent-kit/core/src/console.js';
import readline from 'node:readline/promises';

const VERBS = ['invoke', 'console'];
const argv = process.argv.slice(2);
// Positional verbs (v3): `kit invoke …`, `kit console …`. Everything else is
// the v1/v2 flag surface (doctor by default, --epoch, --wait-ready, …).
const verb = VERBS.includes(argv[0]) ? argv[0] : null;
const args = verb ? argv.slice(1) : argv;
const flag = (f) => args.includes(f);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const opts = (f) => args.flatMap((a, i) => (a === f && i + 1 < args.length ? [args[i + 1]] : []));
// Numeric options are validated at the door: a typo'd value (`--timeout-ms /path`)
// would otherwise reach the poller as NaN, where every bound comparison is false
// forever — a bounded wait silently becoming an endless one.
const num = (f, dflt) => {
  const v = opt(f);
  if (v === undefined) return dflt;
  const n = Number(v);
  if (!Number.isFinite(n)) { console.error(`${f} needs a number (got: ${v})`); process.exit(2); }
  return n;
};
const OPT_FLAGS = ['--only', '--since-epoch', '--timeout-ms', '--poll-ms', '--menu', '--method', '--arg', '--last'];
const root = args.find((a, i) => !a.startsWith('--') && !OPT_FLAGS.includes(args[i - 1])) ?? process.cwd();

const GLYPH = { pass: 'OK  ', warn: 'WARN', fail: 'FAIL', na: '--  ' };

const ctx = createContext(root);

if (verb === 'invoke') {
  const menu = opt('--menu'), method = opt('--method');
  if (!!menu === !!method) { console.error('invoke needs exactly one of --menu "<path>" or --method Ns.Type.Method'); process.exit(2); }
  const id = writeRequest(ctx.root, 'invoke', menu ? { menu } : { method, args: opts('--arg') });
  const r = await awaitResult(ctx.root, id, { timeoutMs: num('--timeout-ms', 120000), pollMs: num('--poll-ms', 250) });
  if (flag('--json')) console.log(JSON.stringify({ id, ...r }, null, 2));
  else if (r.reason === 'done') {
    console.log(r.ok ? `invoke ok (epoch ${r.result.startedEpoch}→${r.result.finishedEpoch})` : `invoke FAILED: ${r.result.error}`);
    for (const l of r.result.log ?? []) console.log(`  [${l.type}] ${l.message}${l.stack ? `\n      ${l.stack}` : ''}`);
  } else if (r.reason === 'blocked') console.log(`editor BLOCKED: ${r.snap.blocked.kind}${r.snap.blocked.title ? ` "${r.snap.blocked.title}"` : ''} — dismiss it, then retry`);
  else console.log(`invoke ${r.reason} after ${r.waitedMs} ms (request ${id} left in Temp/unity-agent-kit/req)`);
  process.exit(r.ok ? 0 : r.reason === 'no-editor' ? 3 : 1);
}

if (verb === 'console') {
  if (flag('--clear')) { clearConsole(ctx.root); console.log('console cleared'); process.exit(0); }
  const entries = readConsole(ctx.root, { errors: flag('--errors'), sinceEpoch: num('--since-epoch', -1), last: num('--last', 0) });
  if (flag('--json')) console.log(JSON.stringify(entries, null, 2));
  else {
    for (const e of entries) {
      console.log(`[${e.type}] e${e.epoch} f${e.frame} ${e.message}`);
      if (e.stack && /^(Error|Exception|Assert)$/.test(e.type)) console.log(`    ${e.stack}`);
    }
    if (!entries.length) console.log('(no console entries — is the kit UPM package installed and the editor open?)');
  }
  process.exit(0);
}

if (flag('--undo')) {
  const { undone } = undoAll(ctx);
  console.log(undone.length ? undone.map(u => `  undid: ${u}`).join('\n') : '  nothing to undo');
  process.exit(0);
}

if (flag('--epoch')) {
  const snap = readEpoch(ctx.root);
  console.log(JSON.stringify({ ...(snap ?? {}), present: !!snap, fresh: isFresh(snap) }, null, 2));
  process.exit(0);
}

if (flag('--wait-ready')) {
  const r = await waitReady(ctx.root, {
    sinceEpoch: num('--since-epoch', -1),
    requireEpochBump: opt('--since-epoch') !== undefined,
    timeoutMs: num('--timeout-ms', 120000),
    pollMs: num('--poll-ms', 250),
  });
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
}

const rows = await doctor(ctx, { only: opt('--only') });

if (flag('--fix')) {
  const failing = rows.filter(r => (r.status === 'fail' || r.status === 'warn') && getCheck(r.id).apply);
  if (!process.stdin.isTTY && !flag('--yes')) { console.error('non-interactive: use --yes'); process.exit(2); }
  const rl = flag('--yes') ? null : readline.createInterface({ input: process.stdin, output: process.stdout });
  let all = flag('--yes');
  for (const r of failing) {
    const c = getCheck(r.id);
    console.log(`\n[${r.id}] ${r.evidence}\n${c.explain()}\n`);
    let go = all;
    if (!go) {
      const a = (await rl.question('Apply? [y/N/a/q] ')).trim().toLowerCase();
      if (a === 'q') break;
      if (a === 'a') { all = true; go = true; }
      if (a === 'y') go = true;
    }
    if (!go) { console.log('  skipped'); continue; }
    try {
      const res = await applyOne(ctx, r.id);
      console.log(`  applied: ${res.changed.join('; ')}`);
      if (res.verify) console.log(`  verify: ${res.verify.ok ? 'PROVEN' : 'FAILED'} — ${res.verify.proof}`);
    } catch (e) {
      console.log(`  apply failed (project untouched): ${e.message}`);
    }
  }
  rl?.close();
  const after = await doctor(ctx, { only: opt('--only') });
  process.exit(after.some(x => x.status === 'fail') ? 1 : 0);
}

if (flag('--json')) {
  const withExplain = rows.map(r => ({ ...r, explain: getCheck(r.id).explain() }));
  console.log(JSON.stringify(withExplain, null, 2));
} else {
  console.log(`unity-agent-kit doctor · ${root}\n`);
  for (const r of rows) {
    console.log(`  ${GLYPH[r.status]}  ${r.id.padEnd(16)} ${r.evidence}`);
    if (r.status === 'fail') console.log(`        why: ${getCheck(r.id).explain().split('. ')[0]}.`);
    const f = r.detail?.findings;
    if (f?.length) {
      for (const x of f.slice(0, 20)) {
        console.log(`        [${x.class}] (${x.confidence.toFixed(1)}) ${x.message}`);
        console.log(`            ${x.file}:${x.line} — prevented by: ${x.preventedBy}`);
      }
      if (f.length > 20) console.log(`        … +${f.length - 20} more (use --json for all)`);
      const t = r.detail.sessions ?? [];
      const sum = (k) => t.reduce((n, s) => n + (k(s) ?? 0), 0);
      console.log(`        sessions: ${t.length} · tool calls: ${sum(s => s.toolCalls)} · retries: ${sum(s => s.retries)} · output tokens: ${sum(s => s.tokens?.output)}`);
    }
  }
  const fails = rows.filter(r => r.status === 'fail').length;
  console.log(`\n  ${fails === 0 ? 'No failures.' : `${fails} failing — run with --fix to repair (per-step consent).`}`);
}
process.exit(rows.some(r => r.status === 'fail') ? 1 : 0);
