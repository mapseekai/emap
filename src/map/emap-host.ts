// Internal host contract for feature managers (`MapshaperOps`,
// `EditSessions`, `AttributeOps`). The managers used to take `_emap: any`
// and reach into private fields by name; this interface declares exactly
// the surface they may touch, so future refactors of `Emap` can detect
// breakage at compile time instead of at runtime.
//
// Members keep their `_` prefix because they are emap-internal — public
// API consumers must not depend on this interface.

import type { MutableTopologySource } from '../source/source';
import type { MapshaperWorkerPool } from '../core/mapshaper-worker-pool';
import type { EditHistory } from '../edit/edit-history';
import type { TransactionInternal } from '../edit/transaction-internal';
import type { Selection } from './selection';
import type { LayerRegistry } from './layer-registry';

export interface EmapHostInternal {
  // ---- mutable lifecycle flags ---------------------------------------
  /** `true` once `Emap.remove()` has been called. Async ops MUST check
   *  this before applying results. */
  readonly _removed: boolean;

  // ---- shared state owned by Emap ------------------------------------
  readonly _sources: globalThis.Map<string, MutableTopologySource>;
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

  _scheduleRender(): void;
  _fireHistoryChange(): void;
  _fireSelectionChange(diff: import('./selection').SelectionDiff): void;
  _invalidateShapeCachesForSources(sourceIds: Iterable<string>): void;
  _clearSpatialIndexesForSources(sourceIds: Iterable<string>): void;

  /**
   * Clear highlights pinned to a layer whose feature ids just shifted
   * (feature deletion). Optional so stub hosts in tests need not stub it;
   * managers must call it defensively (`?.`).
   */
  _clearHighlightsForLayer?(sourceId: string, layerKeys: readonly string[]): void;
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
