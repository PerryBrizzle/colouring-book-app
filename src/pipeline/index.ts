import type { GenerateOptions, Puzzle } from '../types';
import { oklabToRgb, rgbaToOklab } from './color';
import { kmeans, mergeCloseColors } from './quantize';
import { chamferDistance, labelRegions, mergeSmallRegions, modeFilter } from './regions';
import { kuwahara } from './smooth';
import { traceRegions } from './trace';

/** Longest side, in pixels, that photos are scaled to before conversion. */
export const WORKING_SIZE = 1000;

export const DEFAULT_OPTIONS: GenerateOptions = { colors: 20, detail: 3 };

interface Tuning {
  smoothRadius: number;
  modeRadius: number;
  minArea: number;
  minRadius: number;
}

/** Maps the 1–5 detail slider onto the pipeline's knobs. */
export function tuningFor(detail: number, pixelCount: number): Tuning {
  const t = Math.max(0, Math.min(1, (detail - 1) / 4));
  // Knobs are specified for a full-size (1000 x 750) picture and shrink with it.
  const scale = Math.sqrt(pixelCount / 750000);
  const lerp = (a: number, b: number) => a + (b - a) * t;
  return {
    smoothRadius: Math.max(1, Math.round(lerp(9, 3) * scale)),
    modeRadius: Math.max(1, Math.round(lerp(5, 2) * scale)),
    minArea: Math.max(12, Math.round(1400 * Math.pow(60 / 1400, t) * scale * scale)),
    minRadius: Math.max(1.5, lerp(7, 2.2) * scale),
  };
}

/**
 * Converts an RGBA image into a colour-by-number puzzle.
 *
 *   smooth -> reduce colours -> clean borders -> dissolve tiny sections
 *   -> number the sections -> trace vector outlines
 */
export function generatePuzzle(
  rgba: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  options: GenerateOptions,
): Puzzle {
  const n = w * h;
  const tune = tuningFor(options.detail, n);

  const original = rgbaToOklab(rgba, n);
  const smooth = kuwahara(original.L, original.A, original.B, w, h, tune.smoothRadius);

  const clustered = kmeans(smooth.L, smooth.A, smooth.B, n, options.colors);
  const { centers, labels } = mergeCloseColors(clustered.centers, clustered.labels, 0.035);
  const k = centers.length / 3;

  const colors = modeFilter(labels, w, h, k, tune.modeRadius);
  mergeSmallRegions(colors, w, h, centers, tune.minArea, tune.minRadius);

  const reg = new Int32Array(n);
  const { count, area, color } = labelRegions(colors, w, h, reg);
  if (count > 65535) throw new Error('Picture has too many sections');

  // --- Palette: true average colour of what each paint ends up covering -------
  const sums = new Float64Array(k * 3);
  const used = new Float64Array(k);
  for (let p = 0; p < n; p++) {
    const c = colors[p];
    sums[c * 3] += original.L[p];
    sums[c * 3 + 1] += original.A[p];
    sums[c * 3 + 2] += original.B[p];
    used[c]++;
  }
  const entries: { old: number; L: number; A: number; B: number }[] = [];
  for (let c = 0; c < k; c++) {
    if (used[c] === 0) continue;
    entries.push({
      old: c,
      L: sums[c * 3] / used[c],
      A: sums[c * 3 + 1] / used[c],
      B: sums[c * 3 + 2] / used[c],
    });
  }
  // Order the paints: greys first (light to dark), then round the colour wheel.
  const isGrey = (e: { A: number; B: number }) => Math.hypot(e.A, e.B) < 0.035;
  entries.sort((x, y) => {
    const gx = isGrey(x);
    const gy = isGrey(y);
    if (gx !== gy) return gx ? -1 : 1;
    if (gx) return y.L - x.L;
    return Math.atan2(x.B, x.A) - Math.atan2(y.B, y.A) || y.L - x.L;
  });
  const palette = new Uint8Array(entries.length * 3);
  const remap = new Uint8Array(k);
  entries.forEach((e, i) => {
    const [r, g, b] = oklabToRgb(e.L, e.A, e.B);
    palette[i * 3] = r;
    palette[i * 3 + 1] = g;
    palette[i * 3 + 2] = b;
    remap[e.old] = i;
  });

  // --- Per-region info --------------------------------------------------------
  const regionColor = new Uint8Array(count);
  for (let r = 0; r < count; r++) regionColor[r] = remap[color[r]];

  const dist = new Int32Array(n);
  chamferDistance(reg, w, h, dist);
  const peak = new Int32Array(count);
  const sumX = new Float64Array(count);
  const sumY = new Float64Array(count);
  const regionBox = new Uint16Array(count * 4);
  for (let r = 0; r < count; r++) {
    regionBox[r * 4] = 65535;
    regionBox[r * 4 + 1] = 65535;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const r = reg[p];
      if (dist[p] > peak[r]) peak[r] = dist[p];
      sumX[r] += x;
      sumY[r] += y;
      const b = r * 4;
      if (x < regionBox[b]) regionBox[b] = x;
      if (y < regionBox[b + 1]) regionBox[b + 1] = y;
      if (x + 1 > regionBox[b + 2]) regionBox[b + 2] = x + 1;
      if (y + 1 > regionBox[b + 3]) regionBox[b + 3] = y + 1;
    }
  }
  // Number goes at the roomiest spot; among near-equal spots, the most central.
  const labelX = new Float32Array(count);
  const labelY = new Float32Array(count);
  const labelR = new Float32Array(count);
  const bestScore = new Float64Array(count).fill(Infinity);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const r = reg[p];
      if (dist[p] < peak[r] * 0.9) continue;
      const dx = x - sumX[r] / area[r];
      const dy = y - sumY[r] / area[r];
      const score = dx * dx + dy * dy;
      if (score < bestScore[r]) {
        bestScore[r] = score;
        labelX[r] = x + 0.5;
        labelY[r] = y + 0.5;
        labelR[r] = dist[p] / 3;
      }
    }
  }

  const geometry = traceRegions(reg, w, h, count, { smoothPasses: 6, tolerance: 0.04 });

  return {
    width: w,
    height: h,
    palette,
    regionMap: Uint16Array.from(reg),
    regionCount: count,
    regionColor,
    regionArea: Uint32Array.from(area),
    regionBox,
    labelX,
    labelY,
    labelR,
    ...geometry,
  };
}

/** Every buffer inside a puzzle, for zero-copy transfer out of the worker. */
export function puzzleBuffers(p: Puzzle): ArrayBuffer[] {
  return [
    p.palette,
    p.regionMap,
    p.regionColor,
    p.regionArea,
    p.regionBox,
    p.labelX,
    p.labelY,
    p.labelR,
    p.arcPoints,
    p.arcStart,
    p.arcRegions,
    p.ringArcs,
    p.ringStart,
    p.regionRingStart,
  ].map((a) => a.buffer as ArrayBuffer);
}
