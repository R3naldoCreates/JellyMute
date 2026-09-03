/* Adds [JellyMute] console diagnostics to ClientScript.js (dev-time aid). */
'use strict';
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'plugin', 'JellyMute', 'Web', 'ClientScript.js');
let s = fs.readFileSync(file, 'utf8');
const before = s;

const edits = [
  // 1. log helper after the GUID constant
  [
    "    var GUID = '[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';",
    "    var GUID = '[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';\n" +
    "\n" +
    "    function log() {\n" +
    "        try {\n" +
    "            var args = ['[JellyMute]'].concat(Array.prototype.slice.call(arguments));\n" +
    "            console.debug.apply(console, args);\n" +
    "        } catch (e) {\n" +
    "            /* ignore */\n" +
    "        }\n" +
    "    }"
  ],
  // 2. log interval fetch results (cache write site)
  [
    "                intervalsCache[itemId] = { at: now, intervals: list };\n                return list;",
    "                intervalsCache[itemId] = { at: now, intervals: list };\n" +
    "                if (list) {\n" +
    "                    log('item', itemId, '->', list.length, 'intervals');\n" +
    "                } else {\n" +
    "                    log('item', itemId, '-> no .mute sidecar found by the server');\n" +
    "                }\n" +
    "                return list;"
  ],
  // 3. log playback bind
  [
    "        fetchIntervals(itemId).then(function (intervals) {\n            // a newer bind (source change / new episode) supersedes this one\n            if (token === playback.bindToken) {\n                playback.intervals = intervals;\n            }\n        });",
    "        log('playback: binding video, item', itemId, 'enabled:', playback.enabled);\n" +
    "        fetchIntervals(itemId).then(function (intervals) {\n" +
    "            // a newer bind (source change / new episode) supersedes this one\n" +
    "            if (token === playback.bindToken) {\n" +
    "                playback.intervals = intervals;\n" +
    "                if (!intervals) {\n" +
    "                    log('playback: no intervals for this item; muting disabled');\n" +
    "                }\n" +
    "            }\n" +
    "        });"
  ],
  // 4. log mute enter
  [
    "                            video.muted = true;\n                            setIndicator(video, true);\n                        }",
    "                            video.muted = true;\n" +
    "                            setIndicator(video, true);\n" +
    "                            log('mute ON at', t.toFixed(2));\n" +
    "                        }"
  ],
  // 5. log mute exit
  [
    "    function restoreMute(video) {\n        if (playback.weMuted) {",
    "    function restoreMute(video) {\n        if (playback.weMuted) {\n            log('mute OFF');"
  ]
];

let applied = 0;
for (const [needle, replacement] of edits) {
  if (s.includes(needle)) {
    s = s.split(needle).join(replacement);
    applied++;
  } else {
    console.error('PATTERN NOT FOUND:', needle.slice(0, 60).replace(/\n/g, '\\n'));
  }
}

if (s !== before) {
  fs.writeFileSync(file, s);
}
console.log('applied', applied, 'of', edits.length, 'edits');
