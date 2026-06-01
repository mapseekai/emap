// Single contact surface for mapshaper's `internal.*` API.
//
// Why this exists: the codebase reaches into `mapshaper.internal.*` from 13
// production modules across 28 distinct symbols. Mapshaper has no stability
// promise on these — they are versioned along with the public CLI but the
// shapes shift between minor releases. Concentrating every call here lets a
// future mapshaper upgrade fail (or be forwarded to a shim) in exactly one
// file instead of thirteen.
//
// Phase 1 (PR-3) covered the topology-editing surface plus the command
// runner. Phase 2 (PR-11, this version) folds in projection / display-arcs /
// snapshot pack-unpack / intersection layers / segment-endpoint helpers, so
// every main-thread `mapshaper.internal.*` reference now routes here. The
// dedicated worker entry (`src/worker/mapshaper-worker.ts`) intentionally
// keeps direct calls — it IS the host that exposes mapshaper to the rest
// of the bundle, not a consumer.
//
// Tests inject a mock adapter via the `adapter` option on each command and via
// {@link setDefaultMapshaperAdapter} for shared/global paths. Production code
// resolves a singleton via {@link getDefaultMapshaperAdapter} when no explicit
// adapter is supplied.

import type {
  ArcCollection,
  MapshaperDataset,
  MapshaperLayer,
} from '../types/mapshaper-types';

// -- Pack / snapshot serialisation ------------------------------------------
// Mapshaper's pack format has no published TypeScript shape. Treat it as an
// opaque structured-clone-friendly value here; only the adapter and worker
// produce / consume it.

/** Plain-object form produced by `exportDatasetsToPack` / consumed by `restoreSessionData`. */
export type PackedSession = Record<string, unknown> & { datasets?: unknown[] };

/** Single export-file output — `exportFileContent` / `exportPackedDatasets` shape. */
export interface ExportedFile {
  filename: string;
  content: string | Uint8Array | ArrayBuffer;
}

/** A single segment-intersection record; mapshaper carries extra fields we don't expose. */
export interface SegmentIntersection {
  x: number;
  y: number;
  [key: string]: unknown;
}

/** Bounding box returned by `getDatasetBounds` / `getLayerBounds`. */
export interface MapshaperBBox {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

/** Result from mapshaper.geom.getPointToShapeInfo; only distance is consumed. */
export interface PointToShapeInfo {
  distance: number;
  [key: string]: unknown;
}

/**
 * One entry in a parsed mapshaper command pipeline. Equivalent to what
 * `parseCommands('-clip source=mask')` returns: a `name` (kebab-case op
 * name like `'clip'`, `'rename-layers'`, `'filter-fields'`) plus an
 * `options` bag whose keys match mapshaper's snake_case internal naming
 * (e.g. `cap_style`, `gap_fill_area`, `no_replace`).
 *
 * Hand-built ParsedCommands skip mapshaper's CLI parser entirely, which
 * removes the quoting / escaping concern that drove PR-4 phase 1: option
 * values are typed JS values (`string`, `number`, `boolean`, `string[]`)
 * rather than tokens interpolated into a shell-like grammar.
 *
 * Op modules under `src/map/ops/` build these directly via
 * `OpContext.runDatasetCommand(commands, ...)`.
 */
export interface ParsedCommand {
  name: string;
  options: Record<string, unknown>;
}

/** Files injected onto a `-i` command's `input` option. */
export type RunnerInputFiles = Record<string, Uint8Array | string>;

/**
 * The mapshaper internal API surface the editor depends on. Methods are
 * grouped by purpose to make it obvious which mapshaper subsystem each one
 * pokes; signatures match the underlying mapshaper functions exactly so the
 * default adapter implementation can stay a one-line delegation.
 */
export interface MapshaperAdapter {
  // -- Topology vertex editing -------------------------------------------

  /**
   * Move every vertex in `vertexIds` to `to`, preserving topology. Mapshaper
   * mutates the per-arc `xx`/`yy` slices in place and updates affected arc
   * bounds. Used by VertexMoveCommand for both do() and undo().
   */
  snapVertices(
    vertexIds: number[],
    to: [number, number],
    arcs: ArcCollection,
  ): void;

  /**
   * Insert `point` immediately before the vertex at index `vertexIndex`,
   * shifting the rest of the arc forward. Returns the index of the newly
   * inserted vertex (== `vertexIndex` of the original arg).
   *
   * Note: the underlying mapshaper signature is `(arcs, i, point)` — there
   * is no separate `arcId` parameter; mapshaper resolves the arc internally
   * from the global vertex index. The tuple-based naming in the plan was
   * inaccurate; this signature matches actual mapshaper.
   */
  insertVertex(
    arcs: ArcCollection,
    vertexIndex: number,
    point: [number, number],
  ): void;

  /** Remove the vertex at the given global vertex index. */
  deleteVertex(arcs: ArcCollection, vertexIndex: number): void;

  // -- Arc construction (used by FeatureCreateCommand) -------------------

  /** Append a new empty arc to the collection; subsequent `appendVertex`
   *  calls write into it. */
  appendEmptyArc(arcs: ArcCollection): void;

  /**
   * Append `[x, y]` onto the arc most recently created via `appendEmptyArc`.
   * Mapshaper resolves the target arc implicitly; pass the coord pair
   * directly (mapshaper accepts `[x, y]` rather than separate args).
   */
  appendVertex(arcs: ArcCollection, point: [number, number]): void;

  /** Pop the most recently appended arc. Used by FeatureCreateCommand.undo. */
  deleteLastArc(arcs: ArcCollection): void;

  // -- Topology queries (used by VertexEditControl) ----------------------

  /**
   * Find every vertex id that shares the same topological node as the
   * vertex closest to `point` within the given `shape`. Returns an empty
   * array when no vertex is close enough.
   */
  findNearestVertices(
    point: [number, number],
    shape: number[][],
    arcs: ArcCollection,
  ): number[];

  /**
   * Resolve a global vertex index back to its parent arc id, given the
   * `ii` (per-arc start-index) array from `ArcCollection.getVertexData()`.
   * Used by VertexEditControl when mapping a vertex hit to a single arc.
   */
  findArcIdFromVertexId(vertexId: number, ii: Int32Array | Uint32Array): number;

  /**
   * `true` iff the vertex at `idx` is the start- or end-vertex of its
   * arc — those endpoints are shared topological nodes and cannot be
   * deleted without breaking adjacency.
   */
  vertexIsArcEndpoint(idx: number, arcs: ArcCollection): boolean;

  /**
   * Walk every segment of every arc referenced by `shape`, invoking `cb`
   * with the (i, j) global-vertex pair plus the shared `xx` / `yy`
   * arrays. Used by VertexEditControl to find the closest edge under
   * the cursor for drag-to-insert.
   */
  forEachSegmentInShape(
    shape: number[][],
    arcs: ArcCollection,
    cb: (i: number, j: number, xx: Float64Array, yy: Float64Array) => void,
  ): void;

  /**
   * Project (px, py) onto the segment from (ax, ay) to (bx, by). The
   * returned coord is clamped to the segment endpoints when the
   * projection falls outside them. `snapArg` mirrors mapshaper's
   * snap-tolerance argument and is forwarded as-is.
   */
  findClosestPointOnSeg(
    px: number, py: number,
    ax: number, ay: number,
    bx: number, by: number,
    snapArg: number,
  ): [number, number];

  // -- Geometry / topology repair ----------------------------------------

  /**
   * Pre-pass run by every overlay command (clip / dissolve / union / …):
   * inserts vertices at every detected segment intersection and rebuilds
   * shared-arc topology. Mutates `dataset.arcs` in place. Surfaces as
   * `Emap.ops.rebuildTopology()` when called explicitly.
   */
  addIntersectionCuts(
    dataset: MapshaperDataset,
    opts?: { snap_interval?: number; no_snap?: boolean; rebuild_topology?: boolean },
  ): void;

  /**
   * Read-only segment-intersection scan; populates the report consumed
   * by `Emap.ops.checkGeometry`. Does NOT mutate the arcs.
   */
  findSegmentIntersections(
    arcs: ArcCollection,
    opts?: { tolerance?: number },
  ): SegmentIntersection[];

  /**
   * Materialise a multi-point layer at every intersection found by
   * {@link findSegmentIntersections}. Used by
   * `Emap.ops.intersectionPointsLayer` to expose intersections as a
   * pickable / editable layer.
   */
  getIntersectionLayer(
    intersections: SegmentIntersection[],
    target: MapshaperLayer,
    arcs: ArcCollection,
  ): MapshaperLayer;

  // -- LOD / measurement -------------------------------------------------

  /**
   * Average segment length across the arc collection. Used by
   * `DisplayArcs` to pick a sensible per-frame simplification floor.
   */
  getAvgSegment(arcs: ArcCollection): number;

  /**
   * Fast (non-Visvalingam) simplification: drops vertices below a
   * length threshold. Used to pre-build a coarse "always-on" LOD copy
   * the renderer falls back to at zoomed-out scales.
   */
  simplifyArcsFast(arcs: ArcCollection, segLength: number): ArcCollection;

  // -- Geometry predicates / measurements ---------------------------------

  distance2D(ax: number, ay: number, bx: number, by: number): number;

  getPointToShapeInfo(
    x: number,
    y: number,
    shape: number[][],
    arcs: ArcCollection,
  ): PointToShapeInfo;

  testPointInPolygon(
    x: number,
    y: number,
    shape: number[][],
    arcs: ArcCollection,
  ): boolean;

  /**
   * Returns `true` iff the layer carries renderable shape data (a
   * `geometry_type` plus a non-empty `shapes` array). Used by the
   * projection module to decide whether a layer participates in the
   * extent rebuild.
   */
  layerHasGeometry(layer: MapshaperLayer): boolean;

  /**
   * Bounds of one layer's shapes against an arc collection. Returns a
   * mapshaper-internal Bounds-like object — typed loosely because the
   * caller only reads `xmin/ymin/xmax/ymax`.
   */
  getLayerBounds(layer: MapshaperLayer, arcs?: ArcCollection): MapshaperBBox;

  /** Bounding box across every layer in the dataset. */
  getDatasetBounds(dataset: MapshaperDataset): MapshaperBBox;

  // -- Snapshot / export -------------------------------------------------

  /**
   * Pack one or more datasets into a structured-clone-friendly object
   * suitable for `postMessage` (worker round-trips) or
   * {@link pack} (`.msx` snapshot bytes). `compact: true` bakes
   * simplification thresholds into `zz` and gzip-compresses arc
   * buffers; `false` skips that for the worker pipeline.
   */
  exportDatasetsToPack(
    datasets: MapshaperDataset[],
    opts?: { compact?: boolean },
  ): Promise<PackedSession>;

  /**
   * Inverse of {@link exportDatasetsToPack}. Decodes a packed session
   * (typically produced by the worker) back into live datasets.
   */
  restoreSessionData(packed: PackedSession): Promise<{ datasets: MapshaperDataset[] }>;

  /** Materialise a `.msx` snapshot byte buffer from a packed session. */
  pack(obj: PackedSession): Uint8Array;

  /** Inverse of {@link pack}: `.msx` bytes → packed session object. */
  unpackSessionData(bytes: Uint8Array): Promise<PackedSession>;

  /** Convenience: pack + bytes in one call (`.msx` export pipeline). */
  exportPackedDatasets(
    datasets: MapshaperDataset[],
    opts?: { compact?: boolean },
  ): Promise<ExportedFile[]>;

  /** Plain-text export (GeoJSON / TopoJSON). */
  exportFileContent(
    dataset: MapshaperDataset,
    opts: { format: string },
  ): ExportedFile[];

  // -- Dataset cloning (used by dataset-replace ops) ---------------------

  /**
   * Deep copy of `dataset` — separate arc storage, separate per-layer shape
   * arrays. mapshaper's `_runDatasetCommand` snapshots this for undo before
   * letting the in-place clip / dissolve / buffer pipeline run.
   */
  copyDataset(dataset: MapshaperDataset): MapshaperDataset;

  // -- Command runner ----------------------------------------------------

  /**
   * Run a CLI-style command string starting with `-i` (import) and resolve
   * with the first default-target dataset. `inputFiles` is injected as the
   * import command's `input` option, matching the GUI import path.
   */
  runImport(cmd: string, inputFiles: RunnerInputFiles): Promise<MapshaperDataset>;

  /**
   * Run a CLI-style command (sans `-i`) against an existing dataset and
   * resolve with the resulting dataset. `inputFiles` is forwarded to every
   * parsed command's `options.input` so `-join FILE` / similar can resolve
   * relative names. Rejects if mapshaper produced no default target
   * (no-op command — see PR-21 / L1).
   */
  runOnDataset(
    cmd: string,
    dataset: MapshaperDataset,
    inputFiles?: RunnerInputFiles,
  ): Promise<MapshaperDataset>;

  /**
   * Variant of {@link runOnDataset} that accepts a pre-parsed
   * `ParsedCommand[]` and skips the CLI parser entirely. Op modules
   * use this so option values flow as typed JS (numbers / arrays /
   * booleans) rather than as tokens interpolated into a shell-like
   * grammar — eliminates the entire quoting / escaping concern.
   *
   * `inputFiles` is wired onto every command's `options.input` exactly
   * like the string variant, so `-join FILE` works the same way.
   */
  runOnDatasetParsed(
    commands: ParsedCommand[],
    dataset: MapshaperDataset,
    inputFiles?: RunnerInputFiles,
  ): Promise<MapshaperDataset>;
}

/**
 * Default adapter implementation that delegates straight to
 * `mapshaper.internal.*`. Held in a module-level singleton; tests can swap
 * via {@link setDefaultMapshaperAdapter}. Each method is one line so that
 * any future mapshaper rename lands here visibly.
 */
import mapshaper from 'mapshaper';

export class DefaultMapshaperAdapter implements MapshaperAdapter {
  snapVertices(
    vertexIds: number[],
    to: [number, number],
    arcs: ArcCollection,
  ): void {
    mapshaper.internal.snapVerticesToPoint(vertexIds, to, arcs);
  }

  insertVertex(
    arcs: ArcCollection,
    vertexIndex: number,
    point: [number, number],
  ): void {
    mapshaper.internal.insertVertex(arcs, vertexIndex, point);
  }

  deleteVertex(arcs: ArcCollection, vertexIndex: number): void {
    mapshaper.internal.deleteVertex(arcs, vertexIndex);
  }

  appendEmptyArc(arcs: ArcCollection): void {
    mapshaper.internal.appendEmptyArc(arcs);
  }

  appendVertex(arcs: ArcCollection, point: [number, number]): void {
    mapshaper.internal.appendVertex(arcs, point);
  }

  deleteLastArc(arcs: ArcCollection): void {
    mapshaper.internal.deleteLastArc(arcs);
  }

  findNearestVertices(
    point: [number, number],
    shape: number[][],
    arcs: ArcCollection,
  ): number[] {
    return mapshaper.internal.findNearestVertices(point, shape, arcs);
  }

  findArcIdFromVertexId(vertexId: number, ii: Int32Array | Uint32Array): number {
    return mapshaper.internal.findArcIdFromVertexId(vertexId, ii);
  }

  vertexIsArcEndpoint(idx: number, arcs: ArcCollection): boolean {
    return mapshaper.internal.vertexIsArcEndpoint(idx, arcs);
  }

  forEachSegmentInShape(
    shape: number[][],
    arcs: ArcCollection,
    cb: (i: number, j: number, xx: Float64Array, yy: Float64Array) => void,
  ): void {
    mapshaper.internal.forEachSegmentInShape(shape, arcs, cb);
  }

  findClosestPointOnSeg(
    px: number, py: number,
    ax: number, ay: number,
    bx: number, by: number,
    snapArg: number,
  ): [number, number] {
    return mapshaper.internal.findClosestPointOnSeg(px, py, ax, ay, bx, by, snapArg);
  }

  addIntersectionCuts(
    dataset: MapshaperDataset,
    opts?: { snap_interval?: number; no_snap?: boolean; rebuild_topology?: boolean },
  ): void {
    mapshaper.internal.addIntersectionCuts(dataset, opts);
  }

  findSegmentIntersections(
    arcs: ArcCollection,
    opts?: { tolerance?: number },
  ): SegmentIntersection[] {
    return mapshaper.internal.findSegmentIntersections(arcs, opts);
  }

  getIntersectionLayer(
    intersections: SegmentIntersection[],
    target: MapshaperLayer,
    arcs: ArcCollection,
  ): MapshaperLayer {
    return mapshaper.internal.getIntersectionLayer(intersections, target, arcs);
  }

  getAvgSegment(arcs: ArcCollection): number {
    return mapshaper.internal.getAvgSegment(arcs);
  }

  simplifyArcsFast(arcs: ArcCollection, segLength: number): ArcCollection {
    return mapshaper.internal.simplifyArcsFast(arcs, segLength);
  }

  distance2D(ax: number, ay: number, bx: number, by: number): number {
    return mapshaper.geom.distance2D(ax, ay, bx, by);
  }

  getPointToShapeInfo(
    x: number,
    y: number,
    shape: number[][],
    arcs: ArcCollection,
  ): PointToShapeInfo {
    return mapshaper.geom.getPointToShapeInfo(x, y, shape, arcs);
  }

  testPointInPolygon(
    x: number,
    y: number,
    shape: number[][],
    arcs: ArcCollection,
  ): boolean {
    return mapshaper.geom.testPointInPolygon(x, y, shape, arcs);
  }

  layerHasGeometry(layer: MapshaperLayer): boolean {
    return mapshaper.internal.layerHasGeometry(layer);
  }

  getLayerBounds(layer: MapshaperLayer, arcs?: ArcCollection): MapshaperBBox {
    // mapshaper returns null for empty layers; surface that via NaN-bounds
    // rather than mid-pipeline `null` so callers don't have to branch.
    const bb = mapshaper.internal.getLayerBounds(layer, arcs);
    if (!bb) return { xmin: NaN, ymin: NaN, xmax: NaN, ymax: NaN };
    return { xmin: bb.xmin, ymin: bb.ymin, xmax: bb.xmax, ymax: bb.ymax };
  }

  getDatasetBounds(dataset: MapshaperDataset): MapshaperBBox {
    const bb = mapshaper.internal.getDatasetBounds(dataset);
    return { xmin: bb.xmin, ymin: bb.ymin, xmax: bb.xmax, ymax: bb.ymax };
  }

  exportDatasetsToPack(
    datasets: MapshaperDataset[],
    opts?: { compact?: boolean },
  ): Promise<PackedSession> {
    return mapshaper.internal.exportDatasetsToPack(datasets, opts ?? {});
  }

  restoreSessionData(packed: PackedSession): Promise<{ datasets: MapshaperDataset[] }> {
    // mapshaper's `.d.ts` insists `datasets` is required on the input; our
    // public `PackedSession` keeps it optional so callers can spread `emap`
    // metadata onto a fresh object. Cast on the way down.
    return mapshaper.internal.restoreSessionData(packed as { [k: string]: unknown; datasets: unknown[] });
  }

  pack(obj: PackedSession): Uint8Array {
    return mapshaper.internal.pack(obj as { [k: string]: unknown; datasets: unknown[] });
  }

  unpackSessionData(bytes: Uint8Array): Promise<PackedSession> {
    return mapshaper.internal.unpackSessionData(bytes);
  }

  exportPackedDatasets(
    datasets: MapshaperDataset[],
    opts?: { compact?: boolean },
  ): Promise<ExportedFile[]> {
    // mapshaper's `.d.ts` requires the opts object; our public signature
    // keeps it optional. Default to `{}` so the exported shape stays
    // forgiving.
    return mapshaper.internal.exportPackedDatasets(datasets, opts ?? {});
  }

  exportFileContent(
    dataset: MapshaperDataset,
    opts: { format: string },
  ): ExportedFile[] {
    return mapshaper.internal.exportFileContent(dataset, opts);
  }

  copyDataset(dataset: MapshaperDataset): MapshaperDataset {
    return mapshaper.internal.copyDataset(dataset);
  }

  runImport(
    cmd: string,
    inputFiles: RunnerInputFiles,
  ): Promise<MapshaperDataset> {
    const commands = mapshaper.internal.parseCommands(cmd);
    if (commands.length > 0 && commands[0].name === 'i') {
      commands[0].options.input = inputFiles;
    }
    return new Promise<MapshaperDataset>((resolve, reject) => {
      mapshaper.internal.runParsedCommands(
        commands,
        new mapshaper.internal.Job(),
        (err: any, job: any) => {
          if (err) {
            reject(err);
            return;
          }
          const targets = job.catalog.getDefaultTargets();
          if (targets.length === 0) {
            reject(new Error('No layers found in dataset'));
            return;
          }
          resolve(targets[0].dataset);
        },
      );
    });
  }

  runOnDataset(
    cmd: string,
    dataset: MapshaperDataset,
    inputFiles?: RunnerInputFiles,
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
      mapshaper.internal.runParsedCommands(commands, job, (err: any, finished: any) => {
        if (err) {
          reject(err);
          return;
        }
        const targets = finished.catalog.getDefaultTargets();
        if (targets.length === 0) {
          // mapshaper completed without producing a default target — the
          // command was effectively a no-op (e.g. `-target NAME` alone).
          // The previous behaviour silently resolved with the input
          // dataset reference, which let no-op commands pollute history
          // with empty `DatasetReplaceCommand`s. Surface as an error so
          // `_runDatasetCommand` records `Err.mapshaper` instead.
          reject(new Error('mapshaper command completed but produced no default target'));
          return;
        }
        resolve(targets[0].dataset);
      });
    });
  }

  runOnDatasetParsed(
    commands: ParsedCommand[],
    dataset: MapshaperDataset,
    inputFiles?: RunnerInputFiles,
  ): Promise<MapshaperDataset> {
    return new Promise((resolve, reject) => {
      const job = new mapshaper.internal.Job();
      job.catalog.addDataset(dataset);
      if (inputFiles) {
        for (const c of commands) {
          if (c.options) (c.options as Record<string, unknown>).input = inputFiles;
        }
      }
      mapshaper.internal.runParsedCommands(commands as any[], job, (err: any, finished: any) => {
        if (err) {
          reject(err);
          return;
        }
        const targets = finished.catalog.getDefaultTargets();
        if (targets.length === 0) {
          reject(new Error('mapshaper command completed but produced no default target'));
          return;
        }
        resolve(targets[0].dataset);
      });
    });
  }
}

let _default: MapshaperAdapter | null = null;

/**
 * Process-wide singleton adapter. Constructed lazily on first access so
 * importing this module doesn't pay the mapshaper bundle cost up-front for
 * call sites that inject their own adapter explicitly.
 */
export function getDefaultMapshaperAdapter(): MapshaperAdapter {
  return _default ?? (_default = new DefaultMapshaperAdapter());
}

/**
 * Swap the process-wide adapter — tests use this to inject a mock that
 * records calls without invoking the real mapshaper bundle. Pass `null` to
 * reset to the lazy-default behaviour.
 */
export function setDefaultMapshaperAdapter(adapter: MapshaperAdapter | null): void {
  _default = adapter;
}
