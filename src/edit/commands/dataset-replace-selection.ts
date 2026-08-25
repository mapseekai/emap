import type { EditCommand } from '../edit-command';
import type { MapshaperDataset } from '../../types/mapshaper-types';
import { asMutableTopologySource, type TopologySource } from '../../source/source';
import type { FeatureRef } from '../../map/types';
import type { Selection, SelectionDiff, SelectionSnapshot } from '../../map/selection';

export interface DatasetReplaceSelectionCommandOptions {
  source: TopologySource;
  before: MapshaperDataset;
  after: MapshaperDataset;
  label: string;
  selection: Selection;
  beforeSelection: SelectionSnapshot;
  afterSelection: FeatureRef[];
  publishSelection: (diff: SelectionDiff) => void;
}

export class DatasetReplaceSelectionCommand implements EditCommand {
  readonly invalidatesPriorCommands = true;
  readonly label: string;
  private pendingSelectionDiff: SelectionDiff | null = null;

  constructor(private readonly opts: DatasetReplaceSelectionCommandOptions) {
    this.label = opts.label;
  }

  do(): void {
    asMutableTopologySource(this.opts.source).setDataset(this.opts.after, false);
    this.pendingSelectionDiff = this.opts.selection.apply(this.opts.afterSelection, 'replace');
  }

  undo(): void {
    asMutableTopologySource(this.opts.source).setDataset(this.opts.before, false);
    this.pendingSelectionDiff = this.opts.selection.restore(this.opts.beforeSelection);
  }

  publish(): void {
    this.opts.source.fire?.('data', { reason: 'replace' });
    if (this.pendingSelectionDiff?.changed) this.opts.publishSelection(this.pendingSelectionDiff);
    this.pendingSelectionDiff = null;
  }
}
