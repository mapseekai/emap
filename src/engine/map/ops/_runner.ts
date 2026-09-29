import { workerDataByteBound } from '../../../integrations/mapshaper/binary';
// Shared runner used by every dataset-replace op (clip / dissolve / buffer
// / …). Extracted from `mapshaper-ops.ts` so per-op modules don't have to
// import the facade class.
//
// Three phases per call (`_runDatasetCommandParsed`):
//   A. Pre-flight bail (host removed → host-removed error).
//   B. Decide worker vs main thread via `shouldUseWorker` + optional
//      caller-supplied `workerRouting` hook.
//   C. Apply: swap the source's dataset, push a `DatasetReplaceCommand`
//      (which marks every prior undo entry stale), clear selection,
//      schedule render.
//
// `_runViaWorker` packs / unpacks via the adapter and fires the
// `workerjobstart` / `workerjobend` events around the round-trip.
// Worker input packing happens after tasklane admission.

import { CompositeCommand } from '../../../domain/edit/commands/composite';
import { DatasetReplaceCommand } from '../../../domain/edit/commands/dataset-replace';
import { DatasetReplaceSelectionCommand } from '../../../domain/edit/commands/dataset-replace-selection';
import type { EditCommand } from '../../../domain/edit/edit-command';
import type { MapshaperDataset } from '../../../shared/types/mapshaper-types';
import type { EmapHostInternal } from '../emap-host';
import type { MutableTopologySource } from '../../../domain/source/source';
import type { TransactionInternal } from '../../../domain/edit/transaction';
import { Err, OK, okValue, type OpResult } from '../op-result';
import {
  getDefaultMapshaperAdapter,
  resolveMapshaperCrsSignature,
  type PackedSession,
  type ParsedCommand,
} from '../../../integrations/mapshaper/adapter';
import { resolveProjectCrs } from '../../../domain/geo/crs-resolver';
import { shouldUseWorkerForHeads } from '../worker-routing';
import type {
  PrepareDatasetCommand,
  PreparedDatasetMutationResult,
  PreparedDirectEdit,
} from './_context';
import type { FeatureRef } from '../types';
import type { SelectionSnapshot } from '../selection';

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
  dissolve2: 'shape-count',
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
  split: 'shape-count',
  uniq: 'shape-count',
  buffer: 'shape-count',
  drop: 'shape-count',
  'intersection-points': 'shape-count',
  'split-selected': 'shape-count',
  'fill-ring': 'shape-count',
  'auto-complete-polygon': 'shape-count',
  // ↑ declared per AGENTS.md new-op rule; the prepared-edit runner path
  // (fillRing op) does not consult this table — selection is preserved by
  // the command itself (append at end, no feature-id shift).
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
  classify: 'attribute-only',
  sort: 'feature-order',
  // crs-only: project + reproject + whole-layer affine (coords change,
  // shape / arc / feature ids unchanged)
  proj: 'crs-only',
  project: 'crs-only',
  affine: 'crs-only',
};

/**
 * Infer the effect category from a pre-extracted heads array, so the
 * parsed-command runner doesn't reconstruct then re-parse a CLI string
 * just to classify the effect.
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

interface DatasetCommandRequest {
  cmd: string;
  heads: string[];
  commands: ParsedCommand[];
}

const operationQueues = new WeakMap<EmapHostInternal, Map<string, Promise<void>>>();

function uniqueSourceIds(sourceIds: readonly string[]): string[] {
  return [...new Set(sourceIds)];
}

/**
 * Serializes operations that touch a common source while allowing independent
 * source sets to proceed. Registering one shared gate for the whole set
 * before awaiting predecessors avoids lock-order deadlocks.
 */
export function enqueueMultiSourceOperation<T>(
  host: EmapHostInternal,
  sourceIds: readonly string[],
  run: () => Promise<T>,
): Promise<T> {
  const ids = uniqueSourceIds(sourceIds);
  if (ids.length === 0) return Promise.resolve().then(run);

  let queues = operationQueues.get(host);
  if (!queues) {
    queues = new Map();
    operationQueues.set(host, queues);
  }
  const sourceQueues = queues;
  const predecessors = ids.map((sourceId) => sourceQueues.get(sourceId) ?? Promise.resolve());
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  for (const sourceId of ids) sourceQueues.set(sourceId, gate);

  return Promise.all(predecessors.map((predecessor) => predecessor.catch(() => undefined)))
    .then(run)
    .finally(() => {
      release();
      for (const sourceId of ids) {
        if (sourceQueues.get(sourceId) === gate) sourceQueues.delete(sourceId);
      }
    });
}

function enqueueSourceOperation<T>(
  host: EmapHostInternal,
  sourceId: string,
  run: () => Promise<T>,
): Promise<T> {
  return enqueueMultiSourceOperation(host, [sourceId], run);
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
    { commands, heads, cmd: heads.map((head) => `-${head}`).join(' ') },
    label,
    inputFiles,
  );
}

export function _runPreparedDatasetCommandParsed(
  host: EmapHostInternal,
  sourceId: string,
  commands: ParsedCommand[],
  label: string,
  prepare: PrepareDatasetCommand,
  inputFiles?: Record<string, Uint8Array | string>,
): Promise<OpResult> {
  const heads = commands.map((command) => command.name);
  return runDatasetCommand(
    host,
    sourceId,
    { commands, heads, cmd: heads.map((head) => `-${head}`).join(' ') },
    label,
    inputFiles,
    prepare,
  );
}

export function _runPreparedDatasetMutation<T>(
  host: EmapHostInternal,
  sourceId: string,
  label: string | ((value: T) => string),
  mutate: (
    working: MapshaperDataset,
    original: MapshaperDataset,
  ) =>
    | PreparedDatasetMutationResult<T>
    | OpResult<T>
    | Promise<PreparedDatasetMutationResult<T> | OpResult<T>>,
): Promise<OpResult<T>> {
  const transaction = host._activeTransaction ?? null;
  const operation = enqueueSourceOperation(host, sourceId, async () => {
    if (host._removed) return Err.hostRemoved();
    const source = host._sources.get(sourceId);
    if (!source) return Err.notFound('source', sourceId);
    const original = source.getDataset();
    if (!original) return Err.notFound('source', sourceId);

    const originalEditVersion = original.editVersion ?? 0;
    const originalAttrVersion = original.attributeVersion ?? 0;
    let outcome: PreparedDatasetMutationResult<T> | OpResult<T>;
    try {
      const working = getDefaultMapshaperAdapter().copyDataset(original);
      outcome = await mutate(working, original);
      if ('ok' in outcome) return outcome;
      if (host._removed) return Err.hostRemoved();
      if (
        host._sources.get(sourceId) !== source ||
        source.getDataset() !== original ||
        (original.editVersion ?? 0) !== originalEditVersion ||
        (original.attributeVersion ?? 0) !== originalAttrVersion ||
        host._activeTransaction !== transaction ||
        (transaction !== null && !transaction.isOpen)
      ) {
        return Err.staleOperation(
          sourceId,
          typeof label === 'string' ? label : 'prepared dataset mutation',
        );
      }

      const beforeSelection = host._selection.snapshot();
      const resolvedLabel = typeof label === 'function' ? label(outcome.value) : label;
      commitDatasetReplaceSelection(
        host,
        sourceId,
        source,
        original,
        working,
        resolvedLabel,
        beforeSelection,
        outcome.selection,
        transaction,
      );
      return okValue(outcome.value);
    } catch (err) {
      if (host._removed) return Err.hostRemoved();
      host.fire('error', { error: err });
      return Err.mapshaper(err, {
        operation: typeof label === 'string' ? label : 'prepared dataset mutation',
      });
    }
  });
  transaction?._trackOperation(operation);
  return operation;
}

export function _runPreparedEditCommand<T>(
  host: EmapHostInternal,
  sourceId: string,
  label: string,
  plan: (
    dataset: MapshaperDataset,
    source: MutableTopologySource,
  ) => PreparedDirectEdit<T> | OpResult<T>,
): Promise<OpResult<T>> {
  const transaction = host._activeTransaction ?? null;
  const operation = enqueueSourceOperation(host, sourceId, async () => {
    if (host._removed) return Err.hostRemoved();
    const source = host._sources.get(sourceId);
    if (!source) return Err.notFound('source', sourceId);
    const dataset = source.getDataset();
    if (!dataset) return Err.notFound('source', sourceId);

    const plannedEditVersion = dataset.editVersion ?? 0;
    const plannedAttrVersion = dataset.attributeVersion ?? 0;
    let planned: PreparedDirectEdit<T> | OpResult<T>;
    try {
      planned = plan(dataset, source);
      if ('ok' in planned) return planned;
    } catch (err) {
      if (host._removed) return Err.hostRemoved();
      host.fire('error', { error: err });
      return Err.mapshaper(err, { operation: label });
    }

    if (host._removed) return Err.hostRemoved();
    if (
      host._sources.get(sourceId) !== source ||
      source.getDataset() !== dataset ||
      (dataset.editVersion ?? 0) !== plannedEditVersion ||
      (dataset.attributeVersion ?? 0) !== plannedAttrVersion ||
      host._activeTransaction !== transaction ||
      (transaction !== null && !transaction.isOpen)
    ) {
      return Err.staleOperation(sourceId, label);
    }

    // First-touch bookkeeping so Transaction.rollback can notify this source.
    // For direct edits the snapshot IS the live object (mutated in place) —
    // rollback correctness comes from reverse-order command undo, not the
    // snapshot. See transaction.ts rollback.
    transaction?._captureFirstTouch(sourceId, dataset);

    const { command } = planned;
    try {
      command.do();
    } catch (err) {
      // do() is designed to be failure-free after planning (all allocation
      // happens in the planner); if allocation still threw, best-effort undo
      // to avoid leaving a partial mutation.
      try {
        command.undo();
      } catch {
        // swallow — the original error is the meaningful one
      }
      if (host._removed) return Err.hostRemoved();
      host.fire('error', { error: err });
      return Err.mapshaper(err, { operation: label });
    }

    host._history.push(command);
    // publish() fires source 'data' → the map's data handler invalidates
    // shape caches, schedules render, and re-fires map-level 'data'. The
    // runner deliberately does NOT duplicate those side effects.
    (command as { publish?: () => void }).publish?.();
    if (!host._history.isCapturing()) host._fireHistoryChange();
    return okValue(planned.value);
  });
  transaction?._trackOperation(operation);
  return operation;
}

/**
 * A CompositeCommand that restores its all-or-nothing state when a child do
 * or undo fails. The inherited publish() still fans out to every child.
 */
class AtomicCompositeCommand extends CompositeCommand {
  constructor(
    private readonly atomicChildren: readonly EditCommand[],
    label: string,
  ) {
    super(atomicChildren, label);
  }

  override do(): void {
    let completed = 0;
    try {
      for (; completed < this.atomicChildren.length; completed += 1) {
        this.atomicChildren[completed]!.do();
      }
    } catch (error) {
      try {
        this.atomicChildren[completed]?.undo();
      } catch {
        // Keep unwinding already-completed children even if this child had
        // a partial effect and cannot restore itself.
      }
      for (let index = completed - 1; index >= 0; index -= 1) {
        try {
          this.atomicChildren[index]!.undo();
        } catch {
          // Best effort; retain the original command failure for reporting.
        }
      }
      throw error;
    }
  }

  override undo(): void {
    const undone: EditCommand[] = [];
    for (let index = this.atomicChildren.length - 1; index >= 0; index -= 1) {
      const child = this.atomicChildren[index]!;
      try {
        child.undo();
        undone.push(child);
      } catch (error) {
        for (let replayIndex = undone.length - 1; replayIndex >= 0; replayIndex -= 1) {
          try {
            undone[replayIndex]!.do();
          } catch {
            // The original undo failure is the meaningful error; each child
            // remains responsible for reversible, failure-safe do/undo.
          }
        }
        throw error;
      }
    }
  }
}

export function _runPreparedEditCommandMany<T>(
  host: EmapHostInternal,
  sourceIds: readonly string[],
  label: string | ((values: readonly T[]) => string),
  plan: (
    sourceId: string,
    dataset: MapshaperDataset,
    source: MutableTopologySource,
  ) => PreparedDirectEdit<T> | OpResult<T> | null,
): Promise<OpResult<T[]>> {
  const ids = uniqueSourceIds(sourceIds);
  const transaction = host._activeTransaction ?? null;
  const operation = enqueueMultiSourceOperation(host, ids, async () => {
    if (host._removed) return Err.hostRemoved();
    const targets: Array<{
      sourceId: string;
      source: MutableTopologySource;
      dataset: MapshaperDataset;
      editVersion: number;
      attributeVersion: number;
    }> = [];
    for (const sourceId of ids) {
      const source = host._sources.get(sourceId);
      if (!source) return Err.notFound('source', sourceId);
      const dataset = source.getDataset();
      if (!dataset) return Err.notFound('source', sourceId);
      targets.push({
        sourceId,
        source,
        dataset,
        editVersion: dataset.editVersion ?? 0,
        attributeVersion: dataset.attributeVersion ?? 0,
      });
    }

    const planned: Array<{
      edit: PreparedDirectEdit<T>;
      target: (typeof targets)[number];
    }> = [];
    let firstValidation: OpResult<T> | null = null;
    try {
      for (const target of targets) {
        const outcome = plan(target.sourceId, target.dataset, target.source);
        if (outcome === null) continue;
        if ('ok' in outcome) {
          if (outcome.ok) return okValue([outcome.value]);
          if (outcome.error.kind === 'validation') {
            firstValidation ??= outcome;
            continue;
          }
          return outcome;
        }
        planned.push({ edit: outcome, target });
      }
    } catch (error) {
      if (host._removed) return Err.hostRemoved();
      host.fire('error', { error });
      return Err.mapshaper(error, {
        operation: typeof label === 'string' ? label : 'prepared multi-source edit',
      });
    }

    if (planned.length === 0) {
      return firstValidation ?? Err.validation('operation', 'did not prepare any edit');
    }
    if (host._removed) return Err.hostRemoved();
    for (const target of targets) {
      if (
        host._sources.get(target.sourceId) !== target.source ||
        target.source.getDataset() !== target.dataset ||
        (target.dataset.editVersion ?? 0) !== target.editVersion ||
        (target.dataset.attributeVersion ?? 0) !== target.attributeVersion ||
        host._activeTransaction !== transaction ||
        (transaction !== null && !transaction.isOpen)
      ) {
        return Err.staleOperation(
          target.sourceId,
          typeof label === 'string' ? label : 'prepared multi-source edit',
        );
      }
    }

    const targetsById = new Map(targets.map((target) => [target.sourceId, target]));
    const affectedSourceIds = uniqueSourceIds(
      planned.flatMap(({ edit }) => edit.affectedSourceIds),
    );
    const affectedTargets = affectedSourceIds.map((sourceId) => targetsById.get(sourceId));
    if (affectedTargets.some((target) => target === undefined)) {
      return Err.validation('source', 'command affects a source that was not locked');
    }

    for (const target of affectedTargets) {
      transaction?._captureFirstTouch(target!.sourceId, target!.dataset);
    }
    const values = planned.map(({ edit }) => edit.value);
    const command = new AtomicCompositeCommand(
      planned.map(({ edit }) => edit.command),
      typeof label === 'string' ? label : label(values),
    );
    try {
      command.do();
    } catch (error) {
      if (host._removed) return Err.hostRemoved();
      host.fire('error', { error });
      return Err.mapshaper(error, {
        operation: typeof label === 'string' ? label : 'prepared multi-source edit',
      });
    }

    host._history.push(command);
    command.publish();
    if (!host._history.isCapturing()) host._fireHistoryChange();
    return okValue(values);
  });
  transaction?._trackOperation(operation);
  return operation;
}

function runDatasetCommand(
  host: EmapHostInternal,
  sourceId: string,
  request: DatasetCommandRequest,
  label: string,
  inputFiles?: Record<string, Uint8Array | string>,
  prepare?: PrepareDatasetCommand,
): Promise<OpResult> {
  return runDatasetMutation(
    host,
    sourceId,
    label,
    () => inferEffectForHeads(request.heads),
    async (working, original) => {
      prepare?.(working, original);
      const adapter = getDefaultMapshaperAdapter();
      const vertexCount = working.arcs?.getPointCount?.() ?? 0;
      const recordCount = working.layers.reduce(
        (n, l) => n + (l.data?.getRecords?.()?.length ?? 0),
        0,
      );
      const defaultDecision = shouldUseWorkerForHeads(
        request.heads,
        vertexCount,
        host._workerMode,
        host._workerThreshold,
        recordCount,
      );
      const useWorker =
        !!host._workerPool &&
        (host._workerRouting
          ? host._workerRouting({
              cmd: request.cmd,
              heads: request.heads,
              vertexCount,
              recordCount,
              mode: host._workerMode,
              threshold: host._workerThreshold,
              defaultDecision,
            })
          : defaultDecision);

      if (useWorker) {
        return _runViaWorker(host, working, request, label, inputFiles);
      }
      return adapter.runOnDatasetParsed(request.commands, working, inputFiles);
    },
  );
}

function runDatasetMutation(
  host: EmapHostInternal,
  sourceId: string,
  label: string,
  effect: OpEffect | (() => OpEffect),
  run: (
    working: MapshaperDataset,
    original: MapshaperDataset,
  ) => MapshaperDataset | OpResult | void | Promise<MapshaperDataset | OpResult | void>,
): Promise<OpResult> {
  const transaction = host._activeTransaction ?? null;
  const operation = enqueueSourceOperation(host, sourceId, async () => {
    if (host._removed) return Err.hostRemoved();
    const source = host._sources.get(sourceId);
    if (!source) return Err.notFound('source', sourceId);
    const original = source.getDataset();
    if (!original) return Err.notFound('source', sourceId);

    const originalEditVersion = original.editVersion ?? 0;
    const originalAttrVersion = original.attributeVersion ?? 0;
    let after: MapshaperDataset;
    try {
      const working = getDefaultMapshaperAdapter().copyDataset(original);
      const outcome = await run(working, original);
      if (outcome && 'ok' in outcome) return outcome;
      after = outcome ?? working;
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
      (original.attributeVersion ?? 0) !== originalAttrVersion ||
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
      typeof effect === 'function' ? effect() : effect,
      transaction,
    );
  });
  transaction?._trackOperation(operation);
  return operation;
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
  return runDatasetMutation(host, sourceId, label, effect, transform);
}

// mapshaper treats a packed dataset's `info.crs_string` as a parsable CRS
// definition (importInfo → parseCrsString) and expands bare `EPSG:NNNN`
// labels to `+init=epsg:NNNN`, which is a fatal init-file lookup in the
// browser bundle (mproj's disk fallback is patched out). emap stamps such
// canonical EPSG labels as metadata (crs-resolver), so the worker
// round-trip swaps them for an equivalent parseable Proj.4 defn on the
// wire; `_runViaWorker` re-stamps the original label on the result.
const MAPSHAPER_INIT_STRING_RE = /^(esri|epsg|nad83|nad27):\d+$/i;

/**
 * Replace an init-style `crs_string` in a freshly packed session with a
 * parseable Proj.4 definition. Returns the original label so the caller
 * can restore it after the round-trip, or `undefined` when nothing was
 * swapped. Unresolvable labels are left untouched (the worker then fails
 * exactly as the main thread would).
 */
async function sanitizePackedSessionCrs(packed: PackedSession): Promise<string | undefined> {
  const info = (packed.datasets?.[0] as { info?: { crs_string?: unknown } } | undefined)?.info;
  const label = typeof info?.crs_string === 'string' ? info.crs_string : undefined;
  if (!info || !label || !MAPSHAPER_INIT_STRING_RE.test(label)) return undefined;
  try {
    info.crs_string = resolveMapshaperCrsSignature(await resolveProjectCrs(label));
  } catch {
    return undefined;
  }
  return label;
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
    const inputByteLimit = workerDataByteBound({
      commands: request.commands,
      inputFiles,
      datasets: [
        {
          info: { ...dataset.info, crs: undefined },
          arcs: dataset.arcs?.getVertexData?.(),
          layers: dataset.layers.map((layer) => ({
            name: layer.name,
            geometry_type: layer.geometry_type,
            shapes: layer.shapes,
            records: layer.data?.getRecords?.(),
            fields: layer.fields,
          })),
        },
      ],
    });
    let crsLabel: string | undefined;
    const resultPacked = await host._workerPool.dispatchPreparedWithId(
      id,
      request.commands,
      async () => {
        const packed = await adapter.exportDatasetsToPack([dataset], { compact: false });
        crsLabel = await sanitizePackedSessionCrs(packed);
        return packed;
      },
      inputFiles,
      inputByteLimit,
    );
    const restored = await adapter.restoreSessionData(resultPacked);
    if (!restored.datasets || restored.datasets.length === 0) {
      throw new Error('worker: no dataset in response');
    }
    // Re-stamp emap's canonical CRS label when the command could not have
    // changed the CRS (projCmd re-stamps crs_string itself for crs-changing
    // commands, using the already browser-safe -proj target string).
    const effect = inferEffectForHeads(request.heads);
    if (crsLabel !== undefined && effect !== 'crs-only' && effect !== 'unknown') {
      const info = (restored.datasets[0].info ??= {});
      info.crs_string = crsLabel;
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
  if (effectInvalidatesSelection(effect)) {
    commitDatasetReplaceSelection(
      host,
      sourceId,
      source,
      before,
      after,
      label,
      host._selection.snapshot(),
      [],
      transaction,
    );
    return OK;
  }
  transaction?._captureFirstTouch(sourceId, before);
  if (before.editVersion !== undefined) after.editVersion = before.editVersion;
  if (before.attributeVersion !== undefined) after.attributeVersion = before.attributeVersion;
  source.setDataset(after, false);
  const command = new DatasetReplaceCommand({ source, before, after, label });
  host._history.push(command);
  host._invalidateShapeCachesForSources([sourceId]);
  host._scheduleRender();
  command.publish();
  if (!host._history.isCapturing()) host._fireHistoryChange();
  return OK;
}

function commitDatasetReplaceSelection(
  host: EmapHostInternal,
  sourceId: string,
  source: MutableTopologySource,
  before: MapshaperDataset,
  after: MapshaperDataset,
  label: string,
  beforeSelection: SelectionSnapshot,
  afterSelection: FeatureRef[],
  transaction: TransactionInternal | null,
): void {
  transaction?._captureFirstTouch(sourceId, before);
  if (before.editVersion !== undefined) after.editVersion = before.editVersion;
  if (before.attributeVersion !== undefined) after.attributeVersion = before.attributeVersion;
  const command = new DatasetReplaceSelectionCommand({
    source,
    before,
    after,
    label,
    selection: host._selection,
    beforeSelection,
    afterSelection,
    publishSelection: (diff) => host._fireSelectionChange(diff),
  });
  command.do();
  host._history.push(command);
  host._invalidateShapeCachesForSources([sourceId]);
  host._scheduleRender();
  command.publish();
  if (!host._history.isCapturing()) host._fireHistoryChange();
}
