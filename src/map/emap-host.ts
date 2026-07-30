// Internal host contract for feature managers (`MapshaperOps`,
// `EditSessions`, `AttributeOps`). The managers used to take `_emap: any`
// and reach into private fields by name; this interface declares exactly
// the surface they may touch, so future refactors of `Emap` can detect
// breakage at compile time instead of at runtime.
//
// Members keep their `_` prefix because they are emap-internal — public
// API consumers must not depend on this interface.

import type { TopologySource } from '../source/source';
import type { MapshaperWorkerPool } from '../core/mapshaper-worker-pool';
import type { EditHistory } from '../edit/edit-history';
import type { TransactionInternal } from '../edit/transaction-internal';
import type { Selection } from './selection';
import type { MapshaperLayer } from '../types/mapshaper-types';
import type { LayerRegistry } from './layer-registry';

/**
 * Sentinel returned by `_runDatasetCommand` callers when the host has
 * been removed mid-await. Managers interpret this as "drop the result on
 * the floor, do not mutate state, do not emit events".
 */
export const HOST_REMOVED = Symbol('emap-host-removed');

export interface EmapHostInternal {
  // ---- mutable lifecycle flags ---------------------------------------
  /** `true` once `Emap.remove()` has been called. Async ops MUST check
   *  this before applying results. */
  readonly _removed: boolean;

  // ---- shared state owned by Emap ------------------------------------
  readonly _sources: globalThis.Map<string, TopologySource>;
  readonly _history: EditHistory;
  readonly _selection: Selection;
  /**
   * Currently active {@link Transaction}, or `null`. Set by
   * `Transaction`'s constructor and cleared on commit / rollback. The
   * runner consults this in `_applyDatasetReplace` to record per-source
   * first-touch snapshots — kept on the host (rather than threaded
   * through `OpContext`) so existing op signatures don't have to learn
   * about transactions.
   */
  _activeTransaction: TransactionInternal | null;
  readonly _workerPool: MapshaperWorkerPool | null;
  readonly _workerMode: boolean | 'auto';
  readonly _workerThreshold: number;
  readonly _workerRouting?: import('./worker-routing').WorkerRoutingFn;

  // ---- shared services -----------------------------------------------
  /**
   * Single source of truth for `(sourceId, layerId) → MapshaperLayer`
   * resolution. Replaces the legacy `_resolveLayer` method on the host;
   * managers should prefer `host.layers.resolve(...)` going forward.
   */
  readonly layers: LayerRegistry;

  // ---- helpers managers call back into -------------------------------
  /**
   * @deprecated Use `host.layers.resolve(sourceId, layerId)` instead. Kept
   * as a thin shim for one release so in-flight refactors don't all need
   * to land at once.
   */
  _resolveLayer(sourceId: string, layerId: string): MapshaperLayer | null;
  _scheduleRender(): void;
  _fireHistoryChange(): void;
  _fireSelectionChange(diff: import('./selection').SelectionDiff): void;
  _invalidateShapeCachesForSources(sourceIds: Iterable<string>): void;
  _clearSpatialIndexesForSources(sourceIds: Iterable<string>): void;
  _allowExpressionEvaluation(values: Array<string | undefined>, operation: string): boolean;

  // ---- event surface (narrow overloads for events managers fire) -----
  fire(type: 'error', payload: { error: unknown }): void;
  fire(
    type: 'workerjobstart',
    payload: { id: number; cmd: string; label: string; datasetVertexCount: number },
  ): void;
  fire(
    type: 'workerjobend',
    payload: { id: number; ok: boolean; durationMs: number; errorMessage?: string },
  ): void;
}
