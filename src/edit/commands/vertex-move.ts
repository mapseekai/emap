import mapshaper from 'mapshaper';
import type { EditCommand } from '../edit-command';
import type { ArcCollection } from '../../types/mapshaper-types';
import type { TopologySource } from '../../source/source';

export interface VertexMoveCommandOptions {
  /**
   * IDs of every vertex at the moved topological node. mapshaper's
   * snapVerticesToPoint moves them all in lock-step, preserving topology.
   */
  vertexIds: number[];
  /** Original coordinate of the topological node before the drag. */
  from: [number, number];
  /** Final coordinate after the drag. */
  to: [number, number];
  arcs: ArcCollection;
  source: TopologySource;
}

/**
 * Reverse a vertex drag (including topologically shared vertices) by
 * re-running mapshaper's snapVerticesToPoint with the captured `from` /
 * `to` coordinates. The function updates each affected arc's bounds
 * internally, so no extra bookkeeping is required.
 */
export class VertexMoveCommand implements EditCommand {
  readonly label = 'Move vertex';

  constructor(private readonly opts: VertexMoveCommandOptions) {}

  do(): void {
    mapshaper.internal.snapVerticesToPoint(this.opts.vertexIds, this.opts.to, this.opts.arcs);
    this.opts.source.refreshDisplayArcs();
  }

  undo(): void {
    mapshaper.internal.snapVerticesToPoint(this.opts.vertexIds, this.opts.from, this.opts.arcs);
    this.opts.source.refreshDisplayArcs();
  }
}
