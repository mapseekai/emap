import type { EditCommand } from '../edit-command';
import type { MapshaperDataset } from '../../types/mapshaper-types';
import { asMutableTopologySource, type TopologySource } from '../../source/source';

export interface DatasetReplaceCommandOptions {
  /** The source whose dataset is being swapped. */
  source: TopologySource;
  /** Snapshot of the dataset BEFORE the operation. Restored by undo. */
  before: MapshaperDataset;
  /** Reference to the dataset AFTER the operation. Restored by redo. */
  after: MapshaperDataset;
  /** Human-readable label, surfaced via `historychange`. */
  label: string;
}

/**
 * Reverse a whole-dataset operation (clip / erase / dissolve / future
 * polygon ops) by holding both the pre- and post-operation dataset
 * references and swapping which one is active on the `TopologySource`.
 *
 * The `before` reference must be a deep copy (typically produced by
 * `MapshaperAdapter.copyDataset`); the `after` reference is the dataset
 * mapshaper mutated in place. `setDataset` rebuilds DisplayArcs and fires
 * `'data'` so the map re-renders.
 *
 * Note: this command is a "history barrier" — earlier commands closed over
 * specific layer / arc references that point at the old dataset, and must
 * not be replayed across the swap. The `Emap` runner that produces this
 * command clears the history stack before pushing it.
 */
export class DatasetReplaceCommand implements EditCommand {
  readonly label: string;

  /**
   * Pushing a DatasetReplaceCommand marks every prior entry on the undo
   * stack as `stale`. Their captured dataset / arc references point at
   * the object this command swapped out, so undoing them post-swap would
   * write to the wrong place. See `EditCommand.stale` for the full
   * rationale.
   */
  readonly invalidatesPriorCommands = true;

  constructor(private readonly opts: DatasetReplaceCommandOptions) {
    this.label = opts.label;
  }

  do(): void {
    asMutableTopologySource(this.opts.source).setDataset(this.opts.after, false);
  }

  undo(): void {
    asMutableTopologySource(this.opts.source).setDataset(this.opts.before, false);
  }

  publish(): void {
    this.opts.source.fire?.('data', { reason: 'replace' });
  }
}
