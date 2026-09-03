'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fmt = require('../src/shared/muteFormat');

test('sidecarPathFor replaces the extension', () => {
  assert.strictEqual(fmt.sidecarPathFor('C:\\Movies\\Movie.mp4', path), 'C:\\Movies\\Movie.mute');
  assert.strictEqual(fmt.sidecarPathFor('C:\\Movies\\Movie (2024).mkv', path), 'C:\\Movies\\Movie (2024).mute');
  assert.strictEqual(fmt.sidecarPathFor('/media/Movie (2024).mp4', path), '/media/Movie (2024).mute');
  assert.strictEqual(fmt.sidecarPathFor('/media/noext', path), '/media/noext.mute');
  // dotfiles / double dots
  assert.strictEqual(fmt.sidecarPathFor('/media/trailer.2024.remaster.mp4', path), '/media/trailer.2024.remaster.mute');
});

test('altSidecarPathFor appends', () => {
  assert.strictEqual(fmt.altSidecarPathFor('C:\\Movies\\Movie.mp4'), 'C:\\Movies\\Movie.mp4.mute');
});

test('parse accepts wrapped object and bare array', () => {
  const wrapped = JSON.stringify({
    version: 1,
    generator: 'JellyMute Desktop',
    source: 'Movie.mp4',
    intervals: [{ start: '00:14:32.480', end: '00:14:35.120' }]
  });
  assert.deepStrictEqual(fmt.parseIntervals(wrapped), [{ start: 872.48, end: 875.12 }]);

  const bare = JSON.stringify([{ start: '00:01:00', end: '00:01:30' }]);
  assert.deepStrictEqual(fmt.parseIntervals(bare), [{ start: 60, end: 90 }]);
});

test('parse throws on invalid JSON', () => {
  assert.throws(() => fmt.parseIntervals('{nope'));
});

test('serialize writes ms only when needed and normalizes', () => {
  const text = fmt.serialize(
    [
      { start: 872.48, end: 875.12 },
      { start: 3720, end: 3723 }
    ],
    'Movie.mp4',
    'JellyMute Desktop 1.0.0'
  );
  const data = JSON.parse(text);
  assert.strictEqual(data.version, 1);
  assert.strictEqual(data.source, 'Movie.mp4');
  assert.strictEqual(data.generator, 'JellyMute Desktop 1.0.0');
  assert.deepStrictEqual(data.intervals, [
    { start: '00:14:32.480', end: '00:14:35.120' },
    { start: '01:02:00', end: '01:02:03' }
  ]);
  // serialized output must round-trip
  assert.deepStrictEqual(fmt.parseIntervals(text), [
    { start: 872.48, end: 875.12 },
    { start: 3720, end: 3723 }
  ]);
});

test('serialize drops overlaps and sorts', () => {
  const text = fmt.serialize(
    [
      { start: 300, end: 310 },
      { start: 100, end: 120 },
      { start: 110, end: 115 }
    ],
    'Movie.mp4'
  );
  assert.deepStrictEqual(fmt.parseIntervals(text), [
    { start: 100, end: 120 },
    { start: 300, end: 310 }
  ]);
});

test('emptyFile produces a valid empty sidecar', () => {
  const text = fmt.emptyFile('Movie.mp4');
  const data = JSON.parse(text);
  assert.deepStrictEqual(data.intervals, []);
  assert.strictEqual(data.source, 'Movie.mp4');
});
