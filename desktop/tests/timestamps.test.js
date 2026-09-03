'use strict';
const test = require('node:test');
const assert = require('node:assert');
const ts = require('../src/shared/timestamps');

test('format whole seconds -> HH:MM:SS', () => {
  assert.strictEqual(ts.format(0), '00:00:00');
  assert.strictEqual(ts.format(59), '00:00:59');
  assert.strictEqual(ts.format(60), '00:01:00');
  assert.strictEqual(ts.format(3661), '01:01:01');
  assert.strictEqual(ts.format(86399), '23:59:59');
});

test('format includes milliseconds only when needed', () => {
  assert.strictEqual(ts.format(62.5), '00:01:02.500');
  assert.strictEqual(ts.format(14 * 60 + 32 + 0.48), '00:14:32.480');
  assert.strictEqual(ts.format(62.0000004), '00:01:02'); // rounds to whole second
  assert.strictEqual(ts.format(61.9999999), '00:01:02'); // rounds up to whole second
  assert.strictEqual(ts.format(0.25, { forceMillis: true }), '00:00:00.250');
});

test('format clamps negatives and garbage', () => {
  assert.strictEqual(ts.format(-5), '00:00:00');
  assert.strictEqual(ts.format(null), '');
  assert.strictEqual(ts.format(undefined), '');
  assert.strictEqual(ts.format(NaN), '');
});

test('parse numbers and strings', () => {
  assert.strictEqual(ts.parse(90), 90);
  assert.strictEqual(ts.parse('90'), 90);
  assert.strictEqual(ts.parse('90.5'), 90.5);
  assert.strictEqual(ts.parse('01:01:01'), 3661);
  assert.strictEqual(ts.parse('1:01:01'), 3661);
  assert.strictEqual(ts.parse('23:59:59'), 86399);
  assert.strictEqual(ts.parse('00:14:32.480'), 872.48);
  assert.strictEqual(ts.parse('00:14:32,480'), 872.48);
  assert.strictEqual(ts.parse('01:02:03.4'), 3723.4);
  assert.strictEqual(ts.parse('01:02:03.04'), 3723.04);
});

test('parse rejects garbage', () => {
  assert.strictEqual(ts.parse(''), null);
  assert.strictEqual(ts.parse('abc'), null);
  assert.strictEqual(ts.parse('12:99'), null);
  assert.strictEqual(ts.parse('01:02:99'), null);
  assert.strictEqual(ts.parse('-10'), null);
  assert.strictEqual(ts.parse(null), null);
  assert.strictEqual(ts.parse(undefined), null);
});

test('parseInterval validates ordering', () => {
  assert.deepStrictEqual(ts.parseInterval({ start: '00:01:00', end: '00:01:30' }), { start: 60, end: 90 });
  assert.strictEqual(ts.parseInterval({ start: '00:01:30', end: '00:01:00' }), null);
  assert.strictEqual(ts.parseInterval({ start: '00:01:00', end: '00:01:00' }), null);
  assert.strictEqual(ts.parseInterval({}), null);
  assert.strictEqual(ts.parseInterval(null), null);
});

test('normalizeIntervals sorts, merges and drops', () => {
  const out = ts.normalizeIntervals([
    { start: '00:05:00', end: '00:05:10' },
    { start: '00:01:00', end: '00:01:30' },
    { start: '00:01:20', end: '00:02:00' },   // overlap -> merged
    { start: '00:03:00', end: '00:03:05' },   // 5s is fine (>= 0.1)
    { start: '00:04:00', end: '00:04:02.5' },
    { start: 'bad', end: '00:04:02.5' },      // dropped
    { start: '00:06:00', end: '00:06:00.05' } // too short -> dropped
  ]);
  assert.deepStrictEqual(out, [
    { start: 60, end: 120 },
    { start: 180, end: 185 },
    { start: 240, end: 242.5 },
    { start: 300, end: 310 }
  ]);
});

test('normalizeIntervals merges touching intervals', () => {
  const out = ts.normalizeIntervals([
    { start: 10, end: 20 },
    { start: 20, end: 30 }
  ]);
  assert.deepStrictEqual(out, [{ start: 10, end: 30 }]);
});

test('overlapsAny', () => {
  const list = [{ start: 10, end: 20 }, { start: 30, end: 40 }];
  assert.strictEqual(ts.overlapsAny(list, 15, 18), true);
  assert.strictEqual(ts.overlapsAny(list, 18, 25), true);
  assert.strictEqual(ts.overlapsAny(list, 20, 25), false);
  assert.strictEqual(ts.overlapsAny(list, 25, 30), false);
  assert.strictEqual(ts.overlapsAny(list, 35, 45), true);
  assert.strictEqual(ts.overlapsAny(list, 35, 45, 1), false);
});
