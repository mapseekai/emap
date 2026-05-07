// Single contact surface for mapshaper's `internal.*` API.
//
// Why this exists: the codebase reaches into `mapshaper.internal.*` from 13
// production modules across 28 distinct symbols. Mapshaper has no stability
// promise on these — they are versioned along with the public CLI but the
// shapes shift between minor releases. Concentrating every call here lets a
// future mapshaper upgrade fail (or be forwarded to a shim) in exactly one
// file instead of thirteen.
//
// Phase 1 (this file) covers the topology-editing surface plus the command
// runner — the methods used by vertex / feature-create commands and by every
// dataset-replace pipeline. Subsequent phases (PR-11) will fold in the
// remaining `internal.*` callers (projection, display-arcs, snapshot
// pack/unpack, intersection layers, segment / endpoint helpers).
//
// Tests inject a mock adapter via the `adapter` option on each command and via
// {@link setDefaultMapshaperAdapter} for shared/global paths. Production code
// resolves a singleton via {@link getDefaultMapshaperAdapter} when no explicit
// adapter is supplied.

import type {
  ArcCollection,
  MapshaperDataset,
} from '../types/mapshaper-types';

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
   * relative names. Resolves with the original `dataset` reference if
   * mapshaper produced no default target (no-op command).
   */
  runOnDataset(
    cmd: string,
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
        if (targets.length > 0) {
          resolve(targets[0].dataset);
        } else {
          // mapshaper sometimes leaves the input dataset untouched if no
          // target applied — treat as success and return the original ref.
          resolve(dataset);
        }
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
