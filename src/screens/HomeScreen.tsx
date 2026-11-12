import { useEffect, useRef, useState } from 'react';
import { deletePuzzle, LIBRARY_CHANGED, listPuzzles } from '../db';
import type { PuzzleMeta } from '../types';

interface Props {
  onNew: (file: Blob) => void;
  onOpen: (id: string) => void;
}

export function HomeScreen({ onNew, onOpen }: Props) {
  const [items, setItems] = useState<PuzzleMeta[] | null>(null);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const refresh = () =>
    listPuzzles()
      .then(setItems)
      .catch((e) => setError(`Couldn't open saved pictures: ${e?.message ?? e}`));
  useEffect(() => {
    void refresh();
    window.addEventListener(LIBRARY_CHANGED, refresh);
    return () => window.removeEventListener(LIBRARY_CHANGED, refresh);
  }, []);

  const remove = async (item: PuzzleMeta) => {
    if (!confirm('Delete this picture and its progress?')) return;
    await deletePuzzle(item.id);
    void refresh();
  };

  return (
    <div className="screen home">
      <header className="bar">
        <h1>Colouring Book</h1>
      </header>

      <main className="library">
        <button className="card new" onClick={() => input.current?.click()}>
          <span className="plus">+</span>
          <span>New picture</span>
        </button>
        <input
          ref={input}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) onNew(file);
          }}
        />

        {items?.map((item) => (
          <LibraryCard key={item.id} item={item} onOpen={onOpen} onDelete={remove} />
        ))}
      </main>

      {error && <p className="notice">{error}</p>}
      {items?.length === 0 && (
        <p className="notice">Pick a photo to turn it into a colour-by-number picture.</p>
      )}
    </div>
  );
}

function LibraryCard({
  item,
  onOpen,
  onDelete,
}: {
  item: PuzzleMeta;
  onOpen: (id: string) => void;
  onDelete: (item: PuzzleMeta) => void;
}) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!item.thumb) return;
    const u = URL.createObjectURL(item.thumb);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [item.thumb]);

  const percent = Math.floor((item.filledCount / item.regionCount) * 100);
  return (
    <div className="card">
      <button className="thumb" onClick={() => onOpen(item.id)} aria-label="Open picture">
        {url && <img src={url} alt="" />}
      </button>
      <div className="card-info">
        <span>{percent === 100 ? 'Finished' : `${percent}%`}</span>
        <button className="link" onClick={() => onDelete(item)}>
          Delete
        </button>
      </div>
      <div className="meter">
        <div style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
