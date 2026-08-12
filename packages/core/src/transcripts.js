import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Claude Code stores transcripts at ~/.claude/projects/<sanitized>/<session>.jsonl
// where <sanitized> is the absolute project path with every [^A-Za-z0-9] → '-'
// (verified on this machine: C:\Users\Ryan\Kintarō → C--Users-Ryan-Kintar-).
// The format is UNDOCUMENTED and may change at any time — every reader below is
// defensive: bad lines are skipped, bad files are skipped, and callers get []
// rather than an exception. LOCAL-ONLY: this module reads disk and uploads nothing.
export function transcriptDirFor(projectRoot, home = homedir()) {
  const sanitized = projectRoot.replace(/[^A-Za-z0-9]/g, '-');
  return join(home, '.claude', 'projects', sanitized);
}

export function readSessions(dir) {
  if (!dir || !existsSync(dir)) return [];
  let files;
  try { files = readdirSync(dir).filter(f => f.endsWith('.jsonl')); }
  catch { return []; }
  const sessions = [];
  for (const f of files) {
    let text;
    try { text = readFileSync(join(dir, f), 'utf8'); }
    catch { continue; }
    const entries = [];
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      if (!l) continue;
      try {
        const e = JSON.parse(l);
        if (e && typeof e === 'object' && !Array.isArray(e)) entries.push({ line: i + 1, e });
      } catch { /* undocumented format: skip unparseable lines, never crash */ }
    }
    if (entries.length) sessions.push({ file: join(dir, f), entries });
  }
  return sessions;
}

export function toolUses(session) {
  const out = [];
  for (const { line, e } of session.entries) {
    if (e.type !== 'assistant') continue;
    const content = e.message?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (c?.type === 'tool_use' && typeof c.name === 'string') out.push({ line, name: c.name, input: c.input ?? {} });
    }
  }
  return out;
}

export function toolResults(session) {
  const out = [];
  for (const { line, e } of session.entries) {
    if (e.type !== 'user') continue;
    const content = e.message?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (c?.type !== 'tool_result') continue;
      let text = '';
      if (typeof c.content === 'string') text = c.content;
      else if (Array.isArray(c.content)) text = c.content.map(p => (p?.type === 'text' ? p.text ?? '' : '')).join('');
      out.push({ line, text });
    }
  }
  return out;
}

export function usageTotals(session) {
  let input = 0, output = 0;
  for (const { e } of session.entries) {
    const u = e?.message?.usage;
    if (e.type === 'assistant' && u) {
      input += Number(u.input_tokens) || 0;
      output += Number(u.output_tokens) || 0;
    }
  }
  return { input, output };
}
