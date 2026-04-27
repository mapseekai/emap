import type { EditCommand } from '../edit-command';
import type { MapshaperLayer } from '../../types/mapshaper-types';
import type { TopologySource } from '../../source/source';

export interface FeatureDeleteCommandOptions {
  /** The layer object that owns the feature. */
  layer: MapshaperLayer;
  /** Index of the feature within `layer.shapes`. Captured at construction. */
  featureId: number;
  /** Snapshot of the shape, taken before deletion. Restored by undo. */
  shape: unknown;
  /**
   * Snapshot of the data record, taken before deletion. `null` when the
   * layer has no data table.
   */
  record: Record<string, unknown> | null;
  /** Source so the LOD copy can refresh after the splice. */
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
 */
export class FeatureDeleteCommand implements EditCommand {
  readonly label = 'Delete feature';

  constructor(private readonly opts: FeatureDeleteCommandOptions) {}

  do(): void {
    const { layer, featureId, source } = this.opts;
    if (!layer.shapes) return;
    layer.shapes.splice(featureId, 1);
    const records = layer.data?.getRecords?.();
    records?.splice(featureId, 1);
    source.refreshDisplayArcs();
  }

  undo(): void {
    const { layer, featureId, shape, record, source } = this.opts;
    if (!layer.shapes) layer.shapes = [];
    layer.shapes.splice(featureId, 0, shape as any);
    if (record !== null) {
      const records = layer.data?.getRecords?.();
      records?.splice(featureId, 0, record);
    }
    source.refreshDisplayArcs();
  }
}
