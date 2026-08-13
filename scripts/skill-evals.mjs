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

export function parseSkillInvocations(stdoutText) {
  const fired = [];
  for (const line of stdoutText.split(/\r?\n/)) {
    let j; try { j = JSON.parse(line); } catch { continue; }
    for (const block of j?.message?.content ?? []) {
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

function arg(name, dflt) { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : dflt; }

function die(msg) { console.error(`indeterminate: ${msg}`); process.exit(2); }

// A variant goes into frontmatter as a SINGLE-QUOTED YAML scalar with internal
// quotes doubled: bare `NON-NEGOTIABLE: …` class strings break the document,
// and skill-lint's regex would still "see" a description Claude Code cannot.
const yamlSingleQuoted = (s) => `'${s.replace(/'/g, "''")}'`;
const yamlUnquote = (raw) => (raw.startsWith("'") && raw.endsWith("'") ? raw.slice(1, -1).replace(/''/g, "'") : raw);
const frontmatterDesc = (md) => md.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]?.match(/^description:\s*(.+?)\s*$/m)?.[1];

function buildTempProject(skillNames, variant) {
  const proj = mkdtempSync(join(tmpdir(), 'uak-evals-'));
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
  const unknown = skills.filter(s => !allSkills.includes(s));
  if (unknown.length) die(`unknown --skills: ${unknown.join(',')} (have: ${allSkills.join(',')})`);
  if (!Number.isInteger(runs) || runs < 1) die(`--runs must be a positive integer, got "${arg('--runs', '3')}"`);
  const probe = spawnSync('claude', ['--version'], { encoding: 'utf8', shell: true });
  if (probe.status !== 0) die('claude CLI unavailable');
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
  const records = [];
  for (const skill of skills) {
    const set = JSON.parse(readFileSync(join('skills', skill, 'evals.json'), 'utf8'));
    for (const q of set.queries) for (let r = 0; r < runs; r++) {
      const args = ['-p', '--output-format', 'stream-json', '--verbose', '--max-turns', '3', '--allowedTools', 'Skill'];
      if (model) args.push('--model', model);
      const res = spawnSync('claude', args, { cwd: proj, input: q.query, encoding: 'utf8', shell: true, timeout: 120000 });
      const verdict = (res.error || res.status === null) ? 'indeterminate' : null;
      records.push({ skill, query: q.query, expect: q.expect, fired: verdict ? [] : parseSkillInvocations(res.stdout ?? ''), verdict });
      console.log(`${skill} | ${verdict ?? 'ok'} | expect=${q.expect} fired=${records.at(-1).fired.join('+') || '-'} | ${q.query.slice(0, 50)}`);
    }
  }
  const score = scoreRuns(records);
  const out = arg('--out', join('.superpowers', `skill-evals-${variant ?? 'baseline'}.json`));
  mkdirSync(dirname(out), { recursive: true }); // a 300-call run must not die on a missing --out dir
  writeFileSync(out, JSON.stringify({ meta: { model, runs, variant, startedAt: new Date().toISOString() }, records, score }, null, 2));
  console.log(JSON.stringify(score.perSkill, null, 2));
  // Absolute results path: the run is scratch, the file is what gets copied.
  console.log(`cross-fires: ${score.crossFires.length}, indeterminate: ${score.indeterminate}, results: ${resolve(out)}`);
  rmSync(proj, { recursive: true, force: true });
  if (score.indeterminate) process.exit(2);
  const ok = Object.values(score.perSkill).every(b => b.hit / (b.hit + b.miss) >= 0.9) && score.crossFires.length === 0;
  process.exit(ok ? 0 : 1);
}
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('skill-evals.mjs')) await main();
