// sRGB <-> OKLab. OKLab is used for all colour maths because plain distance
// in it matches how different two colours look far better than RGB does.

const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb8(c: number): number {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

/** Converts RGBA bytes to three planar OKLab channels. */
export function rgbaToOklab(
  rgba: Uint8ClampedArray | Uint8Array,
  n: number,
): { L: Float32Array; A: Float32Array; B: Float32Array } {
  const L = new Float32Array(n);
  const A = new Float32Array(n);
  const B = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    // Flatten any transparency onto white paper.
    const alpha = rgba[p + 3] / 255;
    const r = SRGB_TO_LINEAR[rgba[p]] * alpha + (1 - alpha);
    const g = SRGB_TO_LINEAR[rgba[p + 1]] * alpha + (1 - alpha);
    const b = SRGB_TO_LINEAR[rgba[p + 2]] * alpha + (1 - alpha);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    L[i] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    A[i] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    B[i] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  }
  return { L, A, B };
}

export function oklabToRgb(L: number, A: number, B: number): [number, number, number] {
  const l = Math.pow(L + 0.3963377774 * A + 0.2158037573 * B, 3);
  const m = Math.pow(L - 0.1055613458 * A - 0.0638541728 * B, 3);
  const s = Math.pow(L - 0.0894841775 * A - 1.291485548 * B, 3);
  return [
    linearToSrgb8(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb8(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb8(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}
