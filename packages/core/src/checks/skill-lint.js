import { register } from '../registry.js';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const wordSet = (s) => new Set(s.toLowerCase().match(/[a-z0-9-]+/g) ?? []);
const jaccard = (a, b) => {
  const inter = [...a].filter(w => b.has(w)).length;
  const uni = new Set([...a, ...b]).size;
  return uni === 0 ? 0 : inter / uni;
};

// Paragraph-level duplication across skills: k-word shingles, Jaccard on the
// shingle sets. Catches copy-paste drift the description-level check cannot.
const SHINGLE_K = 8;
const paras = (body) => body.split(/\r?\n\s*\r?\n/).map(x => x.trim()).filter(x => x.length >= 120);
const shingleSet = (text) => {
  const words = text.toLowerCase().match(/[a-z0-9-]+/g) ?? [];
  const out = new Set();
  for (let i = 0; i + SHINGLE_K <= words.length; i++) out.add(words.slice(i, i + SHINGLE_K).join(' '));
  return out;
};
function paraDupes(skills) {
  const flags = [];
  for (let i = 0; i < skills.length; i++) for (let j = i + 1; j < skills.length; j++) {
    for (const pa of paras(skills[i].body ?? '')) for (const pb of paras(skills[j].body ?? '')) {
      const sim = jaccard(shingleSet(pa), shingleSet(pb));
      if (sim >= 0.6) {
        flags.push(`${skills[i].name} and ${skills[j].name}: near-duplicate paragraph (${Math.round(sim * 100)}% — "${pa.slice(0, 40)}…") — keep one canonical home and cross-reference`);
      }
    }
  }
  return flags;
}

function collectSkills(root) {
  const out = [];
  for (const base of [join(root, '.claude', 'skills'), join(root, 'skills')]) {
    if (!existsSync(base)) continue;
    let names = [];
    try { names = readdirSync(base); } catch { continue; }
    for (const name of names) {
      const p = join(base, name, 'SKILL.md');
      try {
        if (!existsSync(p)) continue;
        const raw = readFileSync(p, 'utf8');
        const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        const desc = fm?.[1].match(/^description:\s*(.+?)\s*$/m)?.[1] ?? null;
        const body = fm ? raw.slice(fm[0].length) : raw;
        out.push({ name, path: p, desc, body });
      } catch { /* unreadable skill: skip it, lint the rest */ }
    }
  }
  return out;
}

register({
  id: 'skill-lint', layer: 'workflow', title: 'Skill descriptions: cheap, non-overlapping, trigger-phrased',
  explain: () =>
    'Every installed skill description is loaded into EVERY session (a resting token cost) and is the only ' +
    'signal deciding when the skill fires. This lints .claude/skills/ and skills/: missing or overlong ' +
    'descriptions (>200 chars), missing "Use when…" firing conditions, missing negative triggers ' +
    '("Do NOT use…"), near-duplicate overlap between two skills, and the summed resting cost. ' +
    'Detect-only: wording is a human/agent editing job, so there is no --fix.',
  detect: async (ctx) => {
    const skills = collectSkills(ctx.root);
    if (!skills.length) return { status: 'na', evidence: 'no skills installed (.claude/skills/ or skills/)' };
    const flags = [];
    for (const s of skills) {
      if (!s.desc) { flags.push(`${s.name}: missing description`); continue; }
      if (s.desc.length > 200) flags.push(`${s.name}: description ${s.desc.length} chars (>200)`);
      if (!/\buse when\b/i.test(s.desc)) flags.push(`${s.name}: no "Use when" firing condition`);
      if (!/\bdo not\b|\bdon['’]t\b|\bnot for\b/i.test(s.desc)) flags.push(`${s.name}: no negative trigger ("Do NOT use…")`);
    }
    const withDesc = skills.filter(s => s.desc);
    for (let i = 0; i < withDesc.length; i++) {
      for (let j = i + 1; j < withDesc.length; j++) {
        const sim = jaccard(wordSet(withDesc[i].desc), wordSet(withDesc[j].desc));
        if (sim > 0.5) flags.push(`${withDesc[i].name} and ${withDesc[j].name}: descriptions ${Math.round(sim * 100)}% overlapping — agents cannot pick between them`);
      }
    }
    flags.push(...paraDupes(withDesc));
    const tokens = withDesc.reduce((n, s) => n + Math.ceil(s.desc.length / 4), 0);
    if (tokens > 500) flags.push(`resting cost ~${tokens} tokens across ${skills.length} descriptions (>500 budget)`);
    return flags.length
      ? { status: 'warn', evidence: `${skills.length} skill(s), ~${tokens} resting tokens — ${flags.length} issue(s): ${flags.slice(0, 4).join('; ')}${flags.length > 4 ? ` +${flags.length - 4}` : ''}` }
      : { status: 'pass', evidence: `${skills.length} skill(s), ~${tokens} resting tokens, all descriptions well-formed` };
  },
});
