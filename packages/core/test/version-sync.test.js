import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KIT_VERSION } from '../src/version.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('every manifest agrees with KIT_VERSION', () => {
  assert.equal(KIT_VERSION, '0.2.0');
  for (const p of ['packages/core/package.json', 'packages/cli/package.json', 'plugin/.claude-plugin/plugin.json', 'upm/package.json']) {
    assert.equal(JSON.parse(readFileSync(join(REPO, p), 'utf8')).version, KIT_VERSION, p);
  }
  assert.equal(JSON.parse(readFileSync(join(REPO, 'packages/cli/package.json'), 'utf8')).dependencies['@unity-agent-kit/core'], KIT_VERSION);
});
