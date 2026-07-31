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
import type { MutableTopologySource } from '../../source/source';
import type { TransactionInternal } from '../../edit/transaction-internal';
import { Err, OK, type OpResult } from '../op-result';
import { getDefaultMapshaperAdapter, type ParsedCommand } from '../../adapter/mapshaper-adapter';
import { parseCommandHeads, shouldUseWorkerForHeads } from '../worker-routing';

/**
 * What a dataset-replace op CHANGES about the dataset. Drives the
 * selection-preservation policy in `_applyDatasetReplace`:
 *
 *   - `shape-count`     — features added / removed / reordered. Selection
 *                         refs by feature id are stale; clear.
 *   - `topology-only`   — arc storage rebuilt (clean / snap / simplify /
 *                         rebuildTopology / mosaic). Feature ids may
 *                         shift; clear conservatively.
 *   - `attribute-only`  — only data-table fields changed. Feature ids stay;
 *                         preserve selection.
 *   - `crs-only`        — coordinates changed, ids unchanged. Preserve.
 *   - `feature-order`   — features were reordered. Clear id-based selection.
 *   - `layer-identity`  — layer identifiers changed. Clear layer-based refs.
 *   - `unknown`         — no information; clear conservatively.
 */
export type OpEffect =
  | 'shape-count'
  | 'topology-only'
  | 'attribute-only'
  | 'crs-only'
  | 'feature-order'
  | 'layer-identity'
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
  'filter-geom': 'shape-count',
  'filter-islands': 'shape-count',
  'filter-slivers': 'shape-count',
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
  'rename-layers': 'layer-identity',
  'filter-fields': 'attribute-only',
  'data-fill': 'attribute-only',
  sort: 'feature-order',
  // crs-only: project + reproject + whole-layer affine (coords change,
  // shape / arc / feature ids unchanged)
  proj: 'crs-only',
  project: 'crs-only',
  affine: 'crs-only',
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
  'feature-order': 3,
  'layer-identity': 3,
  'shape-count': 3,
  unknown: 3,
};
function strongerEffect(a: OpEffect, b: OpEffect): OpEffect {
  return EFFECT_RANK[a] >= EFFECT_RANK[b] ? a : b;
}

function effectInvalidatesSelection(effect: OpEffect): boolean {
  return effect !== 'attribute-only' && effect !== 'crs-only';
}

type DatasetCommandRequest =
  | { kind: 'string'; cmd: string; heads: string[] }
  | { kind: 'parsed'; cmd: string; heads: string[]; commands: ParsedCommand[] };

const operationQueues = new WeakMap<EmapHostInternal, Map<string, Promise<void>>>();

function enqueueSourceOperation<T>(
  host: EmapHostInternal,
  sourceId: string,
  run: () => Promise<T>,
): Promise<T> {
  let queues = operationQueues.get(host);
  if (!queues) {
    queues = new Map();
    operationQueues.set(host, queues);
  }
  const previous = queues.get(sourceId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  queues.set(sourceId, gate);
  return previous
    .catch(() => undefined)
    .then(run)
    .finally(() => {
      release();
      if (queues?.get(sourceId) === gate) queues.delete(sourceId);
    });
}

export function _runDatasetCommand(
  host: EmapHostInternal,
  sourceId: string,
  cmd: string,
  label: string,
  inputFiles?: Record<string, Uint8Array | string>,
): Promise<OpResult> {
  return runDatasetCommand(
    host,
    sourceId,
    { kind: 'string', cmd, heads: parseCommandHeads(cmd) },
    label,
    inputFiles,
  );
}

export function _runDatasetCommandParsed(
  host: EmapHostInternal,
  sourceId: string,
  commands: ParsedCommand[],
  label: string,
  inputFiles?: Record<string, Uint8Array | string>,
): Promise<OpResult> {
  const heads = commands.map((command) => command.name);
  return runDatasetCommand(
    host,
    sourceId,
    { kind: 'parsed', commands, heads, cmd: heads.map((head) => `-${head}`).join(' ') },
    label,
    inputFiles,
  );
}

function runDatasetCommand(
  host: EmapHostInternal,
  sourceId: string,
  request: DatasetCommandRequest,
  label: string,
  inputFiles?: Record<string, Uint8Array | string>,
): Promise<OpResult> {
  const transaction = host._activeTransaction ?? null;
  const operation = enqueueSourceOperation(host, sourceId, () =>
    executeDatasetCommand(host, sourceId, request, label, inputFiles, transaction),
  );
  transaction?._trackOperation(operation);
  return operation;
}

async function executeDatasetCommand(
  host: EmapHostInternal,
  sourceId: string,
  request: DatasetCommandRequest,
  label: string,
  inputFiles: Record<string, Uint8Array | string> | undefined,
  transaction: TransactionInternal | null,
): Promise<OpResult> {
  if (host._removed) return Err.hostRemoved();
  const source = host._sources.get(sourceId);
  if (!source) return Err.notFound('source', sourceId);
  const original = source.getDataset();
  if (!original) return Err.notFound('source', sourceId);

  const originalEditVersion = original.editVersion ?? 0;
  let after: MapshaperDataset;
  try {
    const adapter = getDefaultMapshaperAdapter();
    const working = adapter.copyDataset(original);
    const vertexCount = working.arcs?.getPointCount?.() ?? 0;
    const defaultDecision = shouldUseWorkerForHeads(
      request.heads,
      vertexCount,
      host._workerMode,
      host._workerThreshold,
    );
    const useWorker =
      !!host._workerPool &&
      (host._workerRouting
        ? host._workerRouting({
            cmd: request.cmd,
            heads: request.heads,
            vertexCount,
            mode: host._workerMode,
            threshold: host._workerThreshold,
            defaultDecision,
          })
        : defaultDecision);

    if (useWorker) {
      after = await _runViaWorker(host, working, request, label, inputFiles);
    } else if (request.kind === 'string') {
      after = await adapter.runOnDataset(request.cmd, working, inputFiles);
    } else {
      after = await adapter.runOnDatasetParsed(request.commands, working, inputFiles);
    }
  } catch (err) {
    if (host._removed) return Err.hostRemoved();
    host.fire('error', { error: err });
    return Err.mapshaper(err, {
      ...(request.kind === 'string' ? { cmd: request.cmd } : {}),
      operation: label,
    });
  }

  if (host._removed) return Err.hostRemoved();
  if (
    host._sources.get(sourceId) !== source ||
    source.getDataset() !== original ||
    (original.editVersion ?? 0) !== originalEditVersion ||
    host._activeTransaction !== transaction ||
    (transaction !== null && !transaction.isOpen)
  ) {
    return Err.staleOperation(sourceId, label);
  }

  return commitDatasetReplace(
    host,
    sourceId,
    source,
    original,
    after,
    label,
    inferEffectForHeads(request.heads),
    transaction,
  );
}

export function _runDatasetTransform(
  host: EmapHostInternal,
  sourceId: string,
  label: string,
  effect: OpEffect,
  transform: (
    working: MapshaperDataset,
    original: MapshaperDataset,
  ) => OpResult | void | Promise<OpResult | void>,
): Promise<OpResult> {
  const transaction = host._activeTransaction ?? null;
  const operation = enqueueSourceOperation(host, sourceId, async () => {
    if (host._removed) return Err.hostRemoved();
    const source = host._sources.get(sourceId);
    if (!source) return Err.notFound('source', sourceId);
    const original = source.getDataset();
    if (!original) return Err.notFound('source', sourceId);
    const originalEditVersion = original.editVersion ?? 0;
    let working: MapshaperDataset;
    try {
      working = getDefaultMapshaperAdapter().copyDataset(original);
      const outcome = await transform(working, original);
      if (outcome) return outcome;
    } catch (err) {
      if (host._removed) return Err.hostRemoved();
      host.fire('error', { error: err });
      return Err.mapshaper(err, { operation: label });
    }

    if (host._removed) return Err.hostRemoved();
    if (
      host._sources.get(sourceId) !== source ||
      source.getDataset() !== original ||
      (original.editVersion ?? 0) !== originalEditVersion ||
      host._activeTransaction !== transaction ||
      (transaction !== null && !transaction.isOpen)
    ) {
      return Err.staleOperation(sourceId, label);
    }
    return commitDatasetReplace(
      host,
      sourceId,
      source,
      original,
      working,
      label,
      effect,
      transaction,
    );
  });
  transaction?._trackOperation(operation);
  return operation;
}

async function _runViaWorker(
  host: EmapHostInternal,
  dataset: MapshaperDataset,
  request: DatasetCommandRequest,
  label: string,
  inputFiles?: Record<string, Uint8Array | string>,
): Promise<MapshaperDataset> {
  if (!host._workerPool) {
    throw new Error('_runViaWorker: worker pool not available');
  }
  const id = host._workerPool.reserveId();
  const datasetVertexCount = dataset.arcs?.getPointCount?.() ?? 0;
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  host.fire('workerjobstart', { id, cmd: request.cmd, label, datasetVertexCount });

  try {
    const adapter = getDefaultMapshaperAdapter();
    const packed = await adapter.exportDatasetsToPack([dataset], { compact: false });
    const transferList = collectTransferables(packed);
    const command = request.kind === 'string' ? request.cmd : request.commands;
    const resultPacked = await host._workerPool.dispatchWithId(
      id,
      command,
      packed,
      inputFiles,
      transferList,
    );
    const restored = await adapter.restoreSessionData(resultPacked);
    if (!restored.datasets || restored.datasets.length === 0) {
      throw new Error('worker: no dataset in response');
    }
    const durationMs =
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
    host.fire('workerjobend', { id, ok: true, durationMs });
    return restored.datasets[0];
  } catch (err: unknown) {
    const durationMs =
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
    host.fire('workerjobend', {
      id,
      ok: false,
      durationMs,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

function reuseUnchangedDatasetState(
  before: MapshaperDataset,
  after: MapshaperDataset,
  effect: OpEffect,
): void {
  const layerCount = Math.min(before.layers.length, after.layers.length);
  if (effect === 'attribute-only') {
    after.arcs = before.arcs;
    for (let i = 0; i < layerCount; i++) {
      const beforeLayer = before.layers[i];
      const afterLayer = after.layers[i];
      if (beforeLayer.shapes?.length === afterLayer.shapes?.length) {
        afterLayer.shapes = beforeLayer.shapes;
      }
    }
    return;
  }
  if (effect !== 'topology-only' && effect !== 'crs-only') return;
  for (let i = 0; i < layerCount; i++) {
    const beforeLayer = before.layers[i];
    const afterLayer = after.layers[i];
    if (beforeLayer.name !== afterLayer.name || beforeLayer.id !== afterLayer.id) continue;
    const beforeRecords = beforeLayer.data?.getRecords?.();
    const afterRecords = afterLayer.data?.getRecords?.();
    if (beforeRecords?.length === afterRecords?.length) {
      afterLayer.data = beforeLayer.data;
    }
  }
}

function commitDatasetReplace(
  host: EmapHostInternal,
  sourceId: string,
  source: MutableTopologySource,
  before: MapshaperDataset,
  after: MapshaperDataset,
  label: string,
  effect: OpEffect,
  transaction: TransactionInternal | null,
): OpResult {
  reuseUnchangedDatasetState(before, after, effect);
  transaction?._captureFirstTouch(sourceId, before);
  source.setDataset(after, false);
  const command = new DatasetReplaceCommand({ source, before, after, label });
  host._history.push(command);
  const selectionDiff = effectInvalidatesSelection(effect) ? host._selection.clear() : null;
  host._invalidateShapeCachesForSources([sourceId]);
  host._scheduleRender();
  command.publish();
  if (!host._history.isCapturing()) host._fireHistoryChange();
  if (selectionDiff) host._fireSelectionChange(selectionDiff);
  return OK;
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
