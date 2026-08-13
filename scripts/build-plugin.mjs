import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { treesEqual } from './fstree.mjs';

// evals.json / evals-variants.json are harness inputs, not agent-facing
// content — the shipped plugin stays lean without them.
const filter = (src) => !/evals(-variants)?\.json$/.test(src);

if (process.argv.includes('--check')) {
  if (!treesEqual('skills', 'plugin/skills', filter)) {
    console.error('plugin/skills is out of date with skills/ — run: npm run build:plugin');
    process.exit(1);
  }
  console.log('plugin/skills fresh');
} else {
  rmSync('plugin/skills', { recursive: true, force: true });
  mkdirSync('plugin/skills', { recursive: true });
  cpSync('skills', 'plugin/skills', { recursive: true, filter });
  console.log('plugin/skills refreshed from skills/');
}
