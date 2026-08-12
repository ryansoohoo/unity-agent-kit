import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContext } from '../src/context.js';
import '../src/checks/index.js';
import { getCheck } from '../src/registry.js';
import { DENY_RULES } from '../src/checks/blast-radius.js';

const audit = getCheck('audit');
const aUse = (name, input) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'x', name, input }], usage: { input_tokens: 1, output_tokens: 1 } } });
const aResult = (text) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: text }] } });

function fixture(entries) {
  const dir = mkdtempSync(join(tmpdir(), 'uak-fx-'));
  writeFileSync(join(dir, 's.jsonl'), entries.map(e => JSON.stringify(e)).join('\n') + '\n');
  return dir;
}

async function detectWith(entries, root = mkdtempSync(join(tmpdir(), 'uak-au-'))) {
  process.env.UAK_TRANSCRIPTS = fixture(entries);
  try { return await audit.detect(createContext(root)); }
  finally { delete process.env.UAK_TRANSCRIPTS; }
}

test('audit: registered detect-only in the audit layer, local-only stated', () => {
  assert.equal(audit.layer, 'audit');
  assert.equal(audit.apply, undefined);
  assert.match(audit.explain(), /[Ll]ocal-only/);
  assert.match(audit.explain(), /uploads? NOTHING/i);
});

test('audit: na when no transcripts exist for this project', async () => {
  const r = await audit.detect(createContext(mkdtempSync(join(tmpdir(), 'uak-au-'))));
  assert.equal(r.status, 'na');
  assert.match(r.evidence, /no local transcripts/);
});

test('audit: clean session → pass with empty findings detail', async () => {
  const r = await detectWith([aUse('Read', { file_path: 'a.cs' }), aResult('ok')]);
  assert.equal(r.status, 'pass');
  assert.deepEqual(r.detail.findings, []);
});

test('audit: blind sleep right after an edit is caught (PROCESS)', async () => {
  const r = await detectWith([
    aUse('Edit', { file_path: 'Assets/Foo.cs' }),
    aUse('Bash', { command: 'sleep 10' }),
  ]);
  assert.equal(r.status, 'warn');
  const f = r.detail.findings.find(x => x.signature === 'blind-sleep-after-edit');
  assert.equal(f.taxonomy, 'PROCESS');
  assert.match(f.preventedBy, /unity-verify/);
  assert.ok(f.line >= 1 && f.file.endsWith('s.jsonl'));
});

test('audit: destructive near-miss is fix-now without deny rules, superseded with them', async () => {
  const entries = [aUse('Bash', { command: 'git clean -fdx' })];
  const r1 = await detectWith(entries);
  assert.equal(r1.detail.findings[0].signature, 'destructive-near-miss');
  assert.equal(r1.detail.findings[0].class, 'fix-now');
  const guarded = mkdtempSync(join(tmpdir(), 'uak-au-'));
  mkdirSync(join(guarded, '.claude'), { recursive: true });
  writeFileSync(join(guarded, '.claude', 'settings.json'), JSON.stringify({ permissions: { deny: DENY_RULES } }));
  const r2 = await detectWith(entries, guarded);
  assert.equal(r2.detail.findings[0].class, 'superseded');
});

test('audit: five consecutive calls at one dead port = retry storm', async () => {
  const r = await detectWith(Array.from({ length: 5 }, () => aUse('Bash', { command: 'curl -s http://localhost:8090/status' })));
  const f = r.detail.findings.find(x => x.signature === 'dead-port-retry-storm');
  assert.match(f.message, /5 consecutive/);
  assert.equal(f.taxonomy, 'TOOL-MISUSE');
});

test('audit: oversized console dump flagged per occurrence', async () => {
  const r = await detectWith([aUse('Bash', { command: 'cat log' }), aResult('x'.repeat(60000))]);
  const f = r.detail.findings.find(x => x.signature === 'oversized-console-dump');
  assert.match(f.message, /60k chars/);
});

test('audit: fix-now findings rank before needs-attention', async () => {
  const r = await detectWith([
    aUse('Edit', { file_path: 'A.cs' }),
    aUse('Bash', { command: 'sleep 5' }),
    aUse('Bash', { command: 'git clean -fdx' }),
  ]);
  assert.equal(r.detail.findings[0].class, 'fix-now');
});

test('audit: garbage transcripts never crash the doctor', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'uak-fx-'));
  writeFileSync(join(dir, 'bad.jsonl'), '\u0000\u0001 total garbage\nmore garbage\n');
  process.env.UAK_TRANSCRIPTS = dir;
  try {
    const r = await audit.detect(createContext(mkdtempSync(join(tmpdir(), 'uak-au-'))));
    assert.equal(r.status, 'na');
  } finally { delete process.env.UAK_TRANSCRIPTS; }
});
