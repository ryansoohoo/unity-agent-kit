import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transcriptDirFor, readSessions, toolUses, toolResults, usageTotals } from '../src/transcripts.js';

test('transcriptDirFor sanitizes every non-alphanumeric to "-" (incl. ō and :\\)', () => {
  assert.equal(
    transcriptDirFor('C:\\Users\\Ryan\\Kintarō', 'C:\\home'),
    join('C:\\home', '.claude', 'projects', 'C--Users-Ryan-Kintar-'));
});

test('readSessions parses JSONL, skips junk lines, never throws', () => {
  const dir = mkdtempSync(join(tmpdir(), 'uak-tr-'));
  writeFileSync(join(dir, 'a.jsonl'), [
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: '1', name: 'Bash', input: { command: 'echo hi' } }], usage: { input_tokens: 7, output_tokens: 3 } } }),
    'NOT JSON AT ALL {{{',
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: '1', content: [{ type: 'text', text: 'hi' }] }] } }),
    '"a bare string is not an entry"',
    JSON.stringify({ type: 'queue-operation', operation: 'enqueue' }),
  ].join('\n'));
  writeFileSync(join(dir, 'empty.jsonl'), '\n\n');
  writeFileSync(join(dir, 'not-a-transcript.txt'), 'ignored');
  const sessions = readSessions(dir);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].entries.length, 3);
  assert.deepEqual(toolUses(sessions[0]), [{ line: 1, name: 'Bash', input: { command: 'echo hi' } }]);
  assert.deepEqual(toolResults(sessions[0]), [{ line: 3, text: 'hi' }]);
  assert.deepEqual(usageTotals(sessions[0]), { input: 7, output: 3 });
});

test('readSessions on a missing dir returns []', () => {
  assert.deepEqual(readSessions(join(tmpdir(), 'uak-definitely-missing-xyz')), []);
});

test('toolResults flattens plain-string content too', () => {
  const dir = mkdtempSync(join(tmpdir(), 'uak-tr-'));
  writeFileSync(join(dir, 'b.jsonl'),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'plain' }] } }) + '\n');
  assert.deepEqual(toolResults(readSessions(dir)[0]), [{ line: 1, text: 'plain' }]);
});
