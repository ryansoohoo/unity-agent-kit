import { validateCheck } from './check.js';

const list = [];
export function register(check) { list.push(validateCheck(check)); return check; }
export const checks = list;
export function getCheck(id) { return list.find(c => c.id === id); }
