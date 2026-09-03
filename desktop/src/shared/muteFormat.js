/*
 * Pure .mute sidecar format logic (parse/serialize/paths) — no Electron, no fs.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./timestamps'));
  } else {
    root.JellyMuteFormat = factory(root.JellyMuteTimestamps);
  }
})(typeof self !== 'undefined' ? self : this, function (ts) {
  'use strict';

  var FORMAT_VERSION = 1;

  function fallbackExtname(p) {
    var i = p.lastIndexOf('.');
    if (i <= 0 || i === p.length - 1) return '';
    var slash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    return i > slash ? p.slice(i) : '';
  }

  /** Uniform {extname, replaceExt} helpers over Node's path module or a naive fallback. */
  function makePath(pathMod) {
    var p = pathMod && (pathMod.win32 || pathMod);
    var extname = p && typeof p.extname === 'function' ? p.extname.bind(p) : fallbackExtname;
    return {
      extname: extname,
      replaceExt: function (file, ext) {
        var e = extname(file);
        return e ? file.slice(0, file.length - e.length) + ext : file + ext;
      }
    };
  }

  /** Video path -> sidecar path (extension replaced with .mute). */
  function sidecarPathFor(videoPath, pathMod) {
    return makePath(pathMod).replaceExt(videoPath, '.mute');
  }

  /** Fallback sidecar path (extension kept: "movie.mp4.mute"). */
  function altSidecarPathFor(videoPath) {
    return videoPath + '.mute';
  }

  /**
   * Parse sidecar text. Accepts the full object ({intervals:[...]}) or a bare
   * array. Returns normalized [{start,end}] in seconds. Throws on bad JSON.
   */
  function parseIntervals(text) {
    var data = JSON.parse(text);
    var raw = Array.isArray(data) ? data : data && data.intervals;
    return ts.normalizeIntervals(raw);
  }

  /**
   * Serialize sidecar content. `intervals` are {start,end} in seconds.
   * Milliseconds are only emitted when the value needs them.
   */
  function serialize(intervals, source, generator) {
    var clean = ts.normalizeIntervals(intervals);
    var payload = {
      version: FORMAT_VERSION,
      generator: generator || 'JellyMute Desktop',
      intervals: clean.map(function (iv) {
        return {
          start: ts.format(iv.start),
          end: ts.format(iv.end)
        };
      })
    };
    if (source) payload.source = source;
    return JSON.stringify(payload, null, 2) + '\n';
  }

  /** Empty sidecar content for a freshly loaded video. */
  function emptyFile(source, generator) {
    return serialize([], source, generator);
  }

  return {
    FORMAT_VERSION: FORMAT_VERSION,
    makePath: makePath,
    sidecarPathFor: sidecarPathFor,
    altSidecarPathFor: altSidecarPathFor,
    parseIntervals: parseIntervals,
    serialize: serialize,
    emptyFile: emptyFile
  };
});
