import type { DrawState, PuzzleRenderer, View } from './render';

const BACKGROUND = '#d9d9e3';
const TAP_SLOP = 8; // px a finger may wander and still count as a tap

/**
 * Owns a canvas showing a puzzle: pan / pinch-zoom gestures, taps, and
 * redrawing. Kept outside React so gestures never wait on a re-render.
 */
export class PuzzleView {
  readonly view: View = { scale: 1, tx: 0, ty: 0 };
  state: DrawState;
  onTap: ((imageX: number, imageY: number) => void) | null = null;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private renderer: PuzzleRenderer;
  private cssW = 1;
  private cssH = 1;
  private dpr = 1;
  private fitScale = 1;
  private frame = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private moved = false;
  private downAt = { x: 0, y: 0 };
  private pinchDist = 0;
  private pinchMid = { x: 0, y: 0 };
  private observer: ResizeObserver;
  private animation = 0;

  // When a full redraw is too slow to do every frame, gestures move a
  // snapshot of the last full render and the sharp redraw follows on pause.
  private snapshot: HTMLCanvasElement | null = null;
  private snapshotView: View = { scale: 1, tx: 0, ty: 0 };
  private lastFullMs = 0;
  private wantFast = false;
  private settleTimer = 0;

  constructor(canvas: HTMLCanvasElement, renderer: PuzzleRenderer, state: DrawState) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.renderer = renderer;
    this.state = state;

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize(true);
  }

  destroy(): void {
    this.observer.disconnect();
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.animation);
    clearTimeout(this.settleTimer);
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onPointerDown);
    c.removeEventListener('pointermove', this.onPointerMove);
    c.removeEventListener('pointerup', this.onPointerUp);
    c.removeEventListener('pointercancel', this.onPointerUp);
    c.removeEventListener('wheel', this.onWheel);
  }

  /** Swap in a different picture (used by the live preview). */
  setRenderer(renderer: PuzzleRenderer, state: DrawState): void {
    const sameSize =
      renderer.puzzle.width === this.renderer.puzzle.width &&
      renderer.puzzle.height === this.renderer.puzzle.height;
    this.renderer = renderer;
    this.state = state;
    this.snapshot = null;
    if (sameSize) this.requestDraw();
    else this.resize(true);
  }

  private resize(refit = false): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const wasFit = Math.abs(this.view.scale - this.fitScale) < 1e-6;
    this.cssW = rect.width;
    this.cssH = rect.height;
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    const p = this.renderer.puzzle;
    this.fitScale = Math.min(this.cssW / p.width, this.cssH / p.height) * 0.96;
    this.snapshot = null;
    if (refit || wasFit) this.fit();
    else {
      this.clampView();
      this.drawNow(false);
    }
  }

  /** Show the whole picture. */
  fit(): void {
    const p = this.renderer.puzzle;
    this.view.scale = this.fitScale;
    this.view.tx = (this.cssW - p.width * this.fitScale) / 2;
    this.view.ty = (this.cssH - p.height * this.fitScale) / 2;
    this.drawNow(false);
  }

  get maxScale(): number {
    return Math.max(this.fitScale * 24, 12);
  }

  private clampView(): void {
    const v = this.view;
    const p = this.renderer.puzzle;
    v.scale = Math.max(this.fitScale * 0.6, Math.min(this.maxScale, v.scale));
    // Never let the picture leave the screen entirely.
    const margin = 60;
    v.tx = Math.min(this.cssW - margin, Math.max(margin - p.width * v.scale, v.tx));
    v.ty = Math.min(this.cssH - margin, Math.max(margin - p.height * v.scale, v.ty));
  }

  private zoomAt(x: number, y: number, factor: number): void {
    const v = this.view;
    const before = v.scale;
    v.scale = Math.max(this.fitScale * 0.6, Math.min(this.maxScale, before * factor));
    const k = v.scale / before;
    v.tx = x - (x - v.tx) * k;
    v.ty = y - (y - v.ty) * k;
  }

  /** Glide so that an image point sits mid-screen at the given zoom. */
  animateTo(imageX: number, imageY: number, scale: number): void {
    cancelAnimationFrame(this.animation);
    const from = { ...this.view };
    const s = Math.max(this.fitScale * 0.6, Math.min(this.maxScale, scale));
    const to = { scale: s, tx: this.cssW / 2 - imageX * s, ty: this.cssH / 2 - imageY * s };
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 380);
      const e = 1 - Math.pow(1 - t, 3);
      // Interpolate zoom geometrically so it feels even.
      this.view.scale = from.scale * Math.pow(to.scale / from.scale, e);
      this.view.tx = from.tx + (to.tx - from.tx) * e;
      this.view.ty = from.ty + (to.ty - from.ty) * e;
      this.requestDraw(t < 1);
      if (t < 1) this.animation = requestAnimationFrame(step);
    };
    this.animation = requestAnimationFrame(step);
  }

  /** Redraw on the next frame. `fast` allows a blurry snapshot while moving. */
  requestDraw(fast = false): void {
    this.wantFast = this.frame ? this.wantFast && fast : fast;
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.drawNow(this.wantFast);
    });
  }

  private drawNow(fast: boolean): void {
    const ctx = this.ctx;
    if (fast && this.snapshot && this.lastFullMs > 12) {
      const sv = this.snapshotView;
      const k = this.view.scale / sv.scale;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = BACKGROUND;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.setTransform(
        k,
        0,
        0,
        k,
        this.dpr * (this.view.tx - sv.tx * k),
        this.dpr * (this.view.ty - sv.ty * k),
      );
      ctx.drawImage(this.snapshot, 0, 0);
      clearTimeout(this.settleTimer);
      this.settleTimer = window.setTimeout(() => this.requestDraw(false), 120);
      return;
    }

    clearTimeout(this.settleTimer);
    const t0 = performance.now();
    this.renderer.draw(ctx, this.cssW, this.cssH, this.dpr, this.view, this.state, BACKGROUND);
    this.lastFullMs = performance.now() - t0;

    if (this.lastFullMs > 12) {
      if (!this.snapshot) this.snapshot = document.createElement('canvas');
      const snap = this.snapshot;
      if (snap.width !== this.canvas.width || snap.height !== this.canvas.height) {
        snap.width = this.canvas.width;
        snap.height = this.canvas.height;
      }
      snap.getContext('2d')!.drawImage(this.canvas, 0, 0);
      this.snapshotView = { ...this.view };
    }
  }

  private localPoint(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private startPinch(): void {
    const [a, b] = [...this.pointers.values()];
    this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    this.pinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  private onPointerDown = (e: PointerEvent): void => {
    cancelAnimationFrame(this.animation);
    this.canvas.setPointerCapture(e.pointerId);
    const pt = this.localPoint(e);
    this.pointers.set(e.pointerId, pt);
    if (this.pointers.size === 1) {
      this.moved = false;
      this.downAt = pt;
    } else {
      this.moved = true;
      if (this.pointers.size === 2) this.startPinch();
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const last = this.pointers.get(e.pointerId);
    if (!last) return;
    const pt = this.localPoint(e);
    this.pointers.set(e.pointerId, pt);

    if (this.pointers.size === 1) {
      if (!this.moved && Math.hypot(pt.x - this.downAt.x, pt.y - this.downAt.y) > TAP_SLOP) {
        this.moved = true;
      }
      if (this.moved) {
        this.view.tx += pt.x - last.x;
        this.view.ty += pt.y - last.y;
        this.clampView();
        this.requestDraw(true);
      }
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.zoomAt(mid.x, mid.y, dist / this.pinchDist);
      this.view.tx += mid.x - this.pinchMid.x;
      this.view.ty += mid.y - this.pinchMid.y;
      this.pinchDist = dist;
      this.pinchMid = mid;
      this.clampView();
      this.requestDraw(true);
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.pointers.delete(e.pointerId)) return;
    if (this.pointers.size === 0) {
      if (!this.moved && e.type === 'pointerup' && this.onTap) {
        const pt = this.localPoint(e);
        this.onTap((pt.x - this.view.tx) / this.view.scale, (pt.y - this.view.ty) / this.view.scale);
      }
      this.requestDraw(false);
    } else if (this.pointers.size === 2) {
      this.startPinch();
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const pt = this.localPoint(e);
    this.zoomAt(pt.x, pt.y, Math.exp(-e.deltaY * 0.0015));
    this.clampView();
    this.requestDraw(true);
  };
}
