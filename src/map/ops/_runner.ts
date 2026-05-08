// Shared runner used by every dataset-replace op (clip / dissolve / buffer
// / …). Extracted from `mapshaper-ops.ts` so per-op modules don't have to
// import the facade class.
//
// Three phases per call (`_runDatasetCommand`):
//   A. Pre-flight bail (host removed → host-removed error).
//   B. Decide worker vs main thread via `shouldUseWorker` + optional
//      caller-supplied `workerRouting` hook.
//   C. Apply: swap the source's dataset, push a `DatasetReplaceCommand`
//      (which marks every prior undo entry stale), clear selection,
//      schedule render.
//
// `_runViaWorker` packs / unpacks via the adapter and fires the
// `workerjobstart` / `workerjobend` events around the round-trip.
// Buffer transfer (PR-12) lives here too via `collectTransferables`.

import { DatasetReplaceCommand } from '../../edit/commands/dataset-replace';
import type { MapshaperDataset } from '../../types/mapshaper-types';
import type { EmapHostInternal } from '../emap-host';
import { Err, OK, type OpResult } from '../op-result';
import { getDefaultMapshaperAdapter } from '../../adapter/mapshaper-adapter';
import { parseCommandHeads, shouldUseWorker } from '../worker-routing';

export async function _runDatasetCommand(
  host: EmapHostInternal,
  sourceId: string,
  cmd: string,
  label: string,
  inputFiles?: Record<string, Uint8Array | string>,
): Promise<OpResult> {
  // Stage A: pre-flight bail. If the host is already torn down, skip
  // the entire command — there is no UI left to update.
  if (host._removed) return Err.hostRemoved();

  const source = host._sources.get(sourceId);
  if (!source) return Err.notFound('source', sourceId);
  const original = source.getDataset();
  if (!original) return Err.notFound('source', sourceId);

  // Deep snapshot for undo. mapshaper's clip / erase / dissolve mutate the
  // input dataset in place; without this snapshot there is nothing to
  // restore on undo.
  const before: MapshaperDataset = getDefaultMapshaperAdapter().copyDataset(original);

  // Routing: command-family aware (cheap commands stay on main thread,
  // expensive ones trip at half the threshold). Pure when no pool exists.
  let useWorker = false;
  if (host._workerPool) {
    const vertexCount = original.arcs?.getPointCount?.() ?? 0;
    const defaultDecision = shouldUseWorker(
      cmd,
      vertexCount,
      host._workerMode,
      host._workerThreshold,
    );
    const routing = host._workerRouting;
    useWorker = routing
      ? routing({
        cmd,
        heads: parseCommandHeads(cmd),
        vertexCount,
        mode: host._workerMode,
        threshold: host._workerThreshold,
        defaultDecision,
      })
      : defaultDecision;
  }

  let after: MapshaperDataset;
  try {
    if (useWorker) {
      after = await _runViaWorker(host, original, cmd, label, inputFiles);
    } else {
      after = await getDefaultMapshaperAdapter().runOnDataset(cmd, original, inputFiles);
    }
  } catch (err) {
    // Stage B: post-await error path. If the host is gone, swallow the
    // error silently — listeners are detached and surfacing it would
    // only confuse callers awaiting a clean shutdown.
    if (host._removed) return Err.hostRemoved();
    // Surface as a fire-and-forget error event; do not throw from a public
    // edit op so that one bad command doesn't tear down the calling page.
    host.fire('error', { error: err });
    return Err.mapshaper(err, { cmd, operation: label });
  }

  // Stage C: post-await success path. Drop the result on the floor if
  // the host was removed mid-await; mutating `_sources` / `_history`
  // now would either crash or resurrect freed state.
  if (host._removed) return Err.hostRemoved();

  return _applyDatasetReplace(host, sourceId, before, after, label);
}

/**
 * Stage C in isolation: swap the source dataset, push the
 * DatasetReplaceCommand (which flags prior commands stale), clear
 * selection, schedule a render. Used directly by ops that produce an
 * `after` dataset via mapshaper internal primitives instead of the CLI
 * runner — `intersectionPointsLayer`, `rebuildTopology`.
 */
export function _applyDatasetReplace(
  host: EmapHostInternal,
  sourceId: string,
  before: MapshaperDataset,
  after: MapshaperDataset,
  label: string,
): OpResult {
  const source = host._sources.get(sourceId);
  if (!source) return Err.notFound('source', sourceId);
  source.setDataset(after);
  // Push the dataset-replace; it self-flags every prior undoStack entry
  // as `stale` (its captured refs target the now-discarded dataset
  // object). UI can render a divider; the entries stay in the stack
  // for visibility, but `EditHistory.undo` skips them.
  host._history.push(new DatasetReplaceCommand({ source, before, after, label }));
  host._fireHistoryChange();
  // Selection refs are by feature id and may now point at different
  // features. Clear conservatively.
  host._fireSelectionChange(host._selection.clear());
  host._scheduleRender();
  return OK;
}

/**
 * Worker-thread variant of {@link _runDatasetCommand}: packs the dataset
 * via `exportDatasetsToPack({ compact: false })`, dispatches to the
 * pool, restores the result. Fires `workerjobstart` / `workerjobend`
 * events around the pool round-trip so UI code can show a spinner
 * without per-call wiring.
 */
async function _runViaWorker(
  host: EmapHostInternal,
  dataset: MapshaperDataset,
  cmd: string,
  label: string,
  inputFiles?: Record<string, Uint8Array | string>,
): Promise<MapshaperDataset> {
  if (!host._workerPool) {
    // Should never reach here — caller checks _workerPool. Defensive.
    throw new Error('_runViaWorker: worker pool not available');
  }
  // Fire workerjobstart BEFORE the synchronous pack work so a UI spinner
  // appears immediately. Pack on a 1M-vertex dataset takes ~500ms; firing
  // the event after pack delays UI feedback by exactly that amount.
  // Use the pool's id reservation so start/end events stay correlated.
  const id = host._workerPool.reserveId();
  const datasetVertexCount = dataset.arcs?.getPointCount?.() ?? 0;
  const startedAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  host.fire('workerjobstart', { id, cmd, label, datasetVertexCount });

  try {
    const packed = await getDefaultMapshaperAdapter().exportDatasetsToPack([dataset], { compact: false });
    // Collect every Uint8Array buffer in `packed` (mapshaper packs arc
    // storage as TypedArrays) and hand them to postMessage as
    // transferables. Net effect: structured-clone no longer copies
    // multi-MB arc buffers across the boundary; main-thread peak
    // memory drops from ~2× dataset to ~1×.
    const transferList = collectTransferables(packed);
    const promise = host._workerPool.dispatchWithId(id, cmd, packed, inputFiles, transferList);
    const resultPacked = await promise;
    const restored = await getDefaultMapshaperAdapter().restoreSessionData(resultPacked);
    if (!restored.datasets || restored.datasets.length === 0) {
      throw new Error('worker: no dataset in response');
    }
    const durationMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
    host.fire('workerjobend', { id, ok: true, durationMs });
    return restored.datasets[0];
  } catch (err: any) {
    const durationMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
    host.fire('workerjobend', {
      id,
      ok: false,
      durationMs,
      errorMessage: err?.message ?? String(err),
    });
    throw err;
  }
}

/**
 * Walk a `PackedSession` object and gather every `ArrayBuffer` referenced
 * by a `Uint8Array` field for postMessage transfer. Visits arrays and
 * plain-object children recursively; skips primitives and known-cycle
 * types (DataView, ArrayBuffer-on-shared-realm). De-dups by buffer
 * identity so the same backing store isn't transferred twice.
 *
 * Returns a fresh array; callers should NOT continue using the
 * Uint8Arrays after the transfer (their byteLength becomes 0 in the
 * source realm).
 */
function collectTransferables(root: unknown): Transferable[] {
  const out: Transferable[] = [];
  const seen = new Set<ArrayBuffer>();
  const visit = (val: unknown): void => {
    if (!val || typeof val !== 'object') return;
    if (val instanceof Uint8Array) {
      const buf = val.buffer;
      if (buf instanceof ArrayBuffer && !seen.has(buf)) {
        seen.add(buf);
        out.push(buf);
      }
      return;
    }
    if (val instanceof ArrayBuffer) {
      if (!seen.has(val)) {
        seen.add(val);
        out.push(val);
      }
      return;
    }
    if (Array.isArray(val)) {
      for (const item of val) visit(item);
      return;
    }
    for (const k of Object.keys(val)) {
      visit((val as Record<string, unknown>)[k]);
    }
  };
  visit(root);
  return out;
}
