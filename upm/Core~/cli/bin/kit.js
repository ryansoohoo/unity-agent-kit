#!/usr/bin/env node
import { createContext } from '@unity-agent-kit/core/src/context.js';
import '@unity-agent-kit/core/src/checks/index.js';
import { doctor, applyOne } from '@unity-agent-kit/core/src/engine.js';
import { getCheck } from '@unity-agent-kit/core/src/registry.js';
import { undoAll } from '@unity-agent-kit/core/src/audit.js';
import { readEpoch, isFresh, waitReady } from '@unity-agent-kit/core/src/kanabo.js';
import { writeRequest, awaitResult } from '@unity-agent-kit/core/src/actions.js';
import { parseProfilerArgs, profilerRequest, executeProfiler, compareProfiler, validateProfilerContext } from '@unity-agent-kit/core/src/profiler.js';
import { readConsole, clearConsole, ERROR_TYPES } from '@unity-agent-kit/core/src/console.js';
import readline from 'node:readline/promises';
import { runBridgeCli, sourceIdentity } from '@unity-agent-kit/core/src/bridge-cli.js';

class UsageError extends Error {}

// Returning an exit code lets Node drain piped stdout/stderr. process.exit()
// can truncate a large JSON response on platforms with asynchronous pipe writes.
async function main() {
  const VERBS = ['console'];
  const argv = process.argv.slice(2);
  const bridgeExit = await runBridgeCli(argv);
  if (bridgeExit !== null) return bridgeExit;
  if (argv[0] === 'doctor') argv.shift();
  // Remaining legacy entry points: console and doctor flags, including --epoch
  // and --wait-ready. The request bridge handles invoke before this parser.
  const verb = VERBS.includes(argv[0]) ? argv[0] : null;
  const args = verb ? argv.slice(1) : argv;
  if (argv[0] === 'profiler') {
    try {
      const parsed = parseProfilerArgs(argv.slice(1));
      const profilerRoot = parsed.root ?? process.cwd();
      if (parsed.context) { const { readFileSync } = await import('node:fs'); parsed.contextJson = validateProfilerContext(readFileSync(parsed.context, 'utf8')); }
      if (parsed.action === 'start') {
        const context = JSON.parse(parsed.contextJson ?? '{}');
        context.source = { ...context.source, ...sourceIdentity(profilerRoot) };
        parsed.contextJson = validateProfilerContext(JSON.stringify(context));
      }
      if (parsed.action === 'compare') {
        if (!parsed.before || !parsed.after) throw new Error('compare needs --before and --after');
        const { readFileSync, writeFileSync } = await import('node:fs');
        const data = compareProfiler(readFileSync(parsed.before, 'utf8'), readFileSync(parsed.after, 'utf8'), parsed.limit);
        if (parsed.out) writeFileSync(parsed.out, JSON.stringify(data, null, 2), { flag: 'wx' });
        console.log(JSON.stringify(data)); return 0;
      }
      const result = await executeProfiler(profilerRoot, profilerRequest(parsed), { writeRequest, awaitResult, timeoutMs: parsed.timeoutMs, leaseToken: parsed.lease });
      if (parsed.out && result.ok) {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(parsed.out, JSON.stringify(result, null, 2), { flag: 'wx' });
      }
      console.log(JSON.stringify(result));
      return result.ok ? 0 : 1;
    } catch (e) { console.error(`profiler: ${e.message}`); return 2; }
  }
  const flag = (f) => args.includes(f);
  const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
  // Numeric options are validated at the door: a typo'd value (`--timeout-ms /path`)
  // would otherwise reach the poller as NaN, where every bound comparison is false
  // forever — a bounded wait silently becoming an endless one.
  const num = (f, dflt) => {
    const v = opt(f);
    if (v === undefined) return dflt;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new UsageError(`${f} needs a number (got: ${v})`);
    return n;
  };
  const OPT_FLAGS = ['--only', '--since-epoch', '--timeout-ms', '--poll-ms', '--last'];
  const root = args.find((a, i) => !a.startsWith('--') && !OPT_FLAGS.includes(args[i - 1])) ?? process.cwd();

  const GLYPH = { pass: 'OK  ', warn: 'WARN', fail: 'FAIL', na: '--  ' };

  const ctx = createContext(root);

  if (verb === 'console') {
    if (flag('--clear')) { clearConsole(ctx.root); console.log('console cleared'); return 0; }
    const entries = readConsole(ctx.root, { errors: flag('--errors'), sinceEpoch: num('--since-epoch', -1), last: num('--last', 0) });
    if (flag('--json')) console.log(JSON.stringify(entries, null, 2));
    else {
      for (const e of entries) {
        console.log(`[${e.type}] e${e.epoch} f${e.frame} ${e.message}`);
        if (e.stack && ERROR_TYPES.has(e.type)) console.log(`    ${e.stack}`);
      }
      if (!entries.length) console.log('(no console entries — is the kit UPM package installed and the editor open?)');
    }
    return 0;
  }

  if (flag('--undo')) {
    const { undone } = undoAll(ctx);
    console.log(undone.length ? undone.map(u => `  undid: ${u}`).join('\n') : '  nothing to undo');
    return 0;
  }

  if (flag('--epoch')) {
    const snap = readEpoch(ctx.root);
    console.log(JSON.stringify({ ...(snap ?? {}), present: !!snap, fresh: isFresh(snap) }, null, 2));
    return 0;
  }

  if (flag('--wait-ready')) {
    const r = await waitReady(ctx.root, {
      sinceEpoch: num('--since-epoch', -1),
      requireEpochBump: opt('--since-epoch') !== undefined,
      timeoutMs: num('--timeout-ms', 120000),
      pollMs: num('--poll-ms', 250),
    });
    console.log(JSON.stringify(r, null, 2));
    return r.ok ? 0 : 1;
  }

  const rows = await doctor(ctx, { only: opt('--only') });

  if (flag('--fix')) {
    const failing = rows.filter(r => (r.status === 'fail' || r.status === 'warn') && getCheck(r.id).apply);
    if (!process.stdin.isTTY && !flag('--yes')) { console.error('non-interactive: use --yes'); return 2; }
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
    return after.some(x => x.status === 'fail') ? 1 : 0;
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
  return rows.some(r => r.status === 'fail') ? 1 : 0;
}

try { process.exitCode = await main(); }
catch (error) {
  if (!(error instanceof UsageError)) throw error;
  console.error(error.message);
  process.exitCode = 2;
}
