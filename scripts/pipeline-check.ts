// Sanity checks for the conversion pipeline on a synthetic "photo".
// Run with: npm run test:pipeline
import { generatePuzzle } from '../src/pipeline/index';
import type { Puzzle } from '../src/types';

function syntheticPhoto(w: number, h: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const blobs = Array.from({ length: 14 }, () => ({
    x: rand() * w,
    y: rand() * h,
    r: 10 + rand() * 60,
    c: [rand() * 255, rand() * 255, rand() * 255],
  }));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Sky-to-ground gradient with diagonal stripes, blobs on top, plus noise.
      let r = 80 + (150 * y) / h;
      let g = 140 + (60 * x) / w;
      let b = 220 - (150 * y) / h;
      if (((x + y) >> 4) % 3 === 0) {
        r *= 0.8;
        g *= 0.9;
      }
      for (const blob of blobs) {
        if ((x - blob.x) ** 2 + (y - blob.y) ** 2 < blob.r ** 2) [r, g, b] = blob.c;
      }
      const noise = (rand() - 0.5) * 40;
      const i = (y * w + x) * 4;
      data[i] = r + noise;
      data[i + 1] = g + noise;
      data[i + 2] = b + noise;
      data[i + 3] = 255;
    }
  }
  return data;
}

function arcEnds(p: Puzzle, ref: number): [number, number, number, number] {
  const i = Math.abs(ref) - 1;
  const a = p.arcStart[i] * 2;
  const b = p.arcStart[i + 1] * 2 - 2;
  const start: [number, number] = [p.arcPoints[a], p.arcPoints[a + 1]];
  const end: [number, number] = [p.arcPoints[b], p.arcPoints[b + 1]];
  return ref > 0 ? [...start, ...end] : [...end, ...start];
}

/** Shoelace area of one ring (positive = clockwise on screen). */
function ringArea(p: Puzzle, ring: number): number {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let j = p.ringStart[ring]; j < p.ringStart[ring + 1]; j++) {
    const ref = p.ringArcs[j];
    const i = Math.abs(ref) - 1;
    const from = p.arcStart[i];
    const to = p.arcStart[i + 1];
    if (ref > 0) {
      for (let q = from; q < to; q++) {
        xs.push(p.arcPoints[q * 2]);
        ys.push(p.arcPoints[q * 2 + 1]);
      }
    } else {
      for (let q = to - 1; q >= from; q--) {
        xs.push(p.arcPoints[q * 2]);
        ys.push(p.arcPoints[q * 2 + 1]);
      }
    }
  }
  let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    const j = (i + 1) % xs.length;
    sum += xs[i] * ys[j] - xs[j] * ys[i];
  }
  return sum / 2;
}

let failures = 0;
function check(ok: boolean, message: string) {
  if (!ok) {
    failures++;
    console.error('  FAIL: ' + message);
  }
}

for (const [w, h, colors, detail] of [
  [400, 300, 12, 3],
  [400, 300, 24, 5],
  [333, 500, 8, 1],
  [1000, 750, 20, 3],
  [1500, 1125, 80, 7],
] as const) {
  const t0 = performance.now();
  const p = generatePuzzle(syntheticPhoto(w, h), w, h, { colors, detail });
  const ms = Math.round(performance.now() - t0);
  const arcCount = p.arcStart.length - 1;
  console.log(
    `${w}x${h} colours=${colors} detail=${detail}: ${p.regionCount} regions, ` +
      `${p.palette.length / 3} colours, ${arcCount} arcs, ${p.arcPoints.length / 2} points, ${ms} ms`,
  );

  // Every pixel belongs to a real region and areas add up.
  let areaSum = 0;
  for (let r = 0; r < p.regionCount; r++) areaSum += p.regionArea[r];
  check(areaSum === w * h, 'region areas should cover the picture');
  check(p.regionShade?.length === p.regionCount * 3, 'every region should have its own shade');

  // Each arc is used once by each of its two regions (once if it is on the picture edge).
  const uses = new Int32Array(arcCount);
  for (const ref of p.ringArcs) uses[Math.abs(ref) - 1]++;
  let badUses = 0;
  for (let i = 0; i < arcCount; i++) {
    const expected = p.arcRegions[i * 2 + 1] < 0 || p.arcRegions[i * 2] < 0 ? 1 : 2;
    if (uses[i] !== expected) badUses++;
  }
  check(badUses === 0, `${badUses} arcs not shared correctly`);

  // Rings are closed chains and their areas match the pixel areas.
  let open = 0;
  let total = 0;
  let worst = 0;
  for (let r = 0; r < p.regionCount; r++) {
    let regionArea = 0;
    for (let ring = p.regionRingStart[r]; ring < p.regionRingStart[r + 1]; ring++) {
      const from = p.ringStart[ring];
      const to = p.ringStart[ring + 1];
      for (let j = from; j < to; j++) {
        const next = j + 1 < to ? j + 1 : from;
        const a = arcEnds(p, p.ringArcs[j]);
        const b = arcEnds(p, p.ringArcs[next]);
        if (a[2] !== b[0] || a[3] !== b[1]) open++;
      }
      regionArea += ringArea(p, ring);
    }
    total += regionArea;
    worst = Math.max(worst, Math.abs(regionArea - p.regionArea[r]) / p.regionArea[r]);
    check(p.regionRingStart[r + 1] > p.regionRingStart[r], `region ${r} has no outline`);
  }
  check(open === 0, `${open} ring joints do not meet`);
  check(Math.abs(total - w * h) < 0.5, `vector areas sum to ${total}, expected ${w * h}`);
  console.log(`  worst area change from smoothing: ${(worst * 100).toFixed(1)}%`);

  // Numbers sit inside their own section, with room to be read.
  let misplaced = 0;
  let minR = Infinity;
  let minArea = Infinity;
  for (let r = 0; r < p.regionCount; r++) {
    const at = Math.floor(p.labelY[r]) * w + Math.floor(p.labelX[r]);
    if (p.regionMap[at] !== r) misplaced++;
    minR = Math.min(minR, p.labelR[r]);
    minArea = Math.min(minArea, p.regionArea[r]);
  }
  check(misplaced === 0, `${misplaced} numbers outside their section`);
  console.log(`  smallest section: ${minArea}px area, ${minR.toFixed(1)}px radius`);
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll pipeline checks passed');
