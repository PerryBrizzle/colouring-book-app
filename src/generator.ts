import { WORKING_SIZE } from './pipeline';
import type { GenerateOptions, Puzzle } from './types';
import type { GenerateRequest, GenerateResponse } from './worker';

/** Decodes a photo and scales it down to the size the converter works at. */
export async function loadPhoto(file: Blob): Promise<ImageData> {
  // 'from-image' applies the phone's rotation tag so portraits stay upright.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, WORKING_SIZE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return ctx.getImageData(0, 0, w, h);
}

export class CancelledError extends Error {}

/**
 * Converts photos in a background worker. Asking for a new conversion while
 * one is running abandons the old one, so dragging a slider stays snappy.
 */
export class Generator {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending: { id: number; reject: (e: Error) => void } | null = null;

  generate(image: ImageData, options: GenerateOptions): Promise<Puzzle> {
    if (this.pending) {
      this.pending.reject(new CancelledError());
      this.pending = null;
      this.worker?.terminate();
      this.worker = null;
    }
    this.worker ??= new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    const worker = this.worker;
    const id = this.nextId++;
    return new Promise<Puzzle>((resolve, reject) => {
      this.pending = { id, reject };
      worker.onmessage = (e: MessageEvent<GenerateResponse>) => {
        if (e.data.id !== id) return;
        this.pending = null;
        if (e.data.ok) resolve(e.data.puzzle);
        else reject(new Error(e.data.error));
      };
      worker.onerror = (e) => {
        this.pending = null;
        reject(new Error(e.message || 'Conversion failed'));
      };
      // Copy the pixels: the original is reused for the next slider change.
      const data = image.data.buffer.slice(0) as ArrayBuffer;
      const request: GenerateRequest = { id, width: image.width, height: image.height, data, options };
      worker.postMessage(request, [data]);
    });
  }

  dispose(): void {
    this.pending?.reject(new CancelledError());
    this.pending = null;
    this.worker?.terminate();
    this.worker = null;
  }
}
