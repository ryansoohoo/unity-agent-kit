export const STATUSES = ['pass', 'warn', 'fail', 'na'];
const LAYERS = ['hygiene', 'workflow', 'template', 'integration', 'audit'];

export function validateCheck(c) {
  if (!c || typeof c.id !== 'string' || !c.id) throw new Error('check needs id');
  if (!LAYERS.includes(c.layer)) throw new Error(`bad layer: ${c.layer}`);
  if (typeof c.title !== 'string' || !c.title) throw new Error('check needs title');
  if (typeof c.detect !== 'function') throw new Error('check needs detect()');
  if (typeof c.explain !== 'function') throw new Error('check needs explain()');
  if (c.apply !== undefined && typeof c.apply !== 'function') throw new Error('apply must be fn');
  if (c.verify !== undefined && typeof c.verify !== 'function') throw new Error('verify must be fn');
  return c;
}
