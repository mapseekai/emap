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

/** Numeric buffer view that permits indexed reads without exposing mutating typed-array methods. */
export interface ReadonlyNumericArray {
  readonly length: number;
  readonly [index: number]: number;
}

/** Read-only view of the raw vertex storage owned by an ArcCollection. */
export interface ReadonlyArcVertexData {
  readonly xx: ReadonlyNumericArray;
  readonly yy: ReadonlyNumericArray;
  readonly zz: ReadonlyNumericArray | null;
  readonly nn: ReadonlyNumericArray;
  readonly ii: ReadonlyNumericArray;
  readonly bb?: ReadonlyNumericArray;
}

/** Mapshaper's ArcCollection — manages all arcs in a dataset */
export interface ArcCollection {
  /** Number of arcs (NOT number of points — see getPointCount for that) */
  size(): number;
  getArcIter(arcId: number): ArcIterator;
  getShapeIter?(part: number[]): ArcIterator;
  forEachSegment?(cb: (i: number, j: number, xx: Float64Array, yy: Float64Array) => void): void;
  forEachArcSegment?(
    arcId: number,
    cb: (i: number, j: number, xx: Float64Array, yy: Float64Array) => void,
  ): void;

  // Simplification
  setRetainedInterval?(interval: number): ArcCollection;
  getRetainedInterval?(): number;
  getThresholdByPct?(pct: number, nth?: number): number;
  setThresholds?(zz: Float64Array): void;
  isFlat?(): boolean;
  flatten?(): void;
  getFilteredCopy?(): ArcCollection;
  getCopy?(): ArcCollection;

  /** Keep only arcs whose ids satisfy `test`, returning old-to-new arc ids. */
  deleteArcs?(test: (arcId: number) => boolean): Int32Array;

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

/**
 * Query-only ArcCollection surface returned by public source getters.
 * Mutators such as setRetainedInterval(), transformPoints() and
 * updateVertexData() are intentionally absent.
 */
export interface ReadonlyArcCollection {
  size(): number;
  getArcIter(arcId: number): ArcIterator;
  getShapeIter?(part: number[]): ArcIterator;
  forEachSegment?(
    cb: (i: number, j: number, xx: ReadonlyNumericArray, yy: ReadonlyNumericArray) => void,
  ): void;
  forEachArcSegment?(
    arcId: number,
    cb: (i: number, j: number, xx: ReadonlyNumericArray, yy: ReadonlyNumericArray) => void,
  ): void;
  getRetainedInterval?(): number;
  getThresholdByPct?(pct: number, nth?: number): number;
  isFlat?(): boolean;
  getFilteredCopy?(): ReadonlyArcCollection;
  getCopy?(): ReadonlyArcCollection;
  getPointCount?(): number;
  getVertexData?(): ReadonlyArcVertexData;
  getVertex2?(vertexId: number): readonly [number, number] | null;
  getSimpleShapeBbox?(shapeIds: number[], bbox: number[]): void;
  arcIsSmaller?(i: number, minLen: number): boolean;
  arcIntersectsBBox?(i: number, bbox: number[]): boolean;
}

// ---------------------------------------------------------------------------
// Layer & Dataset
// ---------------------------------------------------------------------------

export type GeometryType = 'point' | 'polyline' | 'polygon';
export type PathGeometryType = 'polyline' | 'polygon';

/**
 * Mapshaper feature shape vocabulary.
 *
 * Path features (polygon / polyline):
 * - {@link SignedArcId}: a signed arc id; negative values encode reversed
 *   direction. Use `arcId >= 0 ? arcId : ~arcId` for the absolute id.
 * - {@link PathPart}: list of signed arc ids that traverse one ring or
 *   polyline stroke.
 * - {@link PathShape}: list of parts. Polygons use multiple parts for rings
 *   (outer + holes); polylines use multiple parts for multipart features.
 *
 * Point features:
 * - {@link Coord2}: a single `[x, y]` pair. Mutable so in-place edits can
 *   write back through the same array.
 * - {@link PointShape}: list of points (multi-point features). Some legacy
 *   mapshaper datasets store a single bare `[x, y]` instead of `[[x, y]]`;
 *   prefer `normalizePointShape` from `source/layer-utils` to coerce.
 *
 * `null` is reserved for deleted-but-still-indexed features (mapshaper keeps
 * positional alignment between `shapes` and `data.records`).
 */
export type SignedArcId = number;

/** Absolute arc id — strips the sign/`~` direction encoding of a {@link SignedArcId}. */
export function absArcId(arcId: SignedArcId): number {
  return arcId >= 0 ? arcId : ~arcId;
}
export type PathPart = SignedArcId[];
export type PathShape = PathPart[];
export type Coord2 = [number, number];
export type PointShape = Coord2[];
/** Legacy single-coord form some older datasets carry. */
export type LegacyPointShape = Coord2;
export type FeatureShape = PathShape | PointShape | LegacyPointShape;

export type ReadonlyCoord2 = readonly [number, number];
export type ReadonlyPathPart = readonly SignedArcId[];
export type ReadonlyPathShape = readonly ReadonlyPathPart[];
export type ReadonlyPointShape = readonly ReadonlyCoord2[];
export type ReadonlyFeatureShape = ReadonlyPathShape | ReadonlyPointShape | ReadonlyCoord2;

/** Mapshaper DataTable holding feature attributes for a layer */
export interface DataTable {
  getRecordAt?(id: number): Record<string, unknown>;
  getRecords?(): Record<string, unknown>[];
  getFields?(): string[];
  size?(): number;
}

/** Query-only view of a mapshaper attribute table. */
export interface ReadonlyDataTable {
  getRecordAt?(id: number): Readonly<Record<string, unknown>>;
  getRecords?(): readonly Readonly<Record<string, unknown>>[];
  getFields?(): readonly string[];
  size?(): number;
}

/**
 * A single layer within a Mapshaper dataset.
 *
 * `shapes` is intentionally typed loosely (`(FeatureShape | null)[] | null`)
 * because mapshaper itself does not statically tag the array. Use the
 * {@link isPathLayer} / {@link isPointLayer} type guards to narrow to a
 * {@link PathLayer} / {@link PointLayer} where shapes carry a precise type.
 */
export interface MapshaperLayer {
  name?: string;
  id?: string;
  geometry_type?: GeometryType;
  shapes: (FeatureShape | null)[] | null;
  data?: DataTable;
}

/** Deep read-only layer view exposed to package consumers. */
export interface ReadonlyMapshaperLayer {
  readonly name?: string;
  readonly id?: string;
  readonly geometry_type?: GeometryType;
  readonly shapes: readonly (ReadonlyFeatureShape | null)[] | null;
  readonly data?: ReadonlyDataTable;
}

/** Layer narrowed to path geometry. `shapes[i]` is `PathShape | null`. */
export interface PathLayer extends MapshaperLayer {
  geometry_type: PathGeometryType;
  shapes: (PathShape | null)[] | null;
}

/**
 * Layer narrowed to point geometry. `shapes[i]` is `PointShape | LegacyPointShape | null`;
 * use `normalizePointShape` to coerce to a uniform `Coord2[]`.
 */
export interface PointLayer extends MapshaperLayer {
  geometry_type: 'point';
  shapes: ((PointShape | LegacyPointShape) | null)[] | null;
}

/** True iff `layer.geometry_type` is `'polygon'` or `'polyline'`. */
export function isPathLayer(layer: MapshaperLayer): layer is PathLayer {
  return layer.geometry_type === 'polygon' || layer.geometry_type === 'polyline';
}

/** True iff `layer.geometry_type` is `'point'`. */
export function isPointLayer(layer: MapshaperLayer): layer is PointLayer {
  return layer.geometry_type === 'point';
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
    /** Source filenames recorded by mapshaper's importer. */
    input_files?: string[];
    /** Detected source formats (`geojson`, `topojson`, `shapefile`, …). */
    input_formats?: string[];
    crs?: {
      is_latlong?: boolean;
      projName?: string;
      a?: number;
    };
  };
  /**
   * Monotonic counter bumped by every in-place edit (vertex move / insert /
   * delete, feature translate / affine, shared-arc split). Cache layers that
   * key off arc geometry — the per-layer Flatbush spatial index, future
   * arc-flag caches — include this in their cache key so coord-only
   * mutations auto-invalidate without a manual `clear` call.
   *
   * Optional because mapshaper itself doesn't set it; emap initialises to
   * `0` when first observed via {@link bumpEditVersion}.
   */
  editVersion?: number;
  /**
   * Monotonic counter for attribute/record mutations that don't touch
   * geometry. Owns style-resolution cache invalidation; spatial-index
   * caches key on `editVersion` and are NOT rebuilt for pure attribute
   * edits. emap-owned; mapshaper never sets it.
   */
  attributeVersion?: number;
}

/** Deep read-only view of the live dataset owned by a TopologySource. */
export interface ReadonlyMapshaperDataset {
  readonly layers: readonly ReadonlyMapshaperLayer[];
  readonly arcs?: ReadonlyArcCollection;
  readonly info?: {
    readonly crs_string?: string;
    readonly prj?: string;
    readonly wkt1?: string;
    readonly input_files?: readonly string[];
    readonly input_formats?: readonly string[];
    readonly crs?: {
      readonly is_latlong?: boolean;
      readonly projName?: string;
      readonly a?: number;
    };
  };
  readonly editVersion?: number;
}

/**
 * Bump (or initialise to `1`) the dataset's `editVersion` counter. Called
 * by every in-place edit command at the end of `do()` / `undo()` so the
 * spatial index sees a fresh cache key on the next query.
 */
export function bumpEditVersion(dataset: MapshaperDataset | null | undefined): void {
  if (!dataset) return;
  dataset.editVersion = (dataset.editVersion ?? 0) + 1;
}

/** Bump the attribute/record revision. See {@link bumpEditVersion}. */
export function bumpAttributeVersion(dataset: MapshaperDataset | null | undefined): void {
  if (!dataset) return;
  dataset.attributeVersion = (dataset.attributeVersion ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// Render styles
// ---------------------------------------------------------------------------

/** Named line patterns supported by line and polygon-outline paint. */
export type LineDashStyle = 'solid' | 'dash' | 'dot' | 'dash-dot' | 'arrow-dot';

/** Style for stroke-based rendering (lines, polygon outlines). */
export interface StrokeStyle {
  color?: string;
  width?: number;
  dashType?: LineDashStyle;
  dash?: readonly number[];
  arrowSpacing?: number;
  arrowSize?: number;
}

/**
 * Built-in Canvas marker shapes for point layers.
 *
 * @example
 * const shape: PointMarkerShape = 'pentagon';
 */
export type PointMarkerShape =
  | 'circle'
  | 'square'
  | 'triangle'
  | 'triangle-down'
  | 'diamond'
  | 'pentagon'
  | 'star'
  | 'cross'
  | 'x'
  | 'hexagon'
  | 'octagon';

export interface PointStyle {
  color?: string;
  radius?: number;
  fill?: boolean;
  shape?: PointMarkerShape;
}

/** Style for vertex dot rendering in edit mode */
export interface VertexDotStyle {
  dotColor?: string;
  dotRadius?: number;
  /** Optional arc-level visibility filter for large topology datasets. */
  arcFilter?: (arcId: number) => boolean;
  hoverVertex?: [number, number] | null;
  /**
   * Distinguishes a vertex hover (drawn as a circle) from an interpolated
   * edge-midpoint hover (drawn as a square — drag-to-insert affordance).
   * Defaults to `'vertex'` when omitted.
   */
  hoverType?: 'vertex' | 'interpolated' | null;
  hoverColor?: string;
  hoverRadius?: number;
  selectedVertices?: [number, number][];
  selectedColor?: string;
  /** Fill color for polygon shapes in vertex edit mode */
  polygonFill?: string | null;
  geometryType?: string;
}
