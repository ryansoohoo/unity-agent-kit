import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import '../src/checks/index.js';
import { getCheck } from '../src/registry.js';
import { _deps } from '../src/checks/pipeline.js';
import { tmp } from './tmp.js';

function proj(deps) {
  const root = tmp('uak-pipe-');
  mkdirSync(join(root, 'Packages'), { recursive: true });
  writeFileSync(join(root, 'Packages', 'manifest.json'), JSON.stringify({ dependencies: deps }));
  return { root };
}
const check = () => getCheck('pipeline');

test('pipeline: na when com.unity.pipeline is absent', async () => {
  const r = await check().detect(proj({ 'com.unity.inputsystem': '1.19.0' }));
  assert.equal(r.status, 'na'); assert.match(r.evidence, /not installed/);
});

test('pipeline: warn when installed but unity CLI missing or no reachable editor; pass when reachable', async () => {
  const orig = _deps.unityStatus;
  try {
    _deps.unityStatus = () => null;
    let r = await check().detect(proj({ 'com.unity.pipeline': '0.5.0' }));
    assert.equal(r.status, 'warn'); assert.match(r.evidence, /unity CLI/);
    _deps.unityStatus = () => '';
    r = await check().detect(proj({ 'com.unity.pipeline': '0.5.0' }));
    assert.equal(r.status, 'warn'); assert.match(r.evidence, /no reachable/);
    _deps.unityStatus = () => 'port 55123  project C:/x  version 6000.5.5f1  pid 39848';
    r = await check().detect(proj({ 'com.unity.pipeline': '0.5.0' }));
    assert.equal(r.status, 'pass');
  } finally { _deps.unityStatus = orig; }
});
