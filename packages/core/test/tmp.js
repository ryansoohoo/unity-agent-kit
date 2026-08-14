import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Shared fixture: mkdtempSync with cleanup. Every dir made here is removed
// when the test process exits (node --test runs each test file in its own
// process, so the hook fires per file). Best-effort: a dir the OS still
// holds open is left behind rather than failing the run.
const made = [];
process.on('exit', () => {
  for (const dir of made) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

export function tmp(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}
