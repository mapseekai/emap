import mapshaper from 'mapshaper';
import type { EditCommand } from '../edit-command';
import type { ArcCollection } from '../../types/mapshaper-types';
import type { TopologySource } from '../../source/source';

export interface VertexInsertCommandOptions {
  /** Global vertex index where the new vertex was inserted. */
  insertionId: number;
  /** Coordinate of the inserted vertex. */
  point: [number, number];
  arcs: ArcCollection;
  source: TopologySource;
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
    mapshaper.internal.insertVertex(this.opts.arcs, this.opts.insertionId, this.opts.point);
    this.opts.source.refreshDisplayArcs();
  }

  undo(): void {
    mapshaper.internal.deleteVertex(this.opts.arcs, this.opts.insertionId);
    this.opts.source.refreshDisplayArcs();
  }
}
