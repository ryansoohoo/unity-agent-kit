import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { treesEqual } from './fstree.mjs';

if (process.argv.includes('--check')) {
  if (!treesEqual('skills', 'plugin/skills')) {
    console.error('plugin/skills is out of date with skills/ — run: npm run build:plugin');
    process.exit(1);
  }
  console.log('plugin/skills fresh');
} else {
  rmSync('plugin/skills', { recursive: true, force: true });
  mkdirSync('plugin/skills', { recursive: true });
  cpSync('skills', 'plugin/skills', { recursive: true });
  console.log('plugin/skills refreshed from skills/');
}
