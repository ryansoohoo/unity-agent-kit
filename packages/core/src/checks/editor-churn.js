import { register } from '../registry.js';

const SCENE_RE = /\.(unity|prefab)$/;
const CHURN_RE = /^(ProjectSettings\/|Assets\/Settings\/)/;

register({
  id: 'editor-churn', layer: 'hygiene', title: 'No uncommitted scene files or editor reserialization churn',
  explain: () =>
    'Merely opening the Unity editor rewrites settings assets (reserialization) — uncommitted, that churn ' +
    'reappears in every worktree, defeats worktree cleanup (which skips dirty trees), and stacks noise onto ' +
    'every agent diff. Uncommitted .unity/.prefab files are worse: Unity scene YAML is unreconstructable if ' +
    'lost, and these are exactly the files whose merges are dangerous. Commit before agent sessions. ' +
    'The kit never commits for you.',
  detect: async (ctx) => {
    const st = ctx.git('status', '--porcelain');
    if (!st.ok) return { status: 'na', evidence: 'not a git repo' };
    const lines = st.out ? st.out.split('\n') : [];
    const paths = lines.map(l => l.slice(3).replace(/^"|"$/g, ''));
    const scenes = paths.filter(p => SCENE_RE.test(p));
    const churn = paths.filter(p => CHURN_RE.test(p));
    if (!scenes.length && !churn.length) return { status: 'pass', evidence: 'tree clean of scene/settings churn' };
    const bits = [];
    if (scenes.length) bits.push(`uncommitted scene files (unreconstructable if lost): ${scenes.slice(0, 5).join(', ')}${scenes.length > 5 ? ` +${scenes.length - 5}` : ''}`);
    if (churn.length) bits.push(`editor reserialization churn: ${churn.slice(0, 5).join(', ')}${churn.length > 5 ? ` +${churn.length - 5}` : ''}`);
    return { status: 'warn', evidence: bits.join(' | ') + ' — commit these before agent sessions' };
  },
});
