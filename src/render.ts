import type { Puzzle } from './types';

/** Pan/zoom: screen (CSS px) = image * scale + (tx, ty). */
export interface View {
  scale: number;
  tx: number;
  ty: number;
}

export interface DrawState {
  /** 1 for every region that has been coloured in. */
  filled: Uint8Array;
  /** Palette index currently picked, or -1. Its unfilled sections are highlighted. */
  selected: number;
  showNumbers: boolean;
}

const ARCS_PER_CHUNK = 64;
const PAPER = '#ffffff';
const LINE = '#4a4a55';

/** Draws a puzzle (filled sections, outlines, numbers) at any zoom level. */
export class PuzzleRenderer {
  readonly puzzle: Puzzle;
  readonly colorCss: string[];
  /** Fill each section with its own shade instead of its paint's flat colour. */
  shaded: boolean;
  private shadeCss: string[] | null = null;
  private paths: (Path2D | undefined)[];
  private checker: CanvasPattern | null = null;
  private checkerDpr = 0;

  // Outlines are kept in chunks of neighbouring arcs. Colouring a section only
  // rebuilds the few chunks its border touches, which keeps taps instant even
  // on pictures with thousands of sections. null = rebuild, false = nothing to draw.
  private chunks: (Path2D | false | null)[];
  private chunkBox: Float32Array;

  constructor(puzzle: Puzzle) {
    this.puzzle = puzzle;
    this.paths = new Array(puzzle.regionCount);

    const arcCount = puzzle.arcStart.length - 1;
    const chunkCount = Math.ceil(arcCount / ARCS_PER_CHUNK);
    this.chunks = new Array(chunkCount).fill(null);
    this.chunkBox = new Float32Array(chunkCount * 4);
    for (let c = 0; c < chunkCount; c++) {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      const from = puzzle.arcStart[c * ARCS_PER_CHUNK];
      const to = puzzle.arcStart[Math.min(arcCount, (c + 1) * ARCS_PER_CHUNK)];
      for (let q = from; q < to; q++) {
        const x = puzzle.arcPoints[q * 2];
        const y = puzzle.arcPoints[q * 2 + 1];
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      this.chunkBox.set([x0, y0, x1, y1], c * 4);
    }

    this.colorCss = [];
    for (let i = 0; i < puzzle.palette.length; i += 3) {
      this.colorCss.push(
        `rgb(${puzzle.palette[i]},${puzzle.palette[i + 1]},${puzzle.palette[i + 2]})`,
      );
    }
    const shade = puzzle.regionShade;
    if (shade) {
      this.shadeCss = [];
      for (let i = 0; i < shade.length; i += 3) {
        this.shadeCss.push(`rgb(${shade[i]},${shade[i + 1]},${shade[i + 2]})`);
      }
    }
    this.shaded = puzzle.shaded === true;
  }

  /** The colour a section is painted once it has been coloured in. */
  fillCss(r: number): string {
    return this.shaded && this.shadeCss
      ? this.shadeCss[r]
      : this.colorCss[this.puzzle.regionColor[r]];
  }

  /** Call when `filled` has changed wholesale (a different picture state). */
  invalidateOutline(): void {
    this.chunks.fill(null);
  }

  /** Call after one section is coloured so the lines round it are redrawn. */
  invalidateRegion(r: number): void {
    const p = this.puzzle;
    const from = p.ringStart[p.regionRingStart[r]];
    const to = p.ringStart[p.regionRingStart[r + 1]];
    for (let j = from; j < to; j++) {
      this.chunks[Math.floor((Math.abs(p.ringArcs[j]) - 1) / ARCS_PER_CHUNK)] = null;
    }
  }

  private addArc(path: Path2D, arc: number, reversed: boolean, skipFirst: boolean): void {
    const pts = this.puzzle.arcPoints;
    const from = this.puzzle.arcStart[arc];
    const to = this.puzzle.arcStart[arc + 1];
    if (!reversed) {
      for (let q = skipFirst ? from + 1 : from; q < to; q++) {
        if (q === from) path.moveTo(pts[q * 2], pts[q * 2 + 1]);
        else path.lineTo(pts[q * 2], pts[q * 2 + 1]);
      }
    } else {
      for (let q = skipFirst ? to - 2 : to - 1; q >= from; q--) {
        if (q === to - 1) path.moveTo(pts[q * 2], pts[q * 2 + 1]);
        else path.lineTo(pts[q * 2], pts[q * 2 + 1]);
      }
    }
  }

  regionPath(r: number): Path2D {
    let path = this.paths[r];
    if (path) return path;
    const p = this.puzzle;
    path = new Path2D();
    for (let ring = p.regionRingStart[r]; ring < p.regionRingStart[r + 1]; ring++) {
      const from = p.ringStart[ring];
      const to = p.ringStart[ring + 1];
      for (let j = from; j < to; j++) {
        const ref = p.ringArcs[j];
        this.addArc(path, Math.abs(ref) - 1, ref < 0, j > from);
      }
      path.closePath();
    }
    this.paths[r] = path;
    return path;
  }

  private outlineChunk(c: number, filled: Uint8Array): Path2D | false {
    const cached = this.chunks[c];
    if (cached !== null) return cached;
    const p = this.puzzle;
    const path = new Path2D();
    const end = Math.min(p.arcStart.length - 1, (c + 1) * ARCS_PER_CHUNK);
    let any = false;
    for (let i = c * ARCS_PER_CHUNK; i < end; i++) {
      const a = p.arcRegions[i * 2];
      const b = p.arcRegions[i * 2 + 1];
      // A line is only needed while a section next to it is still blank.
      if ((a < 0 || filled[a]) && (b < 0 || filled[b])) continue;
      this.addArc(path, i, false, false);
      any = true;
    }
    return (this.chunks[c] = any ? path : false);
  }

  private checkerPattern(ctx: CanvasRenderingContext2D, dpr: number): CanvasPattern | null {
    if (this.checker && this.checkerDpr === dpr) return this.checker;
    const cell = Math.max(2, Math.round(4 * dpr));
    const tile = document.createElement('canvas');
    tile.width = tile.height = cell * 2;
    const t = tile.getContext('2d')!;
    t.fillStyle = '#e2e2ea';
    t.fillRect(0, 0, cell * 2, cell * 2);
    t.fillStyle = '#b9b9c6';
    t.fillRect(0, 0, cell, cell);
    t.fillRect(cell, cell, cell, cell);
    this.checker = ctx.createPattern(tile, 'repeat');
    this.checkerDpr = dpr;
    return this.checker;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    cssW: number,
    cssH: number,
    dpr: number,
    view: View,
    state: DrawState,
    background: string | null,
  ): void {
    const p = this.puzzle;
    const s = view.scale;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, cssW, cssH);
    } else {
      ctx.clearRect(0, 0, cssW, cssH);
    }

    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * view.tx, dpr * view.ty);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, p.width, p.height);

    // Visible part of the picture, in image pixels.
    const vx0 = -view.tx / s;
    const vy0 = -view.ty / s;
    const vx1 = (cssW - view.tx) / s;
    const vy1 = (cssH - view.ty) / s;
    const box = p.regionBox;
    const visible = (r: number) =>
      box[r * 4] <= vx1 && box[r * 4 + 2] >= vx0 && box[r * 4 + 1] <= vy1 && box[r * 4 + 3] >= vy0;

    const checker = state.selected >= 0 ? this.checkerPattern(ctx, dpr) : null;
    // Keep the checker squares the same size on screen whatever the zoom.
    checker?.setTransform(new DOMMatrix().scale(1 / (dpr * s)));

    ctx.lineJoin = 'round';
    // Thin same-colour stroke hides hairline gaps between neighbouring fills.
    ctx.lineWidth = 0.9 / s;
    for (let r = 0; r < p.regionCount; r++) {
      if (!visible(r)) continue;
      if (state.filled[r]) {
        const css = this.fillCss(r);
        const path = this.regionPath(r);
        ctx.fillStyle = css;
        ctx.strokeStyle = css;
        ctx.fill(path, 'evenodd');
        ctx.stroke(path);
      } else if (checker && p.regionColor[r] === state.selected) {
        ctx.fillStyle = checker;
        ctx.fill(this.regionPath(r), 'evenodd');
      }
    }

    ctx.strokeStyle = LINE;
    ctx.lineWidth = Math.min(0.8, Math.max(0.35, s * 0.7)) / s;
    const cb = this.chunkBox;
    for (let c = 0; c < this.chunks.length; c++) {
      if (cb[c * 4] > vx1 || cb[c * 4 + 2] < vx0 || cb[c * 4 + 1] > vy1 || cb[c * 4 + 3] < vy0) {
        continue;
      }
      const path = this.outlineChunk(c, state.filled);
      if (path) ctx.stroke(path);
    }

    if (!state.showNumbers) return;

    // Numbers are drawn in screen space so they stay crisp, grouped by font
    // size to avoid switching fonts thousands of times per frame.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const buckets: number[][] = [];
    for (let r = 0; r < p.regionCount; r++) {
      if (state.filled[r] || !visible(r)) continue;
      const room = p.labelR[r] * s; // radius of free space on screen
      const digits = p.regionColor[r] + 1 >= 10 ? 2 : 1;
      const size = Math.min(15, Math.floor(room * (digits === 2 ? 1.15 : 1.5)));
      if (size < 6) continue;
      (buckets[size] ??= []).push(r);
    }
    for (let size = 6; size < buckets.length; size++) {
      const list = buckets[size];
      if (!list) continue;
      let current: boolean | null = null;
      for (const r of list) {
        const isSelected = p.regionColor[r] === state.selected;
        if (isSelected !== current) {
          current = isSelected;
          ctx.font = `${isSelected ? '700' : '500'} ${size}px system-ui, sans-serif`;
          ctx.fillStyle = isSelected ? '#16161d' : '#5b5b68';
        }
        ctx.fillText(
          String(p.regionColor[r] + 1),
          p.labelX[r] * s + view.tx,
          p.labelY[r] * s + view.ty + size * 0.06,
        );
      }
    }
  }
}

/** Renders the puzzle in its current state to a small JPEG for the library. */
export async function renderThumbnail(
  renderer: PuzzleRenderer,
  filled: Uint8Array,
  maxSide = 360,
): Promise<Blob | null> {
  const p = renderer.puzzle;
  const scale = maxSide / Math.max(p.width, p.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(p.width * scale);
  canvas.height = Math.round(p.height * scale);
  const ctx = canvas.getContext('2d')!;
  // The cached outline belongs to whatever is on screen; don't reuse or leave ours.
  renderer.invalidateOutline();
  renderer.draw(
    ctx,
    canvas.width,
    canvas.height,
    1,
    { scale, tx: 0, ty: 0 },
    { filled, selected: -1, showNumbers: false },
    PAPER,
  );
  renderer.invalidateOutline();
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
}
