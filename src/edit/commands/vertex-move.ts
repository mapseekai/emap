import type { EditCommand } from '../edit-command';
import { bumpEditVersion, type ArcCollection } from '../../types/mapshaper-types';
import { asMutableTopologySource, type TopologySource } from '../../source/source';
import { getDefaultMapshaperAdapter, type MapshaperAdapter } from '../../adapter/mapshaper-adapter';

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
  /** Adapter override for tests; defaults to the process-wide singleton. */
  adapter?: MapshaperAdapter;
}

/** Time window (ms) during which two consecutive merges still coalesce. */
const MERGE_WINDOW_MS = 500;

/**
 * Reverse a vertex drag (including topologically shared vertices) by
 * re-running mapshaper's snapVertices with the captured `from` /
 * `to` coordinates. The function updates each affected arc's bounds
 * internally, so no extra bookkeeping is required.
 *
 * Mergeable: consecutive moves of the SAME topological node within
 * {@link MERGE_WINDOW_MS} collapse into one undo entry. The merged
 * command keeps the original `from` (the very first pre-drag snapshot)
 * and adopts the latest `to`, so a single undo reverses an entire
 * arrow-key nudge sequence.
 */
export class VertexMoveCommand implements EditCommand {
  readonly label = 'Move vertex';

  /**
   * Wall-clock at construction time; refreshed by `merge()`. Used by
   * `mergeable()` to bound coalescence to a short interactive window.
   */
  private _mergeAt = Date.now();

  constructor(private readonly opts: VertexMoveCommandOptions) {}

  do(): void {
    const adapter = this.opts.adapter ?? getDefaultMapshaperAdapter();
    adapter.snapVertices(this.opts.vertexIds, this.opts.to, this.opts.arcs);
    asMutableTopologySource(this.opts.source).markDisplayArcsDirty?.();
    bumpEditVersion(asMutableTopologySource(this.opts.source).getDataset?.());
  }

  undo(): void {
    const adapter = this.opts.adapter ?? getDefaultMapshaperAdapter();
    adapter.snapVertices(this.opts.vertexIds, this.opts.from, this.opts.arcs);
    asMutableTopologySource(this.opts.source).markDisplayArcsDirty?.();
    bumpEditVersion(asMutableTopologySource(this.opts.source).getDataset?.());
  }

  mergeable(prev: EditCommand): boolean {
    if (!(prev instanceof VertexMoveCommand)) return false;
    if (prev.opts.source !== this.opts.source) return false;
    if (Date.now() - prev._mergeAt > MERGE_WINDOW_MS) return false;
    const a = prev.opts.vertexIds;
    const b = this.opts.vertexIds;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  merge(next: EditCommand): void {
    if (!(next instanceof VertexMoveCommand)) return;
    // Keep our `from` (oldest pre-drag snapshot); adopt the newest `to`.
    // `do/undo` continue to work because they use the post-merge values:
    // undo snaps to the original `from`, do snaps to the updated `to`.
    this.opts.to = next.opts.to;
    this._mergeAt = Date.now();
  }
}
