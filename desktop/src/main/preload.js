/*
 * Preload: exposes a minimal, promise-based API to the renderer.
 */
'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('jellymute', {
  pickVideo: () => ipcRenderer.invoke('dialog:pickVideo'),
  /** Resolve the absolute path of a File object from a drag-and-drop. */
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return null;
    }
  },
  loadVideo: (videoPath) => ipcRenderer.invoke('video:load', { videoPath }),
  getWaveform: (videoPath) => ipcRenderer.invoke('waveform:get', { videoPath }),
  onWaveformProgress: (cb) => {
    const handler = (_event, progress) => cb(progress);
    ipcRenderer.on('waveform:progress', handler);
    return () => ipcRenderer.removeListener('waveform:progress', handler);
  },
  saveSidecar: (sidecarPath, intervals, source) =>
    ipcRenderer.invoke('sidecar:save', { sidecarPath, intervals, source }),
  revealSidecar: (sidecarPath) => ipcRenderer.invoke('sidecar:reveal', { sidecarPath }),
  /** Fired when the app was launched with a video path on the command line. */
  onOpenFile: (cb) => {
    const handler = (_event, videoPath) => cb(videoPath);
    ipcRenderer.on('app:open-file', handler);
    return () => ipcRenderer.removeListener('app:open-file', handler);
  },
  appInfo: () => ipcRenderer.invoke('app:info')
});
