/** Settings the user picks before a photo is converted. */
export interface GenerateOptions {
  /** Target number of palette colours (the result may use slightly fewer). */
  colors: number;
  /** 1 = few big sections … 7 = very many small sections. */
  detail: number;
}

/**
 * A photo converted into a colour-by-number picture.
 *
 * Everything is stored in flat typed arrays so it can be posted from the
 * worker and saved to IndexedDB cheaply. Coordinates are in image pixels.
 */
export interface Puzzle {
  width: number;
  height: number;

  /** RGB triples, one per palette colour. Colour number shown = index + 1. */
  palette: Uint8Array;

  /** Region id for every pixel (row-major, width * height). */
  regionMap: Uint16Array;
  regionCount: number;
  /** Palette index of each region. */
  regionColor: Uint8Array;
  regionArea: Uint32Array;
  /**
   * Each region's own average colour in the photo (RGB triples). Missing on
   * pictures made before this was added.
   */
  regionShade?: Uint8Array;
  /**
   * Colour each section with its own shade rather than its paint's flat
   * colour, so the finished picture is closer to the photo.
   */
  shaded?: boolean;
  /** Bounding box of each region: minX, minY, maxX, maxY (4 per region). */
  regionBox: Uint16Array;

  /** Where to draw each region's number, and how much room there is (radius). */
  labelX: Float32Array;
  labelY: Float32Array;
  labelR: Float32Array;

  /**
   * Vector outlines. Borders are cut into "arcs": a stretch of border between
   * exactly two regions. Each arc is smoothed once and shared by both regions
   * so neighbouring sections always fit together exactly.
   */
  arcPoints: Float32Array; // x,y pairs
  arcStart: Uint32Array; // arcCount + 1, index (in points) into arcPoints
  /** The two regions either side of each arc (2 per arc; -1 = outside the picture). */
  arcRegions: Int32Array;

  /** Closed rings making up each region: signed arc refs (+(i+1) forward, -(i+1) reversed). */
  ringArcs: Int32Array;
  ringStart: Uint32Array; // ringCount + 1
  regionRingStart: Uint32Array; // regionCount + 1, index into rings
}

/** Lightweight record shown in the library. */
export interface PuzzleMeta {
  id: string;
  createdAt: number;
  updatedAt: number;
  regionCount: number;
  filledCount: number;
  colorCount: number;
  thumb: Blob | null;
}
