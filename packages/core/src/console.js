import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

// The editor (upm/Editor/KitConsole.cs) appends one JSON object per console
// entry here. The CLI reads the FILE, no round trip — so the console is
// readable while the editor is mid-reload or stalled, exactly when it matters.
export const consolePath = (root) => join(root, 'Temp', 'unity-agent-kit', 'console.jsonl');

// The console entry types that count as errors — the `--errors` filter here and
// the CLI's "print the stack line too" decision read the same set.
export const ERROR_TYPES = new Set(['Error', 'Exception', 'Assert']);

export function readConsole(root, { errors = false, sinceEpoch = -1, last = 0 } = {}) {
  let text;
  try { text = readFileSync(consolePath(root), 'utf8'); } catch { return []; }
  // A BOM-writing appender would make the first line unparseable forever.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; } // torn tail: the writer is mid-append
    if (!e || typeof e !== 'object' || typeof e.type !== 'string') continue;
    if (errors && !ERROR_TYPES.has(e.type)) continue;
    if (sinceEpoch >= 0 && !(typeof e.epoch === 'number' && e.epoch >= sinceEpoch)) continue;
    out.push(e);
  }
  return last > 0 ? out.slice(-last) : out;
}

export function clearConsole(root) {
  mkdirSync(dirname(consolePath(root)), { recursive: true });
  writeFileSync(consolePath(root), '');
}
