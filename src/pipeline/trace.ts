/**
 * Turns the pixel region map into smooth vector outlines.
 *
 * Borders are walked along the lattice of pixel corners. Each region's border
 * is a set of closed loops; loops are cut at "junctions" (corners where three
 * or more regions meet) into arcs. An arc separates exactly two regions, so it
 * is smoothed once, in a canonical direction, and then referenced by both
 * neighbours. That guarantees adjacent sections share an identical edge with
 * no gaps or overlaps, however much smoothing is applied.
 */

export interface Geometry {
  arcPoints: Float32Array;
  arcStart: Uint32Array;
  arcRegions: Int32Array;
  ringArcs: Int32Array;
  ringStart: Uint32Array;
  regionRingStart: Uint32Array;
}

export interface TraceOptions {
  /** Rounds of neighbour-averaging applied to each arc. */
  smoothPasses: number;
  /** Max deviation (px) allowed when thinning out points. */
  tolerance: number;
}

// Directions in clockwise order (y points down): E, S, W, N.
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

export function traceRegions(
  reg: Int32Array | Uint16Array,
  w: number,
  h: number,
  regionCount: number,
  opts: TraceOptions,
): Geometry {
  const cw = w + 1; // corners per row
  const n = w * h;

  const regAt = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= w || y >= h ? -1 : reg[y * w + x];

  // --- Junction corners -----------------------------------------------------
  const junction = new Uint8Array(cw * (h + 1));
  for (let cy = 0; cy <= h; cy++) {
    for (let cx = 0; cx <= w; cx++) {
      const tl = regAt(cx - 1, cy - 1);
      const tr = regAt(cx, cy - 1);
      const bl = regAt(cx - 1, cy);
      const br = regAt(cx, cy);
      const degree =
        (tl !== tr ? 1 : 0) + (tr !== br ? 1 : 0) + (br !== bl ? 1 : 0) + (bl !== tl ? 1 : 0);
      if (degree >= 3) junction[cy * cw + cx] = 1;
    }
  }
  // Pin the picture's own corners so smoothing can't round them off.
  junction[0] = 1;
  junction[w] = 1;
  junction[h * cw] = 1;
  junction[h * cw + w] = 1;

  /**
   * Is there a border edge of region r leaving corner (cx,cy) in direction d?
   * Edges are directed so the region is always on the right-hand side, which
   * makes outer borders run clockwise and holes anticlockwise.
   */
  const edgeExists = (r: number, cx: number, cy: number, d: number): boolean => {
    switch (d) {
      case 0:
        return regAt(cx, cy) === r && regAt(cx, cy - 1) !== r;
      case 1:
        return regAt(cx - 1, cy) === r && regAt(cx, cy) !== r;
      case 2:
        return regAt(cx - 1, cy - 1) === r && regAt(cx - 1, cy) !== r;
      default:
        return regAt(cx, cy - 1) === r && regAt(cx - 1, cy - 1) !== r;
    }
  };
  /** Pixel index on the right-hand side of the edge (the pixel the edge belongs to). */
  const edgePixel = (cx: number, cy: number, d: number): number => {
    switch (d) {
      case 0:
        return cy * w + cx;
      case 1:
        return cy * w + cx - 1;
      case 2:
        return (cy - 1) * w + cx - 1;
      default:
        return (cy - 1) * w + cx;
    }
  };
  /** Region on the left-hand side of the edge (the neighbour across the border). */
  const edgeOther = (cx: number, cy: number, d: number): number => {
    switch (d) {
      case 0:
        return regAt(cx, cy - 1);
      case 1:
        return regAt(cx, cy);
      case 2:
        return regAt(cx - 1, cy);
      default:
        return regAt(cx - 1, cy - 1);
    }
  };
  const dirBetween = (from: number, to: number): number => {
    const diff = to - from;
    return diff === 1 ? 0 : diff === cw ? 1 : diff === -1 ? 2 : 3;
  };

  // --- Arc storage ------------------------------------------------------------
  const arcIndexByKey = new Map<number, number>();
  const points: number[] = [];
  const arcStart: number[] = [0];
  const arcRegions: number[] = [];
  const regionRings: number[][][] = Array.from({ length: regionCount }, () => []);

  const addArc = (corners: number[], closed: boolean, a: number, b: number): number => {
    const pts = closed ? smoothClosed(corners, cw, opts) : smoothOpen(corners, cw, opts);
    for (let i = 0; i < pts.length; i++) points.push(pts[i]);
    arcStart.push(points.length / 2);
    arcRegions.push(a, b);
    return arcStart.length - 2;
  };

  /** Registers one stretch of border walked by region r; returns a signed arc ref. */
  const openArcRef = (seg: number[], r: number): number => {
    const last = seg.length - 1;
    const fwdKey = seg[0] * 4 + dirBetween(seg[0], seg[1]);
    const revKey = seg[last] * 4 + dirBetween(seg[last], seg[last - 1]);
    const forward = fwdKey < revKey;
    const key = forward ? fwdKey : revKey;
    let index = arcIndexByKey.get(key);
    if (index === undefined) {
      const d = dirBetween(seg[0], seg[1]);
      const other = edgeOther(seg[0] % cw, Math.floor(seg[0] / cw), d);
      index = addArc(forward ? seg : seg.slice().reverse(), false, r, other);
      arcIndexByKey.set(key, index);
    }
    return forward ? index + 1 : -(index + 1);
  };

  const closedArcRef = (loop: number[], r: number): number => {
    const m = loop.length;
    let at = 0;
    for (let i = 1; i < m; i++) if (loop[i] < loop[at]) at = i;
    const next = loop[(at + 1) % m];
    const prev = loop[(at - 1 + m) % m];
    const forward = next < prev;
    const key = loop[at] * 4 + dirBetween(loop[at], forward ? next : prev);
    let index = arcIndexByKey.get(key);
    if (index === undefined) {
      const ordered: number[] = new Array(m);
      for (let i = 0; i < m; i++) {
        ordered[i] = loop[(((at + (forward ? i : -i)) % m) + m) % m];
      }
      const d = dirBetween(loop[0], loop[1]);
      const other = edgeOther(loop[0] % cw, Math.floor(loop[0] / cw), d);
      index = addArc(ordered, true, r, other);
      arcIndexByKey.set(key, index);
    }
    return forward ? index + 1 : -(index + 1);
  };

  // --- Walk every border loop -------------------------------------------------
  const visited = new Uint8Array(n); // one bit per pixel side
  for (let p = 0; p < n; p++) {
    const px = p % w;
    const py = (p - px) / w;
    const r = reg[p];
    for (let side = 0; side < 4; side++) {
      if (visited[p] & (1 << side)) continue;
      // Corner where this side's edge starts, walking clockwise round the pixel.
      const sx = px + (side === 1 || side === 2 ? 1 : 0);
      const sy = py + (side === 2 || side === 3 ? 1 : 0);
      if (!edgeExists(r, sx, sy, side)) continue;

      const loop: number[] = [];
      let cx = sx;
      let cy = sy;
      let d = side;
      do {
        visited[edgePixel(cx, cy, d)] |= 1 << d;
        loop.push(cy * cw + cx);
        cx += DX[d];
        cy += DY[d];
        // Prefer turning right: where a region touches itself diagonally this
        // keeps the walk hugging the same pixel instead of jumping the gap.
        const right = (d + 1) & 3;
        const left = (d + 3) & 3;
        if (edgeExists(r, cx, cy, right)) d = right;
        else if (!edgeExists(r, cx, cy, d)) d = left;
      } while (cx !== sx || cy !== sy || d !== side);

      // Cut the loop into arcs at junctions.
      const m = loop.length;
      let firstJunction = -1;
      for (let i = 0; i < m; i++) {
        if (junction[loop[i]]) {
          firstJunction = i;
          break;
        }
      }
      const ring: number[] = [];
      if (firstJunction < 0) {
        ring.push(closedArcRef(loop, r));
      } else {
        let seg: number[] = [loop[firstJunction]];
        for (let t = 1; t <= m; t++) {
          const c = loop[(firstJunction + t) % m];
          seg.push(c);
          if (junction[c]) {
            ring.push(openArcRef(seg, r));
            seg = [c];
          }
        }
      }
      regionRings[r].push(ring);
    }
  }

  // --- Flatten ------------------------------------------------------------------
  const ringArcs: number[] = [];
  const ringStart: number[] = [0];
  const regionRingStart = new Uint32Array(regionCount + 1);
  for (let r = 0; r < regionCount; r++) {
    for (const ring of regionRings[r]) {
      for (const ref of ring) ringArcs.push(ref);
      ringStart.push(ringArcs.length);
    }
    regionRingStart[r + 1] = ringStart.length - 1;
  }

  return {
    arcPoints: Float32Array.from(points),
    arcStart: Uint32Array.from(arcStart),
    arcRegions: Int32Array.from(arcRegions),
    ringArcs: Int32Array.from(ringArcs),
    ringStart: Uint32Array.from(ringStart),
    regionRingStart,
  };
}

/** Arc between two junctions: end points stay fixed, everything between is smoothed. */
function smoothOpen(corners: number[], cw: number, opts: TraceOptions): number[] {
  const n = corners.length;
  // Edge midpoints turn pixel staircases into straight diagonals.
  const count = n + 1;
  let xs = new Float64Array(count);
  let ys = new Float64Array(count);
  const cx = (c: number) => c % cw;
  const cy = (c: number) => Math.floor(c / cw);
  xs[0] = cx(corners[0]);
  ys[0] = cy(corners[0]);
  for (let i = 0; i < n - 1; i++) {
    xs[i + 1] = (cx(corners[i]) + cx(corners[i + 1])) / 2;
    ys[i + 1] = (cy(corners[i]) + cy(corners[i + 1])) / 2;
  }
  xs[count - 1] = cx(corners[n - 1]);
  ys[count - 1] = cy(corners[n - 1]);

  let tx = new Float64Array(count);
  let ty = new Float64Array(count);
  for (let pass = 0; pass < opts.smoothPasses; pass++) {
    tx[0] = xs[0];
    ty[0] = ys[0];
    tx[count - 1] = xs[count - 1];
    ty[count - 1] = ys[count - 1];
    for (let i = 1; i < count - 1; i++) {
      tx[i] = (xs[i - 1] + 2 * xs[i] + xs[i + 1]) / 4;
      ty[i] = (ys[i - 1] + 2 * ys[i] + ys[i + 1]) / 4;
    }
    [xs, tx] = [tx, xs];
    [ys, ty] = [ty, ys];
  }

  const keep = new Uint8Array(count);
  keep[0] = 1;
  keep[count - 1] = 1;
  simplifyRange(xs, ys, 0, count - 1, opts.tolerance, keep);
  const out: number[] = [];
  for (let i = 0; i < count; i++) if (keep[i]) out.push(xs[i], ys[i]);
  return out;
}

/** Border loop with no junctions (an island): smoothed all the way round. */
function smoothClosed(corners: number[], cw: number, opts: TraceOptions): number[] {
  const m = corners.length;
  let xs = new Float64Array(m);
  let ys = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % m];
    xs[i] = ((a % cw) + (b % cw)) / 2;
    ys[i] = (Math.floor(a / cw) + Math.floor(b / cw)) / 2;
  }
  let tx = new Float64Array(m);
  let ty = new Float64Array(m);
  for (let pass = 0; pass < opts.smoothPasses; pass++) {
    for (let i = 0; i < m; i++) {
      const p = (i - 1 + m) % m;
      const q = (i + 1) % m;
      tx[i] = (xs[p] + 2 * xs[i] + xs[q]) / 4;
      ty[i] = (ys[p] + 2 * ys[i] + ys[q]) / 4;
    }
    [xs, tx] = [tx, xs];
    [ys, ty] = [ty, ys];
  }

  // Simplify as two open halves split at point 0 and the point farthest from it.
  let far = 0;
  let farD = -1;
  for (let i = 1; i < m; i++) {
    const d = (xs[i] - xs[0]) ** 2 + (ys[i] - ys[0]) ** 2;
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  // Work on an unrolled copy with the first point repeated at the end.
  const ux = new Float64Array(m + 1);
  const uy = new Float64Array(m + 1);
  ux.set(xs);
  uy.set(ys);
  ux[m] = xs[0];
  uy[m] = ys[0];
  const keep = new Uint8Array(m + 1);
  keep[0] = 1;
  keep[far] = 1;
  keep[m] = 1;
  simplifyRange(ux, uy, 0, far, opts.tolerance, keep);
  simplifyRange(ux, uy, far, m, opts.tolerance, keep);
  const out: number[] = [];
  for (let i = 0; i <= m; i++) if (keep[i]) out.push(ux[i], uy[i]);
  return out;
}

/** Douglas–Peucker: marks the points needed to stay within `tol` of the original line. */
function simplifyRange(
  xs: Float64Array,
  ys: Float64Array,
  first: number,
  last: number,
  tol: number,
  keep: Uint8Array,
): void {
  const stack: number[] = [first, last];
  const tol2 = tol * tol;
  while (stack.length) {
    const b = stack.pop()!;
    const a = stack.pop()!;
    if (b - a < 2) continue;
    const ax = xs[a];
    const ay = ys[a];
    const dx = xs[b] - ax;
    const dy = ys[b] - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let worstD = tol2;
    for (let i = a + 1; i < b; i++) {
      const px = xs[i] - ax;
      const py = ys[i] - ay;
      let d: number;
      if (len2 === 0) {
        d = px * px + py * py;
      } else {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        const ex = px - t * dx;
        const ey = py - t * dy;
        d = ex * ex + ey * ey;
      }
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push(a, worst, worst, b);
    }
  }
}
