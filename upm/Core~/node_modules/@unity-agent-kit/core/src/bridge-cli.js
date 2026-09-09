import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { writeRequest, awaitResult, readOperation, listOperations, cancelQueued, readJson } from './actions.js';
import { leaseStatus, acquireLease, renewLease, releaseLease, cancelTicket } from './leases.js';
import { readEpoch, isFresh } from './kanabo.js';
import { createContext } from './context.js';
import { normalizeOperation, normalizeWait, normalizeCancellation } from './responses.js';

const COMMANDS = new Set(['status', 'capabilities', 'methods', 'refresh', 'op', 'lease', 'session', 'check', 'invoke']);
const BOOLS = new Set(['json', 'wait', 'async', 'details']);
const VALUES = new Set(['timeout-ms', 'poll-ms', 'lease', 'owner', 'ttl-ms', 'ticket', 'id', 'file', 'files', 'probe', 'method', 'menu', 'arg', 'after', 'expected-epoch', 'filter', 'offset', 'limit', 'config', 'scene', 'seconds', 'warmup', 'setup', 'step', 'check', 'teardown', 'screenshot']);
const pause = ms => new Promise(r => setTimeout(r, ms));
function parse(argv) {
  const command = argv[0]; let action;
  const tokens = argv.slice(1);
  if (['op', 'lease', 'session'].includes(command)) action = tokens.shift();
  const values = {}, positional = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t.startsWith('--')) { positional.push(t); continue; }
    const k = t.slice(2);
    if (BOOLS.has(k)) { values[k] = true; continue; }
    if (!VALUES.has(k)) throw new Error(`Unknown ${command} option: ${t}`);
    const v = tokens[++i]; if (v === undefined || v.startsWith('--')) throw new Error(`${t} needs a value`);
    if (['file', 'arg'].includes(k)) (values[k] ??= []).push(v);
    else { if (values[k] !== undefined) throw new Error(`Duplicate option ${t}`); values[k] = v; }
  }
  if (positional.length > 1) throw new Error('Supply at most one project path; use --id for an operation/session');
  const root = resolve(positional[0] ?? process.cwd());
  const number = (key, fallback, max = 3600000) => {
    const n = values[key] === undefined ? fallback : Number(values[key]);
    if ((values[key] !== undefined && !values[key].trim()) || !Number.isFinite(n) || n < 0 || n > max)
      throw new Error(`Invalid --${key}`);
    return n;
  };
  return { command, action, values, root, number };
}
function localInfo(root, details = false) {
  const src = dirname(fileURLToPath(import.meta.url)), snap = readEpoch(root);
  const origins = skillOrigins(root);
  return { projectPath: root, signalPresent: !!snap, responsive: isFresh(snap), snapshot: snap,
    cli: { packagePath: resolve(src, '..'), version: readJson(resolve(src, '../package.json'))?.version,
      protocol: 2, ...(details ? { sourceHash: createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
        sourceHashPath: fileURLToPath(import.meta.url), sourceHashScope: 'This bridge-cli.js file only; excludes other CLI files and dependencies.' } : {}) },
    ownership: leaseStatus(root), source: sourceIdentity(root), skills: details ? origins : {
      injectionKnown: false, candidateCount: origins.candidates.length, truncated: origins.truncated,
      versions: [...new Set(origins.candidates.map(candidate => candidate.version).filter(Boolean))], detailsAvailable: true } };
}

// These are file identities at known locations, not evidence of which skill text
// an agent received. Limit discovery to three bridge skills and four cache versions.
export function skillOrigins(root, {
  kitRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'),
  codexHome = process.env.CODEX_HOME || join(homedir(), '.codex'),
  claudeHome = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'),
} = {}) {
  const names = ['unity-verify', 'unity-recipes', 'unity-topology'];
  const sourceVersion = readJson(join(kitRoot, 'plugin/.claude-plugin/plugin.json'))?.version ?? null;
  const roots = [
    { path: join(kitRoot, 'skills'), origin: 'kit-source', version: sourceVersion },
    { path: join(kitRoot, 'plugin/skills'), origin: 'kit-plugin-copy', version: sourceVersion },
    { path: join(root, '.claude/skills'), origin: 'project-claude-skills', version: null },
    { path: join(root, '.agents/skills'), origin: 'project-agent-skills', version: null },
    { path: join(codexHome, 'skills'), origin: 'user-codex-skills', version: null },
    { path: join(claudeHome, 'skills'), origin: 'user-claude-skills', version: null },
  ];
  let truncated = false;
  for (const [home, provider] of [[codexHome, 'codex'], [claudeHome, 'claude']]) {
    const cache = join(home, 'plugins/cache/unity-agent-kit/unity-agent-kit');
    let versions = [];
    try { versions = readdirSync(cache, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true })); } catch { /* no known cache */ }
    truncated ||= versions.length > 4;
    for (const version of versions.slice(0, 4)) roots.push({ path: join(cache, version, 'skills'), origin: `${provider}-plugin-cache`, version });
  }
  const candidates = [], seen = new Set();
  for (const candidate of roots) for (const name of names) {
    const path = resolve(candidate.path, name, 'SKILL.md');
    if (seen.has(path)) continue;
    seen.add(path);
    try {
      if (statSync(path).size > 262144) { truncated = true; continue; }
      const bytes = readFileSync(path);
      candidates.push({ name, path, origin: candidate.origin, version: candidate.version,
        versionSource: candidate.origin.endsWith('-cache') ? 'cache directory' : candidate.version ? 'plugin manifest' : null,
        sha256: createHash('sha256').update(bytes).digest('hex') });
    } catch { /* absent or unreadable candidate */ }
  }
  return { injectionKnown: false, scope: 'Known project, user, kit and plugin-cache locations; candidate presence does not prove agent injection.', truncated, candidates };
}
export function sourceIdentity(root) {
  const ctx = createContext(root), revision = ctx.git('rev-parse', 'HEAD'), branch = ctx.git('branch', '--show-current');
  return { worktree: resolve(root), revision: revision.ok ? revision.out : null, branch: branch.ok ? branch.out : null };
}
export function sourceFiles(root, paths) {
  return paths.map(path => { const absolute = resolve(root, path); return { path: absolute,
    sha256: createHash('sha256').update(readFileSync(absolute)).digest('hex') }; });
}
async function request(root, verb, payload, values, timeoutMs) {
  const id = writeRequest(root, verb, { ...payload, leaseToken: values.lease ?? '', requiredReceipt: values.after ?? '',
    expectedEpoch: values['expected-epoch'] ? Number(values['expected-epoch']) : 0, deadlineMs: Date.now() + timeoutMs });
  const options = { details: !!values.details, kind: verb };
  if (values.async) return { ...normalizeOperation(root, readOperation(root, id), options), accepted: true };
  const waited = await awaitResult(root, id, { timeoutMs, pollMs: Math.min(Number(values['poll-ms'] ?? 100), timeoutMs), cancelOnTimeout: true });
  return normalizeWait(root, waited, readOperation(root, id), { ...options, receiptKey: waited.result ? 'result' : 'operation' });
}
export const bridgeHelp = `Unity agent kit
  kit status|capabilities [project] [--filter TypeName] [--details]
  kit methods [project] --filter Namespace.Type [--offset N] [--limit 1..200]
  kit refresh [project] --file Assets/Foo.cs [--file ...] --lease token [--probe proof.json]
  kit invoke|check [project] --method Namespace.Type.Method [--arg value] [--after receipt] [--lease token]
  kit op list|status|wait|cancel [project] [--id operation] [--timeout-ms N]
  kit lease acquire [project] --owner task-id [--wait] [--ttl-ms N] [--ticket queued-id]
  kit lease status|renew|release|cancel [project] [--lease token] [--ticket queued-id]
  kit session start [project] --lease token --config scenario.json [--wait]
  kit session status|stop|cancel [project] --lease token [--id session]
  kit profiler status|start|stop|cancel|mark|sessions|frames|threads|frame|sample|analyze|compare ...
  kit console [project] --errors --last N --json
  kit doctor [project] [--only check] [--json]
Operation waits are bounded. --async returns an ID, not a completed result.
Read id/data/returnValue at the top level. Raw receipts remain at rawReceiptPath; --details includes raw JSON fields and full discovery inventories.
Take the ownership token from lease.token and pass it as --lease.
A lease covers the full refresh/play/check/restore sequence, not individual calls.
Branch files must already be integrated into the Editor's checkout; a lease does not copy or merge them.`;

// Called before the legacy doctor parser so a verb cannot become a directory.
export async function runBridgeCli(argv) {
  if (argv.includes('--help') || argv[0] === 'help') { console.log(bridgeHelp); return 0; }
  if (!COMMANDS.has(argv[0])) return null;
  let p;
  try {
    p = parse(argv); const { command, action, values: v, root, number } = p;
    const timeoutMs = number('timeout-ms', ['status', 'capabilities', 'methods'].includes(command) ? 5000 : 120000);
    if (timeoutMs < 1 || number('poll-ms', 100) < 1) throw new Error('Wait bounds must be positive');
    if (!Number.isInteger(number('expected-epoch', 0, 2147483647))) throw new Error('--expected-epoch must be an integer');
    if (v.async && v.wait) throw new Error('--async and --wait cannot be combined; use the returned operation ID to wait later');
    let result;
    if (command === 'op') {
      const options = { details: !!v.details };
      if (action === 'list') result = { ok: true, operations: listOperations(root, number('limit', 20, 1000)).map(operation => normalizeOperation(root, operation, options)) };
      else if (action === 'status') result = normalizeOperation(root, readOperation(root, v.id), options);
      else if (action === 'cancel') {
        const cancellation = cancelQueued(root, v.id);
        result = normalizeCancellation(root, cancellation, options);
      } else if (action === 'wait') {
        const waited = await awaitResult(root, v.id, { timeoutMs, pollMs: Math.min(number('poll-ms', 100), timeoutMs) });
        result = normalizeWait(root, waited, readOperation(root, v.id), { ...options, receiptKey: waited.result ? 'result' : 'operation' });
      }
      else throw new Error('op action must be list, status, wait, or cancel');
    } else if (command === 'lease') {
      if (action === 'status') result = { ok: true, ...leaseStatus(root) };
      else if (action === 'acquire') result = await acquireLease(root, { owner: v.owner, ttlMs: number('ttl-ms', 300000), timeoutMs, wait: !!v.wait, ticket: v.ticket });
      else if (action === 'renew') result = await renewLease(root, v.lease, number('ttl-ms', 300000));
      else if (action === 'release') result = await releaseLease(root, v.lease);
      else if (action === 'cancel') result = await cancelTicket(root, v.ticket);
      else throw new Error('lease action must be acquire, status, renew, release, or cancel');
    } else if (['status', 'capabilities', 'methods'].includes(command)) {
      const filter = (v.filter ?? '').trim(), offset = number('offset', 0, 2147483647), limit = number('limit', 100, 200);
      if (filter && filter.length < 3 || command === 'methods' && !filter) throw new Error('Method discovery needs a filter of at least three characters');
      if (!Number.isInteger(offset) || !Number.isInteger(limit) || limit < 1) throw new Error('Discovery offset must be a nonnegative integer and limit must be 1..200');
      result = await request(root, command === 'methods' ? 'capabilities' : command, { payloadJson: JSON.stringify({ filter, offset, limit, details: !!v.details }) }, v, timeoutMs);
      result.local = localInfo(root, !!v.details);
    } else if (command === 'refresh') {
      const files = v.files ? JSON.parse(readFileSync(v.files, 'utf8')) : sourceFiles(root, v.file ?? []);
      const payload = { files };
      if (v.probe) {
        const probe = JSON.parse(readFileSync(v.probe, 'utf8'));
        if (!probe || Array.isArray(probe) || typeof probe !== 'object'
            || typeof probe.type !== 'string' || !probe.type.trim()
            || typeof probe.field !== 'string' || !probe.field.trim() || typeof probe.expected !== 'string')
          throw new Error('--probe needs a JSON object with nonempty type and field, and a string expected value');
        payload.probe = probe;
      }
      result = await request(root, 'refresh', { payloadJson: JSON.stringify(payload) }, v, timeoutMs);
    } else if (command === 'session') {
      if (!['start', 'status', 'stop', 'cancel'].includes(action)) throw new Error('session action must be start, status, stop, or cancel');
      if (v.wait && action !== 'start') throw new Error('session --wait is supported only with start');
      const config = v.config ? JSON.parse(readFileSync(v.config, 'utf8')) : {};
      if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Session config must be a JSON object');
      const payload = { ...config, action, id: v.id ?? config.id, owner: v.owner ?? config.owner, leaseToken: v.lease ?? '' };
      for (const [flag, field] of Object.entries({ scene: 'scene', setup: 'setupMethod', step: 'stepMethod', check: 'checkMethod', teardown: 'teardownMethod', screenshot: 'screenshotPath' })) if (v[flag] !== undefined) payload[field] = v[flag];
      if (v.seconds !== undefined) {
        payload.durationSeconds = number('seconds', 10, 600);
        if (payload.durationSeconds <= 0) throw new Error('--seconds must be greater than zero');
      }
      if (v.warmup !== undefined) payload.warmupSeconds = number('warmup', 0, 60);
      const deadline = Date.now() + timeoutMs;
      result = await request(root, 'session', { payloadJson: JSON.stringify(payload) }, v, Math.min(timeoutMs, 10000));
      if (result.ok && action === 'start' && v.wait) {
        const id = result.data?.id ?? result.data?.session?.id;
        if (!id) throw new Error('Session start did not return an ID');
        let lastSession = result.data;
        const timedOut = () => ({ ok: false, reason: 'wait-timeout', sessionId: id, session: lastSession,
          error: 'Session may still be active; inspect or cancel it before releasing the lease.' });
        for (;;) {
          let remaining = deadline - Date.now();
          if (remaining <= 0) { result = timedOut(); break; }
          await pause(Math.min(250, remaining));
          remaining = deadline - Date.now();
          if (remaining <= 0) { result = timedOut(); break; }
          result = await request(root, 'session', { payloadJson: JSON.stringify({ action: 'status', id, leaseToken: v.lease ?? '' }) }, v, Math.min(5000, remaining));
          result.sessionId = id;
          if (!result.ok) {
            result.session = lastSession;
            result.error ??= 'Session status could not be confirmed; inspect or cancel it before releasing the lease.';
            break;
          }
          lastSession = result.data;
          const state = result.data?.state ?? result.data?.session?.state;
          if (['completed', 'failed', 'cancelled'].includes(state)) break;
        }
      }
      if (result.data?.ok === false || v.wait && ['failed', 'cancelled'].includes(result.data?.state)) result.ok = false;
    } else {
      if ((!!v.menu === !!v.method) || command === 'check' && v.menu) throw new Error(`${command} needs --menu "<path>" or --method Namespace.Type.Method`);
      result = await request(root, command, v.menu ? { menu: v.menu } : { method: v.method, args: v.arg ?? [] }, v, timeoutMs);
      if (command === 'invoke' && !v.json && !v.async) {
        if (result.reason === 'done') {
          console.log(result.ok ? `invoke ok (epoch ${result.result.startedEpoch}→${result.result.finishedEpoch})` : `invoke FAILED: ${result.result.error ?? 'no error reported'}`);
          for (const log of result.result.log ?? []) console.log(`  [${log.type}] ${log.message}${log.stack ? `\n      ${log.stack}` : ''}`);
        } else console.log(JSON.stringify(result));
        return result.ok ? 0 : result.reason === 'no-editor' ? 3 : 1;
      }
    }
    console.log(JSON.stringify(result, null, 2));
    return result.reason === 'no-editor' ? 3 : result.ok === false || result.cancelled === false ? 1 : 0;
  } catch (e) { console.error(JSON.stringify({ ok: false, error: e.message })); return 2; }
}
