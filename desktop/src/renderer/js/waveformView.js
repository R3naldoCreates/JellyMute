/*
 * WaveformView — canvas rendering of the audio waveform (zoomable main view
 * + full-duration overview) and all pointer interactions for creating,
 * resizing and moving mute intervals.
 *
 * Mouse model:
 *   LEFT drag on empty timeline ...... pan the timeline left/right
 *   LEFT click ........................ move the playhead (seek)
 *   LEFT drag on the playhead ......... scrub the video
 *   LEFT/RIGHT drag on interval edge .. resize that edge
 *   LEFT/RIGHT drag on interval body .. move the interval
 *   RIGHT drag on empty ............... create a marker and drag it to size
 *   RIGHT click on empty .............. drop a 1-second marker at that point
 *   Wheel ............................. zoom (Shift/wheel-x = pan)
 *   Double click ...................... zoom to interval (or fit whole movie)
 *
 * It talks to the app through a `host` object:
 *   getDuration(), getPeaks(), getIntervals(), getTime(), getSelected(),
 *   getMarkAnchor(), seek(t), createInterval(start,end), applyHandle(i, which, t),
 *   applyMove(i, dt), commitEdit(), select(i)
 */
(function () {
  'use strict';

  const TS = window.JellyMuteTimestamps;

  const COLOR = {
    bg: '#161c23',
    ruler: '#8b9aa7',
    rulerLine: '#232d38',
    centerLine: '#26313c',
    wavePlayed: '#4cc2e0',
    waveRest: '#3d4d5c',
    intervalFill: 'rgba(255, 95, 109, 0.28)',
    intervalBorder: '#ff5f6d',
    intervalSelected: '#ffb3ba',
    handle: '#e8eef4',
    handleHover: '#ffffff',
    playhead: '#ffffff',
    mark: '#ffb340',
    preview: 'rgba(76, 194, 224, 0.35)',
    viewport: '#4cc2e0',
    text: '#8b9aa7'
  };

  const RULER_H = 20;
  const HANDLE_HIT_PX = 7;
  const PLAYHEAD_HIT_PX = 9;
  const CLICK_SLOP_PX = 4;
  const TICK_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

  class WaveformView {
    constructor(mainCanvas, overviewCanvas, host) {
      this.main = mainCanvas;
      this.overview = overviewCanvas;
      this.ctxMain = mainCanvas.getContext('2d');
      this.ctxOverview = overviewCanvas.getContext('2d');
      this.host = host;

      this.view = { start: 0, end: 0 };
      this.drag = null;         // active gesture
      this.preview = null;      // {start,end} while creating a marker
      this.hoverHandle = null;  // {index, which}
      this.hoverInterval = -1;
      this.hoverPlayhead = false;
      this.dpr = Math.max(1, window.devicePixelRatio || 1);

      this.bindEvents();
      this.resize();
    }

    /* ------------------------------------------------ coordinates */

    mainWidth() { return this.main.clientWidth; }
    mainHeight() { return this.main.clientHeight; }

    xToTime(x) {
      const span = this.view.end - this.view.start;
      return this.view.start + (x / this.mainWidth()) * span;
    }
    timeToX(t) {
      const span = this.view.end - this.view.start || 1;
      return ((t - this.view.start) / span) * this.mainWidth();
    }
    pxPerSec() {
      return this.mainWidth() / (this.view.end - this.view.start || 1);
    }

    /* ------------------------------------------------ view window */

    fitView() {
      const d = this.host.getDuration() || 0;
      this.view.start = 0;
      this.view.end = Math.max(d, 1);
      this.redraw();
    }

    setView(start, end) {
      const d = this.host.getDuration() || 0;
      const span = Math.min(Math.max(end - start, 0.2), Math.max(d, 1));
      start = Math.max(0, Math.min(start, d - span));
      end = start + span;
      this.view.start = start;
      this.view.end = end;
      this.redraw();
    }

    zoomAt(factor, anchorX) {
      const d = this.host.getDuration() || 0;
      const t = anchorX == null ? (this.view.start + this.view.end) / 2 : this.xToTime(anchorX);
      let span = (this.view.end - this.view.start) * factor;
      span = Math.min(Math.max(span, 0.5), Math.max(d, 1));
      const frac = (t - this.view.start) / (this.view.end - this.view.start);
      let start = t - frac * span;
      this.setView(start, start + span);
    }

    panBy(seconds) {
      this.setView(this.view.start + seconds, this.view.end + seconds);
    }

    /* ------------------------------------------------ sizing */

    resize() {
      this.dpr = Math.max(1, window.devicePixelRatio || 1);
      for (const canvas of [this.main, this.overview]) {
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        if (w === 0 || h === 0) continue;
        canvas.width = Math.round(w * this.dpr);
        canvas.height = Math.round(h * this.dpr);
      }
      this.redraw();
    }

    /* ------------------------------------------------ drawing */

    redraw() {
      this.drawMain();
      this.drawOverview();
    }

    peakRange(t0, t1, peaks, bps) {
      let lo = Math.max(0, Math.floor(t0 * bps));
      let hi = Math.min(peaks.min.length - 1, Math.ceil(t1 * bps));
      let min = 101, max = -101;
      if (lo > hi) return null;
      for (let i = lo; i <= hi; i++) {
        if (peaks.min[i] < min) min = peaks.min[i];
        if (peaks.max[i] > max) max = peaks.max[i];
      }
      if (min > 100) return null;
      return { min, max };
    }

    drawMain() {
      const { ctxMain: ctx, dpr } = this;
      const w = this.mainWidth();
      const h = this.mainHeight();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = COLOR.bg;
      ctx.fillRect(0, 0, w, h);

      const d = this.host.getDuration();
      const peaks = this.host.getPeaks();
      const time = this.host.getTime();
      const intervals = this.host.getIntervals();
      const selected = this.host.getSelected();
      const midY = RULER_H + (h - RULER_H) / 2;
      const scaleY = ((h - RULER_H) / 2) * 0.92;

      // center line
      ctx.strokeStyle = COLOR.centerLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, midY + 0.5);
      ctx.lineTo(w, midY + 0.5);
      ctx.stroke();

      this.drawRuler(ctx, w);

      // waveform
      if (peaks && d > 0) {
        const bps = peaks.bucketsPerSec || 10;
        for (let x = 0; x < w; x += 1) {
          const t0 = this.xToTime(x);
          const t1 = this.xToTime(x + 1);
          if (t1 < 0 || t0 > d) continue;
          const range = this.peakRange(Math.max(0, t0), Math.min(d, t1), peaks, bps);
          if (!range) continue;
          const yTop = midY - (range.max / 100) * scaleY;
          const yBot = midY - (range.min / 100) * scaleY;
          ctx.fillStyle = t1 <= time ? COLOR.wavePlayed : COLOR.waveRest;
          ctx.fillRect(x, yTop, 1, Math.max(1, yBot - yTop));
        }
      }

      // intervals
      intervals.forEach((iv, i) => {
        const x0 = this.timeToX(iv.start);
        const x1 = this.timeToX(iv.end);
        if (x1 < 0 || x0 > w) return;
        const cl0 = Math.max(0, x0);
        const cl1 = Math.min(w, x1);

        ctx.fillStyle = COLOR.intervalFill;
        ctx.fillRect(cl0, RULER_H, cl1 - cl0, h - RULER_H);

        const isSel = i === selected || this.hoverInterval === i;
        ctx.strokeStyle = isSel ? COLOR.intervalSelected : COLOR.intervalBorder;
        ctx.lineWidth = isSel ? 2 : 1.2;
        ctx.beginPath();
        ctx.moveTo(cl0 + 0.5, RULER_H);
        ctx.lineTo(cl0 + 0.5, h);
        ctx.moveTo(cl1 - 0.5, RULER_H);
        ctx.lineTo(cl1 - 0.5, h);
        ctx.stroke();

        // top label
        if (x1 - x0 > 64) {
          ctx.fillStyle = COLOR.intervalBorder;
          ctx.font = '11px "Segoe UI", sans-serif';
          ctx.textBaseline = 'top';
          const label = TS.format(iv.start, { forceMillis: true });
          const tw = ctx.measureText(label).width;
          ctx.fillText(label, cl0 + (cl1 - cl0 - tw) / 2, RULER_H + 4);
        }

        // handles
        const hovered = this.hoverHandle && this.hoverHandle.index === i;
        ctx.fillStyle = hovered ? COLOR.handleHover : COLOR.handle;
        ctx.fillRect(x0 - 2.5, midY - 11, 5, 22);
        ctx.fillRect(x1 - 2.5, midY - 11, 5, 22);
      });

      // create-preview region
      if (this.preview) {
        const x0 = this.timeToX(this.preview.start);
        const x1 = this.timeToX(this.preview.end);
        ctx.fillStyle = COLOR.preview;
        ctx.fillRect(x0, RULER_H, x1 - x0, h - RULER_H);
        ctx.strokeStyle = COLOR.wavePlayed;
        ctx.lineWidth = 1;
        ctx.strokeRect(x0 + 0.5, RULER_H + 0.5, x1 - x0 - 1, h - RULER_H - 1);
      }

      // pending mark-start anchor
      const anchor = this.host.getMarkAnchor ? this.host.getMarkAnchor() : null;
      if (anchor != null) {
        const x = this.timeToX(anchor);
        ctx.strokeStyle = COLOR.mark;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(x, RULER_H);
        ctx.lineTo(x, h);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = COLOR.mark;
        ctx.beginPath();
        ctx.arc(x, RULER_H + 6, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // playhead
      const px = this.timeToX(time);
      if (px >= -2 && px <= w + 2) {
        const isHover = this.hoverPlayhead || (this.drag && this.drag.mode === 'scrub');
        ctx.strokeStyle = COLOR.playhead;
        ctx.lineWidth = isHover ? 2.5 : 1.5;
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, h);
        ctx.stroke();
        ctx.fillStyle = COLOR.playhead;
        ctx.beginPath();
        ctx.moveTo(px - 5, 0);
        ctx.lineTo(px + 5, 0);
        ctx.lineTo(px, 7);
        ctx.closePath();
        ctx.fill();
      }
    }

    drawRuler(ctx, w) {
      const d = this.host.getDuration();
      const span = this.view.end - this.view.start;
      if (!d || span <= 0) return;
      let step = TICK_STEPS[TICK_STEPS.length - 1];
      for (const s of TICK_STEPS) {
        if (span / s <= 9) { step = s; break; }
      }
      ctx.fillStyle = COLOR.ruler;
      ctx.strokeStyle = COLOR.rulerLine;
      ctx.lineWidth = 1;
      ctx.font = '10px "Segoe UI", sans-serif';
      ctx.textBaseline = 'top';
      ctx.beginPath();
      ctx.moveTo(0, RULER_H - 0.5);
      ctx.lineTo(w, RULER_H - 0.5);
      ctx.stroke();

      const first = Math.floor(this.view.start / step) * step;
      for (let t = first; t <= this.view.end + step; t += step) {
        if (t < 0) continue;
        const x = this.timeToX(t);
        if (x < -1 || x > w + 1) continue;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, RULER_H - 5);
        ctx.lineTo(x + 0.5, RULER_H);
        ctx.stroke();
        const label = step >= 1 ? TS.format(t) : TS.format(t, { forceMillis: true });
        ctx.fillText(label, x + 3, 4);
      }
    }

    drawOverview() {
      const { ctxOverview: ctx, dpr } = this;
      const w = this.overview.clientWidth;
      const h = this.overview.clientHeight;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = COLOR.bg;
      ctx.fillRect(0, 0, w, h);

      const d = this.host.getDuration();
      if (!d) return;
      const midY = h / 2;
      const scaleY = (h / 2) * 0.9;
      const peaks = this.host.getPeaks();

      if (peaks) {
        const bps = peaks.bucketsPerSec || 10;
        for (let x = 0; x < w; x++) {
          const range = this.peakRange((x / w) * d, ((x + 1) / w) * d, peaks, bps);
          if (!range) continue;
          ctx.fillStyle = COLOR.waveRest;
          ctx.fillRect(x, midY - (range.max / 100) * scaleY, 1, Math.max(1, ((range.max - range.min) / 100) * scaleY));
        }
      }

      // intervals
      ctx.fillStyle = 'rgba(255, 95, 109, 0.75)';
      for (const iv of this.host.getIntervals()) {
        ctx.fillRect((iv.start / d) * w, 0, Math.max(1.5, ((iv.end - iv.start) / d) * w), h);
      }

      // viewport indicator
      const vx0 = (this.view.start / d) * w;
      const vx1 = (this.view.end / d) * w;
      ctx.fillStyle = 'rgba(15, 19, 24, 0.55)';
      ctx.fillRect(0, 0, vx0, h);
      ctx.fillRect(vx1, 0, w - vx1, h);
      ctx.strokeStyle = COLOR.viewport;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(vx0 + 0.75, 0.75, Math.max(2, vx1 - vx0 - 1.5), h - 1.5);
    }

    /* ------------------------------------------------ hit testing */

    hitEdge(x) {
      const intervals = this.host.getIntervals();
      for (let i = intervals.length - 1; i >= 0; i--) {
        const xs = this.timeToX(intervals[i].start);
        const xe = this.timeToX(intervals[i].end);
        if (Math.abs(x - xs) <= HANDLE_HIT_PX) return { index: i, which: 'start' };
        if (Math.abs(x - xe) <= HANDLE_HIT_PX) return { index: i, which: 'end' };
      }
      return null;
    }

    hitBody(x) {
      const intervals = this.host.getIntervals();
      for (let i = intervals.length - 1; i >= 0; i--) {
        const xs = this.timeToX(intervals[i].start);
        const xe = this.timeToX(intervals[i].end);
        if (x > xs && x < xe) return i;
      }
      return -1;
    }

    hitPlayhead(x) {
      return Math.abs(x - this.timeToX(this.host.getTime())) <= PLAYHEAD_HIT_PX;
    }

    /* ------------------------------------------------ events */

    bindEvents() {
      const canvas = this.main;

      window.addEventListener('resize', () => this.resize());
      if (typeof ResizeObserver === 'function') {
        new ResizeObserver(() => this.resize()).observe(this.main.parentElement || this.main);
      }

      canvas.addEventListener('pointerdown', (e) => this.onDown(e));
      canvas.addEventListener('pointermove', (e) => this.onMove(e));
      window.addEventListener('pointerup', (e) => this.onUp(e));
      canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
      canvas.addEventListener('dblclick', (e) => this.onDblClick(e));
      // right button is ours — never show the browser menu here
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());

      this.overview.addEventListener('pointerdown', (e) => {
        const x = this.eventX(this.overview, e);
        const d = this.host.getDuration();
        if (!d) return;
        const t = (x / this.overview.clientWidth) * d;
        this.drag = { mode: 'overview' };
        this.overview.setPointerCapture(e.pointerId);
        this.centerViewOn(t);
      });
      this.overview.addEventListener('pointermove', (e) => {
        if (this.drag && this.drag.mode === 'overview') {
          const d = this.host.getDuration();
          if (!d) return;
          this.centerViewOn((this.eventX(this.overview, e) / this.overview.clientWidth) * d);
        }
      });
      this.overview.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    eventX(canvas, e) {
      const rect = canvas.getBoundingClientRect();
      return e.clientX - rect.left;
    }

    centerViewOn(t) {
      const span = this.view.end - this.view.start;
      this.setView(t - span / 2, t + span / 2);
    }

    onDown(e) {
      const button = e.button; // 0 = left, 2 = right
      if (button !== 0 && button !== 2) return;
      const x = this.eventX(this.main, e);
      const t = this.xToTime(x);
      const d = this.host.getDuration();
      if (!d) return;
      this.main.setPointerCapture(e.pointerId);
      const clampedT = Math.max(0, Math.min(t, d));

      const edge = this.hitEdge(x);
      const body = this.hitBody(x);

      // edge resize — same with both buttons
      if (edge) {
        this.drag = { mode: 'handle', button, index: edge.index, which: edge.which };
        this.host.select(edge.index);
        return;
      }

      if (button === 2) {
        // RIGHT: markers. On a marker -> move it. On empty -> create + size it.
        if (body >= 0) {
          this.host.select(body);
          this.drag = { mode: 'maybe-move', button, index: body, startX: x, t0: clampedT };
        } else {
          this.drag = { mode: 'create-right', startX: x, t0: clampedT, moved: false };
          this.preview = { start: clampedT, end: clampedT };
        }
        return;
      }

      // LEFT: playhead scrub, then marker move, then pan (click = seek).
      if (this.hitPlayhead(x)) {
        this.drag = { mode: 'scrub' };
        this.host.seek(clampedT);
        return;
      }
      if (body >= 0) {
        this.host.select(body);
        this.drag = { mode: 'maybe-move', button: 0, index: body, startX: x, t0: clampedT };
        return;
      }
      this.drag = { mode: 'maybe-pan', startX: x, view0: { ...this.view }, t0: clampedT };
    }

    onMove(e) {
      const x = this.eventX(this.main, e);
      const d = this.host.getDuration();
      const t = Math.max(0, Math.min(this.xToTime(x), d || 0));

      const drag = this.drag;
      if (!drag) {
        // hover cursor feedback
        const edge = d ? this.hitEdge(x) : null;
        this.hoverHandle = edge;
        this.hoverInterval = edge ? -1 : (d ? this.hitBody(x) : -1);
        this.hoverPlayhead = !edge && d ? this.hitPlayhead(x) : false;
        this.updateCursor(draglessCursor(this));
        if (edge || this.hoverInterval >= 0 || this.hoverPlayhead) this.redraw();
        return;
      }

      if (drag.mode === 'scrub') {
        this.host.seek(t);
      } else if (drag.mode === 'maybe-pan') {
        if (Math.abs(x - drag.startX) > CLICK_SLOP_PX) {
          drag.mode = 'pan';
          this.updateCursor('grabbing');
        }
      } else if (drag.mode === 'pan') {
        const dt = (x - drag.startX) / this.pxPerSec();
        this.setView(drag.view0.start - dt, drag.view0.end - dt);
      } else if (drag.mode === 'create-right') {
        if (Math.abs(x - drag.startX) > CLICK_SLOP_PX) drag.moved = true;
        this.preview = { start: drag.t0, end: t };
      } else if (drag.mode === 'maybe-move') {
        if (Math.abs(x - drag.startX) > CLICK_SLOP_PX) drag.mode = 'move';
      }
      if (drag.mode === 'move') {
        this.host.applyMove(drag.index, t - drag.t0);
      } else if (drag.mode === 'handle') {
        this.host.applyHandle(drag.index, drag.which, t);
      }
      this.redraw();
    }

    onUp(e) {
      if (!this.drag) return;
      const drag = this.drag;
      const x = this.eventX(this.main, e);
      const d = this.host.getDuration();
      const t = Math.max(0, Math.min(this.xToTime(x), d || 0));
      this.drag = null;

      if (drag.mode === 'scrub') {
        this.host.seek(t); // a plain click on the playhead still moves it
      } else if (drag.mode === 'maybe-pan') {
        this.host.seek(t); // left click = move the playhead
      } else if (drag.mode === 'create-right') {
        this.preview = null;
        const start = Math.min(drag.t0, t);
        const end = Math.max(drag.t0, t);
        if (drag.moved && end - start >= 0.05) {
          this.host.createInterval(start, end);
        } else {
          // plain right-click: drop a 1-second marker at the point
          this.host.createInterval(drag.t0, Math.min(d + 0, drag.t0 + 1));
        }
      } else if (drag.mode === 'maybe-move') {
        this.host.seek(t);
      } else if (drag.mode === 'move' || drag.mode === 'handle') {
        this.host.commitEdit();
      }
      this.preview = null;
      this.redraw();
    }

    onWheel(e) {
      e.preventDefault();
      const d = this.host.getDuration();
      if (!d) return;
      if (e.shiftKey || e.altKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const span = this.view.end - this.view.start;
        const delta = ((e.deltaY || e.deltaX) / 400) * span;
        this.panBy(delta);
        return;
      }
      const factor = e.deltaY < 0 ? 1 / 1.25 : 1.25;
      this.zoomAt(factor, this.eventX(this.main, e));
    }

    onDblClick(e) {
      const x = this.eventX(this.main, e);
      const edge = this.hitEdge(x);
      const body = edge ? edge.index : this.hitBody(x);
      if (body >= 0) {
        const iv = this.host.getIntervals()[body];
        const pad = Math.max(2, (iv.end - iv.start) * 0.5);
        this.setView(iv.start - pad, iv.end + pad);
      } else {
        this.fitView();
      }
    }

    updateCursor(cursor) {
      if (this.main.style.cursor !== cursor) this.main.style.cursor = cursor;
    }
  }

  function draglessCursor(view) {
    if (view.hoverHandle) return 'ew-resize';
    if (view.hoverPlayhead) return 'col-resize';
    if (view.hoverInterval >= 0) return 'grab';
    return 'grab';
  }

  window.JellyMuteWaveformView = WaveformView;
})();
