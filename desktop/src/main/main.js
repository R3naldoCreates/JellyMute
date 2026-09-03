/*
 * JellyMute Desktop — Electron main process.
 */
'use strict';

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const ffmpegStatic = require('ffmpeg-static');
const { registerSchemes, registerMediaProtocol } = require('./mediaProtocol');
const sidecar = require('./sidecar');
const waveform = require('./waveform');

const APP_NAME = 'JellyMute';
const GENERATOR = `JellyMute Desktop ${app.getVersion()}`;

// 2D waveform app — software rendering avoids black-window GPU driver issues.
app.disableHardwareAcceleration();

// Optional diagnostics: set JELLYMUTE_DEBUG=1 to capture renderer logs.
if (process.env.JELLYMUTE_DEBUG) {
  const logPath = () => path.join(app.getPath('userData'), 'jellymute-debug.log');
  const writeLog = (line) => {
    try {
      fs.appendFileSync(logPath(), `[${new Date().toISOString()}] ${line}\n`);
    } catch {
      /* ignore */
    }
  };
  app.whenReady().then(() => {
    try {
      fs.writeFileSync(logPath(), `--- JellyMute debug session ${new Date().toISOString()} ---\n`);
    } catch {
      /* ignore */
    }
  });
  app.on('web-contents-created', (_e, contents) => {
    contents.on('console-message', (_ev, level, message, line, sourceId) => {
      writeLog(`console[${level}] ${message} (${sourceId}:${line})`);
    });
    contents.on('did-fail-load', (_ev, code, desc, url) => {
      writeLog(`did-fail-load ${code} ${desc} ${url}`);
    });
    contents.on('render-process-gone', (_ev, details) => {
      writeLog(`render-process-gone ${JSON.stringify(details)}`);
    });
  });
}

// Keep a reference so the window is not garbage collected.
let win = null;

registerSchemes();

function cacheDir() {
  return path.join(app.getPath('userData'), 'waveform-cache');
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#0f1318',
    autoHideMenuBar: true,
    title: APP_NAME,
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Allow launching with a video: JellyMute.exe "C:\Movies\Movie.mp4"
  const argFile = process.argv
    .slice(app.isPackaged ? 1 : 2)
    .find((a) => sidecar.isVideoFile(a) && fs.existsSync(a));
  if (argFile) {
    win.webContents.once('did-finish-load', () => {
      win.webContents.send('app:open-file', path.resolve(argFile));
    });
  }

  win.on('closed', () => {
    win = null;
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    registerMediaProtocol();
    waveform.initCacheDir(cacheDir());
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  waveform.cancelActive();
  app.quit();
});

/* ------------------------------------------------------------------ */
/* IPC                                                                  */
/* ------------------------------------------------------------------ */

ipcMain.handle('app:info', () => ({
  name: APP_NAME,
  version: app.getVersion(),
  ffmpeg: !!ffmpegStatic
}));

ipcMain.handle('dialog:pickVideo', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Open a video',
    properties: ['openFile'],
    filters: [
      { name: 'Videos', extensions: [...sidecar.VIDEO_EXTS].map((e) => e.slice(1)) },
      { name: 'All files', extensions: ['*'] }
    ]
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('video:load', (_event, { videoPath }) => {
  try {
    if (!videoPath || !sidecar.isVideoFile(videoPath)) {
      return { ok: false, error: 'That does not look like a video file.' };
    }
    if (!fs.existsSync(videoPath)) {
      return { ok: false, error: 'The file no longer exists.' };
    }
    const prepared = sidecar.ensureForVideo(videoPath, GENERATOR);
    return {
      ok: true,
      path: videoPath,
      name: path.basename(videoPath),
      dir: path.dirname(videoPath),
      sidecarPath: prepared.sidecarPath,
      sidecarCreatedNow: prepared.createdNow,
      intervals: prepared.intervals
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('waveform:get', async (event, { videoPath }) => {
  const sender = event.sender;
  const report = (p) => {
    if (!sender.isDestroyed()) sender.send('waveform:progress', p);
  };
  try {
    const result = await waveform.ensurePeaks(ffmpegStatic, videoPath, report);
    report(1);
    return { ok: true, ...result };
  } catch (err) {
    if (err && err.cancelled) return { ok: false, cancelled: true };
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('sidecar:save', (_event, { sidecarPath, intervals, source }) => {
  try {
    const savedAt = sidecar.save(sidecarPath, intervals, source, GENERATOR);
    return { ok: true, savedAt };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('sidecar:reveal', (_event, { sidecarPath }) => {
  if (fs.existsSync(sidecarPath)) shell.showItemInFolder(sidecarPath);
  return true;
});
