import type { GenerateOptions, Puzzle } from '../types';
import { oklabToRgb, rgbaToOklab } from './color';
import { kmeans, mergeCloseColors } from './quantize';
import { chamferDistance, labelRegions, mergeSmallRegions, modeFilter } from './regions';
import { kuwahara } from './smooth';
import { traceRegions } from './trace';

export const MIN_COLORS = 6;
export const MAX_COLORS = 80;
export const MAX_DETAIL = 7;
export const DEFAULT_OPTIONS: GenerateOptions = { colors: 20, detail: 3 };

/**
 * Longest side, in pixels, that a photo is scaled to before conversion. The
 * finest detail levels work on a bigger copy so that their very small
 * sections still have clean shapes.
 */
export function workingSizeFor(detail: number): number {
  return detail >= 7 ? 1500 : detail === 6 ? 1250 : 1000;
}

interface Tuning {
  smoothRadius: number;
  modeRadius: number;
  minArea: number;
  minRadius: number;
}

// One row per detail level, for a 1000 x 750 picture:
//   smoothing radius, border-cleaning radius, smallest section area,
//   smallest section "inner radius" (how big a circle must fit inside).
const LEVELS = [
  [9, 5, 1400, 7],
  [8, 4, 640, 5.8],
  [6, 4, 290, 4.6],
  [5, 3, 132, 3.4],
  [3, 2, 60, 2.2],
  [2, 1, 36, 1.8],
  [1, 1, 20, 1.5],
];

/** Maps the detail slider onto the pipeline's knobs. */
export function tuningFor(detail: number, pixelCount: number): Tuning {
  const level = LEVELS[Math.max(1, Math.min(MAX_DETAIL, Math.round(detail))) - 1];
  // Knobs are specified for a 1000 x 750 picture and scale with the real size.
  const scale = Math.sqrt(pixelCount / 750000);
  return {
    smoothRadius: Math.max(1, Math.round(level[0] * scale)),
    modeRadius: Math.max(1, Math.round(level[1] * scale)),
    minArea: Math.max(12, Math.round(level[2] * scale * scale)),
    minRadius: Math.max(1.5, level[3] * scale),
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

  const wanted = Math.max(MIN_COLORS, Math.min(MAX_COLORS, Math.round(options.colors)));
  const clustered = kmeans(smooth.L, smooth.A, smooth.B, n, wanted);
  // Near-identical paints are merged so two numbers never look the same. With
  // a big palette the colours are meant to sit closer, so the bar is lowered.
  const tooClose = 0.035 * Math.min(1, Math.pow(24 / wanted, 0.75));
  const { centers, labels } = mergeCloseColors(clustered.centers, clustered.labels, tooClose);
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

  const geometry = traceRegions(reg, w, h, count, {
    smoothPasses: 6,
    tolerance: 0.04 * Math.max(1, Math.max(w, h) / 1000),
  });

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
