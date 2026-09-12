import type { EditCommand } from '../edit-command';
import type { FeatureShape, MapshaperLayer } from '../../types/mapshaper-types';
import type { TopologySource } from '../../source/source';
import type { FeatureRef } from '../../map/types';
import type { Selection, SelectionDiff, SelectionSnapshot } from '../../map/selection';
import { markShapeCountChanged, SelectionDiffTracker } from './_shared';

export interface FeatureDeleteCommandOptions {
  /** The layer object that owns the feature. */
  layer: MapshaperLayer;
  /** Index of the feature within `layer.shapes`. Captured at construction. */
  featureId: number;
  /** Snapshot of the shape, taken before deletion. Restored by undo. */
  shape: FeatureShape | null;
  /**
   * Snapshot of the data record, taken before deletion. `null` is a valid
   * table row and is also used when the layer has no data table.
   */
  record: Record<string, unknown> | null;
  /** Owning source; bumps revisions on do/undo. */
  source: TopologySource;
}

/**
 * Removes a single feature from a layer by splicing its shape and data
 * record. Mirrors mapshaper's `gui-drawing-utils.deleteFeature` /
 * `insertFeature` pair so undo restores the exact prior layout.
 *
 * Orphan arcs referenced by deleted path features are intentionally left in
 * the source's `ArcCollection` — that is mapshaper's convention. Undo
 * restores the shape, which references the arcs that are still there. To
 * reclaim space, run a future `clean` / `dissolve` op.
 *
 * No `DisplayArcs` refresh: deletion never changes the arc collection.
 * `DisplayArcs.getScaledArcs` self-heals if `arcs.size()` ever changes for
 * unrelated reasons (vertex add, addIntersectionCuts), so the only callers
 * that need to refresh are those that mutate arcs themselves.
 */
export class FeatureDeleteCommand implements EditCommand {
  readonly label = 'Delete feature';
  private readonly opts: FeatureDeleteCommandOptions;

  constructor(opts: FeatureDeleteCommandOptions) {
    this.opts = {
      ...opts,
      shape: cloneFeatureShape(opts.shape),
      record: opts.record ? { ...opts.record } : opts.record,
    };
  }

  do(): void {
    const { layer, featureId } = this.opts;
    if (!layer.shapes) return;
    layer.shapes.splice(featureId, 1);
    const records = layer.data?.getRecords?.();
    records?.splice(featureId, 1);
    markShapeCountChanged(this.opts.source);
  }

  undo(): void {
    const { layer, featureId, shape, record } = this.opts;
    if (!layer.shapes) layer.shapes = [];
    layer.shapes.splice(featureId, 0, shape);
    const records: Array<Record<string, unknown> | null> | undefined = layer.data?.getRecords?.();
    records?.splice(featureId, 0, record);
    markShapeCountChanged(this.opts.source);
  }
}

function cloneFeatureShape(shape: FeatureShape | null): FeatureShape | null {
  if (!shape) return shape;
  return shape.map((part) => (Array.isArray(part) ? part.slice() : part)) as FeatureShape;
}

export interface BulkFeatureDeleteCommandOptions {
  /** The layer being mutated. */
  layer: MapshaperLayer;
  /**
   * Snapshots of every feature being deleted. `id` is the index in the
   * layer's `shapes` array at the time the command was constructed; the
   * list need not be sorted but ids must be unique.
   */
  snapshots: Array<{
    id: number;
    shape: FeatureShape | null;
    record: Record<string, unknown> | null;
  }>;
  /** Owning source; bumps revisions on do/undo. */
  source: TopologySource;
}

/**
 * Layer-scoped bulk delete. Splicing K features one at a time on a layer
 * with N shapes is O(K·N) — for a 1.5M-vertex topology with K in the
 * hundreds the main thread freezes for seconds. This command does it in
 * one O(N) compaction pass instead.
 *
 * `do()` rebuilds `layer.shapes` and compacts the data table's records
 * array IN PLACE so the table's reference stays valid. `undo()` merges the
 * sorted snapshots back into the compacted arrays from the end in O(N + K).
 *
 * Like {@link FeatureDeleteCommand}, no `DisplayArcs` refresh is issued;
 * deletion never changes the arc collection.
 */
export class BulkFeatureDeleteCommand implements EditCommand {
  readonly label: string;
  private readonly sortedSnapshots: BulkFeatureDeleteCommandOptions['snapshots'];
  private readonly deletedIds: ReadonlySet<number>;

  constructor(private readonly opts: BulkFeatureDeleteCommandOptions) {
    this.label = `Delete ${opts.snapshots.length} feature${opts.snapshots.length === 1 ? '' : 's'}`;
    this.sortedSnapshots = [...opts.snapshots].sort((a, b) => a.id - b.id);
    const deletedIds = new Set<number>();
    for (const snapshot of this.sortedSnapshots) deletedIds.add(snapshot.id);
    this.deletedIds = deletedIds;
  }

  do(): void {
    const { layer, snapshots } = this.opts;
    if (!layer.shapes || snapshots.length === 0) return;

    const del = this.deletedIds;

    const oldShapes = layer.shapes;
    const newShapes: (FeatureShape | null)[] = new Array(oldShapes.length - del.size);
    let dst = 0;
    for (let i = 0; i < oldShapes.length; i++) {
      if (!del.has(i)) newShapes[dst++] = oldShapes[i];
    }
    layer.shapes = newShapes;

    const records = layer.data?.getRecords?.();
    if (records) {
      let rdst = 0;
      for (let i = 0; i < records.length; i++) {
        if (!del.has(i)) records[rdst++] = records[i];
      }
      records.length = rdst;
    }
    markShapeCountChanged(this.opts.source);
  }

  undo(): void {
    const { layer } = this.opts;
    const snapshots = this.sortedSnapshots;
    if (snapshots.length === 0) return;

    const shapes = layer.shapes ?? [];
    const compactedShapeCount = shapes.length;
    shapes.length = compactedShapeCount + snapshots.length;
    let shapeSource = compactedShapeCount - 1;
    let snapshotIndex = snapshots.length - 1;
    for (let dst = shapes.length - 1; dst >= 0; dst--) {
      const snapshot = snapshots[snapshotIndex];
      if (snapshot && snapshot.id === dst) {
        shapes[dst] = snapshot.shape;
        snapshotIndex--;
      } else {
        shapes[dst] = shapes[shapeSource--];
      }
    }
    layer.shapes = shapes;

    const records: Array<Record<string, unknown> | null> | undefined = layer.data?.getRecords?.();
    if (!records) {
      markShapeCountChanged(this.opts.source);
      return;
    }
    const compactedRecordCount = records.length;
    records.length = compactedRecordCount + snapshots.length;
    let recordSource = compactedRecordCount - 1;
    snapshotIndex = snapshots.length - 1;
    for (let dst = records.length - 1; dst >= 0; dst--) {
      const snapshot = snapshots[snapshotIndex];
      if (snapshot && snapshot.id === dst) {
        records[dst] = snapshot.record;
        snapshotIndex--;
      } else {
        records[dst] = records[recordSource--];
      }
    }
    markShapeCountChanged(this.opts.source);
  }
}

export interface FeatureDeleteWithSelectionCommandOptions extends FeatureDeleteCommandOptions {
  source: TopologySource;
  selection: Selection;
  beforeSelection: SelectionSnapshot;
  afterSelection: FeatureRef[];
  publishSelection: (diff: SelectionDiff) => void;
  label: string;
}

/**
 * Source-aware wrapper around {@link FeatureDeleteCommand} for op-driven
 * deletions (e.g. `deletePart` removing a feature's last part). Adds the
 * selection snapshot/remap and publish contract (`data` + one selection diff)
 * around the inner command. Cache invalidation / render / history events stay
 * with the runner.
 */
export class FeatureDeleteWithSelectionCommand implements EditCommand {
  readonly label: string;
  private readonly inner: FeatureDeleteCommand;
  private readonly _selectionTracker: SelectionDiffTracker;

  constructor(opts: FeatureDeleteWithSelectionCommandOptions) {
    this.inner = new FeatureDeleteCommand(opts);
    this.label = opts.label;
    this._selectionTracker = new SelectionDiffTracker(opts);
  }

  do(): void {
    this.inner.do();
    this._selectionTracker.applyAfter();
  }

  undo(): void {
    this.inner.undo();
    this._selectionTracker.restoreBefore();
  }

  publish(): void {
    this._selectionTracker.publish('edit');
  }
}
