import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const auditPath = (ctx) => join(ctx.root, '.unity-agent-kit', 'applied.json');

export function loadAudit(ctx) {
  const p = auditPath(ctx);
  if (!existsSync(p)) return { applied: [] };
  return JSON.parse(readFileSync(p, 'utf8'));
}

export function recordApply(ctx, entry) {
  const data = loadAudit(ctx);
  data.applied.push(entry);
  mkdirSync(dirname(auditPath(ctx)), { recursive: true });
  writeFileSync(auditPath(ctx), JSON.stringify(data, null, 2) + '\n');
}

export function undoAll(ctx) {
  const data = loadAudit(ctx);
  const undone = [];
  for (const entry of data.applied.reverse()) {
    for (const op of (entry.undo ?? []).slice().reverse()) {
      if (op.kind === 'git-config-unset') {
        try {
          execFileSync('git', ['config', '--unset', op.key], { cwd: ctx.root });
          undone.push(`git config --unset ${op.key}`);
        } catch (err) {
          if (err.status === 5) {
            // exit code 5 means key does not exist, treat as already unset
            undone.push(`${op.key} already unset`);
          } else {
            throw new Error(`failed to unset git config ${op.key}: ${err.message}`);
          }
        }
      } else if (op.kind === 'restore-file') {
        if (op.previous === null) { rmSync(op.path, { force: true }); }
        else { writeFileSync(op.path, op.previous); }
        undone.push(`restored ${op.path}`);
      } else if (op.kind === 'git-config-restore') {
        if (op.previous === null) {
          try {
            execFileSync('git', ['config', '--unset', op.key], { cwd: ctx.root });
            undone.push(`git config --unset ${op.key}`);
          } catch (err) {
            if (err.status === 5) {
              // exit code 5 means key does not exist, treat as already unset
              undone.push(`${op.key} already unset`);
            } else {
              throw new Error(`failed to unset git config ${op.key}: ${err.message}`);
            }
          }
        } else {
          execFileSync('git', ['config', op.key, op.previous], { cwd: ctx.root });
          undone.push(`git config ${op.key} restored`);
        }
      }
    }
  }
  writeFileSync(auditPath(ctx), JSON.stringify({ applied: [] }, null, 2) + '\n');
  return { undone };
}
