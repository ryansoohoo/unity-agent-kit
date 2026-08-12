import { cpSync, rmSync, mkdirSync } from 'node:fs';
rmSync('plugin/skills', { recursive: true, force: true });
mkdirSync('plugin/skills', { recursive: true });
cpSync('skills', 'plugin/skills', { recursive: true });
console.log('plugin/skills refreshed from skills/');
