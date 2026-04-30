/**
 * TypeScript interfaces for Mapshaper data structures.
 * These replace pervasive `any` usage across the codebase.
 */

// ---------------------------------------------------------------------------
// Arc iteration
// ---------------------------------------------------------------------------

/** Iterator returned by ArcCollection.getArcIter() */
export interface ArcIterator {
  x: number;
  y: number;
  hasNext(): boolean;
}

// ---------------------------------------------------------------------------
// Arc collection
// ---------------------------------------------------------------------------

/** Raw vertex storage exposed by ArcCollection.getVertexData() */
export interface ArcVertexData {
  xx: Float64Array;
  yy: Float64Array;
  /** Per-vertex simplification thresholds (Visvalingam Z-values). Null if arcs are flat. */
  zz: Float64Array | null;
  /** Number of vertices in each arc (length === arc count) */
  nn: Int32Array | Uint32Array;
  /** Starting vertex index of each arc within xx/yy (length === arc count) */
  ii: Int32Array | Uint32Array;
  /** Per-arc bounding boxes packed as [xmin,ymin,xmax,ymax,...] */
  bb?: Float64Array;
}

/** Mapshaper's ArcCollection — manages all arcs in a dataset */
export interface ArcCollection {
  /** Number of arcs (NOT number of points — see getPointCount for that) */
  size(): number;
  getArcIter(arcId: number): ArcIterator;
  getShapeIter?(part: number[]): ArcIterator;
  forEachSegment?(cb: (i: number, j: number, xx: Float64Array, yy: Float64Array) => void): void;
  forEachArcSegment?(arcId: number, cb: (i: number, j: number, xx: Float64Array, yy: Float64Array) => void): void;

  // Simplification
  setRetainedInterval?(interval: number): ArcCollection;
  getRetainedInterval?(): number;
  getThresholdByPct?(pct: number, nth?: number): number;
  setThresholds?(zz: Float64Array): void;
  isFlat?(): boolean;
  flatten?(): void;
  getFilteredCopy?(): ArcCollection;
  getCopy?(): ArcCollection;

  // Vertex access
  getPointCount?(): number;
  getVertexData?(): ArcVertexData;
  getVertex2?(vertexId: number): [number, number] | null;
  transformPoints?(cb: (x: number, y: number, arcId?: number) => void | [number, number]): void;
  /** Replace the arc storage. Triggers a full bounds rebuild internally. */
  updateVertexData?(
    nn: Int32Array | Uint32Array,
    xx: Float64Array,
    yy: Float64Array,
    zz: Float64Array | null,
  ): void;
  /** Recompute the bounding box of a single arc after in-place vertex mutation */
  updateArcBounds?(arcId: number): void;

  // Spatial queries
  getSimpleShapeBbox?(shapeIds: number[], bbox: number[]): void;
  arcIsSmaller?(i: number, minLen: number): boolean;
  arcIntersectsBBox?(i: number, bbox: number[]): boolean;
}

// ---------------------------------------------------------------------------
// Layer & Dataset
// ---------------------------------------------------------------------------

export type GeometryType = 'point' | 'polyline' | 'polygon';

/** Mapshaper DataTable holding feature attributes for a layer */
export interface DataTable {
  getRecordAt?(id: number): Record<string, unknown>;
  getRecords?(): Record<string, unknown>[];
  getFields?(): string[];
  size?(): number;
}

/** A single layer within a Mapshaper dataset */
export interface MapshaperLayer {
  name?: string;
  id?: string;
  geometry_type?: GeometryType;
  shapes: any[][] | null;
  data?: DataTable;
}

/** A Mapshaper dataset containing layers and arcs */
export interface MapshaperDataset {
  layers: MapshaperLayer[];
  arcs?: ArcCollection;
  info?: {
    crs_string?: string;
    prj?: string;
    /** WKT1 CRS string, sometimes set by importers (e.g. FlatGeobuf, GeoPackage) */
    wkt1?: string;
    crs?: {
      is_latlong?: boolean;
      projName?: string;
      a?: number;
    };
  };
}

// ---------------------------------------------------------------------------
// Render styles
// ---------------------------------------------------------------------------

/** Style for stroke-based rendering (lines, polygon outlines) */
export interface StrokeStyle {
  color?: string;
  width?: number;
}

/** Style for point rendering */
export interface PointStyle {
  color?: string;
  radius?: number;
  fill?: boolean;
}

/** Style for vertex dot rendering in edit mode */
export interface VertexDotStyle {
  dotColor?: string;
  dotRadius?: number;
  hoverVertex?: [number, number] | null;
  /**
   * Distinguishes a vertex hover (drawn as a circle) from an interpolated
   * edge-midpoint hover (drawn as a square — drag-to-insert affordance).
   * Defaults to `'vertex'` when omitted.
   */
  hoverType?: 'vertex' | 'interpolated' | null;
  hoverColor?: string;
  hoverRadius?: number;
  /** Fill color for polygon shapes in vertex edit mode */
  polygonFill?: string | null;
  geometryType?: string;
}
