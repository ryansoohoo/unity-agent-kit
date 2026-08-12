#!/usr/bin/env node
import { createContext } from '@unity-agent-kit/core/src/context.js';
import '@unity-agent-kit/core/src/checks/index.js';
import { doctor, applyOne } from '@unity-agent-kit/core/src/engine.js';
import { getCheck } from '@unity-agent-kit/core/src/registry.js';
import { undoAll } from '@unity-agent-kit/core/src/audit.js';
import readline from 'node:readline/promises';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const root = args.find(a => !a.startsWith('--') && a !== opt('--only')) ?? process.cwd();

const GLYPH = { pass: 'OK  ', warn: 'WARN', fail: 'FAIL', na: '--  ' };

const ctx = createContext(root);

if (flag('--undo')) {
  const { undone } = undoAll(ctx);
  console.log(undone.length ? undone.map(u => `  undid: ${u}`).join('\n') : '  nothing to undo');
  process.exit(0);
}

const rows = await doctor(ctx, { only: opt('--only') });

if (flag('--fix')) {
  const failing = rows.filter(r => r.status === 'fail' && getCheck(r.id).apply);
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
    const res = await applyOne(ctx, r.id);
    console.log(`  applied: ${res.changed.join('; ')}`);
    if (res.verify) console.log(`  verify: ${res.verify.ok ? 'PROVEN' : 'FAILED'} — ${res.verify.proof}`);
  }
  rl?.close();
  const after = await doctor(ctx, { only: opt('--only') });
  process.exit(after.some(x => x.status === 'fail') ? 1 : 0);
}

if (flag('--json')) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  console.log(`unity-agent-kit doctor · ${root}\n`);
  for (const r of rows) {
    console.log(`  ${GLYPH[r.status]}  ${r.id.padEnd(16)} ${r.evidence}`);
    if (r.status === 'fail') console.log(`        why: ${getCheck(r.id).explain().split('. ')[0]}.`);
  }
  const fails = rows.filter(r => r.status === 'fail').length;
  console.log(`\n  ${fails === 0 ? 'No failures.' : `${fails} failing — run with --fix to repair (per-step consent).`}`);
}
process.exit(rows.some(r => r.status === 'fail') ? 1 : 0);
