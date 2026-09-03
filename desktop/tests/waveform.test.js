'use strict';
// Integration test: extracts real waveform peaks via the bundled ffmpeg.
// Skipped when the ffmpeg binary is not installed (e.g. fresh CI checkout).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let ffmpegPath = null;
try {
  ffmpegPath = require('ffmpeg-static');
  if (ffmpegPath && !fs.existsSync(ffmpegPath)) ffmpegPath = null;
} catch {
  ffmpegPath = null;
}

const waveform = require('../src/main/waveform');

test('waveform extraction produces peaks and duration', { skip: !ffmpegPath && 'ffmpeg-static binary not installed' }, async () => {
  const videoPath = path.join(__dirname, '..', '..', 'test-media', 'Movie.mp4');
  if (!fs.existsSync(videoPath)) {
    test.skip('test video not generated yet');
    return;
  }
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jellymute-wave-'));
  waveform.initCacheDir(cacheDir);

  let progressCalls = 0;
  const first = await waveform.ensurePeaks(ffmpegPath, videoPath, () => progressCalls++);
  assert.strictEqual(first.fromCache, false);
  assert.ok(first.duration > 29 && first.duration < 31, 'duration ~30s, got ' + first.duration);
  assert.ok(first.peaks.min.length === first.peaks.max.length);
  assert.ok(first.peaks.min.length > 29 * 9, 'about 10 buckets per second');
  assert.ok(progressCalls > 0, 'progress was reported');

  // loudness: buckets inside the 5-8s beep must be louder than 9-11s silence
  const loud = (t) => Math.max(...first.peaks.max.slice(Math.floor((t) * 10), Math.floor((t + 1) * 10)));
  assert.ok(loud(6) > 30, 'beep at 6s should be loud, got ' + loud(6));
  assert.ok(loud(10) < 5, '10s should be silent, got ' + loud(10));

  // second run must come from cache
  const second = await waveform.ensurePeaks(ffmpegPath, videoPath, null);
  assert.strictEqual(second.fromCache, true);
  assert.deepStrictEqual(second.peaks.min, first.peaks.min);
});

test('waveform rejects files without an audio stream', { skip: !ffmpegPath && 'ffmpeg-static binary not installed' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jellymute-noaudio-'));
  const silent = path.join(dir, 'silent.mp4');
  const { execFileSync } = require('child_process');
  execFileSync(ffmpegPath, [
    '-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=160x120:rate=10',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', silent
  ], { stdio: 'ignore', windowsHide: true });
  waveform.initCacheDir(dir);

  await assert.rejects(
    () => waveform.ensurePeaks(ffmpegPath, silent, null),
    /no audio stream/i
  );
});
