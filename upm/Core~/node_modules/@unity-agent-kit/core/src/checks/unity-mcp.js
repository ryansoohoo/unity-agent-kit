import { register } from '../registry.js';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';

export const _deps = {
  which() {
    try { return execFileSync(process.platform === 'win32' ? 'where' : 'which', ['unity'], { encoding: 'utf8' }).split(/\r?\n/)[0] || null; }
    catch { return null; }
  },
  configure(cwd) {
    try { return { ok: true, out: execFileSync('unity', ['mcp', 'configure', 'claude-code'], { cwd, encoding: 'utf8' }) }; }
    catch (e) { return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }; }
  },
  home() { return homedir(); },
  whichClaude() {
    // stdio: stderr 'ignore' (not 'pipe') — on Windows a failing `where` call's
    // stderr can otherwise leak through nested execFileSync into the parent
    // kit.js process's own captured stderr, corrupting --json output. We never
    // read the error's .stderr below, so discarding it at the OS level is safe.
    try { return execFileSync(process.platform === 'win32' ? 'where' : 'which', ['claude'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/)[0] || null; }
    catch { return null; }
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
    // Newer vendor CLIs register USER-scope via the claude CLI (~/.claude.json).
    try {
      const u = JSON.parse(readFileSync(join(_deps.home(), '.claude.json'), 'utf8'));
      if (u?.mcpServers && Object.keys(u.mcpServers).some(k => /unity/i.test(k))) {
        return { status: 'pass', evidence: 'unity MCP registered user-scope (~/.claude.json)' };
      }
    } catch { /* absent or unreadable = not registered */ }
    if (!_deps.whichClaude()) {
      return { status: 'fail', evidence: 'Unity CLI installed but its MCP is unregistered — and `unity mcp configure` needs the `claude` CLI on PATH (missing here; desktop-app installs do not ship it). Install it (npm i -g @anthropic-ai/claude-code), then re-run --fix.' };
    }
    return { status: 'fail', evidence: 'Unity CLI installed but its MCP is not registered in this project' };
  },
  // Undo is BEST-EFFORT: `unity mcp configure` is a vendor command and may write
  // outside .mcp.json (global config, registries). We snapshot and restore only
  // .mcp.json — the one file we can prove it touches here.
  apply: async (ctx) => {
    const p = join(ctx.root, '.mcp.json');
    const prev = existsSync(p) ? readFileSync(p, 'utf8') : null;
    const r = _deps.configure(ctx.root);
    if (!r.ok) throw new Error(`unity mcp configure failed: ${r.out.slice(0, 300)}`);
    return { changed: [p], undo: [{ kind: 'restore-file', path: p, previous: prev }] };
  },
});
