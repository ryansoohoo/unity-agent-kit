import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('kanabo-proof --dry plans without touching Unity', () => {
  const proj = mkdtempSync(join(tmpdir(), 'uak-proof-'));
  const out = execFileSync(process.execPath,
    [join(REPO, 'scripts', 'kanabo-proof.mjs'), '--project', proj, '--unity', 'X:\\nope\\Unity.exe', '--iters', '3', '--dry'],
    { encoding: 'utf8' });
  const plan = JSON.parse(out);
  assert.equal(plan.dry, true);
  assert.equal(plan.iters, 3);
  assert.ok(plan.probeFile.endsWith(join('Assets', 'UAK', 'EpochProbe.cs')));
  assert.match(plan.manifestPatch['com.unity-agent-kit.doctor'], /^file:/);
});

test('kanabo-proof rejects missing args loudly', () => {
  try {
    execFileSync(process.execPath, [join(REPO, 'scripts', 'kanabo-proof.mjs'), '--dry'], { encoding: 'utf8' });
    assert.fail('should have exited nonzero');
  } catch (e) {
    assert.notEqual(e.status, 0);
    assert.match(`${e.stdout}${e.stderr}`, /--project/);
  }
});
