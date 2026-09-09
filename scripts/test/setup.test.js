import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setup } from '../setup.mjs';

const PACKAGE = 'com.unity-agent-kit.doctor';
const SERVER = 'unity-agent-kit';
const SKILLS = ['unity-verify', 'unity-recipes', 'unity-topology', 'unity-merge', 'unity-claude-md'];
const write = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
const read = path => readFileSync(path, 'utf8');
const json = path => JSON.parse(read(path));

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'unity setup é ')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'My Unity 雪'), kitRoot = join(root, 'Kit clone ö');
  mkdirSync(join(project, 'Assets'), { recursive: true });
  write(join(project, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 6000.0.0f1\n');
  write(join(project, 'Packages', 'manifest.json'), '{\n  "dependencies": { "other.package": "1.2.3" },\n  "scopedRegistries": []\n}\n');
  write(join(project, 'AGENTS.md'), 'My existing project instructions.\n');
  write(join(kitRoot, 'upm', 'package.json'), JSON.stringify({ name: PACKAGE }));
  write(join(kitRoot, 'packages', 'mcp', 'bin', 'server.js'), '// fixture\n');
  for (const skill of SKILLS) write(join(kitRoot, 'skills', skill, 'SKILL.md'), `---\nname: ${skill}\n---\n${skill}\n`);
  return { project, kitRoot, run: options => setup({ project, kitRoot, ...options }) };
}

test('all clients install with literal absolute paths, preserve configs and undo unrelated edits', t => {
  const { project, kitRoot, run } = fixture(t);
  write(join(project, '.codex', 'config.toml'), 'model = "custom"\n\n[mcp_servers.other]\ncommand = "other-command"\n');
  write(join(project, '.mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'other' } }, custom: true }));
  write(join(project, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { other: { url: 'https://example.test' } } }));
  assert.equal(run({ check: true }).ok, false);
  assert.equal(existsSync(join(project, '.unity-agent-kit')), false);
  const result = run({ client: 'all' });
  assert.equal(result.ok, true);
  assert.equal(result.changed.length, 15);
  const manifest = json(join(project, 'Packages', 'manifest.json'));
  assert.equal(manifest.dependencies[PACKAGE], 'file:' + join(kitRoot, 'upm').replaceAll('\\', '/'));
  assert.equal(manifest.dependencies['other.package'], '1.2.3');
  const expectedArgs = [join(kitRoot, 'packages', 'mcp', 'bin', 'server.js'), '--project', project];
  for (const file of ['.mcp.json', '.cursor/mcp.json']) {
    const entry = json(join(project, file)).mcpServers[SERVER];
    assert.equal(entry.command, process.execPath);
    assert.deepEqual(entry.args, expectedArgs);
  }
  const toml = read(join(project, '.codex', 'config.toml'));
  assert.ok(toml.startsWith('model = "custom"\n\n[mcp_servers.other]\ncommand = "other-command"\n'));
  assert.deepEqual(JSON.parse(toml.match(/^args = (.+)$/m)[1]), expectedArgs);
  assert.equal(JSON.parse(toml.match(/^command = (.+)$/gm)[1].slice(10)), process.execPath);
  assert.deepEqual(run({}).changed, []);
  assert.equal(run({ check: true }).ok, true);
  const claude = json(join(project, '.mcp.json'));
  claude.mcpServers.addedLater = { command: 'keep-me' };
  write(join(project, '.mcp.json'), JSON.stringify(claude));
  write(join(project, '.codex', 'config.toml'), toml + '\n[mcp_servers.addedLater]\ncommand = "keep-me"\n');
  assert.equal(run({ undo: true }).ok, true);
  assert.deepEqual(json(join(project, '.mcp.json')), { mcpServers: { other: { command: 'other' }, addedLater: { command: 'keep-me' } }, custom: true });
  assert.ok(read(join(project, '.codex', 'config.toml')).includes('[mcp_servers.addedLater]'));
  assert.ok(!read(join(project, '.codex', 'config.toml')).includes(SERVER));
  assert.equal(existsSync(join(project, '.agents', 'skills', 'unity-verify', 'SKILL.md')), false);
  assert.equal(existsSync(join(project, '.claude', 'skills', 'unity-verify', 'SKILL.md')), false);
  assert.equal(read(join(project, 'AGENTS.md')), 'My existing project instructions.\n');
  assert.equal(run({ undo: true }).ok, true);
});

test('conflicts preflight without writes; explicit replacement has exact original backups', t => {
  const { project, run } = fixture(t);
  const manifest = '{ "dependencies": { "com.unity-agent-kit.doctor": "https://existing.test/repo.git" } }\n';
  const claude = '{ "mcpServers": { "unity-agent-kit": {"command":"my-custom-server"} } }\n';
  const toml = '# Mine\n[mcp_servers."unity-agent-kit"]\ncommand = "custom"\n[mcp_servers."unity-agent-kit".env]\nA = "b"\n[mcp_servers.other]\ncommand = "other"\n';
  const skill = 'My custom verification instructions.\n';
  write(join(project, 'Packages', 'manifest.json'), manifest);
  write(join(project, '.mcp.json'), claude);
  write(join(project, '.codex', 'config.toml'), toml);
  write(join(project, '.agents', 'skills', 'unity-verify', 'SKILL.md'), skill);
  const refused = run({});
  assert.equal(refused.ok, false);
  assert.ok(refused.issues.length >= 4);
  assert.equal(read(join(project, 'Packages', 'manifest.json')), manifest);
  assert.equal(existsSync(join(project, '.cursor')), false);
  assert.equal(run({ replace: true }).ok, true);
  assert.equal(run({ check: true }).ok, true);
  assert.equal(run({ undo: true }).ok, true);
  assert.equal(read(join(project, 'Packages', 'manifest.json')), manifest);
  assert.equal(read(join(project, '.mcp.json')), claude);
  assert.equal(read(join(project, '.codex', 'config.toml')), toml);
  assert.equal(read(join(project, '.agents', 'skills', 'unity-verify', 'SKILL.md')), skill);
});

test('undo refuses edited owned entries before changing anything else', t => {
  const { project, run } = fixture(t);
  assert.equal(run({}).ok, true);
  const path = join(project, '.agents', 'skills', 'unity-verify', 'SKILL.md');
  const installed = read(path);
  write(path, installed + 'My later edit.\n');
  const before = read(join(project, 'Packages', 'manifest.json'));
  assert.equal(run({ check: true }).ok, false);
  const result = run({ undo: true });
  assert.equal(result.ok, false);
  assert.ok(result.issues[0].includes('edited'));
  assert.equal(read(join(project, 'Packages', 'manifest.json')), before);
  assert.equal(read(path), installed + 'My later edit.\n');
  write(path, installed);
  assert.equal(run({ undo: true }).ok, true);
});

test('adding clients and updating owned skills preserves the initial undo backup', t => {
  const { project, kitRoot, run } = fixture(t);
  assert.equal(run({ client: 'codex', skills: false }).ok, true);
  assert.equal(existsSync(join(project, '.agents')), false);
  assert.equal(run({ client: 'claude' }).ok, true);
  const source = join(kitRoot, 'skills', 'unity-verify', 'SKILL.md');
  write(source, read(source) + 'Updated release.\n');
  assert.equal(run({ client: 'claude' }).ok, true);
  assert.equal(run({ client: 'claude', check: true }).ok, true);
  assert.equal(run({ undo: true }).ok, true);
  assert.equal(existsSync(join(project, '.mcp.json')), false);
  assert.equal(existsSync(join(project, '.codex', 'config.toml')), false);
});

test('inline Codex config is refused before mutation and symlink destinations are rejected', t => {
  const { project, kitRoot, run } = fixture(t);
  write(join(project, '.codex', 'config.toml'), '[mcp_servers]\nunity-agent-kit = {command="custom"}\n');
  const original = read(join(project, 'Packages', 'manifest.json'));
  assert.throws(() => run({ replace: true }), /inline/);
  assert.equal(read(join(project, 'Packages', 'manifest.json')), original);
  rmSync(join(project, '.codex'), { recursive: true });
  const outside = join(kitRoot, 'external config');
  mkdirSync(outside);
  symlinkSync(outside, join(project, '.codex'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => run({ client: 'codex' }), /symbolic links/);
  assert.equal(existsSync(join(outside, 'config.toml')), false);
});

test('missing Assets and backup records outside setup scope cannot change the project', t => {
  const { project, run } = fixture(t);
  rmSync(join(project, 'Assets'), { recursive: true });
  assert.throws(() => run({}), /Assets directory/);
  mkdirSync(join(project, 'Assets'));
  assert.equal(run({ client: 'codex', skills: false }).ok, true);
  const statePath = join(project, '.unity-agent-kit', 'setup-state.json');
  const state = json(statePath);
  state.records[0].path = 'AGENTS.md';
  write(statePath, JSON.stringify(state));
  assert.throws(() => run({ undo: true }), /out-of-scope/);
  assert.equal(read(join(project, 'AGENTS.md')), 'My existing project instructions.\n');
  assert.equal(json(join(project, 'Packages', 'manifest.json')).dependencies[PACKAGE].startsWith('file:'), true);
});

test('keys after the Codex end marker remain guarded as part of its TOML table', t => {
  const { project, run } = fixture(t);
  const path = join(project, '.codex', 'config.toml');
  write(path, '[mcp_servers.other]\ncommand = "keep"\n');
  assert.equal(run({ client: 'codex', skills: false }).ok, true);
  const edited = read(path) + 'startup_timeout_sec = 30\n\n[[unrelated]]\nvalue = "preserve"\n';
  write(path, edited);
  assert.equal(run({ client: 'codex', skills: false, check: true }).ok, false);
  assert.equal(run({ undo: true }).ok, false);
  assert.equal(read(path), edited);
  assert.equal(run({ client: 'codex', skills: false, replace: true }).ok, true);
  assert.equal(run({ undo: true }).ok, true);
  assert.equal(read(path), edited);
});

test('multiline TOML examples are rejected before replacing literal table text', t => {
  const { project, run } = fixture(t);
  const path = join(project, '.codex', 'config.toml');
  const original = "developer_instructions = '''\nUse this example:\n[mcp_servers.unity-agent-kit]\ncommand=\"example\"\n'''\n[mcp_servers.other]\ncommand=\"keep\"\n";
  write(path, original);
  const manifest = read(join(project, 'Packages', 'manifest.json'));
  assert.throws(() => run({ client: 'codex', replace: true }), /multiline TOML/);
  assert.equal(read(path), original);
  assert.equal(read(join(project, 'Packages', 'manifest.json')), manifest);
  assert.equal(existsSync(join(project, '.unity-agent-kit')), false);
});

test('nested TOML array values do not truncate a replaced MCP table', t => {
  const { project, run } = fixture(t);
  const path = join(project, '.codex', 'config.toml');
  const original = '[mcp_servers.unity-agent-kit]\ncommand = "custom"\nvalues = [\n[1]\n]\n[mcp_servers.other]\ncommand = "keep"\n';
  write(path, original);
  assert.equal(run({ client: 'codex', skills: false, replace: true }).ok, true);
  const installed = read(path);
  assert.ok(!installed.includes('values ='));
  assert.ok(!installed.includes('[1]'));
  assert.ok(installed.includes('[mcp_servers.other]\ncommand = "keep"\n'));
  assert.equal(run({ undo: true }).ok, true);
  assert.equal(read(path), original);
});
