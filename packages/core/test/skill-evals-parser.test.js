import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSkillInvocations, scoreRuns } from '../../../scripts/skill-evals.mjs';

const LINE = (name) => JSON.stringify({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: name } }] },
});

test('parser: extracts Skill invocations from stream-json lines, ignores noise', () => {
  const out = ['{"type":"system","subtype":"init"}', LINE('unity-verify'), 'not json at all', '{"type":"result","result":"done"}'].join('\n');
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
