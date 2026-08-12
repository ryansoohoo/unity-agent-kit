import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContext } from '../src/context.js';
import '../src/checks/index.js';
import { getCheck } from '../src/registry.js';

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

test('audit: 3+ C# edits with no compile/refresh anywhere = NO-VERIFY', async () => {
  const r = await detectWith([
    aUse('Edit', { file_path: 'Assets/A.cs' }),
    aUse('Edit', { file_path: 'Assets/B.cs' }),
    aUse('Write', { file_path: 'Assets/C.cs', content: 'x' }),
  ]);
  const f = r.detail.findings.find(x => x.signature === 'write-without-refresh');
  assert.equal(f.taxonomy, 'NO-VERIFY');
  assert.match(f.message, /3 C# file edits/);
});

test('audit: a dotnet build clears write-without-refresh', async () => {
  const r = await detectWith([
    aUse('Edit', { file_path: 'Assets/A.cs' }),
    aUse('Edit', { file_path: 'Assets/B.cs' }),
    aUse('Edit', { file_path: 'Assets/C.cs' }),
    aUse('Bash', { command: 'dotnet build MyGame.sln' }),
  ]);
  assert.ok(!r.detail.findings.some(x => x.signature === 'write-without-refresh'));
});

test('audit: three empty tool results = safe-to-ignore accepted-empty-response', async () => {
  const r = await detectWith([aResult(''), aResult('  '), aResult('')]);
  const f = r.detail.findings.find(x => x.signature === 'accepted-empty-response');
  assert.equal(f.class, 'safe-to-ignore');
});

test('audit: 10 straight edits with no measurement after = huge-diff-no-measurement', async () => {
  const edits = Array.from({ length: 10 }, (_, i) => aUse('Edit', { file_path: `Assets/F${i}.cs` }));
  const r1 = await detectWith([...edits, aUse('Bash', { command: 'echo done' })]);
  assert.ok(r1.detail.findings.some(x => x.signature === 'huge-diff-no-measurement'));
  const r2 = await detectWith([...edits, aUse('Bash', { command: 'npm test' })]);
  assert.ok(!r2.detail.findings.some(x => x.signature === 'huge-diff-no-measurement'));
});

test('audit: 10 sub-agent dispatches = runaway-subagent-chain', async () => {
  const r = await detectWith(Array.from({ length: 10 }, () => aUse('Task', { prompt: 'go' })));
  const f = r.detail.findings.find(x => x.signature === 'runaway-subagent-chain');
  assert.match(f.message, /10 sub-agent dispatches/);
});

test('audit: session tally counts tokens, tool calls, and consecutive-identical retries', async () => {
  const r = await detectWith([
    aUse('Bash', { command: 'dotnet build' }),
    aUse('Bash', { command: 'dotnet build' }),
    aUse('Bash', { command: 'dotnet build' }),
  ]);
  const s = r.detail.sessions[0];
  assert.equal(s.toolCalls, 3);
  assert.equal(s.retries, 2);
  assert.deepEqual(s.tokens, { input: 3, output: 3 });
});
