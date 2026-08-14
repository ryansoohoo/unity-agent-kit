import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSkillInvocations, scoreRuns, verdictFor } from '../../../scripts/skill-evals.mjs';

const LINE = (name) => JSON.stringify({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: name } }] },
});

test('parser: extracts Skill invocations from stream-json lines, ignores noise', () => {
  const out = [
    '{"type":"system","subtype":"init"}',
    LINE('unity-verify'),
    'not json at all',
    '{"type":"assistant","message":{"content":{"type":"tool_use","name":"Skill"}}}', // content not an array: another shape, not iterable
    '{"type":"result","result":"done"}',
  ].join('\n');
  assert.deepEqual(parseSkillInvocations(out), ['unity-verify']);
});

test('parser: no Skill tool_use means empty list', () => {
  const out = '{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}';
  assert.deepEqual(parseSkillInvocations(out), []);
});

test('scoring: exact-match verdicts and cross-fire accounting', () => {
  const records = [
    { skill: 'unity-verify', expect: 'unity-verify', fired: ['unity-verify'], verdict: null },
    { skill: 'unity-verify', expect: 'none', fired: ['unity-merge'], verdict: null },
    { skill: 'unity-verify', expect: 'unity-verify', fired: [], verdict: null },
  ];
  const s = scoreRuns(records);
  assert.equal(s.perSkill['unity-verify'].hit, 1);
  assert.equal(s.perSkill['unity-verify'].miss, 1);
  assert.equal(s.crossFires.length, 1);
});

// A failed CLI call is not a skill declining to fire: an expired token mid-run
// must read as indeterminate, never as a run of misses.
test('verdict: a non-zero exit or a failed spawn is indeterminate, not a miss', () => {
  assert.equal(verdictFor({ status: 0 }), null);
  assert.equal(verdictFor({ status: 1 }), 'indeterminate');  // expired auth, usage limit, bad --model
  assert.equal(verdictFor({ status: null }), 'indeterminate'); // timeout
  assert.equal(verdictFor({ error: new Error('ENOENT'), status: null }), 'indeterminate');
});

// Turn exhaustion exits non-zero but is NOT a failed call: the router already
// chose on turn 1 and that choice is in the stream, so the record stays
// determinate and keeps its parsed `fired`. Measured: with the model free to
// use tools after routing, this was 10 of 20 smoke records.
test('verdict: max-turns exhaustion is determinate, unlike every other non-zero exit', () => {
  const result = (extra) => JSON.stringify({ type: 'result', is_error: true, ...extra });
  const maxTurns = result({ subtype: 'error_max_turns', terminal_reason: 'max_turns' });
  assert.equal(verdictFor({ status: 1, stdout: maxTurns }), null);
  // Real captured shape from the auth outage: same exit 1, no max_turns marker.
  assert.equal(verdictFor({ status: 1, stdout: result({ terminal_reason: 'api_error', result: 'Not logged in · Please run /login' }) }), 'indeterminate');
  // A spawn failure is unknowable regardless of what sits in the buffer.
  assert.equal(verdictFor({ error: new Error('ENOENT'), status: null, stdout: maxTurns }), 'indeterminate');
  // Noise around the result line must not be mistaken for one.
  assert.equal(verdictFor({ status: 1, stdout: 'not json\n{"type":"assistant"}\n' }), 'indeterminate');
});
