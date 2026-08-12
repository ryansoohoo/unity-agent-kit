import { checks, getCheck } from './registry.js';
import { recordApply, recordVerify } from './audit.js';

export async function doctor(ctx, { only } = {}) {
  const rows = [];
  for (const c of checks) {
    if (only && c.id !== only && c.layer !== only) continue;
    let res;
    try { res = await c.detect(ctx); }
    catch (e) { res = { status: 'na', evidence: `detect crashed safely: ${String(e?.message ?? e).slice(0, 120)}` }; }
    const row = { id: c.id, layer: c.layer, title: c.title, status: res.status, evidence: res.evidence, canApply: typeof c.apply === 'function' };
    if (res.detail !== undefined) row.detail = res.detail;
    rows.push(row);
  }
  return rows;
}

export async function applyOne(ctx, id) {
  const c = getCheck(id);
  if (!c) throw new Error(`unknown check: ${id}`);
  if (!c.apply) throw new Error(`check ${id} is detect-only`);
  const { changed, undo } = await c.apply(ctx);
  recordApply(ctx, { id, at: new Date().toISOString(), changed, undo });
  const verify = c.verify ? await c.verify(ctx) : null;
  if (verify) recordVerify(ctx, id, verify);
  return { changed, verify };
}
