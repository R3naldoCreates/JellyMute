/*
 * Generates build/icon.png (512x512) without any image dependencies:
 * a dark rounded square with the JellyMute waveform bars (one red = muted).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 512;

/* ---------------- minimal PNG encoder ---------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------------- drawing helpers (2x2 supersampled) ---------------- */

function insideRoundedRect(x, y, x0, y0, x1, y1, r) {
  const dx = Math.max(x0 + r - x, x - (x1 - r), 0);
  const dy = Math.max(y0 + r - y, y - (y1 - r), 0);
  return dx * dx + dy * dy <= r * r;
}

function blend(dst, idx, color, alpha) {
  const a = alpha * color[3];
  dst[idx] = Math.round(dst[idx] * (1 - a) + color[0] * a);
  dst[idx + 1] = Math.round(dst[idx + 1] * (1 - a) + color[1] * a);
  dst[idx + 2] = Math.round(dst[idx + 2] * (1 - a) + color[2] * a);
  dst[idx + 3] = Math.min(255, dst[idx + 3] + a * 255);
}

function main() {
  const rgba = Buffer.alloc(SIZE * SIZE * 4); // transparent

  const bg = [22, 28, 35, 1];        // #161c23
  const cyan = [76, 194, 224, 1];    // #4cc2e0
  const red = [255, 95, 109, 1];     // #ff5f6d

  // SVG viewBox 24x24 scaled up
  const s = SIZE / 24;
  // [x, yTop, width, yBottom, color]
  const bars = [
    [1, 9, 2.6, 15, cyan],
    [6, 5, 2.6, 19, cyan],
    [11, 2, 2.6, 22, cyan],
    [16, 7, 2.6, 17, red],
    [21, 10, 2.6, 14, cyan]
  ];

  const PAD = 32;               // padding inside the icon
  const R = 100;                // background corner radius

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let covered = 0;
      let barAlpha = 0;
      let barColor = null;
      // 2x2 supersample
      for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const px = x + ox;
        const py = y + oy;
        if (!insideRoundedRect(px, py, PAD, PAD, SIZE - PAD, SIZE - PAD, R)) continue;
        covered++;
        for (const [bx, byTop, bw, byBot, color] of bars) {
          const x0 = PAD + bx * s;
          const x1 = PAD + (bx + bw) * s;
          const y0 = PAD + byTop * s;
          const y1 = PAD + byBot * s;
          if (insideRoundedRect(px, py, x0, y0, x1, y1, (x1 - x0) / 2)) {
            barAlpha++;
            barColor = color;
            break;
          }
        }
      }
      if (!covered) continue;
      const idx = (y * SIZE + x) * 4;
      blend(rgba, idx, bg, covered / 4);
      if (barAlpha) blend(rgba, idx, barColor, barAlpha / 4);
    }
  }

  const out = path.join(__dirname, '..', 'desktop', 'build', 'icon.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, encodePng(SIZE, SIZE, rgba));
  console.log('Wrote', out);
}

main();
