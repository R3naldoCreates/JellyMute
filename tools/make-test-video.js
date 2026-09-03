/*
 * Generates a test video with beeps at known times, for verifying the
 * waveform pipeline and mute intervals:
 *   silence 0-5s, beep 5-8s, silence 8-20s, beep 20-23s, silence 23-30s.
 * Usage: node tools/make-test-video.js [output.mp4]
 */
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const ffmpeg = require(path.join(__dirname, '..', 'desktop', 'node_modules', 'ffmpeg-static'));

const out = process.argv[2] || path.join(__dirname, '..', 'test-media', 'Movie.mp4');

const volExpr =
  "if(lt(t,5),0,if(lt(t,8),1,if(lt(t,20),0,if(lt(t,23),1,0))))*4.8";

const args = [
  '-y',
  '-f', 'lavfi', '-i', 'testsrc=duration=30:size=640x360:rate=25',
  '-f', 'lavfi', '-i', `sine=frequency=880:duration=30`,
  '-af', `volume=volume='${volExpr}':eval=frame`,
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast',
  '-c:a', 'aac', '-b:a', '128k',
  '-shortest',
  out
];

const res = spawnSync(ffmpeg, args, { stdio: 'inherit', windowsHide: true });
process.exit(res.status ?? 1);
