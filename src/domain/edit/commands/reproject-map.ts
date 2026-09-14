import type { EditCommand } from '../edit-command';
import type { Bounds } from '../../geo/bounds';
import type { MutableTopologySource } from '../../source/source';
import type { MapshaperDataset } from '../../../shared/types/mapshaper-types';

export interface ReprojectedDataset {
  source: MutableTopologySource;
  before: MapshaperDataset;
  after: MapshaperDataset;
}

export interface ReprojectMapCommandOptions {
  replacements: ReadonlyArray<ReprojectedDataset>;
  before: { crs: string; extent: Bounds };
  after: { crs: string; extent: Bounds };
  applyViewState(state: { crs: string; extent: Bounds }): void;
  publishViewState(): void;
}

export class ReprojectMapCommand implements EditCommand {
  readonly label: string;
  readonly invalidatesPriorCommands = true;

  constructor(private readonly opts: ReprojectMapCommandOptions) {
    this.label = `Reproject to ${opts.after.crs}`;
  }

  do(): void {
    this.apply('after', this.opts.after);
  }

  undo(): void {
    this.apply('before', this.opts.before);
  }

  publish(): void {
    this.opts.publishViewState();
    for (const replacement of this.opts.replacements) {
      replacement.source.fire('data', { reason: 'reproject' });
    }
  }

  private apply(datasetKey: 'before' | 'after', state: { crs: string; extent: Bounds }): void {
    for (const replacement of this.opts.replacements) {
      replacement.source.setDataset(replacement[datasetKey], false);
    }
    this.opts.applyViewState({ crs: state.crs, extent: state.extent.clone() });
  }
}
