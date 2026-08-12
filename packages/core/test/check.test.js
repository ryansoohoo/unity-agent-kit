import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCheck, STATUSES } from '../src/check.js';

const good = { id: 'x', layer: 'hygiene', title: 'X', detect: async () => ({ status: 'pass', evidence: '' }), explain: () => 'why' };

test('accepts a minimal valid check', () => { validateCheck(good); });
test('rejects missing detect', () => {
  assert.throws(() => validateCheck({ ...good, detect: undefined }), /detect/);
});
test('rejects bad layer', () => {
  assert.throws(() => validateCheck({ ...good, layer: 'nope' }), /layer/);
});
test('statuses are fixed', () => { assert.deepEqual(STATUSES, ['pass', 'warn', 'fail', 'na']); });
test('validateCheck accepts the audit layer', () => {
  validateCheck({ id: 'x', layer: 'audit', title: 't', detect: () => {}, explain: () => '' });
});
