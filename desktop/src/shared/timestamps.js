/*
 * Timestamp helpers shared between the Electron main process and the renderer.
 * UMD-ish so it loads via require() and via a plain <script> tag.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.JellyMuteTimestamps = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MS_PER_HOUR = 3600000;
  var MS_PER_MIN = 60000;
  var MS_PER_SEC = 1000;

  function pad(n, width) {
    var s = String(n);
    while (s.length < width) s = '0' + s;
    return s;
  }

  /**
   * Format seconds as HH:MM:SS, or HH:MM:SS.mmm when the value has a
   * sub-second component (milliseconds are only included when needed).
   */
  function format(seconds, opts) {
    if (seconds === null || seconds === undefined || !isFinite(seconds)) return '';
    var ms = Math.round(seconds * 1000);
    if (ms < 0) ms = 0;
    var h = Math.floor(ms / MS_PER_HOUR);
    var m = Math.floor((ms % MS_PER_HOUR) / MS_PER_MIN);
    var s = Math.floor((ms % MS_PER_MIN) / MS_PER_SEC);
    var rem = ms % MS_PER_SEC;
    var base = pad(h, 2) + ':' + pad(m, 2) + ':' + pad(s, 2);
    if (rem > 0 || (opts && opts.forceMillis)) return base + '.' + pad(rem, 3);
    return base;
  }

  /**
   * Parse a timestamp or plain number of seconds.
   * Accepts: 90 | "90.5" | "MM:SS" | "H:MM:SS" | "HH:MM:SS" with optional
   * ".fff" or ",fff" fractional part. Returns seconds (float) or null.
   */
  function parse(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') {
      if (!isFinite(value) || value < 0) return null;
      return value;
    }
    var str = String(value).trim();
    if (!str) return null;
    if (/^\d+(\.\d+)?$/.test(str)) {
      var plain = parseFloat(str);
      return isFinite(plain) && plain >= 0 ? plain : null;
    }
    var m = /^(?:(\d+)\s*:\s*)?(\d{1,2})\s*:\s*(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(str);
    if (!m) return null;
    var h = m[1] !== undefined ? parseInt(m[1], 10) : 0;
    var min = parseInt(m[2], 10);
    var sec = parseInt(m[3], 10);
    var frac = m[4] !== undefined ? parseInt(m[4].padEnd(3, '0'), 10) : 0;
    if (min > 59 || sec > 59) return null;
    return h * 3600 + min * 60 + sec + frac / 1000;
  }

  /** Parse an interval object {start,end}; returns {start,end} in seconds or null. */
  function parseInterval(obj) {
    if (!obj || typeof obj !== 'object') return null;
    var start = parse(obj.start);
    var end = parse(obj.end);
    if (start === null || end === null) return null;
    if (end <= start) return null;
    return { start: start, end: end };
  }

  /**
   * Normalize a raw interval list: parse, drop invalid/too-short entries,
   * sort by start and merge overlaps. Returns clean [{start,end}] in seconds.
   */
  function normalizeIntervals(raw, opts) {
    var minLength = opts && typeof opts.minLength === 'number' ? opts.minLength : 0.1;
    var out = [];
    if (!Array.isArray(raw)) return out;
    for (var i = 0; i < raw.length; i++) {
      var iv = parseInterval(raw[i]);
      if (iv && iv.end - iv.start >= minLength) out.push(iv);
    }
    out.sort(function (a, b) { return a.start - b.start || a.end - b.end; });
    var merged = [];
    for (var j = 0; j < out.length; j++) {
      var cur = out[j];
      var last = merged[merged.length - 1];
      if (last && cur.start <= last.end) {
        if (cur.end > last.end) last.end = cur.end;
      } else {
        merged.push({ start: cur.start, end: cur.end });
      }
    }
    return merged;
  }

  /** True if [start,end) would overlap any interval in the sorted list. */
  function overlapsAny(intervals, start, end, ignoreIndex) {
    for (var i = 0; i < intervals.length; i++) {
      if (i === ignoreIndex) continue;
      var iv = intervals[i];
      if (start < iv.end && end > iv.start) return true;
    }
    return false;
  }

  return {
    format: format,
    parse: parse,
    parseInterval: parseInterval,
    normalizeIntervals: normalizeIntervals,
    overlapsAny: overlapsAny
  };
});
