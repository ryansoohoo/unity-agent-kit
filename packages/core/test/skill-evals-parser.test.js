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
