import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KIT_VERSION } from '../src/version.js';

test('exports a semver version', () => {
  assert.match(KIT_VERSION, /^\d+\.\d+\.\d+$/);
});
