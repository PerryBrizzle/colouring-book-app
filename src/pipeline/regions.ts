/**
 * Majority filter: every pixel takes the most common colour in the square
 * window around it. Removes speckle and straightens ragged borders without
 * inventing new colours. Uses a sliding histogram so cost is O(radius).
 */
export function modeFilter(
  labels: Uint8Array,
  w: number,
  h: number,
  k: number,
  radius: number,
): Uint8Array {
  const out = new Uint8Array(labels.length);
  const hist = new Int32Array(k);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(h - 1, y + radius);
    hist.fill(0);
    for (let xx = 0; xx <= Math.min(radius, w - 1); xx++) {
      for (let yy = y0; yy <= y1; yy++) hist[labels[yy * w + xx]]++;
    }
    for (let x = 0; x < w; x++) {
      const cur = labels[y * w + x];
      let best = cur;
      let bestCount = hist[cur];
      for (let c = 0; c < k; c++) {
        if (hist[c] > bestCount) {
          bestCount = hist[c];
          best = c;
        }
      }
      out[y * w + x] = best;
      const drop = x - radius;
      if (drop >= 0) {
        for (let yy = y0; yy <= y1; yy++) hist[labels[yy * w + drop]]--;
      }
      const add = x + radius + 1;
      if (add < w) {
        for (let yy = y0; yy <= y1; yy++) hist[labels[yy * w + add]]++;
      }
    }
  }
  return out;
}

/**
 * Labels 4-connected areas of equal colour. Writes a region id per pixel into
 * `out` and returns each region's area and colour.
 */
export function labelRegions(
  colors: Uint8Array,
  w: number,
  h: number,
  out: Int32Array,
): { count: number; area: Int32Array; color: Uint8Array } {
  const n = w * h;
  out.fill(-1);
  const stack = new Int32Array(n);
  const areas: number[] = [];
  const cols: number[] = [];
  let count = 0;
  for (let start = 0; start < n; start++) {
    if (out[start] !== -1) continue;
    const c = colors[start];
    let top = 0;
    stack[top++] = start;
    out[start] = count;
    let area = 0;
    while (top > 0) {
      const p = stack[--top];
      area++;
      const x = p % w;
      if (x > 0 && out[p - 1] === -1 && colors[p - 1] === c) {
        out[p - 1] = count;
        stack[top++] = p - 1;
      }
      if (x < w - 1 && out[p + 1] === -1 && colors[p + 1] === c) {
        out[p + 1] = count;
        stack[top++] = p + 1;
      }
      if (p >= w && out[p - w] === -1 && colors[p - w] === c) {
        out[p - w] = count;
        stack[top++] = p - w;
      }
      if (p + w < n && out[p + w] === -1 && colors[p + w] === c) {
        out[p + w] = count;
        stack[top++] = p + w;
      }
    }
    areas.push(area);
    cols.push(c);
    count++;
  }
  return { count, area: Int32Array.from(areas), color: Uint8Array.from(cols) };
}

/**
 * Distance from every pixel to the nearest pixel of a different region (or the
 * picture edge), by two-pass 3-4 chamfer. Result is in thirds of a pixel.
 * The peak inside a region tells us how big a circle fits there, which is
 * what decides whether a number is readable and the section is tappable.
 */
export function chamferDistance(reg: Int32Array, w: number, h: number, dist: Int32Array): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const r = reg[p];
      let d = 1 << 29;
      // left, up-left, up, up-right
      if (x === 0 || y === 0 || x === w - 1) d = 3;
      if (x > 0) {
        const c = reg[p - 1] === r ? dist[p - 1] + 3 : 3;
        if (c < d) d = c;
        if (y > 0) {
          const c2 = reg[p - w - 1] === r ? dist[p - w - 1] + 4 : 4;
          if (c2 < d) d = c2;
        }
      }
      if (y > 0) {
        const c = reg[p - w] === r ? dist[p - w] + 3 : 3;
        if (c < d) d = c;
        if (x < w - 1) {
          const c2 = reg[p - w + 1] === r ? dist[p - w + 1] + 4 : 4;
          if (c2 < d) d = c2;
        }
      }
      dist[p] = d;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const p = y * w + x;
      const r = reg[p];
      let d = dist[p];
      if (y === h - 1) d = Math.min(d, 3);
      if (x < w - 1) {
        const c = reg[p + 1] === r ? dist[p + 1] + 3 : 3;
        if (c < d) d = c;
        if (y < h - 1) {
          const c2 = reg[p + w + 1] === r ? dist[p + w + 1] + 4 : 4;
          if (c2 < d) d = c2;
        }
      }
      if (y < h - 1) {
        const c = reg[p + w] === r ? dist[p + w] + 3 : 3;
        if (c < d) d = c;
        if (x > 0) {
          const c2 = reg[p + w - 1] === r ? dist[p + w - 1] + 4 : 4;
          if (c2 < d) d = c2;
        }
      }
      dist[p] = d;
    }
  }
}

/**
 * Repeatedly dissolves regions that are too small or too thin to colour into
 * whichever neighbouring colour they share the longest border with.
 * Modifies `colors` in place.
 */
export function mergeSmallRegions(
  colors: Uint8Array,
  w: number,
  h: number,
  centers: Float32Array,
  minArea: number,
  minRadius: number,
): void {
  const n = w * h;
  const k = centers.length / 3;
  const reg = new Int32Array(n);
  const dist = new Int32Array(n);
  const votes = new Int32Array(k);
  const minDist = Math.round(minRadius * 3);

  for (let iter = 0; iter < 40; iter++) {
    const { count, area } = labelRegions(colors, w, h, reg);
    if (count <= 1) return;
    chamferDistance(reg, w, h, dist);
    const peak = new Int32Array(count);
    for (let p = 0; p < n; p++) {
      if (dist[p] > peak[reg[p]]) peak[reg[p]] = dist[p];
    }

    // Collect the pixels of every too-small region.
    const small: number[] = [];
    const offset = new Int32Array(count).fill(-1);
    let total = 0;
    for (let r = 0; r < count; r++) {
      if (area[r] < minArea || peak[r] < minDist) {
        small.push(r);
        offset[r] = total;
        total += area[r];
      }
    }
    if (small.length === 0) return;
    const pixels = new Int32Array(total);
    const cursor = new Int32Array(count);
    for (let p = 0; p < n; p++) {
      const r = reg[p];
      if (offset[r] >= 0) pixels[offset[r] + cursor[r]++] = p;
    }

    // Smallest first, so specks vanish before the things they sit on are judged.
    small.sort((a, b) => area[a] - area[b]);
    for (const r of small) {
      const from = offset[r];
      const to = from + area[r];
      const own = colors[pixels[from]];
      votes.fill(0);
      for (let i = from; i < to; i++) {
        const p = pixels[i];
        const x = p % w;
        if (x > 0 && reg[p - 1] !== r) votes[colors[p - 1]]++;
        if (x < w - 1 && reg[p + 1] !== r) votes[colors[p + 1]]++;
        if (p >= w && reg[p - w] !== r) votes[colors[p - w]]++;
        if (p + w < n && reg[p + w] !== r) votes[colors[p + w]]++;
      }
      // A neighbour already changed to our colour this round: we have merged
      // with it, so wait for the next round to see if the result is big enough.
      if (votes[own] > 0) continue;
      let best = -1;
      let bestVotes = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        if (votes[c] === 0 || votes[c] < bestVotes) continue;
        const dl = centers[c * 3] - centers[own * 3];
        const da = centers[c * 3 + 1] - centers[own * 3 + 1];
        const db = centers[c * 3 + 2] - centers[own * 3 + 2];
        const d = dl * dl + da * da + db * db;
        if (votes[c] > bestVotes || d < bestD) {
          best = c;
          bestVotes = votes[c];
          bestD = d;
        }
      }
      if (best < 0) continue;
      for (let i = from; i < to; i++) colors[pixels[i]] = best;
    }
  }
}
