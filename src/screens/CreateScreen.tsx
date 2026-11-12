import { useEffect, useMemo, useRef, useState } from 'react';
import { createPuzzle } from '../db';
import { CancelledError, decodePhoto, Generator, scalePhoto } from '../generator';
import { DEFAULT_OPTIONS, MAX_COLORS, MAX_DETAIL, MIN_COLORS, workingSizeFor } from '../pipeline';
import { PuzzleView } from '../PuzzleView';
import { PuzzleRenderer, renderThumbnail } from '../render';
import type { GenerateOptions, Puzzle } from '../types';

interface Props {
  file: Blob;
  onCancel: () => void;
  onCreated: (id: string) => void;
}

const DETAIL_NAMES = [
  'Very simple',
  'Simple',
  'Medium',
  'Detailed',
  'Very detailed',
  'Fine',
  'Extra fine',
];

const SETTINGS_KEY = 'colouring-book-settings';

/** The sliders start wherever they were left last time. */
function savedOptions(): GenerateOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    const colors = Math.round(Number(saved?.colors));
    const detail = Math.round(Number(saved?.detail));
    if (colors >= MIN_COLORS && colors <= MAX_COLORS && detail >= 1 && detail <= MAX_DETAIL) {
      return { colors, detail };
    }
  } catch {
    // Storage unavailable or corrupt: fall through to the defaults.
  }
  return DEFAULT_OPTIONS;
}

function savedShaded(): boolean {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null')?.shaded !== false;
  } catch {
    return true;
  }
}

/** Preview a photo as a colour-by-number picture and tune it before starting. */
export function CreateScreen({ file, onCancel, onCreated }: Props) {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [options, setOptions] = useState<GenerateOptions>(savedOptions);
  const [shaded, setShaded] = useState(savedShaded);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'colour' | 'outline'>('colour');
  const [saving, setSaving] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<PuzzleView | null>(null);
  const generatorRef = useRef<Generator | null>(null);
  const hasPreview = useRef(false);

  useEffect(() => {
    let alive = true;
    let decoded: ImageBitmap | null = null;
    decodePhoto(file)
      .then((b) => {
        if (!alive) return b.close();
        decoded = b;
        setBitmap(b);
      })
      .catch(() => alive && setError("Couldn't read that image. Try a JPEG or PNG photo."));
    return () => {
      alive = false;
      decoded?.close();
    };
  }, [file]);

  // The finest detail levels convert a larger copy of the photo.
  const workingSize = workingSizeFor(options.detail);
  const image = useMemo(
    () => (bitmap ? scalePhoto(bitmap, workingSize) : null),
    [bitmap, workingSize],
  );

  // Re-convert whenever the photo or a slider changes.
  useEffect(() => {
    if (!image) return;
    setBusy(true);
    const generator = (generatorRef.current ??= new Generator());
    const timer = setTimeout(
      () => {
        generator
          .generate(image, options)
          .then((p) => {
            hasPreview.current = true;
            setPuzzle(p);
            setBusy(false);
          })
          .catch((e) => {
            if (e instanceof CancelledError) return;
            setError(`Conversion failed: ${e?.message ?? e}`);
            setBusy(false);
          });
      },
      hasPreview.current ? 200 : 0,
    );
    return () => clearTimeout(timer);
  }, [image, options]);

  useEffect(
    () => () => {
      generatorRef.current?.dispose();
      viewRef.current?.destroy();
      viewRef.current = null;
    },
    [],
  );

  const renderer = useMemo(() => (puzzle ? new PuzzleRenderer(puzzle) : null), [puzzle]);

  useEffect(() => {
    if (!renderer || !canvasRef.current) return;
    const coloured = mode === 'colour';
    const state = {
      filled: new Uint8Array(renderer.puzzle.regionCount).fill(coloured ? 1 : 0),
      selected: -1,
      showNumbers: !coloured,
    };
    renderer.shaded = shaded;
    renderer.invalidateOutline();
    if (viewRef.current) viewRef.current.setRenderer(renderer, state);
    else viewRef.current = new PuzzleView(canvasRef.current, renderer, state);
  }, [renderer, mode, shaded]);

  const start = async () => {
    if (!puzzle || !renderer || saving) return;
    setSaving(true);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...options, shaded }));
    } catch {
      // Not being able to remember the sliders is harmless.
    }
    try {
      const thumb = await renderThumbnail(renderer, new Uint8Array(puzzle.regionCount));
      onCreated(await createPuzzle({ ...puzzle, shaded }, thumb));
    } catch (e) {
      setError(`Couldn't save the picture: ${(e as Error)?.message ?? e}`);
      setSaving(false);
    }
  };

  return (
    <div className="screen">
      <header className="bar">
        <button className="icon" onClick={onCancel} aria-label="Back">
          ←
        </button>
        <h1>New picture</h1>
      </header>

      <div className="stage">
        <canvas ref={canvasRef} />
        {puzzle && (
          <div className="segmented">
            <button className={mode === 'colour' ? 'on' : ''} onClick={() => setMode('colour')}>
              Finished look
            </button>
            <button className={mode === 'outline' ? 'on' : ''} onClick={() => setMode('outline')}>
              To colour
            </button>
          </div>
        )}
        {busy && !error && (
          <div className={`veil ${puzzle ? 'light' : ''}`}>
            <div className="spinner" />
            <span>{puzzle ? 'Updating…' : 'Converting photo…'}</span>
          </div>
        )}
        {error && <div className="veil">{error}</div>}
      </div>

      <div className="panel">
        <label>
          <span>
            Colours <b>{options.colors}</b>
          </span>
          <input
            type="range"
            min={MIN_COLORS}
            max={MAX_COLORS}
            step={1}
            value={options.colors}
            onChange={(e) => setOptions({ ...options, colors: Number(e.target.value) })}
          />
        </label>
        <label>
          <span>
            Detail <b>{DETAIL_NAMES[options.detail - 1]}</b>
          </span>
          <input
            type="range"
            min={1}
            max={MAX_DETAIL}
            step={1}
            value={options.detail}
            onChange={(e) => setOptions({ ...options, detail: Number(e.target.value) })}
          />
        </label>
        <label className="toggle">
          <span>
            Exact shades
            <small>Each section keeps its own shade from the photo</small>
          </span>
          <input
            type="checkbox"
            checked={shaded}
            onChange={(e) => {
              setShaded(e.target.checked);
              setMode('colour'); // show the effect straight away
            }}
          />
        </label>
        <div className="panel-foot">
          <span className="muted">
            {puzzle
              ? `${puzzle.regionCount} sections · ${puzzle.palette.length / 3} colours`
              : ' '}
          </span>
          <button className="primary" disabled={!puzzle || busy || saving} onClick={start}>
            {saving ? 'Saving…' : 'Start colouring'}
          </button>
        </div>
      </div>
    </div>
  );
}
