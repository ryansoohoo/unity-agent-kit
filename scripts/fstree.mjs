import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export function listFiles(root, filter = () => true, base = root) {
  if (!existsSync(root)) return [];
  const out = [];
  for (const name of readdirSync(root)) {
    const p = join(root, name);
    if (!filter(p)) continue;
    if (statSync(p).isDirectory()) out.push(...listFiles(p, filter, base));
    else out.push(p.slice(base.length + 1).replace(/\\/g, '/'));
  }
  return out.sort();
}

export function treesEqual(a, b, filter = () => true) {
  if (!existsSync(a) || !existsSync(b)) return false;
  const fa = listFiles(a, filter);
  const fb = listFiles(b, filter);
  if (fa.length !== fb.length || fa.some((f, i) => f !== fb[i])) return false;
  return fa.every(f => readFileSync(join(a, f), 'utf8') === readFileSync(join(b, f), 'utf8'));
}
