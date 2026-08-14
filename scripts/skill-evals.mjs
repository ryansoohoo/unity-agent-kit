// Trigger-quality harness: runs each eval query through `claude -p` headless in
// a temp project carrying the five skills, and scores WHICH skill fired.
// Requires a logged-in `claude` CLI; spends real tokens. Never wired into CI.
//   node scripts/skill-evals.mjs [--skills a,b] [--model id] [--variant name] [--runs N] [--out path]
// Exit: 0 = all determinate, every should-trigger rate >= 0.9, zero cross-fires;
//       1 = thresholds missed; 2 = indeterminate (setup/CLI failure).
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function parseSkillInvocations(stdoutText) {
  const fired = [];
  for (const line of stdoutText.split(/\r?\n/)) {
    let j; try { j = JSON.parse(line); } catch { continue; }
    const content = j?.message?.content;
    if (!Array.isArray(content)) continue; // a non-array content is another message shape, not zero skills
    for (const block of content) {
      if (block?.type === 'tool_use' && block?.name === 'Skill' && block?.input?.skill) fired.push(block.input.skill);
    }
  }
  return fired;
}

export function scoreRuns(records) {
  const perSkill = {}; const crossFires = []; let indeterminate = 0;
  for (const r of records) {
    if (r.verdict === 'indeterminate') { indeterminate++; continue; }
    // Bucketed by the skill that SHOULD have fired, not the eval set the query
    // came from: that is what the exit gate's "should-trigger rate" measures,
    // and it counts every record exactly once (`none` gets its own bucket).
    const bucket = (perSkill[r.expect] ??= { hit: 0, miss: 0 });
    const firedRight = r.expect !== 'none' && r.fired.includes(r.expect);
    const firedWrong = r.fired.filter(f => f !== r.expect);
    if (r.expect === 'none' ? r.fired.length === 0 : (firedRight && firedWrong.length === 0)) bucket.hit++;
    else bucket.miss++;
    if (firedWrong.length) crossFires.push({ query: r.query, expect: r.expect, fired: r.fired });
  }
  return { perSkill, crossFires, indeterminate };
}

// Fields off the stream's final `result` line. Returns {} when the run died
// before emitting one — which is itself the signal that the call failed.
export function resultLine(stdoutText) {
  for (const line of (stdoutText ?? '').split(/\r?\n/)) {
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (j?.type === 'result') return j;
  }
  return {};
}

// The effective model, off the stream's `init` line. Worth recording: with user
// settings excluded the CLI may not resolve the model the interactive session uses.
export function initModel(stdoutText) {
  for (const line of (stdoutText ?? '').split(/\r?\n/)) {
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (j?.type === 'system' && j?.subtype === 'init') return j.model ?? null;
  }
  return null;
}

// A non-zero exit is normally a failed CLI call (expired auth, usage limit, rate
// limit, bad --model), not a skill declining to fire; scoring it as a miss would
// read as trigger collapse with indeterminate: 0.
// The exception is turn exhaustion. `--max-turns` is a budget WE set, and the
// router's choice is made on turn 1 and is already in the stream by the time the
// budget runs out — so that record is determinate and keeps its parsed `fired`.
// Measured before this rule existed: it discarded 10 of 20 smoke records, and
// discarded them unevenly (a query that routes then investigates exhausts turns,
// a query that routes then answers does not), which biased the loss toward the
// strongest positives.
export function verdictFor(res) {
  if (res.error) return 'indeterminate';
  if (res.status === 0) return null;
  return resultLine(res.stdout).terminal_reason === 'max_turns' ? null : 'indeterminate';
}

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  if (i < 0) return dflt;
  const v = process.argv[i + 1];
  // A flag left without a value dies here, not 300 calls later at the write.
  if (v === undefined || v.startsWith('--')) die(`${name} needs a value`);
  return v;
}

function die(msg) { console.error(`indeterminate: ${msg}`); process.exit(2); }

// A variant goes into frontmatter as a SINGLE-QUOTED YAML scalar with internal
// quotes doubled: bare `NON-NEGOTIABLE: …` class strings break the document,
// and skill-lint's regex would still "see" a description Claude Code cannot.
const yamlSingleQuoted = (s) => `'${s.replace(/'/g, "''")}'`;
// Write-side inverse, kept local on purpose: skill-lint.js registers a check into
// the global registry at import, and the parser unit test should not drag that in
// for a string helper. Its unquoteScalar is the canonical reader (it also handles
// double quotes); this one only has to undo the line above.
const yamlUnquote = (raw) => (raw.startsWith("'") && raw.endsWith("'") ? raw.slice(1, -1).replace(/''/g, "'") : raw);
const frontmatterDesc = (md) => md.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]?.match(/^description:\s*(.+?)\s*$/m)?.[1];

// The eval queries name files ("i changed PlayerController.cs", "both of us
// touched Boss.prefab"). Against an empty directory those premises are false,
// and a model that looks before routing correctly answers "there is nothing to
// verify" — which scores as a trigger miss while actually measuring the scratch
// dir. These stubs exist only to make the premises plausible; nothing reads them.
function writeUnityShape(proj) {
  const files = {
    'Assets/Scripts/PlayerController.cs': 'using UnityEngine;\n\npublic class PlayerController : MonoBehaviour\n{\n    public float gravity = -9.81f;\n\n    void Update() { }\n}\n',
    'Assets/Scenes/OutdoorsScene.unity': '%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n--- !u!29 &1\nOcclusionCullingSettings:\n  m_ObjectHideFlags: 0\n',
    'Assets/Prefabs/Boss.prefab': '%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n--- !u!1 &100000\nGameObject:\n  m_Name: Boss\n',
    'ProjectSettings/ProjectVersion.txt': 'm_EditorVersion: 6000.5.5f1\n',
  };
  for (const [rel, body] of Object.entries(files)) {
    const p = join(proj, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body, 'utf8');
  }
  // Several queries are phrased around git state ("git says both of us touched
  // Boss.prefab"). A non-repo makes those premises false the same way.
  spawnSync('git', ['init', '-q'], { cwd: proj, shell: true });
}

function buildTempProject(skillNames, variant) {
  const proj = mkdtempSync(join(tmpdir(), 'uak-evals-'));
  writeUnityShape(proj);
  for (const name of skillNames) {
    const src = join('skills', name); const dst = join(proj, '.claude', 'skills', name);
    mkdirSync(dst, { recursive: true });
    let md = readFileSync(join(src, 'SKILL.md'), 'utf8');
    let want = null;
    if (variant) {
      const vp = join(src, 'evals-variants.json');
      if (existsSync(vp)) {
        const v = JSON.parse(readFileSync(vp, 'utf8'))[variant];
        // Function replacer, not a replacement string: `$&`/`$'` in a variant
        // must land as text, not as a backreference.
        if (v) { want = v; md = md.replace(/^description:.*$/m, () => `description: ${yamlSingleQuoted(v)}`); }
      }
    }
    const path = join(dst, 'SKILL.md');
    writeFileSync(path, md, 'utf8'); // utf8 explicitly: variants carry em dashes
    // Substitution self-check: a variant that did not land (no description line,
    // a mangled quote, a swallowed newline) is a setup failure, never a score.
    if (want !== null && yamlUnquote(frontmatterDesc(readFileSync(path, 'utf8')) ?? '') !== want) {
      rmSync(proj, { recursive: true, force: true });
      die(`variant '${variant}' did not round-trip into ${name}/SKILL.md frontmatter`);
    }
  }
  return proj;
}

async function main() {
  // Setup mistakes exit 2 with a message: a bad path crashes mid-run and a
  // zero-record run would otherwise exit 0 as a silent false pass.
  if (!existsSync('skills')) die('no ./skills — run from the repo root');
  const allSkills = readdirSync('skills').filter(n => existsSync(join('skills', n, 'evals.json')));
  const skills = (arg('--skills', '') || allSkills.join(',')).split(',').filter(Boolean);
  const model = arg('--model', null); const variant = arg('--variant', null);
  const runs = Number(arg('--runs', '3'));
  // Every flag is resolved BEFORE the CLI probe: `--out` parsed lazily at the
  // write would only reject a missing value after the whole run had been spent.
  const out = arg('--out', join('.superpowers', `skill-evals-${variant ?? 'baseline'}.json`));
  const unknown = skills.filter(s => !allSkills.includes(s));
  if (unknown.length) die(`unknown --skills: ${unknown.join(',')} (have: ${allSkills.join(',')})`);
  if (!Number.isInteger(runs) || runs < 1) die(`--runs must be a positive integer, got "${arg('--runs', '3')}"`);
  // --model reaches a shell command line (shell:true is needed for claude.cmd).
  if (model !== null && !/^[\w.:@-]+$/.test(model)) die(`--model has characters outside [A-Za-z0-9._:@-], got "${model}"`);
  // Prove the results are writable now: discovering it at the end throws on the
  // rescue path, which reads as exit 1 "thresholds missed" with the records lost.
  // A creatable directory is not enough — `--out <an existing dir>` EISDIRs at
  // the write — so touch the file itself.
  try { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, ''); }
  catch (e) { die(`--out is not writable: ${out} — ${e.message}`); }
  const probe = spawnSync('claude', ['--version'], { encoding: 'utf8', shell: true });
  if (probe.status !== 0) die('claude CLI unavailable');
  // Provenance: which CLI produced these numbers. A results file from a stubbed
  // or mismatched `claude` is otherwise indistinguishable from a real run.
  const claudeVersion = (probe.stdout ?? '').trim();
  const proj = buildTempProject(allSkills, variant); // coexistence: ALL skills always installed
  // Pre-flight over the temp tree: a variant that fails the shipped skill-lint
  // must never produce numbers that read as routing data.
  if (variant) {
    const { createContext } = await import('../packages/core/src/context.js');
    await import('../packages/core/src/checks/index.js');
    const { getCheck } = await import('../packages/core/src/registry.js');
    const lint = await getCheck('skill-lint').detect(createContext(proj));
    if (lint.status !== 'pass') { rmSync(proj, { recursive: true, force: true }); die(`variant '${variant}' fails skill-lint (${lint.status}) — ${lint.evidence}`); }
  }
  const records = []; const startedAt = new Date().toISOString();
  let partial = true; let score = null; let done = false;
  // Provenance, second half: --setting-sources project drops user settings, so
  // the model the CLI actually resolves here need not be the one the interactive
  // session uses. Recorded from the first call's init line.
  let effectiveModel = null;
  // One way out for all three exits (finished, threw, interrupted). The records
  // are the expensive artifact, so they land BEFORE the temp dir is touched:
  // removing it can EPERM on Windows just after a child exits, and a throw
  // there would take a completed run's results with it.
  const finish = (isPartial) => {
    if (done) return; // a SIGINT landing after a complete run must not rewrite the file as partial
    done = true;
    score = scoreRuns(records);
    // What the run actually cost. A partial run reports the spend it already
    // incurred, which is the number that matters when deciding to resume.
    const spendUsd = Number(records.reduce((t, r) => t + (r.cost ?? 0), 0).toFixed(4));
    writeFileSync(out, JSON.stringify({ meta: { model, runs, variant, startedAt, claudeVersion, effectiveModel, spendUsd, partial: isPartial }, records, score }, null, 2));
    console.log(JSON.stringify(score.perSkill, null, 2));
    // Absolute results path: the run is scratch, the file is what gets copied.
    console.log(`cross-fires: ${score.crossFires.length}, indeterminate: ${score.indeterminate}, calls: ${records.length}, spend: $${spendUsd.toFixed(2)}, results: ${resolve(out)}`);
    try { rmSync(proj, { recursive: true, force: true, maxRetries: 3 }); }
    catch (e) { console.error(`note: temp project left behind, remove it by hand: ${proj} — ${e.message}`); }
  };
  // The exit has to happen even if finish() throws mid-signal, or Ctrl-C leaves
  // the run alive: registering this listener disables Node's default termination.
  process.on('SIGINT', () => {
    console.error(`\nindeterminate: interrupted after ${records.length} record(s)`);
    try { finish(true); } finally { process.exit(2); }
  });
  try {
    for (const skill of skills) {
      const set = JSON.parse(readFileSync(join('skills', skill, 'evals.json'), 'utf8'));
      for (const q of set.queries) for (let r = 0; r < runs; r++) {
        // The only dispatch point in the run: spawnSync blocks and nothing else
        // here awaits, so without this yield the SIGINT handler above can never
        // be called — and its mere registration has already disabled Node's
        // default Ctrl-C termination. Negligible against a multi-second CLI call.
        await new Promise(next => setImmediate(next));
        // --max-turns 1: which skill the router reaches for is a first-turn
        // property, so a bigger budget only buys turns of the model doing work
        // it is not being scored on (measured ~40% dearer per call).
        // --setting-sources project: load the temp project's settings only, so
        // the skill universe is the kit's five plus the CLI's own built-ins and
        // does NOT move with whatever plugins are installed on this machine.
        // (Measured: it drops a superpowers plugin that was winning kit queries.)
        const args = ['-p', '--output-format', 'stream-json', '--verbose', '--max-turns', '1',
                      '--allowedTools', 'Skill', '--setting-sources', 'project'];
        if (model) args.push('--model', model);
        const res = spawnSync('claude', args, { cwd: proj, input: q.query, encoding: 'utf8', shell: true, timeout: 120000 });
        const verdict = verdictFor(res);
        effectiveModel ??= initModel(res.stdout);
        // The CLI reports its failures as JSON on stdout, not stderr: during the
        // auth outage every record carried status 1 and an EMPTY stderr, leaving
        // the results file with no recorded cause. Keep a stdout tail too.
        const line = resultLine(res.stdout);
        records.push({ skill, query: q.query, expect: q.expect, fired: verdict ? [] : parseSkillInvocations(res.stdout ?? ''), verdict,
                       status: res.status ?? null, terminal: line.terminal_reason ?? null, cost: line.total_cost_usd ?? null,
                       stderr: (res.stderr ?? '').slice(-200), stdout: (res.stdout ?? '').slice(-300) });
        console.log(`${skill} | ${verdict ?? 'ok'} | expect=${q.expect} fired=${records.at(-1).fired.join('+') || '-'} | ${q.query.slice(0, 50)}`);
      }
    }
    partial = false;
  } catch (e) {
    console.error(`indeterminate: run aborted after ${records.length} record(s) — ${e.message}`);
  } finally {
    finish(partial);
  }
  if (partial) process.exit(2);
  if (!records.length) die('no records — nothing was measured');
  if (score.indeterminate) process.exit(2);
  const ok = Object.values(score.perSkill).every(b => b.hit / (b.hit + b.miss) >= 0.9) && score.crossFires.length === 0;
  process.exit(ok ? 0 : 1);
}
// Exact URL match, not a basename test: a sibling driver that imports scoreRuns
// must never launch a 300-call run just by being named skill-evals-something.
if (import.meta.url === (process.argv[1] && pathToFileURL(process.argv[1]).href)) await main();
