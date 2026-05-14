// Public type/option surface for `Emap`. Extracted from `map.ts` so the
// orchestrator class file can stay focused on behaviour. Re-exported from
// `./map` to preserve every existing `from '@/map/map'` import path.

import type { MapshaperWorkerPool } from '../core/mapshaper-worker-pool';
import type { AffineMatrix } from '../edit/commands/feature-affine';
import type {
  DrawOverlayState,
  DrawOverlaySnapKind,
} from '../renderer/painter';

// `EditDrawState` originally lived here; the canonical definition now sits in
// `src/renderer/painter.ts` (it is the input to `Painter.drawDrawingOverlay`).
// Re-export under the legacy names so existing imports keep resolving.
export type EditDrawState = DrawOverlayState;
export type SnapKind = DrawOverlaySnapKind;

export type ExpressionEvaluationPolicy = 'trusted' | 'disabled';

export interface MapOptions {
  container: string | HTMLElement;
  interactive?: boolean;
  /**
   * Controls APIs that forward JavaScript expressions to mapshaper
   * (`applyExpression`, `filterFeatures`, `sortFeatures`, `splitLayer`, and
   * command options such as `where` / `calc`).
   *
   * Defaults to `'disabled'` so apps loading untrusted layer config or
   * remote datasets cannot accidentally execute arbitrary JavaScript.
   * Apps that load only their own data may opt in to `'trusted'` here or
   * via {@link Emap.setExpressionPolicy}.
   *
   * BREAKING: prior to this release the default was `'trusted'`.
   */
  expressionPolicy?: ExpressionEvaluationPolicy;
  /**
   * Routing for dataset-replace operations (clip, dissolve, union,
   * mosaic, simplify, project, ...).
   *
   * - `false` (default) — every op runs synchronously on the main thread.
   * - `true` — every op routes through a Web Worker, freeing the main
   *   thread during heavy work. Adds ~50-100ms pack/unpack overhead per
   *   op so it's a slowdown for tiny datasets.
   * - `'auto'` — route through the worker only when the source dataset's
   *   arc vertex count is at least {@link workerThreshold}. Best of both
   *   worlds for mixed-size workloads.
   *
   * Selection-level operations (translateSelected, rotateSelected,
   * vertex commands) always run on the main thread regardless of this
   * flag — their per-vertex cost is far below the worker round-trip
   * overhead.
   */
  useWorker?: boolean | 'auto';
  /**
   * Vertex-count threshold for `useWorker: 'auto'`. Datasets whose
   * `arcs.getPointCount()` is at least this large route through the
   * worker; smaller datasets stay on the main thread. Default `50000`.
   * Ignored when `useWorker` is a boolean.
   */
  workerThreshold?: number;
  /**
   * URL of the worker bundle (`emap-worker.js`). Resolved against
   * `document.baseURI` when relative. Only consulted when `useWorker`
   * is truthy. Defaults to `'emap-worker.js'` (sibling of the page).
   */
  workerUrl?: string;
  /**
   * Number of worker threads to maintain. Each adds one mapshaper
   * instance, so peak parallelism = `workerPoolSize`. Default `1`
   * (single-worker, the historical behaviour). Set to e.g.
   * `navigator.hardwareConcurrency - 1` to scale up — useful when
   * the app dispatches multiple independent dataset-replace ops in
   * parallel (one per source). Workers spawn lazily, so a high
   * `workerPoolSize` doesn't pay the spawn cost up-front.
   *
   * Ignored when `workerPool` is supplied (the caller's pool already
   * configures its own size).
   */
  workerPoolSize?: number;
  /**
   * Pre-constructed worker pool. Only consulted when `useWorker` is
   * truthy; takes precedence over `workerUrl` / `workerPoolSize`.
   * Used by tests to inject a mock pool, and by power users who
   * want to share one pool across multiple `Emap` instances.
   */
  workerPool?: MapshaperWorkerPool;
  /**
   * Override the engine's per-call routing decision when `useWorker`
   * is `'auto'`. Receives the parsed command head set, vertex count,
   * and the engine's default decision; return `true` to route through
   * the worker, `false` to keep on the main thread. The default
   * decision tree handles cheap commands (rename-fields / sort / …)
   * and expensive ones (buffer / clean / dissolve / …) but apps with
   * domain knowledge can refine it here. Ignored when `useWorker` is
   * `true` / `false`.
   */
  workerRouting?: import('./worker-routing').WorkerRoutingFn;
}

export interface QueryFeaturesOptions {
  layers?: string[];
}

export interface QueriedFeature {
  id: number;
  source: string;
  layer: string;
  geometryType: string;
  properties: Record<string, unknown>;
}

/** Common options accepted by all selection-drag sessions. */
export interface DragSessionOptions {
  /**
   * When `true` (default), arcs shared between the selection and any
   * unselected feature are duplicated at session start so the unselected
   * neighbour stays put when the selection moves. The duplication is
   * recorded as one extra command alongside the transform on commit, and
   * is reversed on cancel.
   *
   * Set to `false` to keep mapshaper's classic shared-topology behaviour
   * (the boundary moves and unselected features deform along with it).
   */
  splitSharedArcs?: boolean;
}

/**
 * Live "drag" handle for translating the selection without spamming the
 * undo stack. Returned by `Emap.beginTranslateSession`.
 */
export interface FeatureTranslateSession {
  /** Apply an incremental translate; geometry mutates immediately. No history entry. */
  move(dx: number, dy: number): void;
  /**
   * Push ONE cumulative `FeatureTranslateCommand` (or `CompositeCommand`
   * for multi-source selections) to history and close the session. Returns
   * `false` when the cumulative offset is zero (nothing to record).
   */
  commit(): boolean;
  /** Roll geometry back to the pre-session state and close. No history entry. */
  cancel(): void;
  /** Total `(dx, dy)` applied since the session began. */
  getAccumulated(): [number, number];
}

/**
 * Live affine-transform handle (rotate / scale / mixed) returned by
 * `Emap.beginAffineSession`. Same idea as {@link FeatureTranslateSession}:
 * every `applyDelta(matrix)` mutates geometry in place, only `commit()`
 * writes a single history entry built from the cumulative composed matrix.
 */
export interface FeatureAffineSession {
  /**
   * Pivot picked at session start (selection bbox centroid by default).
   * Callers should build their delta matrices around this point so all
   * frames share a single fixed origin — composing rotations/scales then
   * stays equivalent to a single cumulative transform.
   */
  readonly origin: [number, number];
  /** Apply a delta matrix to the current geometry. Composes onto the cumulative. */
  applyDelta(matrix: AffineMatrix): void;
  /**
   * Push ONE cumulative `FeatureAffineCommand` (or `CompositeCommand`)
   * to history and close. Returns `false` when the cumulative is identity
   * (nothing to record). `label` overrides the auto-generated label.
   */
  commit(label?: string): boolean;
  /** Roll geometry back to the pre-session state and close. No history entry. */
  cancel(): void;
  /** Cumulative composed matrix (a · prev) since the session began. */
  getCumulative(): AffineMatrix;
}

export interface FeatureRef {
  id: number;
  source: string;
  layer: string;
}

/** @deprecated Use {@link FeatureRef}. Kept as an alias for back-compat. */
export type HighlightFeatureRef = FeatureRef;

/**
 * Options for the `Emap.clipLayer` / `Emap.eraseLayer` polygon operations.
 * Both target and mask must reside in the same emap source — cross-source
 * masks require a future explicit merge step.
 */
export interface ClipEraseOptions {
  /** Source ID containing the target layer (and optionally the mask layer). */
  source: string;
  /** Layer name (or id) of the target to be clipped/erased. */
  target: string;
  /**
   * Layer name (or id) of the polygon mask living in the same source.
   * Mutually exclusive with {@link bbox} — supply exactly one.
   */
  mask?: string;
  /**
   * Rectangular clip / erase region as `[xmin, ymin, xmax, ymax]` in
   * source-data coordinates. Convenient when no full mask layer exists
   * (e.g. crop to viewport, drop everything outside a bounding box).
   * Mutually exclusive with {@link mask}.
   */
  bbox?: [number, number, number, number];
  /**
   * Run mapshaper's `cleanup` step after clip / erase to fix sliver
   * polygons / unclosed rings. Recommended when the mask geometry is
   * coarse or the target has overlapping shapes.
   */
  cleanup?: boolean;
  /**
   * Drop sliver polygons produced by the clip / erase. Implies a
   * post-step similar to `filter-slivers`.
   */
  removeSlivers?: boolean;
}

/**
 * Options for `Emap.dissolveLayer`. With no `field` / `fields`, mapshaper
 * merges every feature in the target layer into one. With a grouping key,
 * features sharing that key's value are merged together.
 *
 * `field` is shorthand for the single-field case; `fields` is the
 * multi-field array form. They are mutually exclusive — supplying both
 * is a configuration error and the call returns `false`.
 */
export interface DissolveOptions {
  /** Source ID containing the target layer. */
  source: string;
  /** Layer name (or id) of the layer to dissolve. */
  target: string;
  /**
   * Optional single attribute field to group features by. Convenience
   * shorthand for `fields: [field]`. Mutually exclusive with `fields`.
   */
  field?: string;
  /**
   * Multi-field group-by. Comma-bearing entries are filtered out (same
   * pattern as `filterFields`). An empty array is treated as if unset.
   */
  fields?: string[];
  /**
   * Fields whose numeric values should be summed across each dissolved
   * group (mapshaper's `sum-fields=` option). Comma-bearing entries are
   * filtered out.
   */
  sumFields?: string[];
  /**
   * Fields whose values should be carried through the dissolve unchanged
   * (mapshaper's `copy-fields=` option). The first feature in each group
   * provides the value. Comma-bearing entries are filtered out.
   */
  copyFields?: string[];
  /**
   * Custom JS aggregation expression evaluated per dissolve group
   * (mapshaper's `calc=` option). Has access to the standard mapshaper
   * aggregation context. Forwarded verbatim, quoted.
   */
  calc?: string;
  /**
   * Pre-filter expression — only records where `where` evaluates truthy
   * are included in the dissolve (mapshaper's `where=` option).
   */
  where?: string;
  /**
   * Make multipart features instead of dissolving polygon boundaries
   * (mapshaper's `multipart` flag).
   */
  multipart?: boolean;
  /** Optional name for the output layer (mapshaper's `name=` option). */
  name?: string;
  /** Keep the original layer alongside the new dissolved output. */
  noReplace?: boolean;
}

/** Options for `Emap.bufferLayer`. */
export interface BufferOptions {
  /** Source ID containing the target layer. */
  source: string;
  /** Layer name (or id) of the layer to buffer. */
  target: string;
  /**
   * Buffer radius. Either a positive finite `number` or a mapshaper
   * expression string (evaluated per record).
   *
   * Unit semantics:
   *  - **point** layers — always **metres** (mapshaper does geodetic
   *    circles via `getGeodeticSegmentFunction`), unless {@link planar}
   *    is `true`, in which case it's source-CRS units.
   *  - **polyline / polygon** layers — source-CRS units (degrees for
   *    EPSG:4326, metres for a projected CRS).
   */
  radius: number | string;
  /** Buffer cap style. Default is `round`. Mainly affects polyline output. */
  capStyle?: 'flat' | 'round';
  /** Vertices used to approximate a point-buffer circle. Positive integer. */
  vertices?: number;
  /** Segments per quarter-circle in joins and caps. Positive integer. */
  arcQuality?: number;
  /** Curve-approximation tolerance. Positive finite number. */
  tolerance?: number;
  /** Single-sided buffer; meaningful for polyline layers. */
  type?: 'left' | 'right' | 'outer' | 'inner';
  /** Force planar (Cartesian) computation even for lat/lng data. */
  planar?: boolean;
  /** Enable the v2 buffering algorithm. */
  v2?: boolean;
  /** Max path segments per buffer slice. Performance knob. Positive int. */
  sliceLength?: number;
  /** Backtrack distance, mapshaper-internal performance knob. Positive int. */
  backtrack?: number;
}

/**
 * Options for `Emap.applyExpression` — bulk attribute updates via
 * mapshaper's `-each` JS expression engine.
 *
 * SECURITY: `expression` and `where` are evaluated as JavaScript by
 * mapshaper (it builds a `Function` per record). Pass only trusted,
 * authoring-time strings — never untrusted end-user input. The same
 * applies to `where` on {@link InnerlinesOptions}, `expression` on
 * {@link FilterOptions}, and any `calc=` / `where=` arg forwarded to a
 * mapshaper command.
 */
export interface ApplyExpressionOptions {
  /** Source ID containing the target layer. */
  source: string;
  /** Layer name (or id) of the layer to update. */
  target: string;
  /**
   * JS expression evaluated per feature. Use `this.<field>` to read or write
   * record attributes; mapshaper's standard feature context (`this.id`,
   * `this.area`, `this.bounds`, etc.) is also available. Multiple
   * comma-separated assignments are allowed: `this.a = 1, this.b = 2`.
   */
  expression: string;
  /**
   * Optional filter expression. Only records for which `where` evaluates to
   * a truthy value have `expression` applied. Same JS context as
   * `expression`. Mirrors mapshaper CLI's `-each EXPR where=...`.
   */
  where?: string;
}

/** Options for `Emap.explodeLayer`. */
export interface ExplodeOptions {
  /** Source ID containing the target layer. */
  source: string;
  /** Layer name (or id) of the layer whose multi-part features will be split. */
  target: string;
}

/** Options for `Emap.innerlinesLayer`. */
export interface InnerlinesOptions {
  /** Source ID containing the polygon target layer. */
  source: string;
  /** Layer name (or id) of the polygon layer to extract shared edges from. */
  target: string;
  /**
   * Optional polygon-boundary filter expression. Evaluated with `A` and `B`
   * in scope — the two polygons on either side of each candidate boundary —
   * so e.g. `A.STATE !== B.STATE` keeps only inter-state borders. Mirrors
   * mapshaper's `-innerlines where=...`.
   */
  where?: string;
  /** Optional name for the output polyline layer. */
  name?: string;
  /**
   * If true, the original polygon layer is preserved alongside the new
   * polyline layer (mapshaper's `no-replace` flag). Default replaces.
   */
  noReplace?: boolean;
}

/** Options for `Emap.filterFeatures`. */
export interface FilterOptions {
  /** Source ID containing the target layer. */
  source: string;
  /** Layer name (or id) of the layer to filter. */
  target: string;
  /**
   * JS expression evaluated per feature. Records that evaluate to false are
   * deleted (mapshaper convention). Same `this` context as
   * `Emap.applyExpression`: `this.<field>`, `this.id`, etc.
   */
  expression?: string;
  /** Flip the predicate (mapshaper's `invert` flag). */
  invert?: boolean;
  /** Also delete features with null geometry (mapshaper's `remove-empty`). */
  removeEmpty?: boolean;
}

/** Options for `Emap.snapLayer`. */
export interface SnapOptions {
  /** Source ID containing the target layer. */
  source: string;
  /** Layer name (or id) of the layer to snap. */
  target: string;
  /**
   * Snap distance in source-CRS units. When omitted, mapshaper picks a
   * small default based on the dataset.
   */
  interval?: number;
  /** Snap only line endpoints (mapshaper's `endpoints` flag). */
  endpoints?: boolean;
  /** Round all coordinates to a given decimal precision (e.g. 0.000001). */
  precision?: number;
  /**
   * Run a post-snap intersection-cut pass to repair geometry artefacts
   * introduced by rounding / snapping (mapshaper's `fix-geometry` flag).
   * Recommended when `precision` or `interval` aggressively collapse
   * vertices.
   */
  fixGeometry?: boolean;
}

/**
 * Options for `Emap.rebuildTopology`. Forwarded into mapshaper's
 * `addIntersectionCuts` (with snake_case key conversion).
 */
export interface RebuildTopologyOptions {
  /** Source ID whose dataset will be rebuilt. */
  source: string;
  /**
   * Coincident-vertex snap distance in source-CRS units. When omitted,
   * mapshaper auto-detects based on the dataset bounds.
   */
  snapInterval?: number;
  /**
   * Skip the snap pre-pass entirely. Faster, but won't fix near-coincident
   * vertices that should share an arc.
   */
  noSnap?: boolean;
  /**
   * Force a `buildTopology` rerun even when the cut-detection pass found
   * no changes. Useful after pure translates that didn't intersect anything
   * new but still need shared arcs re-derived against neighbours.
   */
  rebuildTopology?: boolean;
}

/** Options for `Emap.renameLayer`. */
export interface RenameLayerOptions {
  /** Source ID containing the target layer. */
  source: string;
  /** Layer name (or id) to rename. */
  target: string;
  /** New layer name. Trimmed; must be non-empty and not collide with another existing layer. */
  name: string;
}

/** Options for `Emap.splitLayer`. */
export interface SplitLayerOptions {
  /** Source ID containing the target layer. */
  source: string;
  /** Layer name (or id) to partition. */
  target: string;
  /**
   * Field name (e.g. `'STATE'`) or JS expression for grouping. mapshaper
   * auto-detects: a bare field reference uses that field's value; otherwise
   * the string is evaluated per feature as JS. Forwarded verbatim.
   */
  expression: string;
  /** Keep the original layer alongside the new split outputs. */
  noReplace?: boolean;
}

/** Options for `Emap.dropLayer`. */
export interface DropLayerOptions {
  /** Source ID containing the layer to delete. */
  source: string;
  /** Layer name (or id) to remove from the source dataset. */
  target: string;
}

/** Options for `Emap.sortFeatures`. */
export interface SortFeaturesOptions {
  /** Source ID containing the target layer. */
  source: string;
  /** Layer name (or id) whose features will be sorted in place. */
  target: string;
  /**
   * JS expression evaluated per feature to produce the sort key. Bare field
   * names (`'POP'`) work because mapshaper exposes record fields as locals.
   */
  expression: string;
  /** Sort descending. Default `false` (ascending). */
  descending?: boolean;
}

/** Options for `Emap.uniqueFeatures`. */
export interface UniqueFeaturesOptions {
  /** Source ID containing the target layer. */
  source: string;
  /** Layer name (or id) to dedupe within. */
  target: string;
  /**
   * JS expression evaluated per feature to produce the dedupe id. Forwarded
   * verbatim (a bare field name like `'STATE_FIPS'` works). For full-record
   * dedupe pass `'JSON.stringify(this.properties)'`.
   */
  expression: string;
  /**
   * Maximum features per id; default `1`. Must be a positive integer when
   * supplied (`> 0`).
   */
  maxCount?: number;
  /** Keep duplicates and drop unique features instead (mapshaper's `invert`). */
  invert?: boolean;
}

/** Options for `Emap.filterFields`. */
export interface FilterFieldsOptions {
  /** Source ID containing the target layer. */
  source: string;
  /** Layer name (or id) whose attribute schema will be slimmed. */
  target: string;
  /**
   * Field names to retain. Each entry must be a non-empty string with no
   * `,` characters. Use `['*']` for "drop all" (mapshaper convention).
   */
  fields: string[];
  /** Drop the listed fields and keep the rest (mapshaper's `invert` flag). */
  invert?: boolean;
}

/**
 * Options for `Emap.filterIslands` — drop tiny disconnected polygon
 * parts (e.g. cartographic cleanup of digitisation noise). Wraps
 * mapshaper's `-filter-islands`.
 *
 * Supply at least one of `minArea` / `minVertices` — mapshaper requires
 * a threshold or it's a no-op.
 */
export interface FilterIslandsOptions {
  /** Source ID containing the target layer. */
  source: string;
  /** Layer name (or id) of the polygon layer to clean. */
  target: string;
  /** Drop islands smaller than this area (source-CRS units²). */
  minArea?: number;
  /** Drop islands with fewer than this many vertices (after dedup). */
  minVertices?: number;
  /**
   * After dropping islands, also drop features whose shape array becomes
   * empty (mapshaper's `remove-empty`). Defaults to keeping empties.
   */
  removeEmpty?: boolean;
}

/**
 * Options for `Emap.filterSlivers` — drop sliver polygons (tiny
 * polygons left over from clip / erase / dissolve operations). Wraps
 * mapshaper's `-filter-slivers`.
 */
export interface FilterSliversOptions {
  /** Source ID containing the target layer. */
  source: string;
  /** Layer name (or id) of the polygon layer to clean. */
  target: string;
  /**
   * Drop polygons whose area falls below this threshold (source-CRS
   * units²). Required — mapshaper has no implicit default.
   */
  minArea: number;
  /**
   * Use a perimeter-weighted area metric (mapshaper's `weighted` flag).
   * Better for elongated slivers where bare area undershoots the
   * "looks like a sliver" intuition.
   */
  weighted?: boolean;
}

/**
 * Options for `Emap.filterGeom` — geometric (vs attribute) filter.
 * Currently mapshaper's `-filter-geom` only supports a single bbox
 * predicate, so the option is required. Use `filterFeatures` for
 * attribute predicates (`expression`).
 */
export interface FilterGeomOptions {
  /** Source ID containing the target layer. */
  source: string;
  /** Layer name (or id) to filter in place. */
  target: string;
  /**
   * Bounding box `[xmin, ymin, xmax, ymax]` in source coords. Features
   * whose geometry intersects this box are kept; the rest are dropped.
   */
  bbox: [number, number, number, number];
}

/**
 * Options for `Emap.affineLayer` — apply an affine transform to every
 * vertex in a layer (or the whole dataset if `target` is omitted).
 * Wraps mapshaper's `-affine`.
 *
 * Distinct from `editSession.beginAffineSession()`: that one is
 * selection-driven (transform only the selected features and split
 * shared arcs first); this op transforms an entire layer in one shot
 * with no shared-arc handling.
 */
export interface AffineLayerOptions {
  /** Source ID containing the target layer. */
  source: string;
  /** Layer name (or id). When omitted, the whole dataset is transformed. */
  target?: string;
  /** Translate by `[dx, dy]` in source coords. */
  shift?: [number, number];
  /** Rotate by this many degrees (positive = counter-clockwise). */
  rotate?: number;
  /**
   * Scale factor. A single number scales uniformly; a `[sx, sy]` pair
   * scales each axis independently.
   */
  scale?: number | [number, number];
  /**
   * Anchor `[x, y]` for rotation / scale. Defaults to the layer's
   * bbox centre when omitted.
   */
  anchor?: [number, number];
  /**
   * Optional JS predicate — only features matching `where` are
   * transformed. Subject to `expressionPolicy` gating.
   */
  where?: string;
}

/**
 * Options for `Emap.dataFill` — fill missing attribute values from
 * adjacent features. Useful for cleaning gappy administrative-region
 * datasets where some polygons lack a code/name field.
 *
 * Wraps mapshaper's `-data-fill`. Currently scoped to a single field
 * per call (mapshaper's API limit).
 */
export interface DataFillOptions {
  /** Source ID containing the target layer. */
  source: string;
  /** Layer name (or id). */
  target: string;
  /** Field name whose null/empty values should be back-filled. */
  field: string;
  /**
   * Optional weighting field — when filling from multiple eligible
   * neighbours, prefer the one with the largest value of this field
   * (e.g. weight by `area` so big neighbours dominate).
   */
  weightField?: string;
  /**
   * Restrict fills so a contiguous block of features can only adopt
   * one value (mapshaper's `contiguous` flag). Without it, isolated
   * pockets within a region can pick up different fill values.
   */
  contiguous?: boolean;
}

/** Options for `Emap.checkGeometry`. Read-only topology validation. */
export interface CheckGeometryOptions {
  /** Source ID whose dataset will be inspected. */
  source: string;
  /**
   * Optional layer name. Reserved for future per-layer scoping; v1 always
   * scans the whole dataset's arcs regardless. The name is still validated
   * up-front so a typo shows up immediately as a `null` return.
   */
  target?: string;
  /**
   * Override the auto-derived intersection-tolerance epsilon. Forwarded to
   * `findSegmentIntersections.tolerance`. Source-CRS units.
   */
  tolerance?: number;
}

/** Result shape returned from `Emap.checkGeometry`. */
export interface GeometryCheckReport {
  /** `true` iff the report has zero issues across every category. */
  ok: boolean;
  /** Detected segment-intersection points. */
  intersections: Array<{ x: number; y: number }>;
  /** Convenience: `intersections.length`. */
  intersectionCount: number;
}

/**
 * Options for `Emap.intersectionPointsLayer`. Materializes the
 * self-intersection points of a polygon or polyline target as a new
 * point layer in the same source's dataset.
 */
export interface IntersectionPointsLayerOptions {
  /** Source ID containing the target. */
  source: string;
  /** Polygon or polyline layer name (or id) whose self-intersections will be extracted. */
  target: string;
  /**
   * Optional name for the new point layer. Defaults to
   * `${target}-intersections`. Must not collide with an existing layer
   * in the same dataset.
   */
  name?: string;
  /**
   * Override the auto-derived intersection-tolerance epsilon. Forwarded
   * to `findSegmentIntersections.tolerance`. Source-CRS units. Must be
   * a positive finite number when supplied.
   */
  tolerance?: number;
}

/** Source-data shape for `Emap.joinTable`. Discriminated union: */
export type JoinTableData =
  /** CSV content (string or bytes). Saved as `.emap-join.csv` in the runner cache. */
  | { csv: string | Uint8Array; json?: never; layer?: never }
  /** JSON content. Plain arrays/objects are auto-stringified before injection. */
  | { json: string | Uint8Array | unknown[] | Record<string, unknown>; csv?: never; layer?: never }
  /** Reference to another layer in the same source by name. */
  | { layer: string; csv?: never; json?: never };

/** Options for `Emap.joinTable`. */
export interface JoinTableOptions {
  /** Source ID containing the target layer. */
  source: string;
  /** Target layer name (or id) to receive joined attributes. */
  target: string;
  /** Where to read the source records from. */
  data: JoinTableData;
  /**
   * Join keys, `[targetKey, sourceKey]`. Both must be non-empty trimmed
   * strings. Forwarded as `keys=<target>,<source>`.
   */
  keys: [string, string];
  /** Fields to copy from the source. Defaults to all but the source key. */
  fields?: string[];
  /** Prefix for joined-in field names (e.g. `'p_'` → `p_pop`, `p_gdp`). */
  prefix?: string;
  /** JS expression to filter source records before join. */
  where?: string;
  /** JS expression for many-to-one aggregation. */
  calc?: string;
  /** Keep target records that didn't match any source record (mapshaper's `unjoined`). */
  unjoined?: boolean;
  /** Output unmatched source records as a separate layer (mapshaper's `unmatched`). */
  unmatched?: boolean;
}

/** Options for `Emap.renameFields`. */
export interface RenameFieldsOptions {
  /** Source ID containing the target layer. */
  source: string;
  /** Layer name (or id) whose fields will be renamed. */
  target: string;
  /**
   * Map of `oldName -> newName`. Both keys and values must be non-empty
   * after trimming and contain neither `,` nor `=` (those would break
   * the comma-and-equals serialization mapshaper expects).
   */
  mapping: Record<string, string>;
}

/** Options for `Emap.mergeLayers`. Requires `targets.length >= 2`. */
export interface MergeLayersOptions {
  /** Source ID containing every target layer. */
  source: string;
  /** Two or more layer names (or ids) to combine into one. */
  targets: string[];
  /** Optional name for the output layer. */
  name?: string;
  /**
   * Allow merging layers with different geometry types or inconsistent data
   * fields (mapshaper's `force` flag). Without this, mismatched-geometry
   * targets are rejected up-front to avoid an opaque mid-pipeline error.
   */
  force?: boolean;
  /**
   * For polygon merges: rebuild as a flat mosaic with higher-id polygons
   * winning overlaps (mapshaper's `flatten` flag). Ignored by mapshaper
   * for non-polygon inputs.
   */
  flatten?: boolean;
}

/** Simplification algorithm exposed by mapshaper's `-simplify`. */
export type SimplifyMethod = 'dp' | 'visvalingam' | 'weighted';

/**
 * Options for `Emap.projectLayer`. Reprojection via mapshaper's `-proj`
 * (Proj.4-backed). `crs` is the destination CRS string; mapshaper accepts
 * EPSG codes (`'EPSG:3857'`), named aliases (`'webmercator'`, `'robinson'`),
 * or full Proj.4 definitions (`'+proj=utm +zone=10'`).
 */
export interface ProjectOptions {
  /** Source ID containing the layer(s) to reproject. */
  source: string;
  /** Destination CRS. Required, non-empty after trimming. */
  crs: string;
  /**
   * Optional layer name to scope the operation. When omitted, the whole
   * source dataset is reprojected (mapshaper CLI default).
   */
  target?: string;
  /**
   * Source CRS override. Useful when the dataset doesn't have a stored
   * CRS or when the stored value is wrong. Same string formats as `crs`.
   */
  init?: string;
  /**
   * Add intermediate vertices along straight segments to approximate
   * curves under the destination projection (mapshaper's `densify` flag).
   * Recommended when projecting from EPSG:4326 to azimuthal or pseudo-
   * cylindrical projections to avoid visible angular distortion of long
   * geodesic segments.
   */
  densify?: boolean;
}

/**
 * Options for `Emap.simplifyLayer`. Exactly one of `percentage`,
 * `interval`, or `resolution` MUST be supplied — they correspond to
 * mapshaper's three threshold modes and are mutually exclusive.
 */
export interface SimplifyOptions {
  /** Source ID. Simplification operates on the source's shared arcs. */
  source: string;
  /**
   * Optional layer name to scope the operation. When omitted, simplify
   * applies to every layer in the source dataset (mapshaper CLI default).
   */
  target?: string;
  /**
   * Percentage of removable vertices to retain, e.g. `10` → `10%`. Must be
   * within `[0, 100]`. Mutually exclusive with `interval` and `resolution`.
   */
  percentage?: number;
  /**
   * Output resolution as a positive distance in source-CRS units. Mutually
   * exclusive with `percentage` and `resolution`.
   */
  interval?: number;
  /**
   * Output resolution as a grid string (e.g. `"1000x500"`). Mutually
   * exclusive with `percentage` and `interval`.
   */
  resolution?: string;
  /**
   * Simplification algorithm. Default is `'weighted'` (weighted-Visvalingam),
   * matching mapshaper's CLI default.
   */
  method?: SimplifyMethod;
  /** Weighted-Visvalingam coefficient (mapshaper default 0.7). */
  weighting?: number;
  /** Treat coordinates as planar (degrees), not 3D spherical. */
  planar?: boolean;
  /** Keep small polygon features that would otherwise vanish. */
  keepShapes?: boolean;
  /** Pin vertices that lie on the dataset bounding box. */
  lockBox?: boolean;
  /** Skip the post-simplify topology repair pass. */
  noRepair?: boolean;
}

/**
 * Options for `Emap.cleanLayer`. Heavy topology-repair pass — O(N²) on
 * polygon counts in the worst case — so opt in via explicit invocation. Every
 * field is optional; omitting them lets mapshaper apply its built-in defaults.
 */
export interface CleanOptions {
  /** Source ID containing the target layer. */
  source: string;
  /** Layer name (or id) of the polygon layer to clean. */
  target: string;
  /**
   * Maximum area (in source-CRS units²) of gaps to fill in. Gaps larger
   * than this are kept as holes. Maps to mapshaper's `gap-fill-area=N`.
   */
  gapFillArea?: number;
  /**
   * Sliver-detection sensitivity, typically `0..1`. Lower keeps more
   * features; higher removes more. Maps to `sliver-control=N`.
   */
  sliverControl?: number;
  /** Coincident-vertex snap distance for the topology-build pre-pass. */
  snapInterval?: number;
  /** Skip the snap pre-pass entirely (mapshaper's `no-snap` flag). */
  noSnap?: boolean;
  /**
   * Allow output polygons to overlap (disables gap fill).
   * Maps to mapshaper's `allow-overlaps` flag.
   */
  allowOverlaps?: boolean;
  /**
   * Tie-breaking rule when overlapping polygons are merged: which input
   * record's attributes win. Maps to `overlap-rule=...`.
   */
  overlapRule?: 'min-id' | 'max-id' | 'min-area' | 'max-area';
  /**
   * Keep features with null geometry instead of removing them.
   * Maps to mapshaper's `allow-empty` flag.
   */
  allowEmpty?: boolean;
  /**
   * Fix CW/CCW winding-order errors in polygon rings.
   * Maps to mapshaper's `rewind` flag.
   */
  rewind?: boolean;
  /**
   * Only delete unused arcs, don't repair gaps / overlaps.
   * Maps to mapshaper's `only-arcs` flag.
   */
  onlyArcs?: boolean;
  /**
   * Skip the arc-dissolve sub-step.
   * Maps to mapshaper's `no-arc-dissolve` flag.
   */
  noArcDissolve?: boolean;
}

/** Options for `Emap.mosaicLayer`. */
export interface MosaicOptions {
  /** Source ID containing the target polygon layer. */
  source: string;
  /** Layer name (or id) of the polygon layer to flatten. */
  target: string;
  /** Snap distance for the topology-build pre-pass (mapshaper's `snap-interval=`). */
  snapInterval?: number;
  /** Skip the snap pre-pass entirely (mapshaper's `no-snap` flag). */
  noSnap?: boolean;
  /** Keep the original layer alongside the new mosaic (mapshaper's `no-replace`). */
  noReplace?: boolean;
  /** Optional name for the output layer. */
  name?: string;
  /**
   * JS expression evaluated per output mosaic feature to compute aggregate
   * attribute values (mapshaper's `calc=` option). The expression has access
   * to the standard mapshaper aggregation context — `sum()`, `min()`,
   * `max()`, `count()`, etc. — over the records that contributed to the
   * mosaic feature. Forwarded verbatim, quoted.
   */
  calc?: string;
}

/** Options for `Emap.unionLayers`. Requires `targets.length >= 2`. */
export interface UnionOptions {
  /** Source ID containing every target layer. */
  source: string;
  /** Two or more polygon layer names to overlay. */
  targets: string[];
  /** Optional list of fields to retain in the output. */
  fields?: string[];
  /** Optional name for the output layer. */
  name?: string;
  /** Keep the original layers alongside the new union output. */
  noReplace?: boolean;
}

/**
 * Options for `Emap.divideLayer`. Splits a polyline `target` layer at
 * the boundaries of a polygon `divider` layer (both in the same source) and
 * copies the underlying polygon's attributes onto each resulting line
 * segment.
 */
export interface DivideOptions {
  /** Source ID containing both target and divider layers. */
  source: string;
  /** Polyline layer name (or id) to be cut by polygon boundaries. */
  target: string;
  /** Polygon layer name (or id) used as the divider. */
  divider: string;
  /**
   * Polygon fields to copy onto each line segment. Defaults to all fields of
   * the divider layer.
   */
  fields?: string[];
  /** Replace existing same-named fields on the line records. */
  force?: boolean;
}

/**
 * Modes for `Emap.pointsLayer`, mapping 1:1 to mapshaper's mutually
 * exclusive `-points` flags.
 */
export type PointsMode =
  | 'centroid'
  | 'inner'
  | 'vertices'
  | 'endpoints'
  | 'midpoints'
  | 'interpolated';

/**
 * Options for `Emap.linesLayer`. Converts a polygon `target` into a
 * polyline layer made of its boundary arcs. With `fields`, the boundaries
 * are emitted hierarchically by category (e.g. outer hull vs. inter-region
 * boundaries vs. inter-subregion boundaries).
 */
export interface LinesOptions {
  /** Source ID containing the polygon target. */
  source: string;
  /** Polygon layer name (or id) to extract boundaries from. */
  target: string;
  /**
   * Optional category fields. Each polygon boundary inherits the value of
   * the most-coarse field that differs across it; mapshaper emits the
   * boundary at the topmost layer in the hierarchy.
   */
  fields?: string[];
  /** Optional name for the new polyline layer. */
  name?: string;
  /** Keep the original polygon layer alongside the new polyline output. */
  noReplace?: boolean;
}

/**
 * Options for `Emap.polygonsLayer`. Inverse of {@link LinesOptions} —
 * forms enclosed polygons from a polyline target.
 */
export interface PolygonsOptions {
  /** Source ID containing the polyline target. */
  source: string;
  /** Polyline layer name (or id) to be polygonized. */
  target: string;
  /**
   * Gap-snapping tolerance in source-CRS units. Forwarded only when
   * positive; otherwise mapshaper picks its own default.
   */
  gapTolerance?: number;
  /**
   * If true, take the fast path that assumes the input is already a layer
   * of closed paths (mapshaper's `from-rings` flag).
   */
  fromRings?: boolean;
}

/** Options for `Emap.pointsLayer`. */
export interface PointsOptions {
  /** Source ID containing the target layer. */
  source: string;
  /** Layer name (or id) of the layer whose points will be extracted. */
  target: string;
  /**
   * Extraction mode. Each mode constrains the input geometry: `centroid` /
   * `inner` need polygons; `midpoints` / `interpolated` need polylines;
   * `vertices` / `endpoints` accept either polygons or polylines.
   */
  type: PointsMode;
  /**
   * Sample interval in source-CRS units. Required (and must be positive) for
   * `type: 'interpolated'`; ignored otherwise.
   */
  interval?: number;
  /** Optional name for the output point layer. */
  name?: string;
  /** Keep the original layer alongside the new point layer (mapshaper's `no-replace`). */
  noReplace?: boolean;
}

/** Options for `Emap.exportSnapshot`. */
export interface ExportSnapshotOptions {
  /**
   * Bake simplification thresholds and gzip-compress arc buffers
   * (mapshaper's `compact` flag). Default `true` — matches mapshaper CLI's
   * on-disk snapshot.
   */
  compact?: boolean;
}

/** Options for `Emap.loadSnapshot`. */
export interface LoadSnapshotOptions {
  /**
   * Prepended to every restored source ID — useful when loading a snapshot
   * alongside existing sources to namespace them apart. Applies to both
   * IDs read from the snapshot's `emap` metadata and fallback IDs.
   */
  idPrefix?: string;
  /**
   * When a restored ID collides with an already-registered source:
   * - `true` (default) — the existing source is removed first.
   * - `false` — the promise rejects without registering anything new.
   */
  replace?: boolean;
  /**
   * Used when the snapshot has no `emap` metadata (e.g. a vanilla mapshaper
   * `.msx` file). One ID per restored dataset, in order. If the array is
   * shorter than the dataset count, the tail falls back to `snapshot-<i>`.
   */
  defaultIds?: string[];
}

export interface HighlightStyle {
  color?: string;
  width?: number;
  radius?: number;
  fill?: boolean;
}

// Aliased to the canonical path-shape vocabulary in `types/mapshaper-types`.
// Kept as named exports for backwards compatibility with existing imports.
export type EditVertexShapePart = import('../types/mapshaper-types').PathPart;
export type EditVertexShape = import('../types/mapshaper-types').PathShape;

export interface EditVertexArcs {
  getArcIter(arcId: number): {
    x: number;
    y: number;
    hasNext(): boolean;
  };
  getShapeIter?(part: number[]): {
    x: number;
    y: number;
    hasNext(): boolean;
  };
}

export interface EditVertexState {
  shapes: EditVertexShape[];
  arcs: EditVertexArcs;
  hoverVertex: [number, number] | null;
  /**
   * Whether `hoverVertex` is an actual vertex on an arc (`'vertex'`) or
   * the interpolated midpoint of an edge (`'interpolated'`, drag to insert
   * a new vertex). Renderers draw a circle for `'vertex'` and a square for
   * `'interpolated'`, mirroring the convention used in DrawFeatureControl.
   */
  hoverType?: 'vertex' | 'interpolated' | null;
  /** CSS color string for polygon fill in vertex edit mode. Null = no fill. */
  polygonFill?: string | null;
  geometryType?: string;
  /** Neighbor shapes sharing the hovered arc (different polygon fill) */
  neighborShapes?: EditVertexShape[];
}

/** Default vertex-count threshold for `useWorker: 'auto'`. */
export const DEFAULT_WORKER_THRESHOLD = 50_000;
