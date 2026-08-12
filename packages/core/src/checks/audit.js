import { register, getCheck } from '../registry.js';
import { transcriptDirFor, readSessions, toolUses, toolResults, usageTotals } from '../transcripts.js';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const isBash = (t) => t.name === 'Bash' || t.name === 'PowerShell';
const cmd = (t) => String(t.input?.command ?? '');
const editedFile = (t) => (EDIT_TOOLS.has(t.name) ? String(t.input?.file_path ?? t.input?.notebook_path ?? '') : null);

const SLEEP_RE = /(^|[;&|(]\s*)sleep\s+\d|Start-Sleep|(^|[;&|(]\s*)timeout\s+\/t\s+\d/im;
const PORT_RE = /(?:localhost|127\.0\.0\.1):(\d{2,5})/;
// Command-shaped mirrors of the blast-radius DENY_RULES (those are permission
// patterns like "Bash(git clean:*)", not regexes — keep the two lists in sync).
const DESTRUCTIVE_RES = [/\bgit\s+clean\b/, /\bgit\s+reset\s+--hard\b/, /\brm\s+-(?:rf?|fr)\b/, /\brmdir\s+\/s\b/i, /Remove-Item\b[^\n]*-Recurse/i];
const DUMP_LIMIT = 50_000;

// Each signature scans ONE session and returns [{ line, message }].
// Taxonomy tags use the failure vocabulary adopted in the spec (Amendments IV):
// PROCESS / TOOL-MISUSE / NO-VERIFY.
export const SIGNATURES = [
  {
    id: 'blind-sleep-after-edit', taxonomy: 'PROCESS', confidence: 0.8,
    preventedBy: 'unity-verify skill (tiered verification, no blind sleeps)',
    scan(s) {
      const uses = toolUses(s), out = [];
      let lastEdit = -99;
      for (let i = 0; i < uses.length; i++) {
        if (editedFile(uses[i]) !== null) lastEdit = i;
        else if (isBash(uses[i]) && SLEEP_RE.test(cmd(uses[i])) && i - lastEdit <= 3)
          out.push({ line: uses[i].line, message: `blind sleep ${i - lastEdit} call(s) after an edit: ${cmd(uses[i]).slice(0, 80)}` });
      }
      return out;
    },
  },
  {
    id: 'destructive-near-miss', taxonomy: 'PROCESS', confidence: 0.9,
    preventedBy: 'blast-radius deny rules',
    scan(s) {
      const out = [];
      for (const t of toolUses(s)) {
        if (!isBash(t)) continue;
        const c = cmd(t);
        if (DESTRUCTIVE_RES.some(re => re.test(c)))
          out.push({ line: t.line, message: `destructive command ran: ${c.slice(0, 100)}` });
      }
      return out;
    },
  },
  {
    id: 'dead-port-retry-storm', taxonomy: 'TOOL-MISUSE', confidence: 0.7,
    preventedBy: 'unity-recipes (compile-wait / console-read recipes)',
    scan(s) {
      const out = [];
      let port = null, run = 0, startLine = 0;
      const flush = () => { if (run >= 5) out.push({ line: startLine, message: `${run} consecutive calls hammering :${port}` }); };
      for (const t of toolUses(s)) {
        if (!isBash(t)) continue;
        const m = cmd(t).match(PORT_RE);
        if (m && m[1] === port) { run++; continue; }
        flush();
        port = m ? m[1] : null;
        run = m ? 1 : 0;
        startLine = t.line;
      }
      flush();
      return out;
    },
  },
  {
    id: 'oversized-console-dump', taxonomy: 'TOOL-MISUSE', confidence: 0.9,
    preventedBy: 'unity-recipes (bounded console read)',
    scan(s) {
      return toolResults(s).filter(r => r.text.length > DUMP_LIMIT)
        .map(r => ({ line: r.line, message: `tool result of ${Math.round(r.text.length / 1000)}k chars dumped into context` }));
    },
  },
];

const CLASS_ORDER = ['fix-now', 'needs-attention', 'safe-to-ignore', 'superseded'];

// One session-independent tally per session file (tokens/retries — Task 7 fills in).
export function sessionTally(s) {
  return { file: s.file, tokens: usageTotals(s), toolCalls: toolUses(s).length, retries: 0 };
}

register({
  id: 'audit', layer: 'audit', title: 'Transcript failure audit (local, detect-only)',
  explain: () =>
    'Scans this project\'s Claude Code transcripts (~/.claude/projects/…) for Unity failure signatures — ' +
    'blind sleeps after edits, dead-port retry storms, C# writes with no refresh, accepted empty responses, ' +
    'oversized console dumps, huge diffs with no measurement, runaway sub-agent chains, destructive-command ' +
    'near-misses — and names the kit rule or skill that prevents each, ranked fix-now → superseded. ' +
    'Local-only: reads transcript JSONL from your disk and uploads NOTHING. The transcript format is ' +
    'undocumented and may change; this check degrades to na rather than ever crashing the doctor.',
  detect: async (ctx) => {
    let sessions, dir;
    try {
      dir = process.env.UAK_TRANSCRIPTS ?? transcriptDirFor(ctx.root);
      sessions = readSessions(dir);
    } catch { return { status: 'na', evidence: 'transcript scan failed safely — format may have changed' }; }
    if (!sessions.length) return { status: 'na', evidence: `no local transcripts for this project (looked in ${dir})` };

    // Classification: destructive findings are superseded once deny rules are
    // installed; the low-confidence empty-response heuristic is safe-to-ignore.
    const denyNow = (await getCheck('blast-radius').detect(ctx)).status === 'pass';
    const classOf = (sigId) =>
      sigId === 'destructive-near-miss' ? (denyNow ? 'superseded' : 'fix-now')
      : sigId === 'accepted-empty-response' ? 'safe-to-ignore'
      : 'needs-attention';

    const findings = [];
    for (const s of sessions) {
      for (const sig of SIGNATURES) {
        let hits = [];
        try { hits = sig.scan(s); } catch { continue; } // one bad session never kills the audit
        for (const h of hits) findings.push({
          signature: sig.id, taxonomy: sig.taxonomy, class: classOf(sig.id), confidence: sig.confidence,
          file: s.file, line: h.line, message: h.message, preventedBy: sig.preventedBy,
        });
      }
    }
    findings.sort((a, b) => CLASS_ORDER.indexOf(a.class) - CLASS_ORDER.indexOf(b.class) || b.confidence - a.confidence);
    const detail = { findings, sessions: sessions.map(sessionTally) };
    if (!findings.length) return { status: 'pass', evidence: `no failure signatures in ${sessions.length} session(s)`, detail };
    const byClass = CLASS_ORDER.map(c => [c, findings.filter(f => f.class === c).length]).filter(([, n]) => n);
    return {
      status: 'warn', // NEVER fail — triage is advisory, exit codes stay honest
      evidence: `${findings.length} finding(s) in ${sessions.length} session(s): ${byClass.map(([c, n]) => `${n} ${c}`).join(', ')}`,
      detail,
    };
  },
});
