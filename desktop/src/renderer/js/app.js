/*
 * JellyMute Desktop — renderer application logic.
 */
(function () {
  'use strict';

  const TS = window.JellyMuteTimestamps;
  const WaveformView = window.JellyMuteWaveformView;

  /* ------------------------------------------------------------------ */
  /* State                                                               */
  /* ------------------------------------------------------------------ */

  const S = {
    videoPath: null,
    name: '',
    dir: '',
    sidecarPath: null,
    intervals: [],
    duration: 0,
    peaks: null,
    playheadTime: 0,
    selected: -1,
    previewMutes: false,
    userMuted: false,
    videoBroken: false,
    markAnchor: null,
    fitted: false,
    moveOrig: null,
    loadSeq: 0
  };

  /* ------------------------------------------------------------------ */
  /* DOM                                                                 */
  /* ------------------------------------------------------------------ */

  const $ = (id) => document.getElementById(id);
  const els = {
    emptyState: $('empty-state'),
    workspace: $('workspace'),
    dropOverlay: $('drop-overlay'),
    video: $('video'),
    videoError: $('video-error'),
    muteIndicator: $('mute-indicator'),
    fileTitle: $('file-title'),
    saveStatus: $('save-status'),
    btnOpen: $('btn-open'),
    btnOpenEmpty: $('btn-open-empty'),
    btnReveal: $('btn-reveal'),
    btnPlay: $('btn-play'),
    btnBack10: $('btn-back10'),
    btnBack1: $('btn-back1'),
    btnFwd1: $('btn-fwd1'),
    btnFwd10: $('btn-fwd10'),
    btnMute: $('btn-mute'),
    volume: $('volume'),
    speed: $('speed-select'),
    timeDisplay: $('time-display'),
    btnMarkStart: $('btn-mark-start'),
    btnMarkEnd: $('btn-mark-end'),
    markHint: $('mark-hint'),
    btnAdd: $('btn-add'),
    cbPreview: $('cb-preview'),
    intervalList: $('interval-list'),
    intervalCount: $('interval-count'),
    intervalEmpty: $('interval-empty'),
    waveMain: $('wave-main'),
    waveOverview: $('wave-overview'),
    waveProgress: $('wave-progress'),
    waveProgressBar: $('wave-progress-bar'),
    statusVideo: $('status-video'),
    statusSidecar: $('status-sidecar'),
    toast: $('toast')
  };

  const video = els.video;

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */

  let toastTimer = null;
  function toast(message, isError) {
    els.toast.textContent = message;
    els.toast.classList.toggle('error', !!isError);
    els.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.add('hidden'), isError ? 5000 : 3000);
  }

  function setSaveStatus(state, detail) {
    els.saveStatus.classList.remove('hidden', 'saved', 'error');
    if (state === 'saving') {
      els.saveStatus.textContent = 'Saving…';
    } else if (state === 'saved') {
      els.saveStatus.classList.add('saved');
      els.saveStatus.textContent = '.mute saved ✓';
    } else if (state === 'created') {
      els.saveStatus.classList.add('saved');
      els.saveStatus.textContent = '.mute created ✓';
    } else if (state === 'error') {
      els.saveStatus.classList.add('error');
      els.saveStatus.textContent = 'Save failed: ' + (detail || '');
    }
  }

  function findIntervalAt(t) {
    for (const iv of S.intervals) {
      if (t >= iv.start && t < iv.end) return iv;
      if (iv.start > t) break;
    }
    return null;
  }

  function mediaUrlFor(p) {
    return 'media://video/?p=' + encodeURIComponent(p);
  }

  /* ------------------------------------------------------------------ */
  /* Save queue (auto-save sidecar)                                      */
  /* ------------------------------------------------------------------ */

  let saveTimer = null;
  function scheduleSave() {
    setSaveStatus('saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(doSave, 400);
  }

  async function doSave() {
    if (!S.sidecarPath) return;
    const res = await window.jellymute.saveSidecar(S.sidecarPath, S.intervals, S.name);
    if (res && res.ok) setSaveStatus('saved');
    else setSaveStatus('error', res && res.error);
  }

  /* ------------------------------------------------------------------ */
  /* Interval operations                                                 */
  /* ------------------------------------------------------------------ */

  function sortIntervals() {
    S.intervals.sort((a, b) => a.start - b.start || a.end - b.end);
  }

  function createInterval(start, end) {
    if (!S.sidecarPath) return;
    const d = S.duration;
    start = Math.max(0, Math.min(start, d));
    end = Math.max(0, Math.min(end, d));
    if (end - start < 0.05) {
      toast('That interval is too short (minimum 0.05 s).', true);
      return;
    }
    if (TS.overlapsAny(S.intervals, start, end)) {
      toast('That overlaps an existing interval.', true);
      return;
    }
    S.intervals.push({ start, end });
    sortIntervals();
    S.selected = S.intervals.findIndex((iv) => iv.start === start && iv.end === end);
    S.markAnchor = null;
    updateMarkHint();
    renderIntervals();
    view.redraw();
    scheduleSave();
  }

  function deleteInterval(index) {
    if (index < 0 || index >= S.intervals.length) return;
    S.intervals.splice(index, 1);
    if (S.selected === index) S.selected = -1;
    else if (S.selected > index) S.selected--;
    renderIntervals();
    view.redraw();
    scheduleSave();
  }

  /** Live-adjust an interval edge while dragging (already clamped here). */
  function applyHandle(index, which, t) {
    const iv = S.intervals[index];
    if (!iv) return;
    const d = S.duration;
    if (which === 'start') {
      const lower = index > 0 ? S.intervals[index - 1].end + 0.05 : 0;
      iv.start = Math.max(lower, Math.min(t, iv.end - 0.1));
    } else {
      const upper = index < S.intervals.length - 1 ? S.intervals[index + 1].start - 0.05 : d;
      iv.end = Math.min(upper, Math.max(t, iv.start + 0.1));
    }
    view.redraw();
  }

  /** Live-move a whole interval while dragging (delta from drag start). */
  function applyMove(index, dt) {
    const iv = S.intervals[index];
    if (!iv) return;
    if (!S.moveOrig) S.moveOrig = { start: iv.start, end: iv.end };
    const d = S.duration;
    const len = S.moveOrig.end - S.moveOrig.start;
    const lower = index > 0 ? S.intervals[index - 1].end + 0.05 : 0;
    const upper = index < S.intervals.length - 1 ? S.intervals[index + 1].start - len - 0.05 : d - len;
    let start = S.moveOrig.start + dt;
    start = Math.max(lower, Math.min(start, Math.max(lower, upper)));
    iv.start = start;
    iv.end = start + len;
    view.redraw();
  }

  /** Commit an edit made by dragging: normalize, re-render, save. */
  function commitEdit() {
    S.moveOrig = null;
    sortIntervals();
    renderIntervals();
    view.redraw();
    scheduleSave();
  }

  function select(index) {
    S.selected = index;
    renderIntervals();
    view.redraw();
  }

  /* ------------------------------------------------------------------ */
  /* Interval list                                                       */
  /* ------------------------------------------------------------------ */

  function renderIntervals() {
    els.intervalCount.textContent = String(S.intervals.length);
    els.intervalEmpty.classList.toggle('hidden', S.intervals.length > 0);
    els.intervalList.textContent = '';

    S.intervals.forEach((iv, i) => {
      const li = document.createElement('li');
      if (i === S.selected) li.classList.add('selected');

      const idx = document.createElement('span');
      idx.className = 'iv-index';
      idx.textContent = String(i + 1);

      const times = document.createElement('span');
      times.className = 'iv-times';
      const startStr = TS.format(iv.start, { forceMillis: true });
      const endStr = TS.format(iv.end, { forceMillis: true });
      times.textContent = `${startStr} → ${endStr}`;

      const dur = document.createElement('span');
      dur.className = 'iv-dur';
      dur.textContent = (iv.end - iv.start).toFixed(2) + 's';

      const btnJump = document.createElement('button');
      btnJump.className = 'btn subtle small';
      btnJump.textContent = '⏵';
      btnJump.title = 'Jump to start of this interval';
      btnJump.addEventListener('click', (e) => {
        e.stopPropagation();
        seek(iv.start + 0.02);
      });

      const btnDel = document.createElement('button');
      btnDel.className = 'btn subtle small';
      btnDel.textContent = '✕';
      btnDel.title = 'Delete this interval';
      btnDel.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteInterval(i);
      });

      li.append(idx, times, dur, btnJump, btnDel);
      li.addEventListener('click', () => {
        select(i);
        seek(iv.start + 0.02);
      });
      els.intervalList.appendChild(li);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Playback & transport                                                */
  /* ------------------------------------------------------------------ */

  function seek(t) {
    const d = S.duration;
    t = Math.max(0, Math.min(t, d || 0));
    S.playheadTime = t;
    if (!S.videoBroken && video.readyState >= 1) {
      try {
        video.currentTime = t;
      } catch {
        /* seek before metadata — playhead still moves */
      }
    }
    view.redraw();
    updateTimeDisplay();
  }

  function togglePlay() {
    if (S.videoBroken || !S.duration) {
      toast("This file can't be previewed — mark intervals on the waveform instead.");
      return;
    }
    if (video.paused || video.ended) video.play().catch(() => {});
    else video.pause();
  }

  function updateTimeDisplay() {
    els.timeDisplay.textContent =
      TS.format(S.playheadTime, { forceMillis: true }) + ' / ' + TS.format(S.duration);
  }

  function jumpToInterval(dir) {
    if (!S.intervals.length) return;
    const t = S.playheadTime;
    let target = null;
    if (dir < 0) {
      for (let i = S.intervals.length - 1; i >= 0; i--) {
        if (S.intervals[i].start < t - 0.05) { target = S.intervals[i]; break; }
      }
    } else {
      for (const iv of S.intervals) {
        if (iv.start > t + 0.05) { target = iv; break; }
      }
    }
    if (target) seek(target.start + 0.02);
  }

  /* Mark start / end at playhead */
  function markStart() {
    S.markAnchor = S.playheadTime;
    updateMarkHint();
    view.redraw();
  }

  function markEnd() {
    if (S.markAnchor == null) {
      toast('Mark a start point first (S or “Mark Start”).', true);
      return;
    }
    if (S.playheadTime - S.markAnchor < 0.05) {
      toast('The end must come after the start — let it play a little longer.', true);
      return;
    }
    createInterval(S.markAnchor, S.playheadTime);
  }

  function updateMarkHint() {
    if (S.markAnchor == null) {
      els.markHint.textContent =
        'Right-click the waveform to drop a marker · right-drag its edges to trim · left-drag pans · S/E mark while listening.';
      els.btnMarkStart.classList.add('primary');
      els.btnMarkStart.style.background = '';
    } else {
      els.markHint.textContent =
        'Start marked at ' + TS.format(S.markAnchor, { forceMillis: true }) +
        ' — now press Mark End (E) at the finish point. (Esc cancels)';
      els.btnMarkStart.classList.remove('primary');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Animation loop (playhead + preview mutes)                           */
  /* ------------------------------------------------------------------ */

  let lastDrawnTime = -1;

  function tick() {
    if (!S.videoBroken && video.readyState >= 2) {
      S.playheadTime = video.currentTime;
    }

    // preview muting during normal playback
    const activeIv = S.previewMutes ? findIntervalAt(S.playheadTime) : null;
    const wantMuted = S.userMuted || !!activeIv;
    if (!S.videoBroken && video.muted !== wantMuted) video.muted = wantMuted;
    els.muteIndicator.classList.toggle('hidden', !activeIv);

    if (video.paused === false || Math.abs(S.playheadTime - lastDrawnTime) > 0.001) {
      lastDrawnTime = S.playheadTime;
      updateTimeDisplay();
      view.redraw();
    }
    requestAnimationFrame(tick);
  }

  /* ------------------------------------------------------------------ */
  /* Loading                                                             */
  /* ------------------------------------------------------------------ */

  async function loadVideoPath(p) {
    const res = await window.jellymute.loadVideo(p);
    if (!res || !res.ok) {
      toast((res && res.error) || 'Could not open that file.', true);
      return;
    }

    S.loadSeq++;
    video.pause();
    S.videoBroken = false;
    els.videoError.classList.add('hidden');
    S.peaks = null;
    S.intervals = res.intervals || [];
    S.selected = -1;
    S.markAnchor = null;
    S.moveOrig = null;
    S.fitted = false;
    S.playheadTime = 0;
    S.duration = 0;
    S.userMuted = false;
    S.videoPath = res.path;
    S.name = res.name;
    S.dir = res.dir;
    S.sidecarPath = res.sidecarPath;
    lastDrawnTime = -1;

    els.emptyState.classList.add('hidden');
    els.workspace.classList.remove('hidden');
    els.fileTitle.classList.remove('hidden');
    els.fileTitle.textContent = res.name;
    els.fileTitle.title = res.path;
    els.btnReveal.classList.remove('hidden');
    els.statusVideo.textContent = 'Video: ' + res.path;
    els.statusVideo.title = res.path;
    els.statusSidecar.textContent = 'Mute file: ' + res.sidecarPath;
    els.statusSidecar.title = res.sidecarPath;

    if (res.sidecarCreatedNow) {
      setSaveStatus('created');
      toast('Created ' + res.name.replace(/\.[^.]+$/, '') + '.mute next to your video.');
    } else if (S.intervals.length) {
      setSaveStatus('saved');
    } else {
      setSaveStatus('saved');
    }

    renderIntervals();
    updateMarkHint();
    view.redraw();

    video.src = mediaUrlFor(res.path);
    video.load();

    loadWaveform(res.path, S.loadSeq);
  }

  async function loadWaveform(videoPath, seq) {
    els.waveProgress.classList.remove('hidden');
    els.waveProgressBar.value = 0;
    const unsub = window.jellymute.onWaveformProgress((p) => {
      els.waveProgressBar.value = p;
    });
    try {
      const res = await window.jellymute.getWaveform(videoPath);
      if (seq !== S.loadSeq) return; // superseded by another load
      if (!res.ok) {
        if (!res.cancelled) toast(res.error || 'Could not analyze the audio.', true);
        return;
      }
      S.peaks = {
        min: res.peaks.min,
        max: res.peaks.max,
        bucketsPerSec: res.bucketsPerSec
      };
      if (res.duration > S.duration) {
        S.duration = res.duration;
        fitOnce();
      }
      view.redraw();
    } finally {
      unsub();
      if (seq === S.loadSeq) els.waveProgress.classList.add('hidden');
    }
  }

  function fitOnce() {
    if (!S.fitted && S.duration > 0) {
      S.fitted = true;
      view.fitView();
      updateTimeDisplay();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Waveform view host                                                  */
  /* ------------------------------------------------------------------ */

  const view = new WaveformView(els.waveMain, els.waveOverview, {
    getDuration: () => S.duration,
    getPeaks: () => S.peaks,
    getIntervals: () => S.intervals,
    getTime: () => S.playheadTime,
    getSelected: () => S.selected,
    getMarkAnchor: () => S.markAnchor,
    seek,
    createInterval,
    applyHandle,
    applyMove,
    commitEdit,
    select
  });

  /* ------------------------------------------------------------------ */
  /* Wiring                                                              */
  /* ------------------------------------------------------------------ */

  els.btnOpen.addEventListener('click', async () => {
    const p = await window.jellymute.pickVideo();
    if (p) loadVideoPath(p);
  });
  els.btnOpenEmpty.addEventListener('click', () => els.btnOpen.click());
  els.btnReveal.addEventListener('click', () => window.jellymute.revealSidecar(S.sidecarPath));

  els.btnPlay.addEventListener('click', togglePlay);
  els.btnBack10.addEventListener('click', () => seek(S.playheadTime - 10));
  els.btnBack1.addEventListener('click', () => seek(S.playheadTime - 1));
  els.btnFwd1.addEventListener('click', () => seek(S.playheadTime + 1));
  els.btnFwd10.addEventListener('click', () => seek(S.playheadTime + 10));
  els.btnMarkStart.addEventListener('click', markStart);
  els.btnMarkEnd.addEventListener('click', markEnd);
  els.btnAdd.addEventListener('click', () => createInterval(S.playheadTime, S.playheadTime + 1));

  els.btnMute.addEventListener('click', () => {
    S.userMuted = !S.userMuted;
    els.btnMute.textContent = S.userMuted ? '🔇' : '🔊';
  });
  els.volume.addEventListener('input', () => {
    video.volume = parseFloat(els.volume.value);
    if (video.volume > 0 && S.userMuted) els.btnMute.click();
  });
  els.speed.addEventListener('change', () => {
    video.playbackRate = parseFloat(els.speed.value);
  });
  els.cbPreview.addEventListener('change', () => {
    S.previewMutes = els.cbPreview.checked;
    if (!S.previewMutes && !S.userMuted) video.muted = false;
  });

  video.addEventListener('play', () => { els.btnPlay.textContent = '⏸'; });
  video.addEventListener('pause', () => { els.btnPlay.textContent = '▶'; });
  video.addEventListener('ended', () => { els.btnPlay.textContent = '▶'; });
  video.addEventListener('loadedmetadata', () => {
    if (isFinite(video.duration) && video.duration > S.duration) {
      S.duration = video.duration;
      fitOnce();
    }
    updateTimeDisplay();
  });
  video.addEventListener('error', () => {
    if (!S.videoPath || !video.src) return;
    S.videoBroken = true;
    els.videoError.classList.remove('hidden');
    if (!S.peaks) {
      toast("This file can't be decoded here and no waveform could be extracted.", true);
    }
  });

  /* Drag & drop */
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth++;
    els.dropOverlay.classList.remove('hidden');
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) els.dropOverlay.classList.add('hidden');
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    els.dropOverlay.classList.add('hidden');
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    const p = window.jellymute.pathForFile(file);
    if (!p) {
      toast('Could not determine the path of the dropped item.', true);
      return;
    }
    loadVideoPath(p);
  });

  /* Keyboard */
  window.addEventListener('keydown', (e) => {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;

    const key = e.key;
    if (key === ' ') {
      e.preventDefault();
      togglePlay();
    } else if (key === 'ArrowLeft') {
      e.preventDefault();
      seek(S.playheadTime - (e.shiftKey ? 0.1 : 1));
    } else if (key === 'ArrowRight') {
      e.preventDefault();
      seek(S.playheadTime + (e.shiftKey ? 0.1 : 1));
    } else if (key === 's' || key === 'S') {
      markStart();
    } else if (key === 'e' || key === 'E') {
      markEnd();
    } else if (key === '[') {
      jumpToInterval(-1);
    } else if (key === ']') {
      jumpToInterval(1);
    } else if (key === 'Delete' || key === 'Backspace') {
      if (S.selected >= 0) deleteInterval(S.selected);
    } else if (key === 'a' || key === 'A') {
      createInterval(S.playheadTime, S.playheadTime + 1);
    } else if (key === 'f' || key === 'F') {
      toggleFullscreen();
    } else if (key === 'Escape') {
      if (S.markAnchor != null) {
        S.markAnchor = null;
        updateMarkHint();
        view.redraw();
      } else if (S.selected >= 0) {
        select(-1);
      }
    } else if ((key === 'o' || key === 'O') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      els.btnOpen.click();
    }
  });

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else els.videoWrapFs().requestFullscreen().catch(() => {});
  }
  // small helper kept separate so #video-wrap id stays referenced once
  els.videoWrapFs = () => document.getElementById('video-wrap');

  /* Start the loop */
  // The editor plays muted where you've marked — like Jellyfin will.
  els.cbPreview.checked = true;
  S.previewMutes = true;
  updateTimeDisplay();
  renderIntervals();
  requestAnimationFrame(tick);

  // Video passed on the command line (JellyMute.exe "Movie.mp4")
  if (window.jellymute.onOpenFile) {
    window.jellymute.onOpenFile((videoPath) => loadVideoPath(videoPath));
  }
})();
