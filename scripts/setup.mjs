#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = 'unity-agent-kit';
const PACKAGE = 'com.unity-agent-kit.doctor';
const STATE = '.unity-agent-kit/setup-state.json';
const SKILLS = ['unity-verify', 'unity-recipes', 'unity-topology', 'unity-merge', 'unity-claude-md'];
const BEGIN = '# BEGIN unity-agent-kit setup';
const END = '# END unity-agent-kit setup';
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const read = path => existsSync(path) ? readFileSync(path, 'utf8') : null;

function parseJson(text, path) {
  const value = JSON.parse((text ?? '{}').replace(/^\uFEFF/, ''));
  if (!object(value)) throw new Error(`${path} must contain a JSON object.`);
  return value;
}

// Config entries are merged individually. Undo never replaces an edited whole config.
function jsonEntry(text, target) {
  const data = parseJson(text, target.path);
  const parent = data[target.parent];
  if (parent !== undefined && !object(parent)) throw new Error(`${target.path}: ${target.parent} must be an object.`);
  return parent && own(parent, target.key) ? { present: true, value: parent[target.key] } : { present: false };
}

function jsonText(text, target, entry, originalText) {
  const data = parseJson(text, target.path);
  if (entry.present) (data[target.parent] ??= {})[target.key] = entry.value;
  else if (data[target.parent]) {
    delete data[target.parent][target.key];
    const original = parseJson(originalText, target.path);
    if (!own(original, target.parent) && Object.keys(data[target.parent]).length === 0) delete data[target.parent];
  }
  if (originalText === null && Object.keys(data).length === 0) return null;
  return JSON.stringify(data, null, 2) + '\n';
}

function tomlHeaders(text) {
  const headers = [];
  let depth = 0;
  for (const line of text.matchAll(/[^\n]*(?:\n|$)/g)) {
    const value = line[0].replace(/\r?\n$/, '');
    const header = depth === 0 && value.match(/^[ \t]*\[\[?([^\]\r\n]+)\]\]?[ \t]*(?:#[^\r\n]*)?$/);
    if (header) { header.index = line.index; headers.push(header); continue; }
    for (let i = 0; i < value.length; i++) {
      const char = value[i];
      if (char === '#') break;
      if (char === '"' || char === "'") {
        const quote = char;
        for (i++; i < value.length; i++) {
          if (value[i] === quote) break;
          if (quote === '"' && value[i] === '\\') i++;
        }
        if (i >= value.length) throw new Error('Codex config has an unterminated TOML string; no files changed.');
      } else if (char === '[' || char === '{') depth++;
      else if (char === ']' || char === '}') depth--;
      if (depth < 0) throw new Error('Codex config has an unmatched TOML bracket; no files changed.');
    }
  }
  if (depth !== 0) throw new Error('Codex config has an unterminated TOML array or inline table; no files changed.');
  return headers;
}

// Only the named MCP table is read; unrelated TOML stays byte-for-byte intact.
// Inline MCP maps are refused rather than attempting to rewrite arbitrary TOML.
function tomlEntry(text = '') {
  text ??= '';
  if (text.includes("'''") || text.includes('"""'))
    throw new Error('Codex config contains multiline TOML strings, which this installer does not rewrite. Add the MCP table manually or move the multiline value before running setup; no files changed.');
  const starts = [...text.matchAll(/^# BEGIN unity-agent-kit setup\r?$/gm)];
  const ends = [...text.matchAll(/^# END unity-agent-kit setup\r?$/gm)];
  let managed;
  if (starts.length || ends.length) {
    if (starts.length !== 1 || ends.length !== 1 || starts[0].index >= ends[0].index)
      throw new Error('Codex setup markers were edited; restore them before running setup.');
    let end = ends[0].index + ends[0][0].length;
    if (text[end] === '\n') end++;
    managed = { start: starts[0].index, end };
  }
  const headers = tomlHeaders(text);
  if (managed) {
    const scopeEnd = headers.find(header => header.index >= managed.end)?.index ?? text.length;
    const trailing = text.slice(managed.end, scopeEnd);
    // A comment marker does not close a TOML table. Trailing keys are owned edits.
    if (trailing.split(/\r?\n/).some(line => line.trim() && !line.trimStart().startsWith('#')))
      managed.end = scopeEnd;
  }
  const ranges = [];
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i];
    if (header[1].includes('mcp_servers') && header[1].includes('\\'))
      throw new Error('Codex escaped MCP table names are not supported by setup; use plain table names.');
    const names = header[1].split('.').map(part => part.trim().replace(/^(?:"([^"]*)"|'([^']*)')$/, '$1$2'));
    const end = headers[i + 1]?.index ?? text.length;
    if (names[0] === 'mcp_servers' && names[1] === SERVER) {
      if (!managed || header.index < managed.start || header.index >= managed.end)
        ranges.push({ start: header.index, end });
    }
    if (names.length === 1 && names[0] === 'mcp_servers'
      && /^[ \t]*(?:unity-agent-kit|"unity-agent-kit"|'unity-agent-kit')[ \t]*=/m.test(text.slice(header.index + header[0].length, end)))
      throw new Error('Codex inline unity-agent-kit config must be moved to [mcp_servers.unity-agent-kit] before setup.');
  }
  if (/^[ \t]*(?:mcp_servers|"mcp_servers"|'mcp_servers')[ \t]*(?:=|\.[ \t]*(?:unity-agent-kit|"unity-agent-kit"|'unity-agent-kit')[ \t]*[.=])/m.test(text))
    throw new Error('Codex inline or dotted MCP config is not supported by setup; use [mcp_servers.unity-agent-kit].');
  if (managed && ranges.length) throw new Error('Codex has duplicate unity-agent-kit tables outside the setup block.');
  const selected = managed ? [managed] : ranges;
  return { entry: selected.length ? { present: true, value: selected.map(r => text.slice(r.start, r.end)).join('') } : { present: false }, ranges: selected };
}

function tomlText(text, entry) {
  text ??= '';
  const { ranges } = tomlEntry(text);
  if (!ranges.length) return entry.present ? text + (text && !text.endsWith('\n') ? '\n' : '') + entry.value : text;
  let result = '', cursor = 0;
  for (let i = 0; i < ranges.length; i++) {
    result += text.slice(cursor, ranges[i].start) + (i === 0 && entry.present ? entry.value : '');
    cursor = ranges[i].end;
  }
  return result + text.slice(cursor);
}

function currentEntry(text, target) {
  if (target.kind === 'json') return jsonEntry(text, target);
  if (target.kind === 'toml') return tomlEntry(text).entry;
  return text === null ? { present: false } : { present: true, value: text };
}

function render(text, target, entry, originalText) {
  if (target.kind === 'json') return jsonText(text, target, entry, originalText);
  if (target.kind === 'toml') {
    const result = tomlText(text, entry);
    return originalText === null && !result.trim() ? null : result;
  }
  return entry.present ? entry.value : null;
}

function projectFile(project, name) {
  const path = resolve(project, name);
  const rel = relative(project, path);
  if (!rel || rel.startsWith('..' + sep) || rel === '..' || isAbsolute(rel)) throw new Error(`Unsafe setup path: ${name}`);
  let cursor = project;
  for (const part of rel.split(sep)) {
    cursor = join(cursor, part);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink())
      throw new Error(`Setup does not write through symbolic links: ${cursor}`);
  }
  return path;
}

function atomicWrite(path, text) {
  if (text === null) { rmSync(path, { force: true }); return; }
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  const mode = existsSync(path) ? lstatSync(path).mode & 0o777 : 0o600;
  try { writeFileSync(temp, text, { flag: 'wx', mode }); renameSync(temp, path); }
  finally { rmSync(temp, { force: true }); }
}

function validateRecord(record) {
  const expected = record.path === 'Packages/manifest.json' ? { kind: 'json', parent: 'dependencies', key: PACKAGE }
    : ['.mcp.json', '.cursor/mcp.json'].includes(record.path) ? { kind: 'json', parent: 'mcpServers', key: SERVER }
    : record.path === '.codex/config.toml' ? { kind: 'toml' }
    : record.path === '.unity-agent-kit/.gitignore'
      || ['.agents/skills', '.claude/skills'].some(base => SKILLS.some(name => record.path === `${base}/${name}/SKILL.md`)) ? { kind: 'file' } : null;
  if (!expected || Object.entries(expected).some(([key, value]) => record[key] !== value)
    || !object(record.original) || typeof record.original.present !== 'boolean'
    || (record.originalText !== null && typeof record.originalText !== 'string')
    || !Array.isArray(record.installedHashes) || record.installedHashes.some(value => !/^[a-f0-9]{64}$/.test(value)))
    throw new Error('Malformed or out-of-scope setup backup record; no files changed.');
}

function desiredTargets(project, kitRoot, client, skills) {
  const clients = client === 'all' ? ['codex', 'claude', 'cursor'] : [client];
  const serverPath = join(kitRoot, 'packages', 'mcp', 'bin', 'server.js');
  if (!existsSync(serverPath)) throw new Error(`Missing MCP server: ${serverPath}. Use a complete release checkout.`);
  if (!existsSync(join(kitRoot, 'upm', 'package.json'))) throw new Error('The release checkout has no upm/package.json.');
  const command = process.execPath;
  const args = [serverPath, '--project', project];
  if ([command, ...args].some(value => value.includes('${')))
    throw new Error('Project, Node and checkout paths cannot contain ${ because MCP clients expand it as an environment variable.');
  const targets = [{ path: 'Packages/manifest.json', kind: 'json', parent: 'dependencies', key: PACKAGE,
    desired: 'file:' + join(kitRoot, 'upm').replace(/\\/g, '/') }];
  if (!existsSync(join(project, '.unity-agent-kit', '.gitignore')))
    targets.push({ path: '.unity-agent-kit/.gitignore', kind: 'file', desired: 'setup-state.json\nsetup.lock\n*.tmp\n' });
  for (const selected of clients) {
    if (selected === 'codex') targets.push({ path: '.codex/config.toml', kind: 'toml',
      desired: `${BEGIN}\n[mcp_servers.${SERVER}]\ncommand = ${JSON.stringify(command)}\nargs = ${JSON.stringify(args)}\n${END}\n` });
    else targets.push({ path: selected === 'claude' ? '.mcp.json' : '.cursor/mcp.json', kind: 'json',
      parent: 'mcpServers', key: SERVER, desired: { command, args } });
  }
  if (skills) {
    const destinations = new Set(clients.map(selected => selected === 'claude' ? '.claude/skills' : '.agents/skills'));
    for (const destination of destinations) for (const name of SKILLS) targets.push({
      path: `${destination}/${name}/SKILL.md`, kind: 'file', desired: readFileSync(join(kitRoot, 'skills', name, 'SKILL.md'), 'utf8')
    });
  }
  return targets;
}

// The backup records store originals plus hashes of generated entries. They are
// published before changes so an interrupted first install can also be undone.
export function setup({ project, client = 'all', check = false, undo = false, replace = false, skills = true, kitRoot = KIT_ROOT } = {}) {
  if (!project) throw new Error('Supply --project <Unity project>.');
  if (!['all', 'codex', 'claude', 'cursor'].includes(client)) throw new Error('--client must be codex, claude, cursor or all.');
  if (check && undo) throw new Error('--check and --undo cannot be combined.');
  if (undo && replace) throw new Error('--undo never overwrites edited entries; do not combine it with --replace.');
  project = realpathSync(resolve(project));
  kitRoot = realpathSync(resolve(kitRoot));
  if (!existsSync(join(project, 'Assets')) || !lstatSync(join(project, 'Assets')).isDirectory()
    || !existsSync(join(project, 'ProjectSettings', 'ProjectVersion.txt')) || !existsSync(join(project, 'Packages', 'manifest.json')))
    throw new Error('The project must contain an Assets directory, ProjectSettings/ProjectVersion.txt and Packages/manifest.json.');
  const statePath = projectFile(project, STATE);
  const stateText = read(statePath);
  const state = stateText === null ? { schema: 1, project, records: [] } : parseJson(stateText, STATE);
  if (state.schema !== 1 || state.project !== project || !Array.isArray(state.records)) throw new Error('Unrecognized setup-state.json; preserve it and inspect before continuing.');
  for (const record of state.records) validateRecord(record);
  if (new Set(state.records.map(record => record.path)).size !== state.records.length) throw new Error('Duplicate setup backup records; no files changed.');
  const changes = [], issues = [], records = structuredClone(state.records);
  const targets = undo ? records : desiredTargets(project, kitRoot, client, skills);
  for (const target of targets) {
    const path = projectFile(project, target.path);
    const before = read(path);
    const current = currentEntry(before, target);
    const currentHash = hash(current);
    const record = records.find(value => value.path === target.path);
    if (undo) {
      if (!record || !Array.isArray(record.installedHashes) || !object(record.original)) throw new Error('Malformed setup backup record.');
      if (currentHash === hash(record.original)) continue;
      if (!record.installedHashes.includes(currentHash)) { issues.push(`${target.path}: owned entry was edited; kept unchanged.`); continue; }
      let after = render(before, target, record.original, record.originalText);
      if (hash(before) === record.firstInstalledFileHash) after = record.originalText;
      changes.push({ path, before, after });
      continue;
    }
    const desired = { present: true, value: target.desired };
    if (currentHash === hash(desired)) continue;
    if (check) { issues.push(`${target.path}: ${current.present ? 'differs from this checkout' : 'not installed'}.`); continue; }
    const owned = record?.installedHashes?.includes(currentHash) || (record && currentHash === hash(record.original));
    if (current.present && !owned && !replace) { issues.push(`${target.path}: existing entry differs; use --replace to back it up and replace it.`); continue; }
    if (record && !owned && !replace) { issues.push(`${target.path}: installed entry was edited; use --replace to preserve that edit as the new undo backup.`); continue; }
    const after = render(before, target, desired, before);
    if (target.kind === 'toml') tomlEntry(after);
    let next = record;
    if (!next || !owned) {
      next = { path: target.path, kind: target.kind, parent: target.parent, key: target.key,
        original: current, originalText: before, installedHashes: [], firstInstalledFileHash: hash(after) };
      const index = records.findIndex(value => value.path === target.path);
      if (index < 0) records.push(next); else records[index] = next;
    }
    if (!next.installedHashes.includes(hash(desired))) next.installedHashes.push(hash(desired));
    changes.push({ path, before, after });
  }
  const result = { ok: issues.length === 0, mode: undo ? 'undo' : check ? 'check' : 'install', project,
    changed: [], issues, statePath };
  if (check || issues.length) return result;
  if (!undo && changes.length === 0) return result;
  const lockPath = projectFile(project, '.unity-agent-kit/setup.lock');
  mkdirSync(dirname(lockPath), { recursive: true });
  try { writeFileSync(lockPath, String(process.pid), { flag: 'wx' }); }
  catch (e) { if (e.code === 'EEXIST') throw new Error(`Another setup owns ${lockPath}; if it stopped, remove this lock before retrying.`); throw e; }
  try {
    if (read(statePath) !== stateText) throw new Error('Setup state changed while planning; retry.');
    for (const change of changes) if (read(change.path) !== change.before) throw new Error(`${change.path} changed while planning; retry.`);
    if (!undo) atomicWrite(statePath, JSON.stringify({ schema: 1, project, records }, null, 2) + '\n');
    for (const change of changes) {
      if (read(change.path) !== change.before) throw new Error(`${change.path} changed during setup; preserved. Run --undo to recover applied entries.`);
      atomicWrite(change.path, change.after);
      result.changed.push(relative(project, change.path).replace(/\\/g, '/'));
    }
    if (undo) atomicWrite(statePath, null);
  } finally { rmSync(lockPath, { force: true }); }
  return result;
}

const HELP = `Usage: node scripts/setup.mjs --project <Unity project> --client codex|claude|cursor|all
  --check       Read-only check of package, MCP configuration and skill files
  --undo        Restore all setup-owned entries, preserving unrelated edits
  --replace     Back up and replace conflicting same-name entries or skill files
  --no-skills   Configure UPM and MCP without copying the five project skills

Requires Node 20+, a complete checkout and npm ci run in that checkout.
This command does not start Unity or change client trust/approval settings.
Codex means the local desktop app, CLI or IDE. Browser ChatGPT cannot run local stdio.
Undo backups are in the project's .unity-agent-kit/setup-state.json.
`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('Node 20 or newer is required.');
    const options = {};
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--help' || arg === '-h') { console.log(HELP); process.exit(0); }
      if (arg === '--project' || arg === '--client') {
        if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${arg}.`);
        options[arg.slice(2)] = args[++i];
      } else if (['--check', '--undo', '--replace'].includes(arg)) options[arg.slice(2)] = true;
      else if (arg === '--no-skills') options.skills = false;
      else throw new Error(`Unknown argument: ${arg}`);
    }
    const result = setup(options);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) { console.error(`setup: ${error.message}`); process.exitCode = 1; }
}
