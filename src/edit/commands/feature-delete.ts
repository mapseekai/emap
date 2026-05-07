import type { EditCommand } from '../edit-command';
import type { FeatureShape, MapshaperLayer } from '../../types/mapshaper-types';

export interface FeatureDeleteCommandOptions {
  /** The layer object that owns the feature. */
  layer: MapshaperLayer;
  /** Index of the feature within `layer.shapes`. Captured at construction. */
  featureId: number;
  /** Snapshot of the shape, taken before deletion. Restored by undo. */
  shape: FeatureShape | null;
  /**
   * Snapshot of the data record, taken before deletion. `null` when the
   * layer has no data table.
   */
  record: Record<string, unknown> | null;
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

  constructor(private readonly opts: FeatureDeleteCommandOptions) {}

  do(): void {
    const { layer, featureId } = this.opts;
    if (!layer.shapes) return;
    layer.shapes.splice(featureId, 1);
    const records = layer.data?.getRecords?.();
    records?.splice(featureId, 1);
  }

  undo(): void {
    const { layer, featureId, shape, record } = this.opts;
    if (!layer.shapes) layer.shapes = [];
    layer.shapes.splice(featureId, 0, shape);
    if (record !== null) {
      const records = layer.data?.getRecords?.();
      records?.splice(featureId, 0, record);
    }
  }
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
}

/**
 * Layer-scoped bulk delete. Splicing K features one at a time on a layer
 * with N shapes is O(K·N) — for a 1.5M-vertex topology with K in the
 * hundreds the main thread freezes for seconds. This command does it in
 * one O(N) compaction pass instead.
 *
 * `do()` rebuilds `layer.shapes` and compacts the data table's records
 * array IN PLACE so the table's reference stays valid. `undo()` walks the
 * snapshots in ascending id order and re-inserts via splice — fine because
 * undo is called once per delete batch, not per feature.
 *
 * Like {@link FeatureDeleteCommand}, no `DisplayArcs` refresh is issued;
 * deletion never changes the arc collection.
 */
export class BulkFeatureDeleteCommand implements EditCommand {
  readonly label: string;

  constructor(private readonly opts: BulkFeatureDeleteCommandOptions) {
    this.label = `Delete ${opts.snapshots.length} feature${opts.snapshots.length === 1 ? '' : 's'}`;
  }

  do(): void {
    const { layer, snapshots } = this.opts;
    if (!layer.shapes || snapshots.length === 0) return;

    const del = new Set<number>();
    for (const s of snapshots) del.add(s.id);

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
  }

  undo(): void {
    const { layer, snapshots } = this.opts;
    if (!layer.shapes) layer.shapes = [];
    const sorted = [...snapshots].sort((a, b) => a.id - b.id);
    const records = layer.data?.getRecords?.();
    for (const s of sorted) {
      layer.shapes.splice(s.id, 0, s.shape);
      if (records && s.record !== null) records.splice(s.id, 0, s.record);
    }
  }
}
