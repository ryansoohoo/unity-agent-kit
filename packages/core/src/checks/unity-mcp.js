import { register } from '../registry.js';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export const _deps = {
  which() {
    try { return execFileSync(process.platform === 'win32' ? 'where' : 'which', ['unity'], { encoding: 'utf8' }).split(/\r?\n/)[0] || null; }
    catch { return null; }
  },
  configure(cwd) {
    try { return { ok: true, out: execFileSync('unity', ['mcp', 'configure', 'claude-code'], { cwd, encoding: 'utf8' }) }; }
    catch (e) { return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }; }
  },
};

register({
  id: 'unity-mcp', layer: 'integration', title: 'Unity\'s official MCP registered for Claude Code',
  explain: () =>
    'Unity\'s CLI bundles a free MCP server with no concurrency cap (Unity staff, announcement thread) and ' +
    'in-memory Roslyn eval with no domain reload. The kit wraps the vendor stack rather than competing with ' +
    'it: this check registers it with Claude Code via `unity mcp configure claude-code`.',
  detect: async (ctx) => {
    if (!_deps.which()) return { status: 'na', evidence: 'Unity CLI not on PATH — install from unity.com/cli to use the vendor MCP (optional)' };
    const p = join(ctx.root, '.mcp.json');
    if (existsSync(p)) {
      try {
        const j = JSON.parse(readFileSync(p, 'utf8'));
        if (j.mcpServers && Object.keys(j.mcpServers).some(k => /unity/i.test(k))) {
          return { status: 'pass', evidence: 'unity MCP present in .mcp.json' };
        }
      } catch { /* fall through to fail */ }
    }
    return { status: 'fail', evidence: 'Unity CLI installed but its MCP is not registered in this project' };
  },
  apply: async (ctx) => {
    const p = join(ctx.root, '.mcp.json');
    const prev = existsSync(p) ? readFileSync(p, 'utf8') : null;
    const r = _deps.configure(ctx.root);
    if (!r.ok) throw new Error(`unity mcp configure failed: ${r.out.slice(0, 300)}`);
    return { changed: [p], undo: [{ kind: 'restore-file', path: p, previous: prev }] };
  },
});
