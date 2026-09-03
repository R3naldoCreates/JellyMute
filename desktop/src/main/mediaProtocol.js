/*
 * Custom "media://" protocol so the renderer can play local video files
 * (with range/seek support) without disabling web security.
 * Usage: media://video/?p=<encodeURIComponent(absolute path)>
 */
'use strict';

const { protocol } = require('electron');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const MIME = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.ts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
  '.ogv': 'video/ogg'
};

function registerSchemes() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'media',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ]);
}

function mediaUrlFor(filePath) {
  return 'media://video/?p=' + encodeURIComponent(filePath);
}

function registerMediaProtocol() {
  protocol.handle('media', (request) => handleRequest(request));
}

function errorResponse(status, message) {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

async function handleRequest(request) {
  let filePath;
  try {
    const u = new URL(request.url);
    filePath = path.normalize(decodeURIComponent(u.searchParams.get('p') || ''));
  } catch {
    return errorResponse(400, 'Bad media URL');
  }
  if (!filePath) return errorResponse(400, 'Missing path');

  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return errorResponse(404, 'File not found');
  }
  if (!stat.isFile()) return errorResponse(404, 'Not a file');

  const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  const baseHeaders = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store'
  };

  const rangeHeader = request.headers.get('Range');
  if (rangeHeader) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    let start = m && m[1] !== '' ? parseInt(m[1], 10) : 0;
    let end = m && m[2] !== '' ? parseInt(m[2], 10) : stat.size - 1;
    if (!Number.isFinite(start) || start < 0) start = 0;
    if (!Number.isFinite(end) || end >= stat.size) end = stat.size - 1;
    if (start > end) start = Math.max(0, end);
    const stream = fs.createReadStream(filePath, { start, end });
    return new Response(Readable.toWeb(stream), {
      status: 206,
      headers: {
        ...baseHeaders,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': String(end - start + 1)
      }
    });
  }

  const stream = fs.createReadStream(filePath);
  return new Response(Readable.toWeb(stream), {
    status: 200,
    headers: { ...baseHeaders, 'Content-Length': String(stat.size) }
  });
}

module.exports = { registerSchemes, registerMediaProtocol, mediaUrlFor };
