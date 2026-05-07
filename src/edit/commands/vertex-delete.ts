import type { EditCommand } from '../edit-command';
import { bumpEditVersion, type ArcCollection } from '../../types/mapshaper-types';
import type { TopologySource } from '../../source/source';
import {
  getDefaultMapshaperAdapter,
  type MapshaperAdapter,
} from '../../adapter/mapshaper-adapter';

export interface VertexDeleteCommandOptions {
  /** Global vertex index of the deleted vertex (recorded before deletion). */
  vertexIndex: number;
  /** Coordinate of the deleted vertex (recorded before deletion). */
  coords: [number, number];
  arcs: ArcCollection;
  source: TopologySource;
  /** Adapter override for tests; defaults to the process-wide singleton. */
  adapter?: MapshaperAdapter;
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
    const adapter = this.opts.adapter ?? getDefaultMapshaperAdapter();
    adapter.deleteVertex(this.opts.arcs, this.opts.vertexIndex);
    this.opts.source.markDisplayArcsDirty?.();
    bumpEditVersion(this.opts.source.getDataset?.());
  }

  undo(): void {
    const adapter = this.opts.adapter ?? getDefaultMapshaperAdapter();
    adapter.insertVertex(this.opts.arcs, this.opts.vertexIndex, this.opts.coords);
    this.opts.source.markDisplayArcsDirty?.();
    bumpEditVersion(this.opts.source.getDataset?.());
  }
}
