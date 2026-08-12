import { register } from '../registry.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets');
const toPosix = (p) => p.replace(/\\/g, '/');

function routed(ctx) {
  const p = join(ctx.root, '.gitattributes');
  if (!existsSync(p)) return false;
  return /merge=unityyamlmerge/.test(readFileSync(p, 'utf8'));
}

register({
  id: 'merge-driver',
  layer: 'hygiene',
  title: 'Unity YAML merge driver wired and proven',
  explain: () =>
    'Your .gitattributes routes Unity YAML (scenes, prefabs, .meta, materials) to a merge driver named ' +
    '"unityyamlmerge". If that driver is not configured, git silently falls back to a plain text merge, ' +
    'which can write conflict markers into a guid: line — Unity treats that as a corrupt .meta and may ' +
    'regenerate the GUID, silently repointing every reference — or cleanly auto-merge YAML into a valid-but-' +
    'wrong scene. The kit installs a tested wrapper (extension restore, distinct input/output, no GUI ' +
    'fallback, marker-safe .meta path) and proves it with a 5-case regression suite.',
  detect: async (ctx) => {
    if (!ctx.git('rev-parse', '--is-inside-work-tree').ok) return { status: 'na', evidence: 'not a git repo' };
    if (!routed(ctx)) return { status: 'na', evidence: 'no .gitattributes routing to unityyamlmerge' };
    const drv = ctx.git('config', '--get', 'merge.unityyamlmerge.driver');
    if (!drv.ok || !drv.out) return { status: 'fail', evidence: '.gitattributes routes Unity YAML to unityyamlmerge but merge.unityyamlmerge.driver is UNSET — git is text-merging scenes' };
    if (!/unity-yaml-merge\.sh/.test(drv.out)) return { status: 'warn', evidence: `driver set to something else: ${drv.out}` };
    return { status: 'pass', evidence: drv.out };
  },
  apply: async (ctx) => {
    const toolsDir = join(ctx.root, 'tools');
    mkdirSync(toolsDir, { recursive: true });
    const dest = join(toolsDir, 'unity-yaml-merge.sh');
    const prev = existsSync(dest) ? readFileSync(dest, 'utf8') : null;
    copyFileSync(join(ASSETS, 'unity-yaml-merge.sh'), dest);
    const prevDrv = ctx.git('config', '--get', 'merge.unityyamlmerge.driver');
    ctx.git('config', 'merge.unityyamlmerge.name', 'Unity SmartMerge (headless, no GUI fallback)');
    ctx.git('config', 'merge.unityyamlmerge.driver', `sh '${toPosix(dest)}' %O %A %B %P`);
    ctx.git('config', 'merge.unityyamlmerge.recursive', 'binary');
    return {
      changed: [dest, 'git config merge.unityyamlmerge.*'],
      undo: [
        { kind: 'restore-file', path: dest, previous: prev },
        ...(prevDrv.ok ? [] : [
          { kind: 'git-config-unset', key: 'merge.unityyamlmerge.driver' },
          { kind: 'git-config-unset', key: 'merge.unityyamlmerge.name' },
          { kind: 'git-config-unset', key: 'merge.unityyamlmerge.recursive' },
        ]),
      ],
    };
  },
  verify: async (ctx) => {
    try {
      const out = execFileSync('sh', [join(ASSETS, 'test-merge-driver.sh')], {
        encoding: 'utf8',
        env: { ...process.env, UAK_DRIVER: toPosix(join(ctx.root, 'tools', 'unity-yaml-merge.sh')) },
      });
      const pass = /PASS=5\s+FAIL=0/.test(out);
      return { ok: pass, proof: pass ? '5/5 regression cases pass (disjoint scene/prefab/meta merge clean; guid & same-field conflicts stop as valid YAML)' : out.slice(-800) };
    } catch (e) {
      return { ok: false, proof: `suite failed: ${(e.stdout ?? '') + (e.stderr ?? '')}`.slice(0, 800) };
    }
  },
});
