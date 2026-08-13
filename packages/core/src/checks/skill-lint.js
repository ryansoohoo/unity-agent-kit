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
  // Shingle every paragraph once up front: the comparison is inherently
  // pairwise, but re-shingling inside the loops makes that cost quadratic too.
  const shingled = skills.map(s => paras(s.body ?? '').map(p => [p, shingleSet(p)]));
  for (let i = 0; i < skills.length; i++) for (let j = i + 1; j < skills.length; j++) {
    for (const [pa, sa] of shingled[i]) for (const [, sb] of shingled[j]) {
      const sim = jaccard(sa, sb);
      if (sim >= 0.6) {
        flags.push(`${skills[i].name} and ${skills[j].name}: near-duplicate paragraph (${Math.round(sim * 100)}% — "${pa.slice(0, 40)}…") — keep one canonical home and cross-reference`);
      }
    }
  }
  return flags;
}

// The accepted negative-trigger forms. ONE definition on purpose: detect() asks
// whether a description has one, the positive-clause splitter below cuts at it,
// and the two drifting apart silently turns negative clauses into claims.
const NEG_TRIGGER = /\bdo not\b|\bdon['’]t\b|\bnot for\b/i;

// Vocabulary discipline across sibling descriptions. Shadowing: one content
// term claimed by two skills' POSITIVE clauses (before the negative trigger)
// leaves the router a coin-flip. Polysemy: terms with two Unity meanings must
// carry a disambiguator wherever they appear.
const STOP = new Set(['use', 'when', 'the', 'a', 'an', 'or', 'and', 'for', 'in', 'of', 'to', 'with', 'not', 'do', 'unity', 'agent', 'agents', 'skill', 'skills', 'this', 'each', 'its', 'into', 'via']);
const SHADOW_ALLOW = new Set(['scene', 'prefab']); // adjudicated: merge=conflict-time, topology=planning-time
// termRe (optional) replaces the default `\b<term>` match where word forms
// matter: build's compile-adjacent forms are re-/pre-prefixed, and "buildings"
// is a different word that merely starts with it.
const POLYSEMES = [
  { term: 'build', termRe: /\b(?:re|pre)?build(?!ing)/i, re: /player|\bexe\b|compil/i, meanings: 'player build vs compilation' },
];
function vocabFlags(skills) {
  const flags = [];
  const positive = (d) => d.split(NEG_TRIGGER)[0];
  const claims = new Map();
  for (const s of skills) {
    const seen = new Set();
    for (const w of positive(s.desc).toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? []) {
      if (STOP.has(w) || SHADOW_ALLOW.has(w) || seen.has(w)) continue;
      seen.add(w);
      if (!claims.has(w)) claims.set(w, []);
      claims.get(w).push(s.name);
    }
    for (const p of POLYSEMES) {
      if ((p.termRe ?? new RegExp(`\\b${p.term}`, 'i')).test(s.desc) && !p.re.test(s.desc)) {
        flags.push(`${s.name}: "${p.term}" is polysemous (${p.meanings}) — add a disambiguator`);
      }
    }
  }
  for (const [w, names] of claims) {
    if (names.length >= 2) flags.push(`"${w}" claimed by ${names.join(' and ')} — positive clauses must not share content terms`);
  }
  return flags;
}

// Environment contracts rot silently (research E1): machine-measured numbers
// must say so on the line; CLI flags must be kit-owned or adjudicated vendor
// tokens (re-verify vendor tokens against the Unity CLI on editor upgrades).
const CONTRACT_ALLOW = new Set([
  '--wait-ready', '--since-epoch', '--timeout-ms', '--poll-ms', '--epoch',
  '--only', '--fix', '--undo', '--json',            // kit-owned (version-locked to this repo)
  '--fallback',                                     // vendor: UnityYAMLMerge, proven by the merge-driver suite
  '--ours', '--theirs',                             // vendor: git checkout conflict-side selectors (verified against git 2.55 `checkout -h`)
]);
function contractFlags(skills) {
  const flags = [];
  for (const s of skills) {
    for (const line of (s.body ?? '').split(/\r?\n/)) {
      if (/\bmeasured\b/i.test(line)) continue;
      const num = line.match(/~?\d+(?:\.\d+)?\s*(?:ms|s|GB|MB)\b/);
      if (num) flags.push(`${s.name}: unannotated measurement "${num[0].trim()}" — add "measured" to the line or remove the number`);
      for (const f of line.match(/--[a-z][\w-]+/g) ?? []) {
        if (!CONTRACT_ALLOW.has(f)) flags.push(`${s.name}: unallowlisted flag "${f}" — kit flag? add to CONTRACT_ALLOW; vendor? adjudicate + comment`);
      }
    }
  }
  return flags;
}
function formFlags(skills) {
  const flags = [];
  for (const s of skills) {
    if (/(^|[\s"”(])(I|I'll|you|we)\b/i.test(s.desc)) flags.push(`${s.name}: first/second-person description — write third person (discovery degrades otherwise)`);
    if (/\bstep \d|\bfirst,|\bthen\b.*\bthen\b/i.test(s.desc)) flags.push(`${s.name}: procedure language in description — describe triggers, not workflow`);
    if (/^##\s+When (to|not to) use/mi.test(s.body ?? '')) flags.push(`${s.name}: "When to use" belongs in the description — bodies load only after routing`);
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

// How many findings the evidence line shows before collapsing to "+N": four
// flag families feed one list now, so a single family cannot crowd out the rest.
const EVIDENCE_CAP = 8;

register({
  id: 'skill-lint', layer: 'workflow', title: 'Skill descriptions: cheap, non-overlapping, trigger-phrased',
  explain: () =>
    'Every installed skill description is loaded into EVERY session (a resting token cost) and is the only ' +
    'signal deciding when the skill fires. This lints .claude/skills/ and skills/ on four dimensions: ' +
    'description form (missing or >200 chars, no "Use when…" firing condition, no "Do NOT use…" negative ' +
    'trigger, first/second-person or step-by-step phrasing, a "When to use" heading hidden in the body, ' +
    'overlap between two descriptions, summed resting cost); paragraph near-duplication across bodies; ' +
    'vocabulary (one content term claimed by two positive clauses, polysemes with no disambiguator); and ' +
    'environment contracts (ms/s/GB/MB numbers whose line does not say "measured", CLI flags outside the ' +
    'adjudicated allowlist). Duplication sensitivity: 120+ char paragraphs, 8-word shingles, 0.6 Jaccard — ' +
    'a 300-char paragraph still matches after four reworded words, a 120-char one can miss after one. ' +
    'Detect-only: wording is a human/agent editing job, so there is no --fix.',
  detect: async (ctx) => {
    const skills = collectSkills(ctx.root);
    if (!skills.length) return { status: 'na', evidence: 'no skills installed (.claude/skills/ or skills/)' };
    const flags = [];
    for (const s of skills) {
      if (!s.desc) { flags.push(`${s.name}: missing description`); continue; }
      if (s.desc.length > 200) flags.push(`${s.name}: description ${s.desc.length} chars (>200)`);
      if (!/\buse when\b/i.test(s.desc)) flags.push(`${s.name}: no "Use when" firing condition`);
      if (!NEG_TRIGGER.test(s.desc)) flags.push(`${s.name}: no negative trigger ("Do NOT use…")`);
    }
    const withDesc = skills.filter(s => s.desc);
    for (let i = 0; i < withDesc.length; i++) {
      for (let j = i + 1; j < withDesc.length; j++) {
        const sim = jaccard(wordSet(withDesc[i].desc), wordSet(withDesc[j].desc));
        if (sim > 0.5) flags.push(`${withDesc[i].name} and ${withDesc[j].name}: descriptions ${Math.round(sim * 100)}% overlapping — agents cannot pick between them`);
      }
    }
    flags.push(...paraDupes(skills)); // bodies dedup across ALL skills: a description-less one is the least linted
    flags.push(...vocabFlags(withDesc));
    flags.push(...contractFlags(withDesc), ...formFlags(withDesc));
    const tokens = withDesc.reduce((n, s) => n + Math.ceil(s.desc.length / 4), 0);
    if (tokens > 500) flags.push(`resting cost ~${tokens} tokens across ${skills.length} descriptions (>500 budget)`);
    return flags.length
      ? { status: 'warn', evidence: `${skills.length} skill(s), ~${tokens} resting tokens — ${flags.length} issue(s): ${flags.slice(0, EVIDENCE_CAP).join('; ')}${flags.length > EVIDENCE_CAP ? ` +${flags.length - EVIDENCE_CAP}` : ''}` }
      : { status: 'pass', evidence: `${skills.length} skill(s), ~${tokens} resting tokens, all descriptions well-formed` };
  },
});
