#!/usr/bin/env node
import { createContext } from '@unity-agent-kit/core/src/context.js';
import '@unity-agent-kit/core/src/checks/index.js';
import { doctor } from '@unity-agent-kit/core/src/engine.js';
import { getCheck } from '@unity-agent-kit/core/src/registry.js';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const root = args.find(a => !a.startsWith('--') && a !== opt('--only')) ?? process.cwd();

const GLYPH = { pass: 'OK  ', warn: 'WARN', fail: 'FAIL', na: '--  ' };

const ctx = createContext(root);
const rows = await doctor(ctx, { only: opt('--only') });

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
