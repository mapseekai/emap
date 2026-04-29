import { EventDispatcher } from '../core/events';
import { Bounds } from '../geo/bounds';
import { AffineTransform } from '../geo/transform';
import { Viewport } from '../geo/viewport';
import { Projection } from '../geo/projection';
import { Painter } from '../renderer/painter';
import { CanvasPainter } from '../renderer/canvas-painter';
import { CanvasKitPainter } from '../renderer/canvaskit-painter';
import { TopologySource } from '../source/source';
import { TopologySource as ConcreteTopologySource } from '../source/topology-source';
import { MouseWheel } from '../core/interactions';
import { DragPanHandler } from '../core/drag-pan-handler';
import { MapshaperWorkerPool } from '../core/mapshaper-worker-pool';
import { FeatureQuery } from './feature-query';
import { HighlightManager } from './highlight-manager';
import { Selection, SelectMode, SelectionDiff } from './selection';
import { EditHistory, HistoryStateSnapshot } from '../edit/edit-history';
import type { EditCommand } from '../edit/edit-command';
import { CompositeCommand } from '../edit/commands/composite';
import { BulkFeatureDeleteCommand, type BulkFeatureDeleteCommandOptions } from '../edit/commands/feature-delete';
import { FeatureTranslateCommand, TranslatedPointFeature } from '../edit/commands/feature-translate';
import {
  SplitSharedArcsCommand,
  planSharedArcSplit,
} from '../edit/commands/split-shared-arcs';
import {
  FeatureAffineCommand,
  AffineMatrix,
  rotateMatrix,
  scaleMatrix,
  composeMatrix,
  invertMatrix,
  IDENTITY_MATRIX,
} from '../edit/commands/feature-affine';
import { DatasetReplaceCommand } from '../edit/commands/dataset-replace';
import { FeaturePropertyChangeCommand } from '../edit/commands/feature-property-change';
import { FieldAddCommand } from '../edit/commands/field-add';
import { FieldRemoveCommand } from '../edit/commands/field-remove';
import { FieldRenameCommand } from '../edit/commands/field-rename';
import mapshaper from 'mapshaper';
import { Control, ControlPosition } from '../ui/control';
import { getLayerId } from '../source/layer-utils';
import { resolveStrokeStyle, resolvePointStyle } from './layer';
import type { LayerSpecification, FillPaint, LinePaint, CirclePaint } from './layer';
import type { MapshaperDataset, MapshaperLayer } from '../types/mapshaper-types';
import type { DrawGeometryType } from '../ui/draw-feature-control';
import type { CanvasKit } from 'canvaskit-wasm';

export type ExpressionEvaluationPolicy = 'trusted' | 'disabled';

export interface MapOptions {
  container: string | HTMLElement;
  interactive?: boolean;
  /**
   * Renderer backend to use.
   * - 'canvas': Canvas 2D API (default, recommended for large datasets)
   * - 'canvaskit': CanvasKit/Skia WASM (experimental)
   */
  renderer?: 'canvas' | 'canvaskit';
  /**
   * CanvasKit instance (required when renderer is 'canvaskit').
   * @experimental This feature is experimental and may have performance issues with large datasets.
   */
  canvasKit?: CanvasKit;
  /**
   * Controls APIs that forward JavaScript expressions to mapshaper
   * (`applyExpression`, `filterFeatures`, `sortFeatures`, `splitLayer`, and
   * command options such as `where` / `calc`). Defaults to `'trusted'` for
   * backward compatibility. Set to `'disabled'` when strings may come from
   * untrusted end users.
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
   * Pre-constructed worker pool. Only consulted when `useWorker` is
   * truthy; takes precedence over `workerUrl`. Used by tests to inject
   * a mock pool, and by power users who want to share one pool across
   * multiple `Emap` instances.
   */
  workerPool?: MapshaperWorkerPool;
}

const DEFAULT_WORKER_THRESHOLD = 50_000;

export interface QueryRenderedFeaturesOptions {
  layers?: string[];
}

export interface RenderedFeatureAttributes {
  id: number;
  source: string;
  layer: string;
  geometryType: string;
  properties: Record<string, unknown>;
}

/**
 * Canonical reference to a single feature within a source/layer.
 * Used by selection, highlight, and downstream geometry operations.
 */
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
 * undo stack. Returned by {@link Emap.beginTranslateSession}.
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
 * {@link Emap.beginAffineSession}. Same idea as
 * {@link FeatureTranslateSession}: every `applyDelta(matrix)` mutates
 * geometry in place, only `commit()` writes a single history entry built
 * from the cumulative composed matrix.
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
 * Options for the {@link Emap.clipLayer} / {@link Emap.eraseLayer} polygon
 * operations. Both target and mask must reside in the same emap source —
 * cross-source masks require a future explicit merge step.
 */
export interface ClipEraseOptions {
  /** Source ID containing both layers. */
  source: string;
  /** Layer name (or id) of the target to be clipped/erased. */
  target: string;
  /** Layer name (or id) of the polygon mask. */
  mask: string;
}

/**
 * Options for {@link Emap.dissolveLayer}. With no `field` / `fields`,
 * mapshaper merges every feature in the target layer into one. With a
 * grouping key, features sharing that key's value are merged together.
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

/** Options for {@link Emap.bufferLayer}. */
export interface BufferOptions {
  /** Source ID containing the target layer. */
  source: string;
  /** Layer name (or id) of the layer to buffer. */
  target: string;
  /**
   * Buffer radius in source-CRS units (e.g., degrees for EPSG:4326, metres
   * for projected CRSes). Accepts either a constant `number` or a mapshaper
   * expression string evaluated per record (e.g. `"pop / 1000"`).
   */
  radius: number | string;
  /** Buffer cap style (mapshaper's `cap-style=` option). Default is `round`. */
  capStyle?: 'flat' | 'round';
}

/**
 * Options for {@link Emap.applyExpression} — bulk attribute updates via
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

/** Options for {@link Emap.explodeLayer}. */
export interface ExplodeOptions {
  /** Source ID containing the target layer. */
  source: string;
  /** Layer name (or id) of the layer whose multi-part features will be split. */
  target: string;
}

/** Options for {@link Emap.innerlinesLayer}. */
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

/** Options for {@link Emap.filterFeatures}. */
export interface FilterOptions {
  /** Source ID containing the target layer. */
  source: string;
  /** Layer name (or id) of the layer to filter. */
  target: string;
  /**
   * JS expression evaluated per feature. Records that evaluate to false are
   * deleted (mapshaper convention). Same `this` context as
   * {@link Emap.applyExpression}: `this.<field>`, `this.id`, etc.
   */
  expression?: string;
  /** Flip the predicate (mapshaper's `invert` flag). */
  invert?: boolean;
  /** Also delete features with null geometry (mapshaper's `remove-empty`). */
  removeEmpty?: boolean;
}

/** Options for {@link Emap.snapLayer}. */
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
 * Options for {@link Emap.rebuildTopology}. Forwarded into mapshaper's
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

/** Options for {@link Emap.renameLayer}. */
export interface RenameLayerOptions {
  /** Source ID containing the target layer. */
  source: string;
  /** Layer name (or id) to rename. */
  target: string;
  /** New layer name. Trimmed; must be non-empty and not collide with another existing layer. */
  name: string;
}

/** Options for {@link Emap.splitLayer}. */
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

/** Options for {@link Emap.dropLayer}. */
export interface DropLayerOptions {
  /** Source ID containing the layer to delete. */
  source: string;
  /** Layer name (or id) to remove from the source dataset. */
  target: string;
}

/** Options for {@link Emap.sortFeatures}. */
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

/** Options for {@link Emap.uniqueFeatures}. */
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

/** Options for {@link Emap.filterFields}. */
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

/** Options for {@link Emap.checkGeometry}. Read-only topology validation. */
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

/** Result shape returned from {@link Emap.checkGeometry}. */
export interface GeometryCheckReport {
  /** `true` iff the report has zero issues across every category. */
  ok: boolean;
  /** Detected segment-intersection points. */
  intersections: Array<{ x: number; y: number }>;
  /** Convenience: `intersections.length`. */
  intersectionCount: number;
}

/**
 * Options for {@link Emap.intersectionPointsLayer}. Materializes the
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

/** Source-data shape for {@link Emap.joinTable}. Discriminated union: */
export type JoinTableData =
  /** CSV content (string or bytes). Saved as `.emap-join.csv` in the runner cache. */
  | { csv: string | Uint8Array; json?: never; layer?: never }
  /** JSON content. Plain arrays/objects are auto-stringified before injection. */
  | { json: string | Uint8Array | unknown[] | Record<string, unknown>; csv?: never; layer?: never }
  /** Reference to another layer in the same source by name. */
  | { layer: string; csv?: never; json?: never };

/** Options for {@link Emap.joinTable}. */
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

/** Options for {@link Emap.renameFields}. */
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

/** Options for {@link Emap.mergeLayers}. Requires `targets.length >= 2`. */
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
 * Options for {@link Emap.simplifyLayer}. Exactly one of `percentage`,
 * `interval`, or `resolution` MUST be supplied — they correspond to
 * mapshaper's three threshold modes and are mutually exclusive.
 */
/**
 * Options for {@link Emap.projectLayer}. Reprojection via mapshaper's `-proj`
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

/** Options for {@link Emap.mosaicLayer}. */
/**
 * Options for {@link Emap.cleanLayer}. Heavy topology-repair pass — O(N²) on
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

/** Options for {@link Emap.unionLayers}. Requires `targets.length >= 2`. */
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
 * Options for {@link Emap.divideLayer}. Splits a polyline `target` layer at
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
 * Modes for {@link Emap.pointsLayer}, mapping 1:1 to mapshaper's mutually
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
 * Options for {@link Emap.linesLayer}. Converts a polygon `target` into a
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
 * Options for {@link Emap.polygonsLayer}. Inverse of {@link LinesOptions} —
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

/** Options for {@link Emap.pointsLayer}. */
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

/** Options for {@link Emap.exportSnapshot}. */
export interface ExportSnapshotOptions {
  /**
   * Bake simplification thresholds and gzip-compress arc buffers
   * (mapshaper's `compact` flag). Default `true` — matches mapshaper CLI's
   * on-disk snapshot.
   */
  compact?: boolean;
}

/** Options for {@link Emap.loadSnapshot}. */
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

export type EditVertexShapePart = number[];
export type EditVertexShape = EditVertexShapePart[];

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

/** Kind of snap target the draw cursor is locked onto. */
export type SnapKind = 'vertex' | 'edge' | null;

export interface EditDrawState {
  vertices: [number, number][];
  cursorCoord: [number, number] | null;
  snapCoord: [number, number] | null;
  /**
   * What kind of geometry the current snap is locked to. Renderers may use
   * this to draw a different glyph for vertex vs edge snap. `null` when
   * there is no snap target (`snapCoord === null`).
   */
  snapKind: SnapKind;
  geometryType: DrawGeometryType;
  drawColor: string;
}

export class Emap extends EventDispatcher {
  private _container: HTMLElement;
  private _canvasContainer: HTMLElement;
  private _canvas: HTMLCanvasElement;
  private _painter: Painter;
  private _viewport: Viewport = new Viewport();
  private _projection: Projection = new Projection();
  private _sources: globalThis.Map<string, TopologySource> =
    new globalThis.Map();
  private _sourceListeners: globalThis.Map<string, (e: any) => void> =
    new globalThis.Map();
  private _layers: LayerSpecification[] = [];
  private _effectiveLayersCache: LayerSpecification[] = [];
  private _defaultLayersDirty = true;
  private _layerArcFlagsCache: globalThis.Map<string, Uint8Array> = new globalThis.Map();

  // Interactions (delegated)
  private _mouseWheel: MouseWheel;
  private _dragPan: DragPanHandler;

  // Rendering
  private _pendingRender = 0;
  private _rafId = 0;

  // UI controls
  private _controlContainers: globalThis.Map<ControlPosition, HTMLElement> =
    new globalThis.Map();

  // Delegated managers
  private _highlightManager: HighlightManager = new HighlightManager();
  private _featureQuery: FeatureQuery;
  private _selection: Selection = new Selection();
  private _history: EditHistory = new EditHistory();
  private _historyShortcutUnbind: (() => void) | null = null;

  // Edit mode
  private _editMode: 'none' | 'vertex' | 'draw' = 'none';
  private _editVertexState: EditVertexState | null = null;
  private _editDrawState: EditDrawState | null = null;

  // Worker pool — lazily constructed when `useWorker !== false` was passed.
  // null when the option is off (or until the first dataset-replace runs).
  private _workerPool: MapshaperWorkerPool | null = null;
  // Resolved `useWorker` mode: false (off), true (always), or 'auto'
  // (per-call decision based on dataset vertex count).
  private _workerMode: boolean | 'auto' = false;
  // Vertex-count threshold for the 'auto' mode. Defaults to
  // `DEFAULT_WORKER_THRESHOLD` (50_000).
  private _workerThreshold: number = DEFAULT_WORKER_THRESHOLD;
  private _expressionPolicy: ExpressionEvaluationPolicy = 'trusted';

  constructor(options: MapOptions) {
    super();

    if (typeof options.container === 'string') {
      const el = document.getElementById(options.container);
      if (!el) throw new Error(`Container #${options.container} not found`);
      this._container = el;
    } else {
      this._container = options.container;
    }

    this._canvasContainer = this._createCanvasContainer();
    this._container.appendChild(this._canvasContainer);

    this._canvas = document.createElement('canvas');
    this._canvas.style.position = 'absolute';
    this._canvas.style.top = '0';
    this._canvas.style.left = '0';
    this._canvasContainer.appendChild(this._canvas);

    // Select renderer based on options (default: 'canvas')
    if (options.renderer === 'canvaskit' && options.canvasKit) {
      this._painter = new CanvasKitPainter(options.canvasKit, this._canvas);
    } else {
      this._painter = new CanvasPainter(this._canvas);
    }
    this._painter.setPixelRatio(window.devicePixelRatio || 1);

    this._updateSize();

    // Viewport callbacks
    this._viewport.onViewChange = () => this.fire('move');
    this._viewport.initZoomTween();

    // Interactions — both use EventDispatcher pattern
    this._mouseWheel = new MouseWheel(this._canvasContainer);
    this._dragPan = new DragPanHandler(this._canvasContainer);

    // Feature query (delegated)
    this._featureQuery = new FeatureQuery(
      this._sources,
      () => this._viewport.transform,
      () => ({ width: this._viewport.width, height: this._viewport.height }),
      () => this._viewport.initialMX,
    );

    this._attachEventListeners();

    this.on('move', () => this._scheduleRender());
    this.on('resize', () => this._scheduleRender());
    this.on('reset', () => this.reset());

    // Set up the worker pool eagerly when requested. Construction is cheap;
    // the underlying Worker is lazy-spawned on first run().
    this._expressionPolicy = options.expressionPolicy ?? 'trusted';
    this._workerMode = options.useWorker ?? false;
    if (typeof options.workerThreshold === 'number' && options.workerThreshold >= 0) {
      this._workerThreshold = options.workerThreshold;
    }
    if (this._workerMode !== false || options.workerPool) {
      if (options.workerPool) {
        this._workerPool = options.workerPool;
      } else {
        this._workerPool = new MapshaperWorkerPool({
          workerUrl: options.workerUrl ?? 'emap-worker.js',
        });
      }
    }
  }

  /**
   * Hard-cancel any in-flight worker jobs. Safe to call when no worker
   * pool exists (no-op). The pool stays usable — subsequent dataset-replace
   * ops re-spawn a fresh worker.
   *
   * mapshaper isn't interruptible mid-command, so this is the only sound
   * abandonment path: terminate the worker, lose any other queued jobs as
   * collateral, and let the next op start over.
   */
  public cancelWorkerJobs(): void {
    this._workerPool?.cancelAll();
  }

  public setExpressionPolicy(policy: ExpressionEvaluationPolicy): void {
    this._expressionPolicy = policy;
  }

  public getExpressionPolicy(): ExpressionEvaluationPolicy {
    return this._expressionPolicy ?? 'trusted';
  }

  private _allowExpressionEvaluation(values: Array<string | undefined>, operation: string): boolean {
    const hasExpression = values.some((value) => typeof value === 'string' && value.trim().length > 0);
    if (!hasExpression || this.getExpressionPolicy() === 'trusted') return true;
    this.fire('error', {
      error: new Error(`${operation}: expression evaluation is disabled`),
    });
    return false;
  }


  public getCanvasContainer(): HTMLElement {
    return this._canvasContainer;
  }

  public getEditMode(): 'none' | 'vertex' | 'draw' {
    return this._editMode;
  }

  public setEditMode(mode: 'none' | 'vertex' | 'draw'): void {
    this._editMode = mode;
    this._dragPan.setEnabled(mode === 'none');
    this.fire('editmodechange', { mode });
  }

  public setEditVertexState(state: EditVertexState): void {
    this._editVertexState = state;
  }

  public clearEditVertexState(): void {
    this._editVertexState = null;
  }

  public setEditDrawState(state: EditDrawState): void {
    this._editDrawState = state;
  }

  public clearEditDrawState(): void {
    this._editDrawState = null;
  }

  private _attachEventListeners(): void {
    this._dragPan.on('pan', (e: { dx: number; dy: number }) => {
      this._viewport.pan(e.dx, e.dy);
      this.fire('move');
    });
    this._dragPan.on('panstart', () => {
      this._viewport.cancelZoomAnimation();
    });

    this._mouseWheel.on('mousewheel', (e: { direction: number; multiplier: number; x: number; y: number }) => {
      this._viewport.applyWheelZoom(e.direction, e.multiplier, e.x, e.y);
      this.fire('move');
    });
  }

  private _createCanvasContainer(): HTMLElement {
    const el = document.createElement('div');
    el.style.position = 'relative';
    el.style.width = '100%';
    el.style.height = '100%';
    el.style.overflow = 'hidden';
    el.className = 'emap-canvas-container';

    const corners: ControlPosition[] = [
      'top-left',
      'top-right',
      'bottom-left',
      'bottom-right',
    ];
    for (const pos of corners) {
      const container = document.createElement('div');
      container.className = `emap-ctrl-${pos}`;
      container.style.position = 'absolute';
      container.style.pointerEvents = 'none';
      container.style.zIndex = '10';

      const [v, h] = pos.split('-');
      container.style[v as 'top' | 'bottom'] = '10px';
      container.style[h as 'left' | 'right'] = '10px';
      container.style.display = 'flex';
      container.style.flexDirection = 'column';
      container.style.gap = '8px';

      el.appendChild(container);
      this._controlContainers.set(pos, container);
    }

    return el;
  }

  private _updateSize(): void {
    const width = this._container.clientWidth;
    const height = this._container.clientHeight;
    this._viewport.updateSize(width, height);
    this._painter.resize(width, height);
  }


  public addSource(id: string, source: TopologySource): void {
    this._sources.set(id, source);

    const onData = (e: any) => {
      if (this._sources.size === 1 && source.getCRS) {
        const crs = source.getCRS();
        if (crs && this._projection.crs !== crs) {
          this._projection.setCRS(crs);
          this._viewport.setCRS(crs);
          this.fire('crschange');
        }
      }
      this.fire('data', { sourceId: id, ...e });
      this._defaultLayersDirty = true;
      this._layerArcFlagsCache.clear();
      this._scheduleRender();
    };

    this._sourceListeners.set(id, onData);
    source.on('data', onData);

    // If source already has data, trigger logic once manually
    if (source.getDataset && source.getDataset()) {
      onData({ type: 'data' });
    }
  }

  public removeSource(id: string): void {
    const source = this._sources.get(id);
    if (source) {
      const listener = this._sourceListeners.get(id);
      if (listener) {
        source.off('data', listener);
        this._sourceListeners.delete(id);
      }
      this._sources.delete(id);
      this._defaultLayersDirty = true;
      this._layerArcFlagsCache.delete(id);
      
      // Remove all cached arc flags for this source
      for (const key of this._layerArcFlagsCache.keys()) {
        if (key.startsWith(`${id}:`)) {
          this._layerArcFlagsCache.delete(key);
        }
      }
      this._scheduleRender();
    }
  }

  public getSource(id: string): TopologySource | undefined {
    return this._sources.get(id);
  }

  // ---------------------------------------------------------------------------
  // Multi-source snapshot (.msx) — pack/unpack the whole map
  // ---------------------------------------------------------------------------

  /**
   * Pack every topology source on this map into one `.msx` snapshot Blob via
   * mapshaper's session pack pipeline. Source IDs are preserved in a custom
   * `emap.sources` field on the packed object so {@link loadSnapshot} can
   * re-register sources under their original IDs.
   *
   * Sources that have no dataset yet (load not completed) are skipped.
   *
   * The output file is a valid mapshaper `.msx` — vanilla mapshaper will
   * load it (just dropping the `emap` metadata).
   */
  public async exportSnapshot(opts: ExportSnapshotOptions = {}): Promise<Blob> {
    const compact = opts.compact !== false;
    const ids: string[] = [];
    const datasets: any[] = [];
    for (const [id, source] of this._sources) {
      if (source.type !== 'topology') continue;
      const ds = source.getDataset?.();
      if (!ds) continue;
      ids.push(id);
      datasets.push(ds);
    }

    const obj = await mapshaper.internal.exportDatasetsToPack(datasets, { compact });
    (obj as Record<string, unknown>).emap = {
      version: 1,
      sources: ids.map((id) => ({ id })),
    };
    const bytes = mapshaper.internal.pack(obj);
    return new Blob([bytes as BlobPart], { type: 'application/octet-stream' });
  }

  /**
   * Restore one or more topology sources from a `.msx` snapshot via
   * mapshaper's session unpack pipeline. Returns the list of registered
   * source IDs in registration order.
   *
   * ID resolution priority (per restored dataset, in order):
   * 1. `opts.idPrefix` + ID from snapshot's `emap.sources[i].id` (if metadata present)
   * 2. `opts.idPrefix` + `opts.defaultIds[i]` (if supplied)
   * 3. `opts.idPrefix` + `snapshot-<i>` fallback
   *
   * On ID collision: `replace: true` (default) removes the existing source
   * first; `replace: false` rejects without registering anything.
   *
   * Edit history and selection are cleared because feature IDs in the
   * replayed history would point to features that no longer exist after
   * dataset replacement. Same semantics as the dataset-replace family
   * (clip, dissolve, mosaic, ...).
   */
  public async loadSnapshot(
    input: Blob | Uint8Array | ArrayBuffer,
    opts: LoadSnapshotOptions = {},
  ): Promise<string[]> {
    const replace = opts.replace !== false;
    const prefix = opts.idPrefix ?? '';
    const defaults = opts.defaultIds ?? [];

    let bytes: Uint8Array;
    if (input instanceof Uint8Array) {
      bytes = input;
    } else if (input instanceof ArrayBuffer) {
      bytes = new Uint8Array(input);
    } else if (typeof Blob !== 'undefined' && input instanceof Blob) {
      bytes = new Uint8Array(await input.arrayBuffer());
    } else {
      throw new Error('loadSnapshot: input must be Blob, Uint8Array, or ArrayBuffer');
    }

    const obj = await mapshaper.internal.unpackSessionData(bytes);
    const datasets = obj.datasets ?? [];
    const meta = (obj as Record<string, unknown>).emap as
      | { sources?: Array<{ id?: string }> }
      | undefined;
    const storedIds = meta?.sources?.map((s) => s?.id).filter((s): s is string => typeof s === 'string') ?? [];

    const resolvedIds: string[] = datasets.map((_, i) => {
      const stored = storedIds[i];
      const fallback = defaults[i] ?? `snapshot-${i}`;
      return prefix + (stored ?? fallback);
    });

    // Collision check before any side effects when replace=false
    if (!replace) {
      for (const id of resolvedIds) {
        if (this._sources.has(id)) {
          throw new Error(`loadSnapshot: source "${id}" already exists (pass { replace: true } to overwrite)`);
        }
      }
    }

    // History and selection no longer reference live features.
    this._history.clear();
    this._fireSelectionChange(this._selection.clear());
    this.fire('historychange');

    const registered: string[] = [];
    for (let i = 0; i < datasets.length; i++) {
      const id = resolvedIds[i];
      if (replace && this._sources.has(id)) this.removeSource(id);
      const src = new ConcreteTopologySource(id);
      src.setDataset(datasets[i]);
      this.addSource(id, src);
      registered.push(id);
    }
    return registered;
  }

  // ---------------------------------------------------------------------------
  // Layer management
  // ---------------------------------------------------------------------------

  public addLayer(layer: LayerSpecification, before?: string): void {
    if (!this._sources.has(layer.source)) {
      throw new Error(`Source "${layer.source}" not found`);
    }
    if (this._layers.some((l) => l.id === layer.id)) {
      throw new Error(`Layer "${layer.id}" already exists`);
    }
    if (before) {
      const idx = this._layers.findIndex((l) => l.id === before);
      if (idx === -1) {
        throw new Error(`Layer "${before}" not found`);
      }
      this._layers.splice(idx, 0, { ...layer });
    } else {
      this._layers.push({ ...layer });
    }
    this._defaultLayersDirty = true;
    this._scheduleRender();
  }

  public removeLayer(id: string): void {
    const idx = this._layers.findIndex((l) => l.id === id);
    if (idx !== -1) {
      this._layers.splice(idx, 1);
      this._defaultLayersDirty = true;
      this._scheduleRender();
    }
  }

  public getLayer(id: string): LayerSpecification | undefined {
    return this._layers.find((l) => l.id === id);
  }

  public getLayers(): LayerSpecification[] {
    return [...this._layers];
  }

  public setLayerVisibility(id: string, visibility: 'visible' | 'none'): void {
    const layer = this._layers.find((l) => l.id === id);
    if (layer) {
      if (!layer.layout) layer.layout = {};
      layer.layout.visibility = visibility;
      this._scheduleRender();
    }
  }

  public setPaintProperty(id: string, name: string, value: unknown): void {
    const layer = this._layers.find((l) => l.id === id);
    if (layer) {
      if (!layer.paint) layer.paint = {};
      (layer.paint as Record<string, unknown>)[name] = value;
      this._scheduleRender();
    }
  }

  public moveLayer(id: string, beforeId?: string): void {
    const idx = this._layers.findIndex((l) => l.id === id);
    if (idx === -1) return;
    const [layer] = this._layers.splice(idx, 1);
    if (beforeId) {
      const beforeIdx = this._layers.findIndex((l) => l.id === beforeId);
      if (beforeIdx === -1) {
        this._layers.push(layer);
      } else {
        this._layers.splice(beforeIdx, 0, layer);
      }
    } else {
      this._layers.push(layer);
    }
    this._defaultLayersDirty = true;
    this._scheduleRender();
  }

  private _getEffectiveLayers(): LayerSpecification[] {
    if (this._layers.length > 0) return this._layers;

    if (!this._defaultLayersDirty) {
      return this._effectiveLayersCache;
    }

    const defaults: LayerSpecification[] = [];
    for (const [sourceId, source] of this._sources) {
      const mapshaperLayers = source.getLayers() as MapshaperLayer[];
      if (mapshaperLayers.length === 0) {
        defaults.push({
          id: `${sourceId}:default`,
          type: 'line',
          source: sourceId,
          paint: { 'line-color': '#333', 'line-width': 0.8 },
        });
      } else {
        for (let i = 0; i < mapshaperLayers.length; i++) {
          const ml = mapshaperLayers[i];
          const layerId = getLayerId(ml, i);
          const geomType = ml.geometry_type;
          // Default polygon rendering is outline-only (`type: 'line'`) to match
          // mapshaper GUI's behaviour and emap's pre-layer-concept default.
          // Canvas 2D fill is significantly more expensive than stroke for
          // many-polygon datasets (winding-rule rasterization vs straight
          // strokes). Callers who want a filled appearance add an explicit
          // `type: 'fill'` layer via addLayer().
          defaults.push({
            id: `${sourceId}:${layerId}`,
            type: geomType === 'point' ? 'circle' : 'line',
            source: sourceId,
            'source-layer': layerId,
            paint:
              geomType === 'point'
                ? { 'circle-color': '#333', 'circle-radius': 4 }
                : { 'line-color': '#333', 'line-width': 0.8 },
          });
        }
      }
    }
    
    this._effectiveLayersCache = defaults;
    this._defaultLayersDirty = false;
    return defaults;
  }

  private _resolveSourceLayer(
    source: TopologySource,
    sourceLayerName?: string,
  ): MapshaperLayer | null {
    const layers = source.getLayers() as MapshaperLayer[];
    if (!layers.length) return null;
    if (!sourceLayerName) return layers[0];
    for (let i = 0; i < layers.length; i++) {
      const lid = getLayerId(layers[i], i);
      if (lid === sourceLayerName) return layers[i];
    }
    return null;
  }

  /**
   * Generates a boolean flag array for arcs that belong to a specific source layer.
   * Cached to prevent walking shapes on every frame.
   */
  private _getLayerArcFlags(ml: MapshaperLayer, arcs: any, cacheKey: string): Uint8Array | null {
    if (!ml || !ml.shapes || !arcs) return null;
    
    let flags = this._layerArcFlagsCache.get(cacheKey);
    if (flags) return flags;

    const arcCount = arcs.size();
    flags = new Uint8Array(arcCount);
    
    // Tag all arcs used by this layer's shapes
    for (const shape of ml.shapes) {
      if (!shape) continue;
      for (const part of shape) {
        for (const arcId of part) {
          const absId = arcId >= 0 ? arcId : ~arcId;
          flags[absId] = 1;
        }
      }
    }
    
    this._layerArcFlagsCache.set(cacheKey, flags);
    return flags;
  }

  private _getVisibleLayerKeys(): Set<string> {
    const keys = new Set<string>();
    const layers = this._getEffectiveLayers();
    for (const layer of layers) {
      if (layer.layout?.visibility === 'none') continue;
      const source = this._sources.get(layer.source);
      if (!source) continue;
      const ml = this._resolveSourceLayer(source, layer['source-layer']);
      if (ml) {
        const mapshaperLayers = source.getLayers() as MapshaperLayer[];
        const idx = mapshaperLayers.indexOf(ml);
        const lid = getLayerId(ml, idx >= 0 ? idx : 0);
        keys.add(`${layer.source}:${lid}`);
      }
    }
    return keys;
  }

  public getPainter(): Painter {
    return this._painter;
  }

  public getCRS(): string {
    return this._projection.crs;
  }

  public setCRS(crs: string): void {
    this._projection.setCRS(crs);
    this._viewport.setCRS(crs);
    this.fire('crschange');
  }

  public async reproject(targetCrs: string): Promise<void> {
    if (this._projection.crs === targetCrs) return;

    const newExtent = await this._projection.reproject(targetCrs, this._sources);

    this._viewport.setCRS(targetCrs);
    this._viewport.clearInitialState();

    if (newExtent.hasBounds()) {
      this.setExtent(newExtent);
    }

    this.fire('crschange');
    this.fire('data', { reason: 'reproject' });
  }

  public getCenter(): [number, number] {
    const t = this._viewport.transform;
    const cx = (this._viewport.width / 2 - t.bx) / t.mx;
    const cy = (this._viewport.height / 2 - t.by) / t.my;
    return this._projection.getCenter(cx, cy);
  }

  public getZoom(): number {
    return this._projection.getZoom(Math.abs(this._viewport.transform.mx));
  }

  public getTransform(): AffineTransform {
    return this._viewport.transform;
  }

  public getExtent(): Bounds {
    return this._viewport.extent;
  }

  public setExtent(bounds: Bounds): void {
    this._viewport.setExtent(bounds);
    this.fire('move');
  }

  public reset(): void {
    this._viewport.reset();
  }

  public addControl(
    control: Control,
    position: ControlPosition = 'top-left',
  ): void {
    const el = control.onAdd(this);
    el.style.pointerEvents = 'auto';
    this._controlContainers.get(position)?.appendChild(el);
  }

  public removeControl(control: Control): void {
    control.onRemove(this);
  }

  public zoomIn(): void {
    this._viewport.zoomIn();
  }

  public zoomOut(): void {
    this._viewport.zoomOut();
  }

  private _scheduleRender(): void {
    this._pendingRender++;
    if (this._rafId === 0) {
      this._rafId = requestAnimationFrame(() => this._doRender());
    }
  }

  private _doRender(): void {
    this._rafId = 0;
    if (this._pendingRender > 0) {
      this._pendingRender = 0;
      this.render();
    }
  }

  public render(): void {
    const transform = this._viewport.transform;
    this._painter.setTransform(transform);
    this._painter.clear();

    const lineScale = this._viewport.getLineScale();
    const pixelSize = 1 / Math.abs(transform.mx);
    const effectiveLayers = this._getEffectiveLayers();

    for (const layer of effectiveLayers) {
      if (layer.layout?.visibility === 'none') continue;

      const source = this._sources.get(layer.source);
      if (!source) continue;

      const displayArcs = source.getDisplayArcs();
      const arcs = displayArcs
        ? displayArcs.getScaledArcs(pixelSize)
        : source.getArcs();

      if (arcs) {
        if (
          arcs.setRetainedInterval &&
          (typeof arcs.isFlat !== 'function' || !arcs.isFlat())
        ) {
          // User-driven `-simplify` writes a sticky floor on the source.
          // Per-frame zoom-LOD raises that floor on zoom-out (smaller scale,
          // bigger pixel) but never below the user's threshold — otherwise
          // every render would re-introduce detail the user just filtered.
          const userFloor = source.getSimplifyFloor?.() ?? 0;
          arcs.setRetainedInterval(Math.max(userFloor, pixelSize * 0.5));
        }
      }

      const ml = this._resolveSourceLayer(source, layer['source-layer']);
      const cacheKey = `${layer.source}:${layer['source-layer'] || 'default'}`;

      if (layer.type === 'line') {
        const style = resolveStrokeStyle(layer.paint as LinePaint, lineScale);
        
        if (ml?.shapes && arcs) {
          // Optimized layer line rendering: use drawArcs with a boolean arc presence filter
          const flags = this._getLayerArcFlags(ml, arcs, cacheKey);
          const viewportFilter = this._viewport.getArcFilter(arcs);
          
          let combinedFilter;
          if (flags && viewportFilter) {
            combinedFilter = (i: number) => flags[i] === 1 && viewportFilter(i);
          } else if (flags) {
            combinedFilter = (i: number) => flags[i] === 1;
          } else {
            combinedFilter = viewportFilter;
          }
          
          this._painter.drawArcs(arcs, style, combinedFilter);
        } else if (arcs) {
          // Fallback: draw all arcs
          const filter = this._viewport.getArcFilter(arcs);
          this._painter.drawArcs(arcs, style, filter);
        }
      } else if (layer.type === 'fill') {
        if (ml?.shapes && arcs) {
          // Draw fill
          const fillColor = (layer.paint as FillPaint)?.['fill-color'] || 'rgba(200, 200, 200, 0.4)';
          const painter = this._painter as CanvasPainter;
          if (painter.drawPolygonFill) {
            const filter = this._viewport.getArcFilter(arcs);
            painter.drawPolygonFill(
              ml.shapes,
              arcs,
              fillColor,
              filter
            );
          }
          // Draw outline
          const style = resolveStrokeStyle(layer.paint as LinePaint, lineScale);
          this._painter.drawPaths(ml.shapes, style, arcs);
        }
      } else if (layer.type === 'circle') {
        if (ml?.shapes) {
          const style = resolvePointStyle(layer.paint as CirclePaint);
          this._painter.drawPoints(ml.shapes, style);
        }
      }
    }

    // Delegated highlight rendering
    const visibleKeys = this._getVisibleLayerKeys();
    this._highlightManager.renderHighlights(
      this._painter,
      this._sources,
      transform,
      lineScale,
      visibleKeys,
    );

    // Polygon fill in vertex edit mode (drawn before dots so dots appear on top)
    if (
      this._editMode === 'vertex' &&
      this._editVertexState &&
      this._editVertexState.geometryType === 'polygon' &&
      this._editVertexState.polygonFill
    ) {
      const painter = this._painter as CanvasPainter;
      if (painter.drawPolygonFill) {
        painter.drawPolygonFill(
          this._editVertexState.shapes,
          this._editVertexState.arcs as unknown as import('../types/mapshaper-types').ArcCollection,
          this._editVertexState.polygonFill,
        );
      }
    }

    // Vertex dots via Painter interface
    if (
      this._editMode === 'vertex' &&
      this._editVertexState &&
      this._painter.drawVertexDots
    ) {
      this._painter.drawVertexDots(
        this._editVertexState.shapes,
        this._editVertexState.arcs as unknown as import('../types/mapshaper-types').ArcCollection,
        {
          dotColor: '#333',
          dotRadius: 3,
          hoverVertex: this._editVertexState.hoverVertex,
          hoverType: this._editVertexState.hoverType ?? 'vertex',
          hoverColor: '#cc6acc',
          hoverRadius: 6,
        },
      );
    }

    // Drawing overlay (feature creation in progress)
    if (this._editMode === 'draw' && this._editDrawState) {
      const painter = this._painter as CanvasPainter;
      if (painter.drawDrawingOverlay) {
        painter.drawDrawingOverlay(this._editDrawState);
      }
    }

    // Flush GPU commands for CanvasKit
    if (this._painter.flush) {
      this._painter.flush();
    }
  }

  public project(x: number, y: number): [number, number] {
    return this._viewport.project(x, y);
  }

  public unproject(px: number, py: number): [number, number] {
    return this._viewport.unproject(px, py);
  }

  public resize(): void {
    this._updateSize();
    this._viewport.setExtent(this._viewport.extent);
    this.fire('resize');
  }

  public queryRenderedFeatures(
    geometryOrOptions?:
      | [number, number]
      | [[number, number], [number, number]]
      | QueryRenderedFeaturesOptions,
    options?: QueryRenderedFeaturesOptions,
  ): RenderedFeatureAttributes[] {
    const visibleKeys = this._getVisibleLayerKeys();
    return this._featureQuery.query(geometryOrOptions, options, visibleKeys);
  }

  /**
   * Eagerly build the per-layer Flatbush spatial index for one source (or
   * every registered source when `sourceId` is omitted). Useful for paying
   * the build cost in idle time before the user's first hit-test.
   *
   * Idempotent — already-cached layer indexes are skipped. No-op for
   * sources without a dataset.
   *
   * Subsequent `queryRenderedFeatures` calls automatically use whatever's
   * cached, regardless of whether `prebuildSpatialIndex` was called.
   */
  public prebuildSpatialIndex(sourceId?: string): void {
    this._featureQuery.prebuild(sourceId);
  }

  /**
   * Drop cached per-layer spatial indexes for one source (or all sources
   * when `sourceId` is omitted).
   *
   * Required after in-place geometry edits (`translateSelected`,
   * `rotateSelected`, vertex commands) that mutate arc coordinates without
   * changing shape or arc counts — the cache key wouldn't notice and
   * subsequent queries would return prefilter-stale results.
   *
   * Dataset-replace ops (clip / dissolve / etc.) automatically invalidate
   * via shape-count or arc-count change; this method is only needed for
   * in-place edits.
   */
  public clearSpatialIndex(sourceId?: string): void {
    this._featureQuery.clear(sourceId);
  }

  private _clearSpatialIndexesForSources(sourceIds: Iterable<string>): void {
    for (const sourceId of sourceIds) {
      this._featureQuery?.clear(sourceId);
    }
  }

  public setHighlightedFeatures(
    features: Array<RenderedFeatureAttributes | HighlightFeatureRef>,
    style?: HighlightStyle,
  ): void {
    this._highlightManager.setHighlightedFeatures(features, style);
    this._scheduleRender();
  }

  public clearHighlightedFeatures(): void {
    if (this._highlightManager.clearHighlightedFeatures()) {
      this._scheduleRender();
    }
  }

  public setHighlightStyle(style: HighlightStyle): void {
    if (this._highlightManager.setHighlightStyle(style)) {
      this._scheduleRender();
    }
  }

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------

  /**
   * Mutate the persistent feature selection.
   *
   * @param features Refs to apply. `RenderedFeatureAttributes` is structurally
   *   compatible with `FeatureRef`, so results from `queryRenderedFeatures` can
   *   be passed directly.
   * @param options.mode `'replace'` (default) wipes prior contents,
   *   `'add'` unions, `'toggle'` flips membership.
   *
   * Fires a `selectionchange` event with `{ selected, added, removed }` only
   * when the set actually changes.
   */
  public select(
    features: ReadonlyArray<FeatureRef>,
    options?: { mode?: SelectMode },
  ): void {
    const mode = options?.mode ?? 'replace';
    const diff = this._selection.apply(features, mode);
    this._fireSelectionChange(diff);
  }

  /** Remove the listed features from the selection. No-op if absent. */
  public deselect(features: ReadonlyArray<FeatureRef>): void {
    const diff = this._selection.remove(features);
    this._fireSelectionChange(diff);
  }

  /** Empty the selection. No-op (and no event) if it was already empty. */
  public clearSelection(): void {
    const diff = this._selection.clear();
    this._fireSelectionChange(diff);
  }

  /** Snapshot of the current selection as a flat list of refs. */
  public getSelection(): FeatureRef[] {
    return this._selection.getAll();
  }

  /** Test whether a single feature is currently selected. */
  public isSelected(feature: FeatureRef): boolean {
    return this._selection.has(feature);
  }

  private _fireSelectionChange(diff: SelectionDiff): void {
    if (!diff.changed) return;
    this.fire('selectionchange', {
      selected: this._selection.getAll(),
      added: diff.added,
      removed: diff.removed,
    });
  }

  /**
   * Delete every currently-selected feature in one undoable history step.
   *
   * Returns `true` when at least one feature was deleted, `false` when the
   * selection was empty (in which case nothing is pushed and no events fire).
   *
   * Implementation matches mapshaper's `deleteFeature` / `insertFeature`
   * pair: shape + data record are spliced out (and back in on undo). Within
   * each layer, deletes proceed in descending-id order so each delete's
   * index stays valid; a single Ctrl+Z reverses the entire batch.
   *
   * The selection is cleared on success — the deleted refs no longer exist.
   */
  public deleteSelected(): boolean {
    const refs = this._selection.getAll();
    if (refs.length === 0) return false;

    // Group ids by (sourceId, layerId) so each (source, layer) pair runs as
    // ONE BulkFeatureDeleteCommand — splicing K features individually on a
    // layer with N shapes is O(K·N), the bulk command compacts in a single
    // O(N) pass.
    const grouped: globalThis.Map<string, globalThis.Map<string, number[]>> = new globalThis.Map();
    for (const ref of refs) {
      let bySource = grouped.get(ref.source);
      if (!bySource) {
        bySource = new globalThis.Map();
        grouped.set(ref.source, bySource);
      }
      const ids = bySource.get(ref.layer) ?? [];
      ids.push(ref.id);
      bySource.set(ref.layer, ids);
    }

    const children: EditCommand[] = [];
    let totalDeleted = 0;

    for (const [sourceId, byLayer] of grouped) {
      const source = this._sources.get(sourceId);
      if (!source) continue;
      const layers = source.getLayers();
      for (const [layerId, ids] of byLayer) {
        let target: MapshaperLayer | null = null;
        for (let i = 0; i < layers.length; i++) {
          if (getLayerId(layers[i], i) === layerId) {
            target = layers[i] as MapshaperLayer;
            break;
          }
        }
        if (!target?.shapes) continue;

        const records = target.data?.getRecords?.();
        const snapshots: BulkFeatureDeleteCommandOptions['snapshots'] = [];
        // De-dup ids — selection theoretically guarantees this but
        // defensive: a duplicate would corrupt the bulk command's
        // del-set / undo path.
        const seen = new Set<number>();
        for (const featureId of ids) {
          if (seen.has(featureId)) continue;
          seen.add(featureId);
          const shape = target.shapes[featureId];
          if (shape === undefined) continue;
          const record = records ? records[featureId] : null;
          snapshots.push({ id: featureId, shape, record: record ?? null });
        }
        if (snapshots.length === 0) continue;

        const bulk = new BulkFeatureDeleteCommand({ layer: target, snapshots });
        bulk.do();
        children.push(bulk);
        totalDeleted += snapshots.length;
      }
    }

    if (children.length === 0) return false;

    const composite = new CompositeCommand(
      children,
      `Delete ${totalDeleted} feature${totalDeleted > 1 ? 's' : ''}`,
    );
    this._history.push(composite);
    this._fireHistoryChange();

    // Invalidate caches keyed off `layer.shapes` for every touched source —
    // the line-layer arc-flag cache and the per-layer Flatbush index both
    // hold references to shapes that no longer exist.
    this._invalidateShapeCachesForSources(grouped.keys());

    // Clear the selection — the refs no longer exist.
    this._fireSelectionChange(this._selection.clear());
    this._scheduleRender();

    return true;
  }

  /**
   * Drop derived caches (line-layer arc flags + spatial index) for the given
   * sources. Call after any edit that mutates `layer.shapes` so subsequent
   * frames and `queryRenderedFeatures` calls don't reference stale features.
   */
  private _invalidateShapeCachesForSources(sourceIds: Iterable<string>): void {
    for (const sourceId of sourceIds) {
      const prefix = `${sourceId}:`;
      for (const key of this._layerArcFlagsCache.keys()) {
        if (key.startsWith(prefix)) this._layerArcFlagsCache.delete(key);
      }
      this._featureQuery?.clear(sourceId);
    }
  }

  // ---------------------------------------------------------------------------
  // Edit history (undo / redo)
  // ---------------------------------------------------------------------------

  /**
   * Push an executed `EditCommand` onto the undo stack.
   *
   * Per the memento pattern, the caller is expected to have already performed
   * the work; the command captures what changed so the operation can be
   * reversed on undo. `pushCommand` does NOT call `cmd.do()`. It clears any
   * pending redo entries and fires `historychange`.
   */
  public pushCommand(cmd: EditCommand): void {
    this._history.push(cmd);
    this._fireHistoryChange();
  }

  /**
   * Reverse the most recent command. No-op when there is nothing to undo.
   * Fires `historychange` and schedules a re-render after the reversal.
   */
  public undo(): boolean {
    const cmd = this._history.undo();
    if (!cmd) return false;
    this._fireHistoryChange();
    // Any command that touched `layer.shapes` (delete/create/...) will have
    // moved feature ids around; invalidate every shape-derived cache rather
    // than threading per-command source ids through the history.
    this._layerArcFlagsCache.clear();
    for (const id of this._sources.keys()) this._featureQuery?.clear(id);
    this._scheduleRender();
    return true;
  }

  /**
   * Re-apply the most recently undone command. No-op when there is nothing
   * to redo. Fires `historychange` and schedules a re-render.
   */
  public redo(): boolean {
    const cmd = this._history.redo();
    if (!cmd) return false;
    this._fireHistoryChange();
    this._layerArcFlagsCache.clear();
    for (const id of this._sources.keys()) this._featureQuery?.clear(id);
    this._scheduleRender();
    return true;
  }

  public canUndo(): boolean {
    return this._history.canUndo();
  }

  public canRedo(): boolean {
    return this._history.canRedo();
  }

  /** Empty both undo and redo stacks. Fires `historychange` if non-empty. */
  public clearHistory(): void {
    const wasNonEmpty = this._history.canUndo() || this._history.canRedo();
    this._history.clear();
    if (wasNonEmpty) this._fireHistoryChange();
  }

  /**
   * Bind Ctrl/Cmd+Z (undo) and Ctrl/Cmd+Shift+Z / Ctrl+Y (redo) on the given
   * element (default: the canvas container). Returns an unbind function. Calls
   * to this method are idempotent — subsequent calls unbind the prior binding.
   */
  public bindHistoryShortcuts(target?: HTMLElement): () => void {
    this._historyShortcutUnbind?.();
    const el = target ?? this._canvasContainer;
    // Ensure the element can receive focus so it gets keydown events.
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');

    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const isZ = e.key === 'z' || e.key === 'Z';
      const isY = e.key === 'y' || e.key === 'Y';
      if (isZ && !e.shiftKey) {
        e.preventDefault();
        this.undo();
      } else if ((isZ && e.shiftKey) || isY) {
        e.preventDefault();
        this.redo();
      }
    };
    el.addEventListener('keydown', handler);
    const unbind = () => {
      el.removeEventListener('keydown', handler);
      if (this._historyShortcutUnbind === unbind) this._historyShortcutUnbind = null;
    };
    this._historyShortcutUnbind = unbind;
    return unbind;
  }

  private _fireHistoryChange(): void {
    const snap: HistoryStateSnapshot = this._history.snapshot();
    this.fire('historychange', snap);
  }

  // ---------------------------------------------------------------------------
  // Whole-dataset operations (clip / erase / future dissolve, buffer, ...)
  // ---------------------------------------------------------------------------

  /**
   * Clip a layer to the polygons in a mask layer using mapshaper's `-clip`
   * pipeline. Target and mask must live in the same source. Returns `true`
   * on success, `false` for unresolvable source / target / mask.
   *
   * The operation is recorded as a single undoable history entry. Note that
   * dataset-replace operations clear prior fine-grained edit history (see
   * design.md for the rationale).
   */
  public async clipLayer(opts: ClipEraseOptions): Promise<boolean> {
    return this._runClipErase(opts, 'clip');
  }

  /**
   * Erase (cut holes from) a layer using a polygon mask layer via mapshaper's
   * `-erase` pipeline. Same semantics as {@link clipLayer}.
   */
  public async eraseLayer(opts: ClipEraseOptions): Promise<boolean> {
    return this._runClipErase(opts, 'erase');
  }

  private async _runClipErase(opts: ClipEraseOptions, op: 'clip' | 'erase'): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    // Validate that both target and mask resolve to layers in this source's
    // dataset. mapshaper would throw an opaque error otherwise.
    if (!findLayerByName(dataset.layers, opts.target)) return false;
    if (!findLayerByName(dataset.layers, opts.mask)) return false;

    const verb = op === 'clip' ? 'Clip' : 'Erase';
    const cmd = `-target ${quoteMapshaperArg(opts.target)} -${op} source=${quoteMapshaperArg(opts.mask)}`;
    return this._runDatasetCommand(opts.source, cmd, `${verb} ${opts.target}`);
  }

  /**
   * Merge polygon (or point / polyline) features in the target layer using
   * mapshaper's `-dissolve` pipeline. Without `field`, all features in the
   * layer collapse into one; with `field`, features sharing the same field
   * value are merged. Returns `true` on success, `false` for unresolvable
   * source / target. Recorded as a single undoable history entry.
   */
  public async dissolveLayer(opts: DissolveOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    if (!findLayerByName(dataset.layers, opts.target)) return false;

    // `field` (single) and `fields` (multi) are mutually exclusive — both
    // set is a configuration error.
    const hasFields = Array.isArray(opts.fields) && opts.fields.length > 0;
    if (opts.field !== undefined && hasFields) return false;

    // mapshaper's -dissolve DEFAULT option is `fields` (comma-list, type
    // strings). A field name containing `,` would silently group by N
    // imaginary fields; reject up-front instead.
    if (opts.field !== undefined && (typeof opts.field !== 'string' || opts.field.includes(','))) {
      return false;
    }
    if (!this._allowExpressionEvaluation([opts.calc, opts.where], 'dissolveLayer')) return false;

    // Build the positional group-by token (single-field convenience or
    // multi-field array). When neither is set, dissolve collapses every
    // feature into one (mapshaper's default for -dissolve with no key).
    let groupToken = '';
    if (opts.field) {
      groupToken = ` ${quoteMapshaperArg(opts.field)}`;
    } else if (hasFields) {
      const safeFields = opts.fields!.filter((f) => typeof f === 'string' && !f.includes(','));
      if (safeFields.length > 0) {
        groupToken = ` ${quoteMapshaperArg(safeFields.join(','))}`;
      }
    }

    const parts: string[] = [
      `-target ${quoteMapshaperArg(opts.target)}`,
      `-dissolve${groupToken}`,
    ];

    const safeFieldList = (list?: string[]) =>
      Array.isArray(list)
        ? list.filter((f) => typeof f === 'string' && !f.includes(','))
        : [];

    const sumFields = safeFieldList(opts.sumFields);
    if (sumFields.length > 0) parts.push(`sum-fields=${sumFields.join(',')}`);

    const copyFields = safeFieldList(opts.copyFields);
    if (copyFields.length > 0) parts.push(`copy-fields=${copyFields.join(',')}`);

    if (opts.calc && opts.calc.trim()) {
      parts.push(`calc=${quoteMapshaperArg(opts.calc)}`);
    }
    if (opts.where && opts.where.trim()) {
      parts.push(`where=${quoteMapshaperArg(opts.where)}`);
    }
    if (opts.multipart) parts.push('multipart');
    if (opts.name && opts.name.trim()) {
      parts.push(`name=${quoteMapshaperArg(opts.name)}`);
    }
    if (opts.noReplace) parts.push('no-replace');

    return this._runDatasetCommand(opts.source, parts.join(' '), `Dissolve ${opts.target}`);
  }

  /**
   * Generate buffer polygons for a layer using mapshaper's `-buffer` pipeline.
   *
   * `radius` is interpreted in source-CRS units: degrees for EPSG:4326,
   * metres for typical projected CRSes. Accepts either a constant number or a
   * mapshaper expression string evaluated per record (e.g. `"pop / 1000"`),
   * matching mapshaper CLI syntax exactly.
   *
   * Returns `true` on success, `false` for unresolvable source/target.
   * Recorded as a single undoable history entry; inherits dataset-replace
   * semantics (history barrier, selection cleared) from `_runDatasetCommand`.
   */
  public async bufferLayer(opts: BufferOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    if (!findLayerByName(dataset.layers, opts.target)) return false;

    // Validate numeric radius up-front: 0 silently produces empty buffers,
    // negative values throw inside mapshaper. Expression-string radii are
    // forwarded as-is — mapshaper evaluates per-feature and there's no
    // sound way to validate them without parsing JS.
    if (typeof opts.radius === 'number') {
      if (!Number.isFinite(opts.radius) || opts.radius <= 0) return false;
    } else if (typeof opts.radius !== 'string' || opts.radius.trim().length === 0) {
      return false;
    }
    if (typeof opts.radius === 'string' && !this._allowExpressionEvaluation([opts.radius], 'bufferLayer')) {
      return false;
    }

    // Numbers go in bare; expression strings are quoted so the shell-style
    // command parser keeps them intact.
    const radiusArg =
      typeof opts.radius === 'number' ? String(opts.radius) : quoteMapshaperArg(opts.radius);
    const capArg = opts.capStyle ? ` cap-style=${opts.capStyle}` : '';
    const cmd = `-target ${quoteMapshaperArg(opts.target)} -buffer ${radiusArg}${capArg}`;
    return this._runDatasetCommand(opts.source, cmd, `Buffer ${opts.target}`);
  }

  /**
   * Run a mapshaper `-each` JS expression against a layer to update
   * attributes in bulk. Use for derived fields (`this.density = this.pop /
   * this.area`), normalization (`this.name = this.name.toUpperCase()`), or
   * any other per-record mutation that the per-feature
   * {@link setFeatureProperty} would be tedious for.
   *
   * The optional `where` filter mirrors mapshaper CLI's `-each EXPR
   * where=...` — only records matching it are mutated.
   *
   * Returns `false` for unresolvable source / target or empty expression.
   * Recorded as one undoable history entry; inherits dataset-replace
   * semantics (history barrier, selection cleared) from `_runDatasetCommand`.
   */
  public async applyExpression(opts: ApplyExpressionOptions): Promise<boolean> {
    if (!opts.expression || !opts.expression.trim()) return false;
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    if (!findLayerByName(dataset.layers, opts.target)) return false;
    if (!this._allowExpressionEvaluation([opts.expression, opts.where], 'applyExpression')) return false;

    const whereArg = opts.where && opts.where.trim()
      ? ` where=${quoteMapshaperArg(opts.where)}`
      : '';
    const cmd = `-target ${quoteMapshaperArg(opts.target)} -each ${quoteMapshaperArg(opts.expression)}${whereArg}`;
    return this._runDatasetCommand(opts.source, cmd, `Update ${opts.target}`);
  }

  /**
   * Divide multi-part features in the target layer into single-part features
   * via mapshaper's `-explode`. Each part inherits the original record's
   * attributes. Returns `false` for unresolvable source / target.
   *
   * Useful for unpacking multipolygon islands, multipart polylines, or
   * multipoint clusters into separately-pickable features.
   */
  public async explodeLayer(opts: ExplodeOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    if (!findLayerByName(dataset.layers, opts.target)) return false;
    const cmd = `-target ${quoteMapshaperArg(opts.target)} -explode`;
    return this._runDatasetCommand(opts.source, cmd, `Explode ${opts.target}`);
  }

  /**
   * Convert a polygon layer to a polyline layer along shared polygon edges
   * via mapshaper's `-innerlines`. Useful for cartographic styling: render
   * internal administrative borders as a separately-stylable line layer
   * while keeping the original polygons.
   *
   * Optional `where` (with `A` / `B` in scope) keeps only boundaries whose
   * neighbouring polygons match the predicate; `name` controls the output
   * layer name; `noReplace: true` keeps the input polygon layer alongside
   * the new polyline layer.
   */
  public async innerlinesLayer(opts: InnerlinesOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    if (!findLayerByName(dataset.layers, opts.target)) return false;
    if (!this._allowExpressionEvaluation([opts.where], 'innerlinesLayer')) return false;

    const parts: string[] = [
      `-target ${quoteMapshaperArg(opts.target)}`,
      `-innerlines`,
    ];
    if (opts.where && opts.where.trim()) {
      parts.push(`where=${quoteMapshaperArg(opts.where)}`);
    }
    if (opts.name && opts.name.trim()) {
      parts.push(`name=${quoteMapshaperArg(opts.name)}`);
    }
    if (opts.noReplace) {
      parts.push('no-replace');
    }
    return this._runDatasetCommand(opts.source, parts.join(' '), `Innerlines ${opts.target}`);
  }

  /**
   * Drop features from a layer using mapshaper's `-filter`.
   *
   * Convention follows mapshaper: features whose `expression` evaluates to
   * FALSE are deleted (so `'this.pop > 100'` *keeps* populous features).
   * `invert: true` flips the predicate. `removeEmpty: true` also drops
   * features with null geometry.
   *
   * Returns `false` when neither `expression` nor `removeEmpty` is supplied
   * (mapshaper would error otherwise). Companion to {@link applyExpression}:
   * same JS context, opposite intent (mutate vs delete).
   */
  public async filterFeatures(opts: FilterOptions): Promise<boolean> {
    const hasExpr = !!(opts.expression && opts.expression.trim());
    if (!hasExpr && !opts.removeEmpty) return false;

    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    if (!findLayerByName(dataset.layers, opts.target)) return false;
    if (!this._allowExpressionEvaluation([opts.expression], 'filterFeatures')) return false;

    const parts: string[] = [
      `-target ${quoteMapshaperArg(opts.target)}`,
      `-filter`,
    ];
    if (hasExpr) {
      parts.push(quoteMapshaperArg(opts.expression as string));
    }
    if (opts.invert) {
      parts.push('invert');
    }
    if (opts.removeEmpty) {
      parts.push('remove-empty');
    }
    return this._runDatasetCommand(opts.source, parts.join(' '), `Filter ${opts.target}`);
  }

  /**
   * Snap nearby vertices together using mapshaper's `-snap`. Useful as a
   * targeted fix for almost-but-not-quite-coincident vertices left over
   * from reprojection, manual digitization, or merged sources.
   *
   * `interval` is the snap distance in source-CRS units; mapshaper picks a
   * small default when omitted. `endpoints: true` restricts to line
   * endpoints. `precision` rounds all coords to a given decimal precision.
   */
  public async snapLayer(opts: SnapOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    if (!findLayerByName(dataset.layers, opts.target)) return false;

    const parts: string[] = [
      `-target ${quoteMapshaperArg(opts.target)}`,
      `-snap`,
    ];
    if (typeof opts.interval === 'number') {
      parts.push(String(opts.interval));
    }
    if (opts.endpoints) {
      parts.push('endpoints');
    }
    if (typeof opts.precision === 'number') {
      parts.push(`precision=${opts.precision}`);
    }
    if (opts.fixGeometry) {
      parts.push('fix-geometry');
    }
    return this._runDatasetCommand(opts.source, parts.join(' '), `Snap ${opts.target}`);
  }

  /**
   * Run mapshaper's `-clean` against a layer to repair topology issues
   * (intersection cuts, polygon overlaps, sliver removal). Heavy — O(N²) on
   * polygon counts in the worst case — so it is opt-in instead of running on
   * every import. Returns `Promise<boolean>`; failure modes match the other
   * dataset-replace ops (false on unresolvable source/target, error event on
   * mapshaper failure).
   *
   * All tuning options are optional; omitting them lets mapshaper apply its
   * default cleanup heuristics. See {@link CleanOptions} for the surface.
   */
  public async cleanLayer(opts: CleanOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    if (!findLayerByName(dataset.layers, opts.target)) return false;

    // Numeric tuning options reject NaN / negative — mapshaper would either
    // error opaquely or silently produce surprising results.
    const validNumOrUnset = (n?: number) =>
      n === undefined || (typeof n === 'number' && Number.isFinite(n) && n >= 0);
    if (!validNumOrUnset(opts.gapFillArea)) return false;
    if (!validNumOrUnset(opts.sliverControl)) return false;
    if (!validNumOrUnset(opts.snapInterval)) return false;

    if (opts.overlapRule !== undefined) {
      const allowed = ['min-id', 'max-id', 'min-area', 'max-area'];
      if (!allowed.includes(opts.overlapRule)) return false;
    }

    const parts: string[] = [
      `-target ${quoteMapshaperArg(opts.target)}`,
      `-clean`,
    ];
    if (opts.gapFillArea !== undefined) parts.push(`gap-fill-area=${opts.gapFillArea}`);
    if (opts.sliverControl !== undefined) parts.push(`sliver-control=${opts.sliverControl}`);
    if (opts.snapInterval !== undefined) parts.push(`snap-interval=${opts.snapInterval}`);
    if (opts.noSnap) parts.push('no-snap');
    if (opts.allowOverlaps) parts.push('allow-overlaps');
    if (opts.overlapRule !== undefined) parts.push(`overlap-rule=${opts.overlapRule}`);
    if (opts.allowEmpty) parts.push('allow-empty');
    if (opts.rewind) parts.push('rewind');
    if (opts.onlyArcs) parts.push('only-arcs');
    if (opts.noArcDissolve) parts.push('no-arc-dissolve');

    return this._runDatasetCommand(opts.source, parts.join(' '), `Clean ${opts.target}`);
  }

  /**
   * Re-derive shared arcs and insert intersection cuts via mapshaper's
   * `addIntersectionCuts` — the lightweight repair pass every overlay
   * command runs as a pre-pass before clip / erase / dissolve / union.
   *
   * Use case: after `translateSelected` / `rotateSelected` / vertex moves
   * change arc geometry, this pass re-detects overlaps that the in-place
   * edits didn't update. Without it, exports bake topology bugs into
   * output and shared-arc rendering can misrepresent neighbour boundaries.
   *
   * Lighter than {@link cleanLayer} (which also removes spikes / slivers
   * and dissolves polygon overlaps).
   *
   * Acts as a history barrier — prior fine-grained edit commands close
   * over the OLD `arcs` object and old arc indices, so undoing them after
   * a rebuild would corrupt geometry. The rebuild itself is one undoable
   * step that fully restores the pre-rebuild state.
   *
   * Returns `true` (no-op) for arc-less point-only datasets,
   * `false` for unresolvable source or `addIntersectionCuts` errors.
   */
  public async rebuildTopology(opts: RebuildTopologyOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const original = source.getDataset();
    if (!original) return false;
    if (!original.arcs) return true; // point-only — nothing to rebuild

    const before: MapshaperDataset = mapshaper.internal.copyDataset(original);
    const after: MapshaperDataset = mapshaper.internal.copyDataset(original);

    try {
      mapshaper.internal.addIntersectionCuts(after, {
        snap_interval: opts.snapInterval,
        no_snap: opts.noSnap,
        rebuild_topology: opts.rebuildTopology,
      });
    } catch (err) {
      this.fire('error', { error: err });
      return false;
    }

    source.setDataset(after);

    this._history.clear();
    this._history.push(new DatasetReplaceCommand({ source, before, after, label: 'Rebuild topology' }));
    this._fireHistoryChange();

    this._fireSelectionChange(this._selection.clear());

    this._scheduleRender();
    return true;
  }

  /**
   * Flatten overlapping polygons in a single layer into a tile mosaic via
   * mapshaper's `-mosaic`. Every overlap region becomes its own polygon;
   * gaps are preserved.
   *
   * Returns `false` for unresolvable source / target. Inherits all
   * dataset-replace semantics from `_runDatasetCommand`.
   */
  public async mosaicLayer(opts: MosaicOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    if (!findLayerByName(dataset.layers, opts.target)) return false;
    if (!this._allowExpressionEvaluation([opts.calc], 'mosaicLayer')) return false;

    const parts: string[] = [
      `-target ${quoteMapshaperArg(opts.target)}`,
      `-mosaic`,
    ];
    if (typeof opts.snapInterval === 'number') {
      parts.push(`snap-interval=${opts.snapInterval}`);
    }
    if (opts.noSnap) {
      parts.push('no-snap');
    }
    if (opts.noReplace) {
      parts.push('no-replace');
    }
    if (opts.name && opts.name.trim()) {
      parts.push(`name=${quoteMapshaperArg(opts.name)}`);
    }
    if (opts.calc && opts.calc.trim()) {
      parts.push(`calc=${quoteMapshaperArg(opts.calc)}`);
    }
    return this._runDatasetCommand(opts.source, parts.join(' '), `Mosaic ${opts.target}`);
  }

  /**
   * Overlay two or more polygon layers from the same source via mapshaper's
   * `-union`. Output is one flat mosaic where every intersection region is
   * its own polygon, attributed by the union of input fields.
   *
   * Returns `false` for unresolvable source, fewer than two targets, or any
   * unresolved target name. Inherits dataset-replace semantics from
   * `_runDatasetCommand`.
   *
   * Note: mapshaper's `-target` for `-union` is a comma-separated layer
   * list, not a single layer name; we join `targets` with commas inside one
   * quoted argument.
   */
  public async unionLayers(opts: UnionOptions): Promise<boolean> {
    if (!opts.targets || opts.targets.length < 2) return false;
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    // Every target must resolve and be `,`-free — mapshaper joins the list
    // with commas and would otherwise silently split a comma-bearing name
    // into multiple bogus targets.
    for (const t of opts.targets) {
      if (typeof t !== 'string' || t.includes(',')) return false;
      if (!findLayerByName(dataset.layers, t)) return false;
    }

    const targetList = opts.targets.join(',');
    const parts: string[] = [
      `-target ${quoteMapshaperArg(targetList)}`,
      `-union`,
    ];
    if (opts.fields && opts.fields.length > 0) {
      const safe = opts.fields.filter((f) => !f.includes(','));
      if (safe.length > 0) parts.push(`fields=${safe.join(',')}`);
    }
    if (opts.name && opts.name.trim()) {
      parts.push(`name=${quoteMapshaperArg(opts.name)}`);
    }
    if (opts.noReplace) {
      parts.push('no-replace');
    }
    return this._runDatasetCommand(opts.source, parts.join(' '), `Union ${targetList}`);
  }

  /**
   * Cut a polyline `target` layer at the boundaries of a polygon `divider`
   * layer in the same source via mapshaper's `-divide`. Each resulting line
   * segment inherits the underlying polygon's attributes (subset by `fields`
   * when supplied).
   *
   * Returns `false` for unresolvable source, missing/wrong-geometry target,
   * or missing/wrong-geometry divider. Inherits dataset-replace semantics
   * from `_runDatasetCommand`.
   *
   * mapshaper's `-divide` can take its polygon source positionally, but we
   * use the explicit `source=<name>` form for symmetry with `clipLayer` and
   * `eraseLayer`.
   */
  public async divideLayer(opts: DivideOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    const targetLayer = findLayerByName(dataset.layers, opts.target);
    if (!targetLayer || targetLayer.geometry_type !== 'polyline') return false;
    const dividerLayer = findLayerByName(dataset.layers, opts.divider);
    if (!dividerLayer || dividerLayer.geometry_type !== 'polygon') return false;

    const parts: string[] = [
      `-target ${quoteMapshaperArg(opts.target)}`,
      `-divide source=${quoteMapshaperArg(opts.divider)}`,
    ];
    if (opts.fields && opts.fields.length > 0) {
      const safe = opts.fields.filter((f) => !f.includes(','));
      if (safe.length > 0) parts.push(`fields=${safe.join(',')}`);
    }
    if (opts.force) parts.push('force');
    return this._runDatasetCommand(opts.source, parts.join(' '), `Divide ${opts.target}`);
  }

  /**
   * Extract a point layer from a polygon or polyline target via mapshaper's
   * `-points`. The `type` enum collapses mapshaper's mutually-exclusive
   * `-points` flags into a single option:
   *
   * - `centroid` / `inner` — one point per polygon (target must be polygon)
   * - `midpoints` / `interpolated` — sample along polylines (target must be polyline;
   *   `interpolated` also requires a positive `interval`)
   * - `vertices` / `endpoints` — extract path vertices (target must be polygon or polyline)
   *
   * Returns `false` for unresolvable source / target, mismatched geometry,
   * or `interpolated` without a positive `interval`. Inherits dataset-replace
   * semantics from `_runDatasetCommand`.
   */
  public async pointsLayer(opts: PointsOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    const layer = findLayerByName(dataset.layers, opts.target);
    if (!layer) return false;

    const geom = layer.geometry_type;
    switch (opts.type) {
      case 'centroid':
      case 'inner':
        if (geom !== 'polygon') return false;
        break;
      case 'midpoints':
      case 'interpolated':
        if (geom !== 'polyline') return false;
        break;
      case 'vertices':
      case 'endpoints':
        if (geom !== 'polygon' && geom !== 'polyline') return false;
        break;
      default:
        return false;
    }
    if (opts.type === 'interpolated' && !(typeof opts.interval === 'number' && opts.interval > 0)) {
      return false;
    }

    const parts: string[] = [
      `-target ${quoteMapshaperArg(opts.target)}`,
      `-points ${opts.type}`,
    ];
    if (opts.type === 'interpolated') {
      parts.push(`interval=${opts.interval}`);
    }
    if (opts.name && opts.name.trim()) {
      parts.push(`name=${quoteMapshaperArg(opts.name)}`);
    }
    if (opts.noReplace) parts.push('no-replace');
    return this._runDatasetCommand(opts.source, parts.join(' '), `Points ${opts.target}`);
  }

  /**
   * Convert a polygon target into a polyline layer of its boundary arcs via
   * mapshaper's `-lines`. Optional `fields` produces a hierarchy of
   * boundaries (outer hull at the top, intra-region boundaries below).
   *
   * Returns `false` for unresolvable source / target or non-polygon target.
   * Inherits dataset-replace semantics from `_runDatasetCommand`.
   *
   * `fields` is mapshaper's positional `DEFAULT: true` arg, emitted as a
   * bare comma-joined token (no `fields=` prefix) to match the CLI norm.
   */
  public async linesLayer(opts: LinesOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    const layer = findLayerByName(dataset.layers, opts.target);
    if (!layer || layer.geometry_type !== 'polygon') return false;

    // mapshaper's `-lines` DEFAULT positional is the comma-joined fields
    // list. Build the `-lines [fields-csv]` token in one place rather than
    // pushing a placeholder and rewriting it.
    const safeFields = opts.fields?.filter((f) => typeof f === 'string' && !f.includes(','));
    const linesToken = safeFields && safeFields.length > 0
      ? `-lines ${safeFields.join(',')}`
      : '-lines';

    const parts: string[] = [
      `-target ${quoteMapshaperArg(opts.target)}`,
      linesToken,
    ];
    if (opts.name && opts.name.trim()) {
      parts.push(`name=${quoteMapshaperArg(opts.name)}`);
    }
    if (opts.noReplace) parts.push('no-replace');
    return this._runDatasetCommand(opts.source, parts.join(' '), `Lines ${opts.target}`);
  }

  /**
   * Convert a polyline target into a polygon layer via mapshaper's
   * `-polygons`. Inverse of {@link linesLayer}. The default path snaps
   * gaps and reconstructs faces; `fromRings` skips that step when the
   * input is known to be a layer of closed paths.
   *
   * Returns `false` for unresolvable source / target or non-polyline
   * target. Inherits dataset-replace semantics from `_runDatasetCommand`.
   */
  public async polygonsLayer(opts: PolygonsOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    const layer = findLayerByName(dataset.layers, opts.target);
    if (!layer || layer.geometry_type !== 'polyline') return false;

    const parts: string[] = [
      `-target ${quoteMapshaperArg(opts.target)}`,
      '-polygons',
    ];
    if (typeof opts.gapTolerance === 'number' && opts.gapTolerance > 0) {
      parts.push(`gap-tolerance=${opts.gapTolerance}`);
    }
    if (opts.fromRings) parts.push('from-rings');
    return this._runDatasetCommand(opts.source, parts.join(' '), `Polygons ${opts.target}`);
  }

  /**
   * Simplify the geometry of polygon and polyline features via mapshaper's
   * `-simplify`. Operates on the source's shared arcs (sets per-vertex `zz`
   * thresholds + a `zlimit`); subsequent commands and exports honour the
   * threshold automatically. Re-running with a different threshold replaces
   * the previous one — the original vertex data is preserved on the arc
   * collection.
   *
   * Exactly one of `percentage`, `interval`, or `resolution` MUST be
   * supplied. `target` is optional; when omitted, the whole source dataset
   * is simplified (mapshaper CLI default).
   *
   * Returns `false` for unresolvable source, unresolved target, missing /
   * conflicting / out-of-range threshold, or malformed `resolution`.
   */
  public async simplifyLayer(opts: SimplifyOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    if (opts.target !== undefined) {
      if (!findLayerByName(dataset.layers, opts.target)) return false;
    }

    // Exactly one threshold mode.
    const thresholdsSet = [
      opts.percentage !== undefined,
      opts.interval !== undefined,
      opts.resolution !== undefined,
    ].filter(Boolean).length;
    if (thresholdsSet !== 1) return false;

    let thresholdToken: string;
    if (opts.percentage !== undefined) {
      const p = opts.percentage;
      if (!Number.isFinite(p) || p < 0 || p > 100) return false;
      thresholdToken = `${p}%`;
    } else if (opts.interval !== undefined) {
      const v = opts.interval;
      if (!Number.isFinite(v) || v <= 0) return false;
      thresholdToken = `interval=${v}`;
    } else {
      const r = opts.resolution!;
      if (!/^\d+x\d+$/.test(r)) return false;
      thresholdToken = `resolution=${r}`;
    }

    // `weighting` only makes sense for weighted-Visvalingam. mapshaper
    // silently ignores `weighting` when method is `dp` or `visvalingam`,
    // which leaves the caller wondering why their tuning had no effect.
    // Reject up-front. (Method `undefined` is fine — defaults to weighted.)
    if (opts.weighting !== undefined && opts.method !== undefined && opts.method !== 'weighted') {
      return false;
    }

    const parts: string[] = [];
    if (opts.target) parts.push(`-target ${quoteMapshaperArg(opts.target)}`);
    parts.push(`-simplify ${thresholdToken}`);
    if (opts.method) parts.push(opts.method);
    if (typeof opts.weighting === 'number' && Number.isFinite(opts.weighting)) {
      parts.push(`weighting=${opts.weighting}`);
    }
    if (opts.planar) parts.push('planar');
    if (opts.keepShapes) parts.push('keep-shapes');
    if (opts.lockBox) parts.push('lock-box');
    if (opts.noRepair) parts.push('no-repair');

    const label = `Simplify ${opts.target ?? opts.source}`;
    return this._runDatasetCommand(opts.source, parts.join(' '), label);
  }

  /**
   * Reproject a source's coordinates via mapshaper's `-proj` (Proj.4).
   * The destination `crs` accepts EPSG codes (`'EPSG:3857'`), aliases
   * (`'webmercator'`, `'robinson'`, `'wgs84'`), or full Proj.4 strings.
   * `target` is optional; when omitted, the whole source dataset is
   * reprojected.
   *
   * Returns `false` for unresolvable source, unresolved target, or
   * empty `crs`. Inherits dataset-replace semantics from `_runDatasetCommand`
   * (history barrier, undoable).
   *
   * Note: the source's stored CRS metadata is updated by mapshaper inside
   * the dataset, but emap does NOT auto-fit the viewport to the new
   * projected extent. Call `setExtent(source.getExtent())` after
   * `await projectLayer(...)` to recentre.
   */
  public async projectLayer(opts: ProjectOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    if (opts.target !== undefined) {
      if (!findLayerByName(dataset.layers, opts.target)) return false;
    }
    const crs = (opts.crs ?? '').trim();
    if (crs.length === 0) return false;

    const parts: string[] = [];
    if (opts.target) parts.push(`-target ${quoteMapshaperArg(opts.target)}`);
    parts.push(`-proj ${quoteMapshaperArg(crs)}`);
    if (opts.init && opts.init.trim()) {
      parts.push(`init=${quoteMapshaperArg(opts.init)}`);
    }
    if (opts.densify) parts.push('densify');

    const label = `Project ${opts.target ?? opts.source}`;
    return this._runDatasetCommand(opts.source, parts.join(' '), label);
  }

  /**
   * Rename one layer in a source dataset via mapshaper's `-rename-layers`.
   * The new name is trimmed and validated for non-emptiness and absence of
   * collision with any other existing layer in the same dataset.
   *
   * Returns `false` for unresolvable source / target, empty name, or
   * collision with another layer.
   */
  public async renameLayer(opts: RenameLayerOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    if (!findLayerByName(dataset.layers, opts.target)) return false;
    const newName = (opts.name ?? '').trim();
    if (newName.length === 0) return false;
    // mapshaper's -rename-layers DEFAULT is `names` (comma-list). A name
    // containing `,` would silently split into N rename pairs.
    if (newName.includes(',')) return false;
    // Allow renaming to the same name (no-op-ish), but reject if another
    // layer in this dataset already owns it.
    if (newName !== opts.target) {
      const collision = dataset.layers.some(
        (l: any) => (l?.name ?? '') === newName,
      );
      if (collision) return false;
    }
    const cmd = `-target ${quoteMapshaperArg(opts.target)} -rename-layers ${quoteMapshaperArg(newName)}`;
    return this._runDatasetCommand(opts.source, cmd, `Rename ${opts.target} → ${newName}`);
  }

  /**
   * Combine two or more layers in the same source into one via mapshaper's
   * `-merge-layers`. Targets are joined with commas inside one quoted
   * `-target` argument (matching mapshaper's CLI grammar for this command).
   *
   * Up-front geometry-type check: if targets disagree and the caller didn't
   * pass `force: true`, returns `false` rather than letting mapshaper throw
   * an opaque mid-pipeline error.
   */
  public async mergeLayers(opts: MergeLayersOptions): Promise<boolean> {
    if (!opts.targets || opts.targets.length < 2) return false;
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;

    // Targets are joined with commas inside the `-target` arg; reject names
    // that themselves contain `,` so we don't silently split into bogus
    // targets.
    if (opts.targets.some((t) => typeof t !== 'string' || t.includes(','))) return false;

    const layers = opts.targets.map((t) => findLayerByName(dataset.layers, t));
    if (layers.some((l) => !l)) return false;

    if (!opts.force) {
      const firstGeom = layers[0]?.geometry_type;
      const allSame = layers.every((l) => l?.geometry_type === firstGeom);
      if (!allSame) return false;
    }

    const targetList = opts.targets.join(',');
    const parts: string[] = [
      `-target ${quoteMapshaperArg(targetList)}`,
      '-merge-layers',
    ];
    if (opts.name && opts.name.trim()) {
      parts.push(`name=${quoteMapshaperArg(opts.name)}`);
    }
    if (opts.force) parts.push('force');
    if (opts.flatten) parts.push('flatten');
    return this._runDatasetCommand(opts.source, parts.join(' '), `Merge ${targetList}`);
  }

  /**
   * Partition a single layer into one output layer per distinct grouping
   * value via mapshaper's `-split`. The `expression` argument may be a
   * bare field name or a JS expression — mapshaper auto-detects.
   *
   * Returns `false` for unresolvable source / target or empty expression.
   *
   * v1 omits the `apart` flag (which produces independent datasets); the
   * one-source-one-dataset model in emap doesn't expose those. Use
   * `loadSnapshot` with `defaultIds` if you need that workflow.
   */
  public async splitLayer(opts: SplitLayerOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    if (!findLayerByName(dataset.layers, opts.target)) return false;
    const expr = (opts.expression ?? '').trim();
    if (expr.length === 0) return false;
    if (!this._allowExpressionEvaluation([expr], 'splitLayer')) return false;

    const parts: string[] = [
      `-target ${quoteMapshaperArg(opts.target)}`,
      `-split ${quoteMapshaperArg(expr)}`,
    ];
    if (opts.noReplace) parts.push('no-replace');
    return this._runDatasetCommand(opts.source, parts.join(' '), `Split ${opts.target}`);
  }

  /**
   * Delete a single layer from the source dataset via mapshaper's `-drop`.
   * mapshaper's `-drop` is multi-modal (layer / geometry / holes / fields);
   * v1 wraps only the "drop the entire layer" mode. Use {@link filterFields}
   * for the field-drop case.
   *
   * Returns `false` for unresolvable source / target.
   */
  public async dropLayer(opts: DropLayerOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    if (!findLayerByName(dataset.layers, opts.target)) return false;
    const cmd = `-target ${quoteMapshaperArg(opts.target)} -drop`;
    return this._runDatasetCommand(opts.source, cmd, `Drop ${opts.target}`);
  }

  /**
   * Sort features within a layer by a JS expression via mapshaper's `-sort`.
   * Bare field names work directly. Default order is ascending; pass
   * `descending: true` for the reverse.
   *
   * Returns `false` for unresolvable source / target or empty expression.
   */
  public async sortFeatures(opts: SortFeaturesOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    if (!findLayerByName(dataset.layers, opts.target)) return false;
    const expr = (opts.expression ?? '').trim();
    if (expr.length === 0) return false;
    if (!this._allowExpressionEvaluation([expr], 'sortFeatures')) return false;

    const parts: string[] = [
      `-target ${quoteMapshaperArg(opts.target)}`,
      `-sort ${quoteMapshaperArg(expr)}`,
    ];
    if (opts.descending) parts.push('descending');
    return this._runDatasetCommand(opts.source, parts.join(' '), `Sort ${opts.target}`);
  }

  /**
   * Drop duplicate features by an id expression via mapshaper's `-uniq`.
   * Pass `'JSON.stringify(this.properties)'` for full-record dedupe.
   *
   * Returns `false` for unresolvable source / target, empty expression,
   * or non-positive `maxCount`.
   */
  public async uniqueFeatures(opts: UniqueFeaturesOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    if (!findLayerByName(dataset.layers, opts.target)) return false;
    const expr = (opts.expression ?? '').trim();
    if (expr.length === 0) return false;
    if (!this._allowExpressionEvaluation([expr], 'uniqueFeatures')) return false;
    if (opts.maxCount !== undefined && !(typeof opts.maxCount === 'number' && opts.maxCount > 0)) {
      return false;
    }

    const parts: string[] = [
      `-target ${quoteMapshaperArg(opts.target)}`,
      `-uniq ${quoteMapshaperArg(expr)}`,
    ];
    if (opts.maxCount !== undefined) parts.push(`max-count=${opts.maxCount}`);
    if (opts.invert) parts.push('invert');
    return this._runDatasetCommand(opts.source, parts.join(' '), `Uniq ${opts.target}`);
  }

  /**
   * Retain only the listed attribute fields via mapshaper's `-filter-fields`.
   * Pass `invert: true` to drop the listed fields and keep the rest.
   *
   * Returns `false` for unresolvable source / target, empty `fields[]`,
   * or any field name that's empty or contains `,`.
   */
  public async filterFields(opts: FilterFieldsOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    if (!findLayerByName(dataset.layers, opts.target)) return false;
    if (!Array.isArray(opts.fields) || opts.fields.length === 0) return false;
    for (const f of opts.fields) {
      if (typeof f !== 'string' || f.trim().length === 0) return false;
      if (f.includes(',')) return false;
    }

    const list = opts.fields.join(',');
    const parts: string[] = [
      `-target ${quoteMapshaperArg(opts.target)}`,
      `-filter-fields ${quoteMapshaperArg(list)}`,
    ];
    if (opts.invert) parts.push('invert');
    return this._runDatasetCommand(opts.source, parts.join(' '), `Filter fields ${opts.target}`);
  }

  /**
   * Bulk-rename multiple attribute fields via mapshaper's `-rename-fields`.
   * Mapping order is preserved (object iteration order). Both old and new
   * names must be non-empty after trimming and free of `,` / `=`.
   *
   * Returns `false` for unresolvable source / target or any invalid
   * key / value in `mapping`.
   */
  public async renameFields(opts: RenameFieldsOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    if (!findLayerByName(dataset.layers, opts.target)) return false;
    if (!opts.mapping || typeof opts.mapping !== 'object') return false;
    const entries = Object.entries(opts.mapping);
    if (entries.length === 0) return false;
    const pairs: string[] = [];
    for (const [oldName, newName] of entries) {
      const o = (oldName ?? '').trim();
      const n = (newName ?? '').trim();
      if (o.length === 0 || n.length === 0) return false;
      if (o.includes(',') || o.includes('=') || n.includes(',') || n.includes('=')) return false;
      pairs.push(`${o}=${n}`);
    }
    const list = pairs.join(',');
    const cmd = `-target ${quoteMapshaperArg(opts.target)} -rename-fields ${quoteMapshaperArg(list)}`;
    return this._runDatasetCommand(opts.source, cmd, `Rename fields ${opts.target}`);
  }

  /**
   * Read-only topology validation pass over a source's arcs via
   * `mapshaper.internal.findSegmentIntersections`. Reports self-intersection
   * count and a sample of intersection points; does NOT mutate the dataset
   * or push to history.
   *
   * Returns `null` for unresolvable source, missing dataset, or unresolved
   * `target`. For arc-less point-only datasets returns the empty/clean
   * report (vacuously valid).
   *
   * Lighter than {@link cleanLayer} (heavy + destructive) and complementary
   * to {@link rebuildTopology} (which fixes the issues this command finds).
   */
  public async checkGeometry(opts: CheckGeometryOptions): Promise<GeometryCheckReport | null> {
    const source = this._sources.get(opts.source);
    if (!source) return null;
    const dataset = source.getDataset();
    if (!dataset) return null;
    if (opts.target !== undefined) {
      if (!findLayerByName(dataset.layers, opts.target)) return null;
    }
    if (!dataset.arcs) {
      return { ok: true, intersections: [], intersectionCount: 0 };
    }

    const internalOpts: { tolerance?: number } = {};
    if (opts.tolerance !== undefined) internalOpts.tolerance = opts.tolerance;

    const raw = mapshaper.internal.findSegmentIntersections(dataset.arcs, internalOpts);
    const intersections = raw.map((r) => ({ x: r.x, y: r.y }));
    return {
      ok: intersections.length === 0,
      intersections,
      intersectionCount: intersections.length,
    };
  }

  /**
   * Materialize the self-intersection points of a polygon or polyline
   * target as a new point layer in the same source's dataset.
   *
   * Counterpart to {@link checkGeometry} — `checkGeometry` returns a
   * read-only report, while this op produces a renderable, selectable,
   * editable layer. Useful when the user wants to label or operate on
   * the intersection locations.
   *
   * mapshaper's CLI `-points intersections` flag is registered but its
   * implementation is a debug-only timing benchmark; this method
   * bypasses the CLI and uses `findSegmentIntersections` +
   * `getIntersectionLayer` directly, which DO produce the right output.
   *
   * Returns `false` for any of: missing source / dataset, unresolved
   * target, target geometry not polygon/polyline, name collision with
   * an existing layer, non-positive `tolerance`. On internal error
   * (mapshaper threw), fires `error` event and returns `false`.
   *
   * The resulting layer is one multi-point feature (mapshaper's
   * `getIntersectionLayer` returns `shapes: [points]`). Pipe through
   * `explodeLayer` if one feature per intersection is needed.
   */
  public async intersectionPointsLayer(opts: IntersectionPointsLayerOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const original = source.getDataset();
    if (!original) return false;
    const targetLayer = findLayerByName(original.layers, opts.target);
    if (!targetLayer) return false;
    if (targetLayer.geometry_type !== 'polygon' && targetLayer.geometry_type !== 'polyline') {
      return false;
    }
    if (!original.arcs) return false;

    const newName = (opts.name && opts.name.trim()) || `${opts.target}-intersections`;
    if (original.layers.some((l: any) => l?.name === newName)) return false;
    if (opts.tolerance !== undefined) {
      if (typeof opts.tolerance !== 'number' || !Number.isFinite(opts.tolerance) || opts.tolerance <= 0) {
        return false;
      }
    }

    const internalOpts: { tolerance?: number } = {};
    if (opts.tolerance !== undefined) internalOpts.tolerance = opts.tolerance;

    // Custom dataset-replace path. Snapshot for undo, do work on a deep
    // copy, swap. Mirrors `_runDatasetCommand` but skips parseCommands
    // because mapshaper's CLI `-points intersections` is broken upstream
    // — we go directly to the internal primitives.
    const before: MapshaperDataset = mapshaper.internal.copyDataset(original);
    const after: MapshaperDataset = mapshaper.internal.copyDataset(original);

    let pointLyr: any;
    try {
      const intersections = mapshaper.internal.findSegmentIntersections(after.arcs!, internalOpts);
      // Find the cloned target inside the working copy by name.
      const workingTarget = findLayerByName(after.layers, opts.target);
      if (!workingTarget) {
        // Should never happen — target was in original, copyDataset preserves names.
        throw new Error('intersectionPointsLayer: target lost in copyDataset');
      }
      pointLyr = mapshaper.internal.getIntersectionLayer(intersections, workingTarget, after.arcs!);
      pointLyr.name = newName;
      after.layers.push(pointLyr);
    } catch (err) {
      this.fire('error', { error: err });
      return false;
    }

    source.setDataset(after);

    // Same history-barrier convention as every other dataset-replace op.
    this._history.clear();
    this._history.push(new DatasetReplaceCommand({
      source, before, after,
      label: `Intersection points ${opts.target}`,
    }));
    this._fireHistoryChange();

    this._fireSelectionChange(this._selection.clear());
    this._scheduleRender();
    return true;
  }

  /**
   * Join attribute records from a CSV / JSON / another-layer source onto a
   * target layer via mapshaper's `-join`. The canonical "thematic shapefile
   * + CSV of measures → chloropleth" workflow.
   *
   * `data` is one of:
   * - `{ csv: string | Uint8Array }` — CSV bytes injected into the runner's
   *   input cache as `.emap-join.csv`.
   * - `{ json: string | Uint8Array | unknown[] | object }` — JSON bytes
   *   injected as `.emap-join.json`. Arrays/objects are stringified.
   * - `{ layer: string }` — by-name reference to another layer in the same
   *   source. No cache injection.
   *
   * Returns `false` for unresolvable source / target, malformed `keys`, or
   * an invalid `data` shape.
   */
  public async joinTable(opts: JoinTableOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    if (!findLayerByName(dataset.layers, opts.target)) return false;
    if (!Array.isArray(opts.keys) || opts.keys.length !== 2) return false;
    const [targetKey, sourceKey] = opts.keys.map((k) => (typeof k === 'string' ? k.trim() : ''));
    if (targetKey.length === 0 || sourceKey.length === 0) return false;
    // mapshaper serializes `keys=` as `target,source`; a key containing `,`
    // would split into 3+ keys and trip mapshaper's length validator.
    if (targetKey.includes(',') || sourceKey.includes(',')) return false;

    let joinSource: string;
    let inputFiles: Record<string, Uint8Array | string> | undefined;
    const data = opts.data as Record<string, unknown> | undefined;
    if (!data || typeof data !== 'object') return false;

    if ('layer' in data && typeof data.layer === 'string' && data.layer.trim().length > 0) {
      joinSource = data.layer.trim();
    } else if ('csv' in data && (typeof data.csv === 'string' || data.csv instanceof Uint8Array)) {
      const filename = '.emap-join.csv';
      joinSource = filename;
      inputFiles = { [filename]: data.csv as string | Uint8Array };
    } else if ('json' in data && data.json !== undefined) {
      const filename = '.emap-join.json';
      let payload: string | Uint8Array;
      if (typeof data.json === 'string' || data.json instanceof Uint8Array) {
        payload = data.json as string | Uint8Array;
      } else {
        payload = JSON.stringify(data.json);
      }
      joinSource = filename;
      inputFiles = { [filename]: payload };
    } else {
      return false;
    }
    if (!this._allowExpressionEvaluation([opts.where, opts.calc], 'joinTable')) return false;

    const parts: string[] = [
      `-target ${quoteMapshaperArg(opts.target)}`,
      `-join ${quoteMapshaperArg(joinSource)}`,
      `keys=${quoteMapshaperArg(`${targetKey},${sourceKey}`)}`,
    ];
    if (opts.fields && opts.fields.length > 0) {
      const safe = opts.fields.filter((f) => typeof f === 'string' && !f.includes(','));
      if (safe.length > 0) parts.push(`fields=${safe.join(',')}`);
    }
    if (opts.prefix && opts.prefix.length > 0) {
      parts.push(`prefix=${quoteMapshaperArg(opts.prefix)}`);
    }
    if (opts.where && opts.where.trim().length > 0) {
      parts.push(`where=${quoteMapshaperArg(opts.where)}`);
    }
    if (opts.calc && opts.calc.trim().length > 0) {
      parts.push(`calc=${quoteMapshaperArg(opts.calc)}`);
    }
    if (opts.unjoined) parts.push('unjoined');
    if (opts.unmatched) parts.push('unmatched');

    return this._runDatasetCommand(
      opts.source,
      parts.join(' '),
      `Join ${opts.target}`,
      inputFiles,
    );
  }

  /**
   * Combine the currently-selected features (when they all live in the same
   * source/layer) into a single feature, recorded as one undoable history
   * entry.
   *
   * Implements the standard mapshaper recipe: tag selected features with a
   * temp discriminator field, run `-dissolve` on it, then drop the temp
   * field. Attribute fields are preserved via `copy-fields=` so unselected
   * single-feature groups keep their values and the merged group inherits
   * the FIRST selected feature's values (mapshaper's documented
   * data-aggregation behaviour).
   *
   * Returns `false` (and runs no command) for an empty selection or when
   * the selection spans more than one source/layer.
   */
  public async mergeSelected(): Promise<boolean> {
    const refs = this._selection.getAll();
    if (refs.length === 0) return false;

    // Reject cross-source / cross-layer selections — mapshaper's dissolve
    // operates on a single layer at a time.
    const sourceId = refs[0].source;
    const layerId = refs[0].layer;
    for (const r of refs) {
      if (r.source !== sourceId || r.layer !== layerId) return false;
    }

    const layer = this._resolveLayer(sourceId, layerId);
    if (!layer) return false;

    // Sort selected ids ascending so the embedded JSON literal is
    // deterministic (helpful for tests + diffs).
    const ids = refs.map((r) => r.id).slice().sort((a, b) => a - b);

    const cmd = buildMergeSelectedCommand(layerId, ids, layer);
    const label = `Merge ${refs.length} feature${refs.length > 1 ? 's' : ''}`;
    return this._runDatasetCommand(sourceId, cmd, label);
  }

  /**
   * Translate every selected feature by `(dx, dy)` in source-data coordinates.
   * Returns `false` for an empty selection or zero offset.
   *
   * Lightweight in-place mutation — does not replace the dataset, does not
   * clear the selection, composes freely with other commands in one undo
   * timeline. For multi-source selections, one `FeatureTranslateCommand` is
   * built per source and they are wrapped in a single `CompositeCommand` so
   * one undo reverses the whole nudge.
   *
   * Known limitation: arcs shared with unselected features will be translated
   * along with the selection, distorting the unselected neighbours. Safe for
   * isolated features and contiguous polygon subsets; documented in the spec.
   */
  public translateSelected(dx: number, dy: number): boolean {
    if (dx === 0 && dy === 0) return false;
    const refs = this._selection.getAll();
    if (refs.length === 0) return false;

    // Group selection by source, collecting unique abs-arc-ids (for path
    // features) and (layer, featureId) pairs (for point features).
    const bySource = new globalThis.Map<
      string,
      {
        arcIdSet: Set<number>;
        pointFeatures: TranslatedPointFeature[];
      }
    >();

    for (const ref of refs) {
      const layer = this._resolveLayer(ref.source, ref.layer);
      if (!layer?.shapes) continue;
      const shape = layer.shapes[ref.id];
      if (!shape) continue;

      let bucket = bySource.get(ref.source);
      if (!bucket) {
        bucket = { arcIdSet: new Set<number>(), pointFeatures: [] };
        bySource.set(ref.source, bucket);
      }

      if (layer.geometry_type === 'point') {
        bucket.pointFeatures.push({ layer, featureId: ref.id });
      } else {
        // Path feature: shape is a list of parts, each part is a list of
        // signed arc ids. Negative ids encode reversed direction; abs them.
        for (const part of shape) {
          if (!Array.isArray(part)) continue;
          for (const rawArcId of part) {
            if (typeof rawArcId !== 'number') continue;
            bucket.arcIdSet.add(rawArcId >= 0 ? rawArcId : ~rawArcId);
          }
        }
      }
    }

    if (bySource.size === 0) return false;

    const children: EditCommand[] = [];
    const editedSourceIds: string[] = [];
    for (const [sourceId, bucket] of bySource) {
      const source = this._sources.get(sourceId);
      if (!source) continue;
      if (bucket.arcIdSet.size === 0 && bucket.pointFeatures.length === 0) continue;

      const cmd = new FeatureTranslateCommand({
        source,
        arcs: source.getArcs(),
        dx,
        dy,
        arcIds: Array.from(bucket.arcIdSet),
        pointFeatures: bucket.pointFeatures,
      });
      cmd.do();
      children.push(cmd);
      editedSourceIds.push(sourceId);
    }

    if (children.length === 0) return false;

    const pushed: EditCommand =
      children.length === 1
        ? children[0]
        : new CompositeCommand(children, `Translate ${refs.length} features`);
    this._history.push(pushed);
    this._fireHistoryChange();
    this._clearSpatialIndexesForSources(editedSourceIds);
    this._scheduleRender();
    return true;
  }

  /**
   * Begin a translate "drag session" against the current selection.
   *
   * The session lets a UI animate a translate (e.g. follow the cursor)
   * without spamming the undo stack with one entry per mousemove. Geometry
   * mutates on every `move(dx, dy)`; only `commit()` pushes a single
   * cumulative `FeatureTranslateCommand` (or `CompositeCommand`) to history.
   * `cancel()` rolls the geometry back to the pre-session state and
   * pushes nothing.
   *
   * Returns `null` when the selection is empty. The session captures the
   * selection at start time — concurrent edits to the selection during
   * a drag are intentionally ignored.
   */
  /**
   * Shared scaffolding for translate/affine sessions: groups the active
   * selection by source into buckets of `(arcIds, pointFeatures)`, and
   * (when `splitShared` is true) duplicates any arc shared with an
   * unselected feature so the drag doesn't drag the neighbour along.
   *
   * Returns `null` for an empty / fully-resolved-empty selection. The
   * returned `splitCmds` have already been `do()`-applied; the caller
   * must push them onto a composite at commit and call `undo()` on
   * cancel.
   */
  private _buildSelectionBuckets(splitShared: boolean): {
    buckets: Array<{
      sourceId: string;
      source: TopologySource;
      arcIds: number[];
      pointFeatures: TranslatedPointFeature[];
    }>;
    splitCmds: SplitSharedArcsCommand[];
  } | null {
    type Bucket = {
      sourceId: string;
      source: TopologySource;
      arcIds: number[];
      pointFeatures: TranslatedPointFeature[];
      pathFeatures: Array<{ layer: MapshaperLayer; featureId: number }>;
    };

    const refs = this._selection.getAll();
    if (refs.length === 0) return null;

    // First pass: classify selected refs into path / point per source.
    // We DON'T compute arcIds yet — those need to wait until after the
    // optional shared-arc split rewrites the shapes.
    const bySource = new globalThis.Map<string, Bucket>();
    for (const ref of refs) {
      const layer = this._resolveLayer(ref.source, ref.layer);
      if (!layer?.shapes) continue;
      const shape = layer.shapes[ref.id];
      if (!shape) continue;
      const source = this._sources.get(ref.source);
      if (!source) continue;

      let bucket = bySource.get(ref.source);
      if (!bucket) {
        bucket = {
          sourceId: ref.source,
          source,
          arcIds: [],
          pointFeatures: [],
          pathFeatures: [],
        };
        bySource.set(ref.source, bucket);
      }

      if (layer.geometry_type === 'point') {
        bucket.pointFeatures.push({ layer, featureId: ref.id });
      } else {
        bucket.pathFeatures.push({ layer, featureId: ref.id });
      }
    }

    if (bySource.size === 0) return null;

    // Optional shared-arc split per source. Plan reads the dataset's
    // layers, the command's `do()` appends new arcs and rewrites the
    // selected features' shape arrays in place.
    const splitCmds: SplitSharedArcsCommand[] = [];
    if (splitShared) {
      for (const bucket of bySource.values()) {
        if (bucket.pathFeatures.length === 0) continue;
        const plan = planSharedArcSplit(
          bucket.source,
          bucket.pathFeatures,
          bucket.source.getLayers() as MapshaperLayer[],
        );
        if (!plan) continue;
        const cmd = new SplitSharedArcsCommand(plan);
        cmd.do();
        splitCmds.push(cmd);
      }
    }

    // Second pass: now compute arcIds from the (possibly rewritten) shapes.
    for (const bucket of bySource.values()) {
      const seen = new Set<number>();
      for (const pf of bucket.pathFeatures) {
        const shape = pf.layer.shapes![pf.featureId];
        if (!shape) continue;
        for (const part of shape as number[][]) {
          if (!Array.isArray(part)) continue;
          for (const raw of part) {
            if (typeof raw !== 'number') continue;
            const abs = raw >= 0 ? raw : ~raw;
            if (!seen.has(abs)) {
              seen.add(abs);
              bucket.arcIds.push(abs);
            }
          }
        }
      }
    }

    const buckets = Array.from(bySource.values()).map((b) => ({
      sourceId: b.sourceId,
      source: b.source,
      arcIds: b.arcIds,
      pointFeatures: b.pointFeatures,
    }));
    return { buckets, splitCmds };
  }

  public beginTranslateSession(opts?: DragSessionOptions): FeatureTranslateSession | null {
    const built = this._buildSelectionBuckets(opts?.splitSharedArcs !== false);
    if (!built) return null;
    const { buckets, splitCmds } = built;
    let accumDx = 0;
    let accumDy = 0;
    let closed = false;

    const applyStep = (dx: number, dy: number) => {
      for (const b of buckets) {
        if (b.arcIds.length === 0 && b.pointFeatures.length === 0) continue;
        new FeatureTranslateCommand({
          source: b.source,
          arcs: b.source.getArcs(),
          dx,
          dy,
          arcIds: b.arcIds,
          pointFeatures: b.pointFeatures,
        }).do();
      }
    };

    return {
      move: (dx: number, dy: number) => {
        if (closed) return;
        if (dx === 0 && dy === 0) return;
        applyStep(dx, dy);
        accumDx += dx;
        accumDy += dy;
        this._scheduleRender();
      },
      commit: (): boolean => {
        if (closed) return false;
        closed = true;
        const moved = !(accumDx === 0 && accumDy === 0);
        // If the user opened a session, didn't drag, and committed: roll
        // any split-shared-arcs work back. Splitting alone with no visible
        // movement isn't worth a history entry.
        if (!moved) {
          for (let i = splitCmds.length - 1; i >= 0; i--) splitCmds[i].undo();
          if (splitCmds.length > 0) this._scheduleRender();
          return false;
        }
        // Geometry already moved by `move()` calls; build one cumulative
        // command and push it WITHOUT calling `.do()` — the post-do state
        // is already live. `undo` will subtract the cumulative offset,
        // `redo` re-applies it.
        const translateChildren: EditCommand[] = buckets.map((b) =>
          new FeatureTranslateCommand({
            source: b.source,
            arcs: b.source.getArcs(),
            dx: accumDx,
            dy: accumDy,
            arcIds: b.arcIds,
            pointFeatures: b.pointFeatures,
          }),
        );
        const total = buckets.reduce(
          (n, b) => n + b.arcIds.length + b.pointFeatures.length,
          0,
        );
        // Splits go FIRST in the composite so undo runs translate.undo()
        // (subtract offset on the duplicated arcs) before split.undo()
        // (truncate duplicates + restore original shape refs).
        const children: EditCommand[] = [...splitCmds, ...translateChildren];
        const pushed: EditCommand =
          children.length === 1
            ? children[0]
            : new CompositeCommand(children, `Translate ${total} features`);
        this._history.push(pushed);
        this._fireHistoryChange();
        this._clearSpatialIndexesForSources(buckets.map((b) => b.sourceId));
        this._scheduleRender();
        return true;
      },
      cancel: () => {
        if (closed) return;
        closed = true;
        // Reverse the translate first (on duplicated arcs), then reverse
        // the splits in LIFO order — each undo sees the state its do() left.
        if (accumDx !== 0 || accumDy !== 0) applyStep(-accumDx, -accumDy);
        for (let i = splitCmds.length - 1; i >= 0; i--) splitCmds[i].undo();
        accumDx = 0;
        accumDy = 0;
        this._scheduleRender();
      },
      getAccumulated: (): [number, number] => [accumDx, accumDy],
    };
  }

  /**
   * Begin a rotate / scale / arbitrary-affine "drag session" against the
   * current selection. Same one-history-entry-per-drag semantics as
   * {@link beginTranslateSession}, but the per-frame delta is an arbitrary
   * affine matrix (typically `rotateMatrix(theta, ox, oy)` or
   * `scaleMatrix(sx, sy, ox, oy)` with the session's `origin`).
   *
   * The pivot is captured at session start: pass `origin` explicitly or let
   * it default to the selection bbox centroid. Subsequent matrices should
   * use the same pivot; otherwise the cumulative composed matrix on commit
   * won't match the visually applied sequence.
   */
  public beginAffineSession(
    origin?: [number, number],
    opts?: DragSessionOptions,
  ): FeatureAffineSession | null {
    const built = this._buildSelectionBuckets(opts?.splitSharedArcs !== false);
    if (!built) return null;
    const { buckets, splitCmds } = built;

    // Pivot. Same default as `_applyAffineToSelection`: bbox centroid of
    // every vertex the transform will touch.
    let ox: number;
    let oy: number;
    if (origin) {
      [ox, oy] = origin;
    } else {
      const centroidInput = new globalThis.Map<
        string,
        { arcIdSet: Set<number>; pointFeatures: TranslatedPointFeature[] }
      >();
      for (const b of buckets) {
        centroidInput.set(b.sourceId, {
          arcIdSet: new Set(b.arcIds),
          pointFeatures: b.pointFeatures,
        });
      }
      const centroid = this._computeSelectionCentroid(centroidInput);
      if (!centroid) {
        // Roll back any speculative split before bailing out.
        for (let i = splitCmds.length - 1; i >= 0; i--) splitCmds[i].undo();
        return null;
      }
      [ox, oy] = centroid;
    }
    if (!Number.isFinite(ox) || !Number.isFinite(oy)) {
      for (let i = splitCmds.length - 1; i >= 0; i--) splitCmds[i].undo();
      return null;
    }
    const pivot: [number, number] = [ox, oy];

    let cumulative: AffineMatrix = { ...IDENTITY_MATRIX };
    let closed = false;

    const isIdentity = (m: AffineMatrix): boolean =>
      m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.tx === 0 && m.ty === 0;

    const applyMatrix = (matrix: AffineMatrix) => {
      for (const b of buckets) {
        if (b.arcIds.length === 0 && b.pointFeatures.length === 0) continue;
        new FeatureAffineCommand({
          source: b.source,
          arcs: b.source.getArcs(),
          matrix,
          arcIds: b.arcIds,
          pointFeatures: b.pointFeatures,
        }).do();
      }
    };

    return {
      origin: pivot,
      applyDelta: (matrix: AffineMatrix) => {
        if (closed) return;
        if (isIdentity(matrix)) return;
        applyMatrix(matrix);
        // Cumulative is "delta · cumulative" — newer transforms apply
        // after older ones, matching the visual sequence above.
        cumulative = composeMatrix(matrix, cumulative);
        this._scheduleRender();
      },
      commit: (label?: string): boolean => {
        if (closed) return false;
        closed = true;
        if (isIdentity(cumulative)) {
          // No movement — undo any speculative split so we don't pollute
          // the dataset with orphan duplicated arcs and a pointless entry.
          for (let i = splitCmds.length - 1; i >= 0; i--) splitCmds[i].undo();
          if (splitCmds.length > 0) this._scheduleRender();
          return false;
        }
        const totalFeatures = buckets.reduce(
          (n, b) => n + b.arcIds.length + b.pointFeatures.length,
          0,
        );
        const affineChildren: EditCommand[] = buckets.map((b) =>
          new FeatureAffineCommand({
            source: b.source,
            arcs: b.source.getArcs(),
            matrix: cumulative,
            arcIds: b.arcIds,
            pointFeatures: b.pointFeatures,
            label,
          }),
        );
        // Splits FIRST so undo runs affine.undo() (apply matrix^-1 on the
        // duplicated arcs) before split.undo() (truncate + restore shapes).
        const children: EditCommand[] = [...splitCmds, ...affineChildren];
        const pushed: EditCommand =
          children.length === 1
            ? children[0]
            : new CompositeCommand(
                children,
                label ?? `Transform ${totalFeatures} feature${totalFeatures === 1 ? '' : 's'}`,
              );
        this._history.push(pushed);
        this._fireHistoryChange();
        this._clearSpatialIndexesForSources(buckets.map((b) => b.sourceId));
        this._scheduleRender();
        return true;
      },
      cancel: () => {
        if (closed) return;
        closed = true;
        // Reverse the affine first, then the splits in LIFO order.
        if (!isIdentity(cumulative)) applyMatrix(invertMatrix(cumulative));
        for (let i = splitCmds.length - 1; i >= 0; i--) splitCmds[i].undo();
        cumulative = { ...IDENTITY_MATRIX };
        this._scheduleRender();
      },
      getCumulative: (): AffineMatrix => ({ ...cumulative }),
    };
  }

  /**
   * Rotate every selected feature around `origin` by `angleDegrees`.
   * Default `origin` is the bbox centroid of the affected vertices.
   *
   * Lightweight in-place transform on the same path as `translateSelected`:
   * not a history barrier, selection survives, multi-source selections wrap
   * in a `CompositeCommand`. Returns `false` for empty selection or zero
   * angle.
   */
  public rotateSelected(angleDegrees: number, origin?: [number, number]): boolean {
    if (angleDegrees === 0) return false;
    const angleRad = (angleDegrees * Math.PI) / 180;
    return this._applyAffineToSelection(
      (ox, oy) => rotateMatrix(angleRad, ox, oy),
      origin,
      (n) => `Rotate ${n} feature${n === 1 ? '' : 's'}`,
    );
  }

  /**
   * Scale every selected feature by `(sx, sy)` around `origin`.
   * `sy` defaults to `sx` (uniform scale). Default `origin` is the bbox
   * centroid of the affected vertices. Returns `false` for empty selection
   * or no-op scale (`sx === 1 && sy === 1`).
   */
  public scaleSelected(sx: number, sy?: number, origin?: [number, number]): boolean {
    const sX = sx;
    const sY = sy ?? sx;
    if (sX === 1 && sY === 1) return false;
    return this._applyAffineToSelection(
      (ox, oy) => scaleMatrix(sX, sY, ox, oy),
      origin,
      (n) => `Scale ${n} feature${n === 1 ? '' : 's'}`,
    );
  }

  /**
   * Shared scaffolding for rotate / scale: walks the current selection,
   * groups by source, computes the bbox centroid (when no origin supplied),
   * builds one `FeatureAffineCommand` per source, and pushes either the
   * single command or a `CompositeCommand` wrapping all sources.
   */
  private _applyAffineToSelection(
    matrixForOrigin: (ox: number, oy: number) => AffineMatrix,
    origin: [number, number] | undefined,
    labelFor: (totalFeatures: number) => string,
  ): boolean {
    const refs = this._selection.getAll();
    if (refs.length === 0) return false;

    const bySource = new globalThis.Map<
      string,
      {
        arcIdSet: Set<number>;
        pointFeatures: TranslatedPointFeature[];
      }
    >();

    for (const ref of refs) {
      const layer = this._resolveLayer(ref.source, ref.layer);
      if (!layer?.shapes) continue;
      const shape = layer.shapes[ref.id];
      if (!shape) continue;

      let bucket = bySource.get(ref.source);
      if (!bucket) {
        bucket = { arcIdSet: new Set<number>(), pointFeatures: [] };
        bySource.set(ref.source, bucket);
      }

      if (layer.geometry_type === 'point') {
        bucket.pointFeatures.push({ layer, featureId: ref.id });
      } else {
        for (const part of shape) {
          if (!Array.isArray(part)) continue;
          for (const rawArcId of part) {
            if (typeof rawArcId !== 'number') continue;
            bucket.arcIdSet.add(rawArcId >= 0 ? rawArcId : ~rawArcId);
          }
        }
      }
    }

    if (bySource.size === 0) return false;

    // Default origin = bbox centroid of every vertex the transform will
    // touch. Picked once and reused across all per-source commands so
    // multi-source selections rotate / scale around a single shared pivot.
    let ox: number;
    let oy: number;
    if (origin) {
      ox = origin[0];
      oy = origin[1];
    } else {
      const centroid = this._computeSelectionCentroid(bySource);
      if (!centroid) return false;
      [ox, oy] = centroid;
    }

    if (!Number.isFinite(ox) || !Number.isFinite(oy)) return false;

    const matrix = matrixForOrigin(ox, oy);

    const children: EditCommand[] = [];
    const editedSourceIds: string[] = [];
    for (const [sourceId, bucket] of bySource) {
      const source = this._sources.get(sourceId);
      if (!source) continue;
      if (bucket.arcIdSet.size === 0 && bucket.pointFeatures.length === 0) continue;

      const cmd = new FeatureAffineCommand({
        source,
        arcs: source.getArcs(),
        matrix,
        arcIds: Array.from(bucket.arcIdSet),
        pointFeatures: bucket.pointFeatures,
      });
      cmd.do();
      children.push(cmd);
      editedSourceIds.push(sourceId);
    }

    if (children.length === 0) return false;

    const pushed: EditCommand =
      children.length === 1
        ? children[0]
        : new CompositeCommand(children, labelFor(refs.length));
    this._history.push(pushed);
    this._fireHistoryChange();
    this._clearSpatialIndexesForSources(editedSourceIds);
    this._scheduleRender();
    return true;
  }

  /**
   * Compute the bbox centroid of every vertex the bySource buckets reference
   * (across path-feature arcs and point-feature shapes). Returns `null` when
   * no vertex was found (e.g., empty arcs).
   */
  private _computeSelectionCentroid(
    bySource: globalThis.Map<string, { arcIdSet: Set<number>; pointFeatures: TranslatedPointFeature[] }>,
  ): [number, number] | null {
    let xmin = Infinity, ymin = Infinity;
    let xmax = -Infinity, ymax = -Infinity;
    let any = false;

    for (const [sourceId, bucket] of bySource) {
      const source = this._sources.get(sourceId);
      if (!source) continue;

      // Path features: walk the affected arcs' xx/yy slices.
      const arcs = source.getArcs();
      const data = arcs?.getVertexData?.();
      if (data && bucket.arcIdSet.size > 0) {
        const { xx, yy, ii, nn } = data;
        for (const arcId of bucket.arcIdSet) {
          const start = ii[arcId];
          const len = nn[arcId];
          for (let i = start; i < start + len; i++) {
            const x = xx[i];
            const y = yy[i];
            if (x < xmin) xmin = x;
            if (x > xmax) xmax = x;
            if (y < ymin) ymin = y;
            if (y > ymax) ymax = y;
            any = true;
          }
        }
      }

      // Point features: walk each shape's coords.
      for (const pf of bucket.pointFeatures) {
        const shape = pf.layer.shapes?.[pf.featureId] as number[][] | undefined;
        if (!shape) continue;
        for (const coord of shape) {
          if (!coord || coord.length < 2) continue;
          const x = coord[0];
          const y = coord[1];
          if (x < xmin) xmin = x;
          if (x > xmax) xmax = x;
          if (y < ymin) ymin = y;
          if (y > ymax) ymax = y;
          any = true;
        }
      }
    }

    if (!any) return null;
    return [(xmin + xmax) / 2, (ymin + ymax) / 2];
  }

  // ---------------------------------------------------------------------------
  // Attribute / data-table editing
  // ---------------------------------------------------------------------------

  /**
   * Set or overwrite a single property on a single feature. Setting `value` to
   * `undefined` deletes the key. Returns `false` for unresolvable refs or when
   * the call is a no-op (existing value already matches).
   */
  public setFeatureProperty(ref: FeatureRef, key: string, value: unknown): boolean {
    return this.setFeatureProperties(ref, { [key]: value });
  }

  /**
   * Set multiple properties on one feature in a single undo entry.
   *
   * Per-key semantics:
   * - `props[key] === undefined` → delete the key from the record
   * - any other value → set / overwrite the key
   *
   * Returns `false` for unresolvable refs or when every key already has the
   * requested value (no-op call); no command is pushed and no events fire.
   */
  public setFeatureProperties(
    ref: FeatureRef,
    props: Record<string, unknown>,
  ): boolean {
    const layer = this._resolveLayer(ref.source, ref.layer);
    if (!layer) return false;
    const records = layer.data?.getRecords?.();
    const record = records?.[ref.id];
    if (!record) return false;

    const prev: Record<string, unknown> = {};
    const next: Record<string, unknown> = {};

    for (const key of Object.keys(props)) {
      const had = key in record;
      const prevValue = had ? record[key] : undefined;
      const nextValue = props[key];

      // Detect no-ops at the key level so the diff stays minimal.
      if (nextValue === undefined && !had) continue;
      if (nextValue !== undefined && had && record[key] === nextValue) continue;

      if (had) prev[key] = prevValue;
      if (nextValue !== undefined) next[key] = nextValue;
    }

    if (Object.keys(prev).length === 0 && Object.keys(next).length === 0) {
      return false;
    }

    const cmd = new FeaturePropertyChangeCommand({
      layer,
      featureId: ref.id,
      prev,
      next,
    });
    cmd.do();
    this._history.push(cmd);
    this._fireHistoryChange();
    this._scheduleRender();
    return true;
  }

  /**
   * Add a new column to a layer's data table. Records that already carry the
   * key are skipped (and not rolled back by undo). `defaultValue` defaults to
   * `null`. Returns `false` if the source / target / data table cannot be
   * resolved.
   */
  public addField(opts: {
    source: string;
    target: string;
    field: string;
    defaultValue?: unknown;
  }): boolean {
    const layer = this._resolveLayer(opts.source, opts.target);
    if (!layer?.data) return false;
    const cmd = new FieldAddCommand({
      layer,
      field: opts.field,
      defaultValue: opts.defaultValue,
    });
    cmd.do();
    this._history.push(cmd);
    this._fireHistoryChange();
    this._scheduleRender();
    return true;
  }

  /**
   * Drop a column from a layer's data table. Per-record values are
   * snapshotted for undo so removing the field is fully reversible.
   * Returns `false` if the source / target / data table cannot be resolved.
   */
  public removeField(opts: {
    source: string;
    target: string;
    field: string;
  }): boolean {
    const layer = this._resolveLayer(opts.source, opts.target);
    if (!layer?.data) return false;
    const cmd = new FieldRemoveCommand({ layer, field: opts.field });
    cmd.do();
    this._history.push(cmd);
    this._fireHistoryChange();
    this._scheduleRender();
    return true;
  }

  /**
   * Rename a column on every record in a layer. Refuses (returns `false`) when
   * any record already carries both `from` and `to` so silent overwrites are
   * impossible. Use `removeField(to)` first if that is the intent.
   */
  public renameField(opts: {
    source: string;
    target: string;
    from: string;
    to: string;
  }): boolean {
    const layer = this._resolveLayer(opts.source, opts.target);
    if (!layer?.data) return false;
    const records = layer.data.getRecords?.();
    if (!records) return false;
    if (opts.from === opts.to) return false;
    for (const r of records) {
      if (r && opts.from in r && opts.to in r) {
        return false;
      }
    }
    const cmd = new FieldRenameCommand({ layer, from: opts.from, to: opts.to });
    cmd.do();
    this._history.push(cmd);
    this._fireHistoryChange();
    this._scheduleRender();
    return true;
  }

  /** Resolve a (sourceId, layerId) pair to the actual MapshaperLayer object. */
  private _resolveLayer(sourceId: string, layerId: string): MapshaperLayer | null {
    const source = this._sources.get(sourceId);
    if (!source) return null;
    const layers = source.getLayers();
    for (let i = 0; i < layers.length; i++) {
      if (getLayerId(layers[i], i) === layerId) {
        return layers[i] as MapshaperLayer;
      }
    }
    return null;
  }

  /**
   * Generic runner for whole-dataset mapshaper commands.
   *
   * Snapshots the dataset (`internal.copyDataset`), runs the command which
   * mutates the original in place, clears the undo history (dataset replace
   * is a history barrier), pushes one `DatasetReplaceCommand`, clears the
   * selection, and fires `historychange` once. Future ops (`dissolve`,
   * `buffer`, ...) reuse this helper.
   */

  /**
   * Worker-thread variant of {@link runMapshaperCommandOnDataset}: packs
   * the dataset via `exportDatasetsToPack({ compact: false })`, dispatches
   * to the pool, restores the result. Fires `workerjobstart` /
   * `workerjobend` events around the pool round-trip so UI code can show
   * a spinner without per-call wiring.
   */
  private async _runViaWorker(
    dataset: MapshaperDataset,
    cmd: string,
    label: string,
    inputFiles?: Record<string, Uint8Array | string>,
  ): Promise<MapshaperDataset> {
    if (!this._workerPool) {
      // Should never reach here — caller checks _workerPool. Defensive.
      throw new Error('_runViaWorker: worker pool not available');
    }
    // Fire workerjobstart BEFORE the synchronous pack work so a UI spinner
    // appears immediately. Pack on a 1M-vertex dataset takes ~500ms; firing
    // the event after pack delays UI feedback by exactly that amount.
    // Use the pool's id reservation so start/end events stay correlated.
    const id = this._workerPool.reserveId();
    const datasetVertexCount = dataset.arcs?.getPointCount?.() ?? 0;
    const startedAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    this.fire('workerjobstart', { id, cmd, label, datasetVertexCount });

    try {
      const packed = await mapshaper.internal.exportDatasetsToPack([dataset], { compact: false });
      const promise = this._workerPool.dispatchWithId(id, cmd, packed, inputFiles);
      const resultPacked = await promise;
      const restored = await mapshaper.internal.restoreSessionData(resultPacked);
      if (!restored.datasets || restored.datasets.length === 0) {
        throw new Error('worker: no dataset in response');
      }
      const durationMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
      this.fire('workerjobend', { id, ok: true, durationMs });
      return restored.datasets[0];
    } catch (err: any) {
      const durationMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
      this.fire('workerjobend', {
        id,
        ok: false,
        durationMs,
        errorMessage: err?.message ?? String(err),
      });
      throw err;
    }
  }

  private async _runDatasetCommand(
    sourceId: string,
    cmd: string,
    label: string,
    inputFiles?: Record<string, Uint8Array | string>,
  ): Promise<boolean> {
    const source = this._sources.get(sourceId);
    if (!source) return false;
    const original = source.getDataset();
    if (!original) return false;

    // Deep snapshot for undo. mapshaper's clip / erase / dissolve mutate the
    // input dataset in place; without this snapshot there is nothing to
    // restore on undo.
    const before: MapshaperDataset = mapshaper.internal.copyDataset(original);

    // Decide worker vs main-thread.
    // - false      → main-thread always
    // - true       → worker always (when pool exists)
    // - 'auto'     → worker when arc vertex count meets workerThreshold
    let useWorker = false;
    if (this._workerPool) {
      if (this._workerMode === true) {
        useWorker = true;
      } else if (this._workerMode === 'auto') {
        const vertexCount = original.arcs?.getPointCount?.() ?? 0;
        useWorker = vertexCount >= this._workerThreshold;
      }
    }

    let after: MapshaperDataset;
    try {
      if (useWorker) {
        after = await this._runViaWorker(original, cmd, label, inputFiles);
      } else {
        after = await runMapshaperCommandOnDataset(cmd, original, inputFiles);
      }
    } catch (err) {
      // Surface as a fire-and-forget error event; do not throw from a public
      // edit op so that one bad command doesn't tear down the calling page.
      this.fire('error', { error: err });
      return false;
    }

    // Apply: swap the source's active dataset.
    source.setDataset(after);

    // History barrier: prior commands closed over the OLD dataset's layers /
    // arcs. Clearing keeps undo predictable; the dataset-replace itself is
    // the single new undoable step.
    this._history.clear();
    this._history.push(new DatasetReplaceCommand({ source, before, after, label }));
    this._fireHistoryChange();

    // Selection refs are by feature id and may now point at different
    // features. Clear conservatively.
    this._fireSelectionChange(this._selection.clear());

    this._scheduleRender();
    return true;
  }

  public remove(): void {
    this._dragPan.destroy();
    this._mouseWheel.destroy();
    this._historyShortcutUnbind?.();
    this._historyShortcutUnbind = null;
    if (this._workerPool) {
      this._workerPool.destroy();
      this._workerPool = null;
    }
    if (this._container && this._canvasContainer) {
      this._container.removeChild(this._canvasContainer);
    }
  }
}

// ---------------------------------------------------------------------------
// Module-private helpers for whole-dataset mapshaper command execution
// ---------------------------------------------------------------------------

/**
 * Resolve a mapshaper layer by its name or id (matches what `mapshaper -clip
 * source=NAME` would resolve internally). Returns null when no layer
 * matches.
 */
function findLayerByName(layers: MapshaperLayer[], nameOrId: string): MapshaperLayer | null {
  for (const layer of layers) {
    if (layer.name === nameOrId || layer.id === nameOrId) return layer;
  }
  return null;
}

/**
 * Quote a layer name so it can be embedded in a mapshaper command string.
 * mapshaper accepts double-quoted arguments; we escape any embedded quotes.
 */
function quoteMapshaperArg(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

/** Internal field name used by `mergeSelected`'s discriminator pass. */
const MERGE_SELECTED_FIELD = '__emap_merge';

/**
 * Build the mapshaper command string that implements `mergeSelected` for
 * one (target layer, selected ids) pair. Recipe:
 *   1. Tag every record with a discriminator field — selected rows get
 *      'M', unselected rows get a unique value so they pass through.
 *   2. Run `-dissolve` on the discriminator with `copy-fields=` listing
 *      every original field so attributes survive.
 *   3. Drop the discriminator field via `-filter-fields ... invert`.
 *
 * IMPORTANT: mapshaper's `-each` interprets BARE assignments
 * (`foo = ...`) as writes to the record, but `this.foo = ...` writes to
 * the synthetic feature proxy and is silently dropped (see
 * `mapshaper-feature-expressions.mjs`). The discriminator is therefore
 * assigned bare; reads of `this.id` / `this.<field>` still proxy through
 * the feature object and work normally.
 *
 * Cleanup uses `-filter-fields __emap_merge invert` rather than
 * `-each "delete __emap_merge"` because deleting from a `with(record)`
 * scope by bare name doesn't remove the field from the DataTable schema
 * — the field would still appear in subsequent `getFields()` calls.
 *
 * Returns the full command as a single string suitable for
 * `mapshaper.internal.parseCommands`.
 */
function buildMergeSelectedCommand(
  layerName: string,
  selectedIds: number[],
  layer: MapshaperLayer,
): string {
  // JSON.stringify produces a stable, parser-safe array literal.
  const idsJSON = JSON.stringify(selectedIds);
  // Single quotes wrap the JS expression; literal string values inside
  // use double quotes so they don't collide with the outer delimiter.
  const tagExpr =
    `'${MERGE_SELECTED_FIELD} = ${idsJSON}.indexOf(this.id) >= 0 ? "M" : "k_" + this.id'`;

  // Build copy-fields= from the layer's data table when one exists.
  // Field names with commas are intentionally rejected (mapshaper's
  // copy-fields= is comma-delimited and does not quote individual entries).
  let copyFieldsArg = '';
  const fields = layer.data?.getFields?.();
  if (fields && fields.length > 0) {
    const safeFields = fields.filter(
      (f) => f !== MERGE_SELECTED_FIELD && !f.includes(','),
    );
    if (safeFields.length > 0) {
      copyFieldsArg = ` copy-fields=${safeFields.join(',')}`;
    }
  }

  return [
    `-target ${quoteMapshaperArg(layerName)}`,
    `-each ${tagExpr}`,
    `-dissolve ${quoteMapshaperArg(MERGE_SELECTED_FIELD)}${copyFieldsArg}`,
    `-filter-fields ${MERGE_SELECTED_FIELD} invert`,
  ].join(' ');
}

/**
 * Run a mapshaper command string against a single dataset and resolve with
 * the resulting (post-mutation) dataset. Wraps the parseCommands +
 * runParsedCommands + Job dance in a Promise.
 */
function runMapshaperCommandOnDataset(
  cmd: string,
  dataset: MapshaperDataset,
  inputFiles?: Record<string, Uint8Array | string>,
): Promise<MapshaperDataset> {
  return new Promise((resolve, reject) => {
    const job = new mapshaper.internal.Job();
    job.catalog.addDataset(dataset);
    const commands = mapshaper.internal.parseCommands(cmd);
    if (inputFiles) {
      // mapshaper resolves filename references in command args via
      // `cli.readFile(name, null, opts.input)`, so the cache must be present
      // on every command's options. Cheap to set on all of them.
      for (const c of commands) {
        if (c.options) c.options.input = inputFiles;
      }
    }
    mapshaper.internal.runParsedCommands(commands, job, (err: any, finished) => {
      if (err) {
        reject(err);
        return;
      }
      const targets = finished.catalog.getDefaultTargets();
      if (targets.length > 0) {
        resolve(targets[0].dataset);
      } else {
        // mapshaper sometimes leaves the input dataset untouched if no target
        // applied — treat as success and return the original ref.
        resolve(dataset);
      }
    });
  });
}
