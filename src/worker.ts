// Runs the photo conversion off the main thread so the screen stays responsive.
import { generatePuzzle, puzzleBuffers } from './pipeline';
import type { GenerateOptions, Puzzle } from './types';

export interface GenerateRequest {
  id: number;
  width: number;
  height: number;
  data: ArrayBuffer;
  options: GenerateOptions;
}

export type GenerateResponse =
  | { id: number; ok: true; puzzle: Puzzle }
  | { id: number; ok: false; error: string };

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<GenerateRequest>) => void) | null;
  postMessage(message: GenerateResponse, transfer?: Transferable[]): void;
};

scope.onmessage = (e) => {
  const { id, width, height, data, options } = e.data;
  try {
    const puzzle = generatePuzzle(new Uint8ClampedArray(data), width, height, options);
    scope.postMessage({ id, ok: true, puzzle }, puzzleBuffers(puzzle));
  } catch (err) {
    scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
