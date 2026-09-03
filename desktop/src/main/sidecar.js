/*
 * .mute sidecar file operations (fs layer on top of the pure format module).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const fmt = require('../shared/muteFormat');

const VIDEO_EXTS = new Set([
  '.mp4', '.m4v', '.mkv', '.webm', '.mov', '.avi', '.ts', '.m2ts',
  '.mpg', '.mpeg', '.wmv', '.flv', '.ogv'
]);

function isVideoFile(filePath) {
  return VIDEO_EXTS.has(path.extname(filePath).toLowerCase());
}

function exists(p) {
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Find an existing sidecar: "Movie.mute" first, then "Movie.mp4.mute". */
function findExisting(videoPath) {
  const primary = fmt.sidecarPathFor(videoPath, path);
  if (exists(primary)) return primary;
  const alt = fmt.altSidecarPathFor(videoPath);
  if (exists(alt)) return alt;
  return null;
}

/** Read + normalize intervals from a sidecar. Returns [] when missing/corrupt. */
function readIntervals(sidecarPath) {
  try {
    return fmt.parseIntervals(fs.readFileSync(sidecarPath, 'utf8'));
  } catch {
    return [];
  }
}

/**
 * Ensure a sidecar exists for the video (create an empty one when missing).
 * Returns { sidecarPath, createdNow, intervals }.
 */
function ensureForVideo(videoPath, generator) {
  const existing = findExisting(videoPath);
  if (existing) {
    return { sidecarPath: existing, createdNow: false, intervals: readIntervals(existing) };
  }
  const sidecarPath = fmt.sidecarPathFor(videoPath, path);
  const source = path.basename(videoPath);
  writeAtomic(sidecarPath, fmt.emptyFile(source, generator));
  return { sidecarPath, createdNow: true, intervals: [] };
}

function writeAtomic(targetPath, content) {
  const tmp = targetPath + '.jellymute-tmp';
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, targetPath);
}

/** Save intervals (seconds) to a sidecar atomically. */
function save(sidecarPath, intervals, source, generator) {
  writeAtomic(sidecarPath, fmt.serialize(intervals, source, generator));
  return new Date().toISOString();
}

module.exports = {
  VIDEO_EXTS,
  isVideoFile,
  findExisting,
  readIntervals,
  ensureForVideo,
  save,
  writeAtomic
};
