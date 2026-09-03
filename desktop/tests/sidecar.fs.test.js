'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sidecar = require('../src/main/sidecar');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jellymute-sidecar-'));
}

test('ensureForVideo creates an empty sidecar next to the video', () => {
  const dir = tmpDir();
  const videoPath = path.join(dir, 'Movie.mp4');
  fs.writeFileSync(videoPath, 'x');

  const first = sidecar.ensureForVideo(videoPath, 'JellyMute Desktop test');
  assert.strictEqual(first.createdNow, true);
  assert.strictEqual(first.sidecarPath, path.join(dir, 'Movie.mute'));
  assert.deepStrictEqual(first.intervals, []);
  assert.ok(fs.existsSync(first.sidecarPath));
  const content = JSON.parse(fs.readFileSync(first.sidecarPath, 'utf8'));
  assert.strictEqual(content.source, 'Movie.mp4');
  assert.deepStrictEqual(content.intervals, []);

  // second call finds the existing one
  const second = sidecar.ensureForVideo(videoPath, 'JellyMute Desktop test');
  assert.strictEqual(second.createdNow, false);
});

test('ensureForVideo picks up existing intervals', () => {
  const dir = tmpDir();
  const videoPath = path.join(dir, 'Show.mkv');
  fs.writeFileSync(videoPath, 'x');
  const sidecarPath = path.join(dir, 'Show.mute');
  fs.writeFileSync(sidecarPath, JSON.stringify([
    { start: '00:00:10', end: '00:00:12' },
    { start: 'bad', end: 'x' },
    { start: 60, end: 63 }
  ]));

  const res = sidecar.ensureForVideo(videoPath, 'test');
  assert.strictEqual(res.createdNow, false);
  assert.deepStrictEqual(res.intervals, [
    { start: 10, end: 12 },
    { start: 60, end: 63 }
  ]);
});

test('save writes intervals atomically and readIntervals round-trips', () => {
  const dir = tmpDir();
  const videoPath = path.join(dir, 'Film.mov');
  fs.writeFileSync(videoPath, 'x');
  const { sidecarPath } = sidecar.ensureForVideo(videoPath, 'test');

  sidecar.save(sidecarPath, [{ start: 30, end: 33.25 }], 'Film.mov', 'test');
  // no temp leftovers
  assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => f.includes('tmp')), []);

  assert.deepStrictEqual(sidecar.readIntervals(sidecarPath), [{ start: 30, end: 33.25 }]);
});

test('readIntervals returns [] for corrupt sidecars', () => {
  const dir = tmpDir();
  const sidecarPath = path.join(dir, 'X.mute');
  fs.writeFileSync(sidecarPath, '{not json');
  assert.deepStrictEqual(sidecar.readIntervals(sidecarPath), []);
});
