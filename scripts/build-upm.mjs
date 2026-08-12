import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { treesEqual } from './fstree.mjs';

// upm/Core~ bundles the WHOLE engine inside the package (folders ending in ~
// are invisible to Unity's asset importer but ship with the package, local or
// git URL). packages/core lands under Core~/node_modules/@unity-agent-kit/core
// so kit.js's bare import specifiers resolve with zero source rewriting —
// one code path, no second copy of any logic.
const PAIRS = [
  ['packages/core', 'upm/Core~/node_modules/@unity-agent-kit/core'],
  ['packages/cli', 'upm/Core~/cli'],
];
const EXCLUDE = /[\\/]test$|[\\/]test[\\/]/;
const filter = (src) => !EXCLUDE.test(src);

if (process.argv.includes('--check')) {
  for (const [src, dest] of PAIRS) {
    if (!treesEqual(src, dest, filter)) {
      console.error(`upm bundle out of date: ${dest} != ${src} — run: npm run build:upm`);
      process.exit(1);
    }
  }
  console.log('upm/Core~ fresh');
} else {
  rmSync('upm/Core~', { recursive: true, force: true });
  for (const [src, dest] of PAIRS) {
    mkdirSync(dest, { recursive: true });
    cpSync(src, dest, { recursive: true, filter });
  }
  console.log('upm/Core~ refreshed from packages/');
}
