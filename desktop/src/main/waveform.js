/*
 * Audio waveform extraction: runs the bundled ffmpeg to convert the video's
 * first audio stream to mono 8 kHz 16-bit PCM, streamed into min/max peak
 * buckets (10 buckets/second). Results are cached on disk keyed by file
 * path+size+mtime so re-opening a movie is instant.
 */
'use strict';

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 8000;
const BUCKETS_PER_SEC = 10;
const SAMPLES_PER_BUCKET = SAMPLE_RATE / BUCKETS_PER_SEC;

let activeProc = null;
let activeToken = 0;
let cacheDir = null;

function initCacheDir(dir) {
  cacheDir = dir;
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* cache is best-effort */
  }
}

function cacheKeyFor(videoPath) {
  let stat;
  try {
    stat = fs.statSync(videoPath);
  } catch {
    stat = { size: 0, mtimeMs: 0 };
  }
  const hash = crypto.createHash('sha1');
  hash.update(path.resolve(videoPath));
  hash.update(`|${stat.size}|${Math.round(stat.mtimeMs)}`);
  return hash.digest('hex');
}

function readCache(videoPath) {
  if (!cacheDir) return null;
  try {
    const file = path.join(cacheDir, cacheKeyFor(videoPath) + '.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data && data.version === 1 && data.peaks && Array.isArray(data.peaks.min)) {
      return data;
    }
  } catch {
    /* fall through to extraction */
  }
  return null;
}

function writeCache(videoPath, result) {
  if (!cacheDir) return;
  try {
    const file = path.join(cacheDir, cacheKeyFor(videoPath) + '.json');
    fs.writeFileSync(file, JSON.stringify(result), 'utf8');
  } catch {
    /* best effort */
  }
}

function cancelActive() {
  activeToken++;
  if (activeProc) {
    try {
      activeProc.kill();
    } catch {
      /* ignore */
    }
    activeProc = null;
  }
}

/**
 * Extract waveform peaks for a video.
 * onProgress(0..1) is called with coarse progress while ffmpeg runs.
 * Resolves { peaks: {min,max}, duration, sampleRate, bucketsPerSec }.
 */
async function ensurePeaks(ffmpegPath, videoPath, onProgress) {
  const cached = readCache(videoPath);
  if (cached) return { ...cached, fromCache: true };

  cancelActive();
  const token = activeToken;
  const result = await extract(ffmpegPath, videoPath, onProgress, token);
  if (token !== activeToken) {
    const err = new Error('cancelled');
    err.cancelled = true;
    throw err;
  }
  writeCache(videoPath, result);
  return { ...result, fromCache: false };
}

function extract(ffmpegPath, videoPath, onProgress, token) {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner', '-nostats',
      '-i', videoPath,
      '-vn', '-sn', '-dn',
      '-map', '0:a:0',
      '-ac', '1',
      '-ar', String(SAMPLE_RATE),
      '-f', 's16le',
      '-'
    ];
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    activeProc = proc;

    let durationSec = null;
    let stderrText = '';
    let pending = Buffer.alloc(0);
    let totalSamples = 0;
    let bucketCount = 0;
    let bucketMin = 101;
    let bucketMax = -101;
    const mins = [];
    const maxs = [];

    const report = (frac) => {
      if (typeof onProgress === 'function') {
        try {
          onProgress(Math.max(0, Math.min(1, frac)));
        } catch {
          /* ignore */
        }
      }
    };

    const flushSample = (sample) => {
      const v = Math.round((sample / 32768) * 100);
      if (v < bucketMin) bucketMin = v;
      if (v > bucketMax) bucketMax = v;
      totalSamples++;
      if (totalSamples % SAMPLES_PER_BUCKET === 0) {
        mins.push(bucketMin);
        maxs.push(bucketMax);
        bucketCount++;
        bucketMin = 101;
        bucketMax = -101;
        if (durationSec) report((totalSamples / SAMPLE_RATE) / durationSec);
      }
    };

    proc.stdout.on('data', (chunk) => {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      const usable = pending.length - (pending.length % 2);
      for (let i = 0; i < usable; i += 2) {
        flushSample(pending.readInt16LE(i));
      }
      if (usable < pending.length) {
        pending = Buffer.from(pending.subarray(usable));
      } else {
        pending = Buffer.alloc(0);
      }
    });

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (stderrText.length < 20000) stderrText += text;
      if (durationSec === null) {
        const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderrText);
        if (m) durationSec = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
      }
      // "time=" lines appear per frame; parse the last one in this chunk
      const times = text.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g);
      if (times && durationSec && durationSec > 0) {
        const last = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(times[times.length - 1]);
        if (last) {
          const t = (+last[1]) * 3600 + (+last[2]) * 60 + (+last[3]);
          report(t / durationSec);
        }
      }
    });

    const finish = (code) => {
      if (token !== activeToken) {
        reject(cancelledError());
        return;
      }
      // flush the final partial bucket
      if (bucketMin <= 100) {
        mins.push(bucketMin);
        maxs.push(bucketMax);
      }
      activeProc = null;
      if (code !== 0 && totalSamples === 0) {
        const tail = stderrText.trim().split('\n').slice(-4).join(' ').trim();
        let msg = 'ffmpeg could not read an audio stream from this file.';
        if (/matches no streams/i.test(stderrText)) {
          msg = 'This file has no audio stream — nothing to build a waveform from.';
        } else if (/invalid data|error/i.test(stderrText) && tail) {
          msg = 'ffmpeg failed: ' + tail.slice(0, 300);
        }
        reject(new Error(msg));
        return;
      }
      const duration = totalSamples / SAMPLE_RATE;
      resolve({
        version: 1,
        peaks: { min: mins, max: maxs },
        duration,
        sampleRate: SAMPLE_RATE,
        bucketsPerSec: BUCKETS_PER_SEC
      });
    };

    proc.on('close', finish);
    proc.on('error', (err) => {
      activeProc = null;
      if (token === activeToken) reject(new Error('Could not run ffmpeg: ' + err.message));
    });
  });
}

function cancelledError() {
  const err = new Error('cancelled');
  err.cancelled = true;
  return err;
}

module.exports = {
  SAMPLE_RATE,
  BUCKETS_PER_SEC,
  initCacheDir,
  ensurePeaks,
  cancelActive
};
