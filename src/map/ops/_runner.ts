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
import { getDefaultMapshaperAdapter, type ParsedCommand } from '../../adapter/mapshaper-adapter';
import { parseCommandHeads, shouldUseWorker, shouldUseWorkerForHeads } from '../worker-routing';

/**
 * What a dataset-replace op CHANGES about the dataset. Drives the
 * selection-preservation policy in `_applyDatasetReplace`:
 *
 *   - `shape-count`     — features added / removed / reordered. Selection
 *                         refs by feature id are stale; clear.
 *   - `topology-only`   — arc storage rebuilt (clean / snap / simplify /
 *                         rebuildTopology / mosaic). Feature ids may
 *                         shift; clear conservatively.
 *   - `attribute-only`  — only data-table fields changed (each / join /
 *                         rename-fields / filter-fields / sort / etc.).
 *                         Feature ids stay; preserve selection.
 *   - `crs-only`        — coords reprojected, ids unchanged. Preserve.
 *   - `unknown`         — no information — fall back to clearing for
 *                         safety. Treated identically to `shape-count`.
 */
export type OpEffect =
  | 'shape-count'
  | 'topology-only'
  | 'attribute-only'
  | 'crs-only'
  | 'unknown';

/**
 * Mapshaper command head → effect classification. Heads not in the table
 * get treated as `unknown` (= clear selection) by `inferEffect`.
 *
 * Categories:
 *   - shape-count: changes the number / order of features
 *   - topology-only: changes arcs but not feature count
 *   - attribute-only: changes only data-table fields
 *   - crs-only: changes coordinates only (reprojection)
 */
const COMMAND_EFFECTS: Readonly<Record<string, OpEffect>> = {
  // shape-count: change feature count / membership
  clip: 'shape-count',
  erase: 'shape-count',
  dissolve: 'shape-count',
  explode: 'shape-count',
  filter: 'shape-count',
  'merge-layers': 'shape-count',
  mosaic: 'shape-count',
  union: 'shape-count',
  divide: 'shape-count',
  points: 'shape-count',
  lines: 'shape-count',
  polygons: 'shape-count',
  innerlines: 'shape-count',
  // mapshaper's CLI is `-split` and parseCommands canonicalises to
  // `split`; the older entry `split-layer` was a dead key.
  split: 'shape-count',
  'split-layer': 'shape-count',
  uniq: 'shape-count',
  buffer: 'shape-count',
  drop: 'shape-count',
  'intersection-points': 'shape-count',
  // topology-only: rebuild arcs but feature ids stay
  clean: 'topology-only',
  snap: 'topology-only',
  simplify: 'topology-only',
  'rebuild-topology': 'topology-only',
  // attribute-only: only data-table fields change
  each: 'attribute-only',
  join: 'attribute-only',
  'rename-fields': 'attribute-only',
  'rename-layers': 'attribute-only',
  'filter-fields': 'attribute-only',
  'filter-slivers': 'attribute-only',
  sort: 'attribute-only',
  // crs-only: project + reproject
  proj: 'crs-only',
  project: 'crs-only',
};

/**
 * Infer the effect category of a CLI command. Considers every `-NAME`
 * head in the command string and returns the **strongest** effect (in
 * the order `shape-count` > `topology-only` > `crs-only` > `attribute-only`).
 * `target` (a no-op selector head) is ignored.
 */
export function inferEffect(cmd: string): OpEffect {
  return inferEffectForHeads(parseCommandHeads(cmd));
}

/**
 * Same as {@link inferEffect} but consuming a pre-extracted heads array.
 * Used by the parsed-command runner so we don't reconstruct then re-parse
 * a CLI string just to classify the effect.
 */
export function inferEffectForHeads(heads: string[]): OpEffect {
  let strongest: OpEffect = 'attribute-only';
  let sawAny = false;
  for (const head of heads) {
    if (head === 'target') continue;
    const effect = COMMAND_EFFECTS[head];
    if (effect === undefined) {
      return 'unknown';
    }
    sawAny = true;
    strongest = strongerEffect(strongest, effect);
  }
  return sawAny ? strongest : 'unknown';
}

const EFFECT_RANK: Readonly<Record<OpEffect, number>> = {
  'attribute-only': 0,
  'crs-only': 1,
  'topology-only': 2,
  'shape-count': 3,
  unknown: 3,
};
function strongerEffect(a: OpEffect, b: OpEffect): OpEffect {
  return EFFECT_RANK[a] >= EFFECT_RANK[b] ? a : b;
}

/** True iff this effect type invalidates a selection keyed by feature id. */
function effectInvalidatesSelection(effect: OpEffect): boolean {
  return effect === 'shape-count' || effect === 'topology-only' || effect === 'unknown';
}

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

  return _applyDatasetReplace(host, sourceId, before, after, label, inferEffect(cmd));
}

/**
 * PR-4b parsed-command path. Same dataset-replace pipeline as
 * {@link _runDatasetCommand} but consumes a pre-built `ParsedCommand[]`
 * instead of a CLI string. Eliminates the escape/re-parse round-trip
 * and the class of bugs that come with it.
 */
export async function _runDatasetCommandParsed(
  host: EmapHostInternal,
  sourceId: string,
  commands: ParsedCommand[],
  label: string,
  inputFiles?: Record<string, Uint8Array | string>,
): Promise<OpResult> {
  if (host._removed) return Err.hostRemoved();

  const source = host._sources.get(sourceId);
  if (!source) return Err.notFound('source', sourceId);
  const original = source.getDataset();
  if (!original) return Err.notFound('source', sourceId);

  const before: MapshaperDataset = getDefaultMapshaperAdapter().copyDataset(original);

  const heads = commands.map((c) => c.name);
  let useWorker = false;
  if (host._workerPool) {
    const vertexCount = original.arcs?.getPointCount?.() ?? 0;
    const defaultDecision = shouldUseWorkerForHeads(
      heads,
      vertexCount,
      host._workerMode,
      host._workerThreshold,
    );
    const routing = host._workerRouting;
    useWorker = routing
      ? routing({
        // The routing hook's `cmd` field is documented as a CLI string;
        // synthesize a debug-only summary from heads. Hooks that key on
        // exact options must use the `heads` field instead.
        cmd: heads.map((h) => `-${h}`).join(' '),
        heads,
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
      after = await _runViaWorkerParsed(host, original, commands, label, inputFiles);
    } else {
      after = await getDefaultMapshaperAdapter().runOnDatasetParsed(commands, original, inputFiles);
    }
  } catch (err) {
    if (host._removed) return Err.hostRemoved();
    host.fire('error', { error: err });
    return Err.mapshaper(err, { operation: label });
  }

  if (host._removed) return Err.hostRemoved();
  return _applyDatasetReplace(host, sourceId, before, after, label, inferEffectForHeads(heads));
}

async function _runViaWorkerParsed(
  host: EmapHostInternal,
  dataset: MapshaperDataset,
  commands: ParsedCommand[],
  label: string,
  inputFiles?: Record<string, Uint8Array | string>,
): Promise<MapshaperDataset> {
  if (!host._workerPool) {
    throw new Error('_runViaWorkerParsed: worker pool not available');
  }
  const id = host._workerPool.reserveId();
  const datasetVertexCount = dataset.arcs?.getPointCount?.() ?? 0;
  const startedAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  // Synthesize a heads-only debug string for `workerjobstart`'s `cmd`
  // field — listeners use it for telemetry, not parsing.
  const cmdSummary = commands.map((c) => `-${c.name}`).join(' ');
  host.fire('workerjobstart', { id, cmd: cmdSummary, label, datasetVertexCount });

  try {
    const packed = await getDefaultMapshaperAdapter().exportDatasetsToPack([dataset], { compact: false });
    const transferList = collectTransferables(packed);
    const promise = host._workerPool.dispatchWithId(id, commands, packed, inputFiles, transferList);
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
 * Stage C in isolation: swap the source dataset, push the
 * DatasetReplaceCommand (which flags prior commands stale), conditionally
 * clear selection (PR-10 — depends on `effect`), schedule a render. Used
 * directly by ops that produce an `after` dataset via mapshaper internal
 * primitives instead of the CLI runner — `intersectionPointsLayer`,
 * `rebuildTopology`.
 *
 * `effect` defaults to `'unknown'` (= clear selection) for safety. Ops
 * that know they only changed attributes / CRS should pass the more
 * specific value so the UI's selection survives the operation.
 */
export function _applyDatasetReplace(
  host: EmapHostInternal,
  sourceId: string,
  before: MapshaperDataset,
  after: MapshaperDataset,
  label: string,
  effect: OpEffect = 'unknown',
): OpResult {
  const source = host._sources.get(sourceId);
  if (!source) return Err.notFound('source', sourceId);
  // Transaction-aware: register the FIRST-touch snapshot for this source
  // so a later rollback can restore the dataset to the pre-transaction
  // state regardless of how many ops swap it. Subsequent ops within the
  // transaction overwrite the live dataset but the snapshot is unchanged.
  if (host._activeTransaction) {
    host._activeTransaction._captureFirstTouch(sourceId, before);
  }
  source.setDataset(after);
  // Push the dataset-replace; it self-flags every prior undoStack entry
  // as `stale` (its captured refs target the now-discarded dataset
  // object). UI can render a divider; the entries stay in the stack
  // for visibility, but `EditHistory.undo` skips them.
  host._history.push(new DatasetReplaceCommand({ source, before, after, label }));
  // During a transaction, the push above diverts into the capture buffer
  // — visible history state hasn't changed, so don't fire `historychange`
  // (would otherwise trip every after-commit validator on each inner
  // op, defeating the whole point of batching). The transaction's
  // commit / rollback fires `historychange` once for the whole batch.
  if (!host._history.isCapturing()) {
    host._fireHistoryChange();
  }
  if (effectInvalidatesSelection(effect)) {
    // Selection refs are by feature id and may now point at different
    // features. Clear conservatively. Even inside a transaction, inner
    // ops should see a clean selection so subsequent ops don't act on
    // stale ids; transaction rollback restores the pre-tx selection.
    host._fireSelectionChange(host._selection.clear());
  }
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
