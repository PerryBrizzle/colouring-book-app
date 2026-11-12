import type { Puzzle, PuzzleMeta } from './types';

// Everything lives on the device in IndexedDB:
//   meta     - small records for the library screen
//   puzzle   - the converted picture (large typed arrays)
//   progress - which sections have been coloured

const DB_NAME = 'colouring-book';
export const LIBRARY_CHANGED = 'library-changed';
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('meta', { keyPath: 'id' });
      db.createObjectStore('puzzle');
      db.createObjectStore('progress');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function get<T>(store: IDBObjectStore, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function listPuzzles(): Promise<PuzzleMeta[]> {
  const db = await openDb();
  const store = db.transaction('meta').objectStore('meta');
  const all = await new Promise<PuzzleMeta[]>((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as PuzzleMeta[]);
    req.onerror = () => reject(req.error);
  });
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function createPuzzle(puzzle: Puzzle, thumb: Blob | null): Promise<string> {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  const meta: PuzzleMeta = {
    id,
    createdAt: now,
    updatedAt: now,
    regionCount: puzzle.regionCount,
    filledCount: 0,
    colorCount: puzzle.palette.length / 3,
    thumb,
  };
  const db = await openDb();
  const tx = db.transaction(['meta', 'puzzle', 'progress'], 'readwrite');
  tx.objectStore('meta').put(meta);
  tx.objectStore('puzzle').put(puzzle, id);
  tx.objectStore('progress').put(new Uint8Array(puzzle.regionCount), id);
  await done(tx);
  // Ask the browser not to evict our pictures when storage runs low.
  void navigator.storage?.persist?.().catch(() => false);
  return id;
}

export async function loadPuzzle(
  id: string,
): Promise<{ puzzle: Puzzle; filled: Uint8Array } | null> {
  const db = await openDb();
  const tx = db.transaction(['puzzle', 'progress']);
  const [puzzle, filled] = await Promise.all([
    get<Puzzle>(tx.objectStore('puzzle'), id),
    get<Uint8Array>(tx.objectStore('progress'), id),
  ]);
  if (!puzzle) return null;
  return {
    puzzle,
    filled: filled && filled.length === puzzle.regionCount ? filled : new Uint8Array(puzzle.regionCount),
  };
}

export async function saveProgress(
  id: string,
  filled: Uint8Array,
  thumb?: Blob | null,
): Promise<void> {
  let filledCount = 0;
  for (let i = 0; i < filled.length; i++) filledCount += filled[i];
  const db = await openDb();
  const tx = db.transaction(['meta', 'progress'], 'readwrite');
  tx.objectStore('progress').put(filled, id);
  const metaStore = tx.objectStore('meta');
  const meta = await get<PuzzleMeta>(metaStore, id);
  if (meta) {
    meta.filledCount = filledCount;
    meta.updatedAt = Date.now();
    if (thumb) meta.thumb = thumb;
    metaStore.put(meta);
  }
  await done(tx);
  // Lets the library refresh if it is already showing (e.g. after "back").
  window.dispatchEvent(new Event(LIBRARY_CHANGED));
}

export async function deletePuzzle(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['meta', 'puzzle', 'progress'], 'readwrite');
  tx.objectStore('meta').delete(id);
  tx.objectStore('puzzle').delete(id);
  tx.objectStore('progress').delete(id);
  await done(tx);
}
