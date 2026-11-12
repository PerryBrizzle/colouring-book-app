/**
 * Kuwahara filter: an edge-preserving "painterly" smoother.
 *
 * For every pixel it looks at the four square windows that have the pixel in
 * one corner, and takes the average colour of whichever window is the most
 * uniform. Flat areas get flatter and texture disappears, but edges stay
 * crisp because a window that straddles an edge is never the most uniform.
 *
 * Summed-area tables make the cost independent of the radius.
 */
export function kuwahara(
  L: Float32Array,
  A: Float32Array,
  B: Float32Array,
  w: number,
  h: number,
  radius: number,
): { L: Float32Array; A: Float32Array; B: Float32Array } {
  const n = w * h;
  const sw = w + 1;
  const sL = new Float64Array(sw * (h + 1));
  const sA = new Float64Array(sw * (h + 1));
  const sB = new Float64Array(sw * (h + 1));
  const sQ = new Float64Array(sw * (h + 1)); // sum of squares, all channels

  for (let y = 0; y < h; y++) {
    let rl = 0;
    let ra = 0;
    let rb = 0;
    let rq = 0;
    const row = (y + 1) * sw;
    const prev = y * sw;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const l = L[i];
      const a = A[i];
      const b = B[i];
      rl += l;
      ra += a;
      rb += b;
      rq += l * l + a * a + b * b;
      sL[row + x + 1] = sL[prev + x + 1] + rl;
      sA[row + x + 1] = sA[prev + x + 1] + ra;
      sB[row + x + 1] = sB[prev + x + 1] + rb;
      sQ[row + x + 1] = sQ[prev + x + 1] + rq;
    }
  }

  const oL = new Float32Array(n);
  const oA = new Float32Array(n);
  const oB = new Float32Array(n);

  for (let y = 0; y < h; y++) {
    const yTop = Math.max(0, y - radius);
    const yBot = Math.min(h - 1, y + radius);
    for (let x = 0; x < w; x++) {
      const xLeft = Math.max(0, x - radius);
      const xRight = Math.min(w - 1, x + radius);
      let best = Infinity;
      let bl = 0;
      let ba = 0;
      let bb = 0;
      for (let q = 0; q < 4; q++) {
        const x0 = q & 1 ? x : xLeft;
        const x1 = q & 1 ? xRight : x;
        const y0 = q & 2 ? y : yTop;
        const y1 = q & 2 ? yBot : y;
        const i00 = y0 * sw + x0;
        const i01 = y0 * sw + x1 + 1;
        const i10 = (y1 + 1) * sw + x0;
        const i11 = (y1 + 1) * sw + x1 + 1;
        const cnt = (x1 - x0 + 1) * (y1 - y0 + 1);
        const ml = (sL[i11] - sL[i01] - sL[i10] + sL[i00]) / cnt;
        const ma = (sA[i11] - sA[i01] - sA[i10] + sA[i00]) / cnt;
        const mb = (sB[i11] - sB[i01] - sB[i10] + sB[i00]) / cnt;
        const variance =
          (sQ[i11] - sQ[i01] - sQ[i10] + sQ[i00]) / cnt - (ml * ml + ma * ma + mb * mb);
        if (variance < best) {
          best = variance;
          bl = ml;
          ba = ma;
          bb = mb;
        }
      }
      const i = y * w + x;
      oL[i] = bl;
      oA[i] = ba;
      oB[i] = bb;
    }
  }
  return { L: oL, A: oA, B: oB };
}
