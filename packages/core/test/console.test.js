import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { consolePath, readConsole, clearConsole } from '../src/console.js';
import { tmp } from './tmp.js';

const e = (epoch, type, message, extra = {}) => ({ epoch, frame: 1, timeMs: 1000 + epoch, type, message, stack: '', ...extra });
function seed(root, entries, trailing = '') {
  mkdirSync(dirname(consolePath(root)), { recursive: true });
  writeFileSync(consolePath(root), entries.map(x => JSON.stringify(x)).join('\n') + '\n' + trailing);
}

test('readConsole: empty when the file is missing', () => {
  assert.deepEqual(readConsole(tmp('uak-con-')), []);
});

test('readConsole: parses lines, skips a torn tail, filters errors / sinceEpoch / last', () => {
  const p = tmp('uak-con-');
  seed(p, [e(3, 'Log', 'a'), e(3, 'Error', 'b'), e(4, 'Warning', 'c'), e(4, 'Exception', 'd', { stack: 'at Foo.Bar()' }), e(5, 'Log', 'e')], '{"epoch":5,"ty');
  assert.equal(readConsole(p).length, 5);
  assert.deepEqual(readConsole(p, { errors: true }).map(x => x.message), ['b', 'd']);
  assert.deepEqual(readConsole(p, { sinceEpoch: 4 }).map(x => x.message), ['c', 'd', 'e']);
  assert.deepEqual(readConsole(p, { sinceEpoch: 4, last: 2 }).map(x => x.message), ['d', 'e']);
  assert.equal(readConsole(p, { errors: true })[1].stack, 'at Foo.Bar()');
});

test('clearConsole truncates and creates', () => {
  const p = tmp('uak-con-');
  clearConsole(p);
  assert.ok(existsSync(consolePath(p)));
  seed(p, [e(1, 'Log', 'x')]);
  clearConsole(p);
  assert.equal(readFileSync(consolePath(p), 'utf8'), '');
  assert.deepEqual(readConsole(p), []);
});
