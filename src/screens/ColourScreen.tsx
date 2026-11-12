import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadPuzzle, saveProgress } from '../db';
import { PuzzleView } from '../PuzzleView';
import { PuzzleRenderer, renderThumbnail, type DrawState } from '../render';
import type { Puzzle } from '../types';

interface Props {
  id: string;
  onExit: () => void;
}

export function ColourScreen({ id, onExit }: Props) {
  const [loaded, setLoaded] = useState<{ puzzle: Puzzle; filled: Uint8Array } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    loadPuzzle(id)
      .then((result) => {
        if (!alive) return;
        if (result) setLoaded(result);
        else setError('This picture could not be found.');
      })
      .catch((e) => alive && setError(`Couldn't open the picture: ${e?.message ?? e}`));
    return () => {
      alive = false;
    };
  }, [id]);

  if (!loaded) {
    return (
      <div className="screen">
        <header className="bar">
          <button className="icon" onClick={onExit} aria-label="Back">
            ←
          </button>
        </header>
        <div className="stage">
          <div className="veil">{error || <div className="spinner" />}</div>
        </div>
      </div>
    );
  }
  return <Colouring id={id} puzzle={loaded.puzzle} filled={loaded.filled} onExit={onExit} />;
}

function textOn(palette: Uint8Array, i: number): string {
  const lum = 0.299 * palette[i * 3] + 0.587 * palette[i * 3 + 1] + 0.114 * palette[i * 3 + 2];
  return lum > 150 ? '#1b1b22' : '#ffffff';
}

function Colouring({
  id,
  puzzle,
  filled,
  onExit,
}: {
  id: string;
  puzzle: Puzzle;
  filled: Uint8Array;
  onExit: () => void;
}) {
  const colorCount = puzzle.palette.length / 3;
  const renderer = useMemo(() => new PuzzleRenderer(puzzle), [puzzle]);

  /** Sections still blank, per colour. */
  const [remaining, setRemaining] = useState<number[]>(() => {
    const counts = new Array<number>(colorCount).fill(0);
    for (let r = 0; r < puzzle.regionCount; r++) if (!filled[r]) counts[puzzle.regionColor[r]]++;
    return counts;
  });
  const [selected, setSelected] = useState(() => remaining.findIndex((c) => c > 0));
  const [celebrate, setCelebrate] = useState(false);
  const left = remaining.reduce((a, b) => a + b, 0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<PuzzleView | null>(null);
  const drawState = useRef<DrawState>({ filled, selected, showNumbers: true });
  const dirty = useRef(false);
  const saveTimer = useRef(0);

  // --- Saving -------------------------------------------------------------------
  const save = useCallback(
    async (withThumb: boolean) => {
      clearTimeout(saveTimer.current);
      if (!dirty.current) return;
      dirty.current = false;
      const thumb = withThumb ? await renderThumbnail(renderer, filled) : undefined;
      await saveProgress(id, filled, thumb).catch(() => {
        dirty.current = true;
      });
    },
    [id, filled, renderer],
  );

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void save(false);
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      void save(true); // leaving the screen: also refresh the library thumbnail
    };
  }, [save]);

  // --- Colouring ------------------------------------------------------------------
  const fill = useCallback(
    (r: number) => {
      filled[r] = 1;
      renderer.invalidateRegion(r);
      viewRef.current?.requestDraw();
      navigator.vibrate?.(8);
      const c = puzzle.regionColor[r];
      setRemaining((prev) => {
        const next = prev.slice();
        next[c]--;
        return next;
      });
      dirty.current = true;
      clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => void save(false), 1500);
    },
    [filled, puzzle, renderer, save],
  );

  const tap = useRef<(x: number, y: number) => void>(() => {});
  tap.current = (ix, iy) => {
    const view = viewRef.current;
    if (selected < 0 || !view) return;
    const { width: w, height: h, regionMap, regionColor } = puzzle;
    const x = Math.floor(ix);
    const y = Math.floor(iy);
    const wanted = (r: number) => !filled[r] && regionColor[r] === selected;
    if (x >= 0 && y >= 0 && x < w && y < h && wanted(regionMap[y * w + x])) {
      fill(regionMap[y * w + x]);
      return;
    }
    // Be forgiving: take the nearest matching section within a fingertip.
    const reach = Math.min(40, Math.ceil(14 / view.view.scale));
    let best = -1;
    let bestD = reach * reach + 1;
    for (let dy = -reach; dy <= reach; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -reach; dx <= reach; dx++) {
        const xx = x + dx;
        const d = dx * dx + dy * dy;
        if (xx < 0 || xx >= w || d >= bestD) continue;
        const r = regionMap[yy * w + xx];
        if (wanted(r)) {
          best = r;
          bestD = d;
        }
      }
    }
    if (best >= 0) fill(best);
  };

  useEffect(() => {
    const view = new PuzzleView(canvasRef.current!, renderer, drawState.current);
    view.onTap = (x, y) => tap.current(x, y);
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [renderer]);

  // Keep the canvas in step with the picked colour.
  useEffect(() => {
    drawState.current.selected = selected;
    viewRef.current?.requestDraw();
    paletteRef.current
      ?.querySelector('.swatch.on')
      ?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [selected]);

  // When a colour is used up, move to the next one; when all are, celebrate.
  useEffect(() => {
    if (selected < 0 || remaining[selected] > 0) return;
    let next = -1;
    for (let i = 1; i <= colorCount; i++) {
      const c = (selected + i) % colorCount;
      if (remaining[c] > 0) {
        next = c;
        break;
      }
    }
    setSelected(next);
    if (next < 0) {
      setCelebrate(true);
      viewRef.current?.fit();
    }
  }, [remaining, selected, colorCount]);

  /** Jump to the nearest blank section of the picked colour. */
  const find = () => {
    const view = viewRef.current;
    const canvas = canvasRef.current;
    if (!view || !canvas || selected < 0) return;
    const v = view.view;
    const cx = (canvas.clientWidth / 2 - v.tx) / v.scale;
    const cy = (canvas.clientHeight / 2 - v.ty) / v.scale;
    let best = -1;
    let bestD = Infinity;
    for (let r = 0; r < puzzle.regionCount; r++) {
      if (filled[r] || puzzle.regionColor[r] !== selected) continue;
      const d = (puzzle.labelX[r] - cx) ** 2 + (puzzle.labelY[r] - cy) ** 2;
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    if (best < 0) return;
    const room = puzzle.labelR[best];
    const scale = room * v.scale >= 18 ? v.scale : 26 / room;
    view.animateTo(puzzle.labelX[best], puzzle.labelY[best], scale);
  };

  const total = puzzle.regionCount;
  const percent = Math.floor(((total - left) / total) * 100);

  return (
    <div className="screen">
      <header className="bar">
        <button className="icon" onClick={onExit} aria-label="Back">
          ←
        </button>
        <div className="progress">
          <div className="meter">
            <div style={{ width: `${percent}%` }} />
          </div>
          <span>{left === 0 ? 'Finished' : `${percent}% · ${left} left`}</span>
        </div>
        {left > 0 && (
          <button className="pill" onClick={find}>
            Find
          </button>
        )}
        <button className="pill" onClick={() => viewRef.current?.fit()}>
          Fit
        </button>
      </header>

      <div className="stage">
        <canvas ref={canvasRef} />
        {celebrate && (
          <div className="toast">
            <strong>Finished! 🎉</strong>
            <div>
              <button className="pill" onClick={() => setCelebrate(false)}>
                Admire it
              </button>
              <button className="primary" onClick={onExit}>
                Library
              </button>
            </div>
          </div>
        )}
      </div>

      {left > 0 && (
        <div className="palette" ref={paletteRef}>
          {remaining.map((count, i) =>
            count === 0 ? null : (
              <button
                key={i}
                className={`swatch ${i === selected ? 'on' : ''}`}
                onClick={() => setSelected(i)}
                aria-label={`Colour ${i + 1}, ${count} sections left`}
              >
                <span
                  className="dot"
                  style={{ background: renderer.colorCss[i], color: textOn(puzzle.palette, i) }}
                >
                  {i + 1}
                </span>
                <span className="count">{count}</span>
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
