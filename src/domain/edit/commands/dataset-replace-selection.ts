import type { EditCommand } from '../edit-command';
import type { MapshaperDataset } from '../../../shared/types/mapshaper-types';
import { asMutableTopologySource, type TopologySource } from '../../source/source';
import type { FeatureRef } from '../../../engine/map/types';
import type { Selection, SelectionDiff, SelectionSnapshot } from '../../../engine/map/selection';
import { SelectionDiffTracker } from './_shared';

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
  private readonly _selection: SelectionDiffTracker;

  constructor(private readonly opts: DatasetReplaceSelectionCommandOptions) {
    this.label = opts.label;
    this._selection = new SelectionDiffTracker(opts);
  }

  do(): void {
    asMutableTopologySource(this.opts.source).setDataset(this.opts.after, false);
    this._selection.applyAfter();
  }

  undo(): void {
    asMutableTopologySource(this.opts.source).setDataset(this.opts.before, false);
    this._selection.restoreBefore();
  }

  publish(): void {
    this._selection.publish('replace');
  }
}
