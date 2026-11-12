/** Small deterministic PRNG so the same photo + settings always gives the same picture. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Reduces the image to `k` colours with k-means clustering in OKLab.
 * Returns the cluster centres and the cluster index of every pixel.
 */
export function kmeans(
  L: Float32Array,
  A: Float32Array,
  B: Float32Array,
  n: number,
  k: number,
): { centers: Float32Array; labels: Uint8Array } {
  const rand = mulberry32(0xc0ffee);

  // Cluster on a random sample; assigning every pixel each round is wasted work.
  const sampleCount = Math.min(n, 40000);
  const sL = new Float32Array(sampleCount);
  const sA = new Float32Array(sampleCount);
  const sB = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const j = sampleCount === n ? i : Math.floor(rand() * n);
    sL[i] = L[j];
    sA[i] = A[j];
    sB[i] = B[j];
  }

  k = Math.max(2, Math.min(k, 255, sampleCount));
  const centers = new Float32Array(k * 3);

  // k-means++ seeding: spread the starting colours out so that small but
  // distinctive colours (a red flower in a green field) get their own cluster.
  const d2 = new Float32Array(sampleCount).fill(Infinity);
  let pick = Math.floor(rand() * sampleCount);
  for (let c = 0; c < k; c++) {
    centers[c * 3] = sL[pick];
    centers[c * 3 + 1] = sA[pick];
    centers[c * 3 + 2] = sB[pick];
    let total = 0;
    for (let i = 0; i < sampleCount; i++) {
      const dl = sL[i] - sL[pick];
      const da = sA[i] - sA[pick];
      const db = sB[i] - sB[pick];
      const d = dl * dl + da * da + db * db;
      if (d < d2[i]) d2[i] = d;
      total += d2[i];
    }
    if (total <= 0) {
      // Fewer distinct colours than clusters.
      k = c + 1;
      break;
    }
    let target = rand() * total;
    pick = sampleCount - 1;
    for (let i = 0; i < sampleCount; i++) {
      target -= d2[i];
      if (target <= 0) {
        pick = i;
        break;
      }
    }
  }

  const assign = new Uint8Array(sampleCount);
  const sums = new Float64Array(k * 3);
  const counts = new Int32Array(k);
  for (let iter = 0; iter < 16; iter++) {
    sums.fill(0);
    counts.fill(0);
    let changed = 0;
    for (let i = 0; i < sampleCount; i++) {
      const l = sL[i];
      const a = sA[i];
      const b = sB[i];
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const dl = l - centers[c * 3];
        const da = a - centers[c * 3 + 1];
        const db = b - centers[c * 3 + 2];
        const d = dl * dl + da * da + db * db;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (assign[i] !== best) {
        assign[i] = best;
        changed++;
      }
      sums[best * 3] += l;
      sums[best * 3 + 1] += a;
      sums[best * 3 + 2] += b;
      counts[best]++;
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) {
        centers[c * 3] = sums[c * 3] / counts[c];
        centers[c * 3 + 1] = sums[c * 3 + 1] / counts[c];
        centers[c * 3 + 2] = sums[c * 3 + 2] / counts[c];
      }
    }
    if (iter > 0 && changed < sampleCount * 0.001) break;
  }

  const finalCenters = centers.slice(0, k * 3);
  return { centers: finalCenters, labels: assignAll(L, A, B, n, finalCenters) };
}

/**
 * Merges palette colours that are too alike to tell apart on a swatch, so the
 * player never has two numbers that look like the same paint.
 */
export function mergeCloseColors(
  centers: Float32Array,
  labels: Uint8Array,
  threshold: number,
): { centers: Float32Array; labels: Uint8Array } {
  const k = centers.length / 3;
  const weight = new Float64Array(k);
  for (let i = 0; i < labels.length; i++) weight[labels[i]]++;
  const c = Float64Array.from(centers);
  const target = new Int32Array(k).map((_, i) => i); // which colour each one became
  const alive = new Uint8Array(k).fill(1);

  for (;;) {
    let bestA = -1;
    let bestB = -1;
    let bestD = threshold * threshold;
    for (let a = 0; a < k; a++) {
      if (!alive[a]) continue;
      for (let b = a + 1; b < k; b++) {
        if (!alive[b]) continue;
        const dl = c[a * 3] - c[b * 3];
        const da = c[a * 3 + 1] - c[b * 3 + 1];
        const db = c[a * 3 + 2] - c[b * 3 + 2];
        const d = dl * dl + da * da + db * db;
        if (d < bestD) {
          bestD = d;
          bestA = a;
          bestB = b;
        }
      }
    }
    if (bestA < 0) break;
    const total = weight[bestA] + weight[bestB];
    for (let j = 0; j < 3; j++) {
      c[bestA * 3 + j] =
        total > 0
          ? (c[bestA * 3 + j] * weight[bestA] + c[bestB * 3 + j] * weight[bestB]) / total
          : c[bestA * 3 + j];
    }
    weight[bestA] = total;
    alive[bestB] = 0;
    for (let i = 0; i < k; i++) if (target[i] === bestB) target[i] = bestA;
  }

  const index = new Int32Array(k).fill(-1);
  const out: number[] = [];
  for (let i = 0; i < k; i++) {
    if (!alive[i]) continue;
    index[i] = out.length / 3;
    out.push(c[i * 3], c[i * 3 + 1], c[i * 3 + 2]);
  }
  const merged = new Uint8Array(labels.length);
  for (let i = 0; i < labels.length; i++) merged[i] = index[target[labels[i]]];
  return { centers: Float32Array.from(out), labels: merged };
}

function assignAll(
  L: Float32Array,
  A: Float32Array,
  B: Float32Array,
  n: number,
  centers: Float32Array,
): Uint8Array {
  const k = centers.length / 3;
  const labels = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const l = L[i];
    const a = A[i];
    const b = B[i];
    let best = 0;
    let bestD = Infinity;
    for (let c = 0; c < k; c++) {
      const dl = l - centers[c * 3];
      const da = a - centers[c * 3 + 1];
      const db = b - centers[c * 3 + 2];
      const d = dl * dl + da * da + db * db;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    labels[i] = best;
  }
  return labels;
}
