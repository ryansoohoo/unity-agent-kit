import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// The `npm test` entry point — run from the repo root. Node 20's test runner
// does not glob-expand its positional args (that landed in 21) and npm runs
// scripts through cmd.exe on Windows, so nothing in the chain expands them
// either: enumerate the files here and hand the runner an explicit list.
// Directory args are not an option — `node --test <dir>` is broken on Windows.
// --test-concurrency=1 is required: the tests drive real git merges and flake
// in parallel.
const ROOTS = ['packages/core/test', 'packages/cli/test'];

const files = [];
for (const root of ROOTS) {
  if (!existsSync(root)) {
    console.error(`run-tests: missing test root ${root} (cwd: ${process.cwd()}) — run from the repo root`);
    process.exit(1);
  }
  const found = readdirSync(root, { recursive: true })
    .filter(name => name.endsWith('.test.js'))
    .map(name => `${root}/${name.replace(/\\/g, '/')}`)
    .sort();
  if (found.length === 0) {
    console.error(`run-tests: no *.test.js files under ${root}`);
    process.exit(1);
  }
  files.push(...found);
}

console.log(`run-tests: ${files.length} test files`);
const res = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { stdio: 'inherit' });
process.exit(res.status ?? 1);
