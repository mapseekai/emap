import mapshaper from 'mapshaper';
import type { EditCommand } from '../edit-command';
import type { ArcCollection } from '../../types/mapshaper-types';
import type { TopologySource } from '../../source/source';

export interface VertexDeleteCommandOptions {
  /** Global vertex index of the deleted vertex (recorded before deletion). */
  vertexIndex: number;
  /** Coordinate of the deleted vertex (recorded before deletion). */
  coords: [number, number];
  arcs: ArcCollection;
  source: TopologySource;
}

/**
 * Reverse a vertex deletion by re-inserting at the same global index. Pair
 * with `VertexInsertCommand`'s symmetry: this command's `do()` performs the
 * deletion (called only on redo), `undo()` restores the vertex.
 */
export class VertexDeleteCommand implements EditCommand {
  readonly label = 'Delete vertex';

  constructor(private readonly opts: VertexDeleteCommandOptions) {}

  do(): void {
    mapshaper.internal.deleteVertex(this.opts.arcs, this.opts.vertexIndex);
    this.opts.source.refreshDisplayArcs();
  }

  undo(): void {
    mapshaper.internal.insertVertex(this.opts.arcs, this.opts.vertexIndex, this.opts.coords);
    this.opts.source.refreshDisplayArcs();
  }
}
