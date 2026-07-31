import type { EditCommand } from '../edit-command';
import { bumpEditVersion, type ArcCollection } from '../../types/mapshaper-types';
import { asMutableTopologySource, type TopologySource } from '../../source/source';
import { getDefaultMapshaperAdapter, type MapshaperAdapter } from '../../adapter/mapshaper-adapter';

export interface VertexInsertCommandOptions {
  /** Global vertex index where the new vertex was inserted. */
  insertionId: number;
  /** Coordinate of the inserted vertex. */
  point: [number, number];
  arcs: ArcCollection;
  source: TopologySource;
  /** Adapter override for tests; defaults to the process-wide singleton. */
  adapter?: MapshaperAdapter;
}

/**
 * Reverse a vertex insertion by deleting at the same global index.
 * mapshaper's deleteVertex shifts subsequent indices back into place via
 * updateVertexData, which also rebuilds arc bounds.
 */
export class VertexInsertCommand implements EditCommand {
  readonly label = 'Insert vertex';

  constructor(private readonly opts: VertexInsertCommandOptions) {}

  do(): void {
    const adapter = this.opts.adapter ?? getDefaultMapshaperAdapter();
    adapter.insertVertex(this.opts.arcs, this.opts.insertionId, this.opts.point);
    asMutableTopologySource(this.opts.source).markDisplayArcsDirty?.();
    bumpEditVersion(asMutableTopologySource(this.opts.source).getDataset?.());
  }

  undo(): void {
    const adapter = this.opts.adapter ?? getDefaultMapshaperAdapter();
    adapter.deleteVertex(this.opts.arcs, this.opts.insertionId);
    asMutableTopologySource(this.opts.source).markDisplayArcsDirty?.();
    bumpEditVersion(asMutableTopologySource(this.opts.source).getDataset?.());
  }
}
