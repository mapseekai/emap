import { EventDispatcher } from '../../core/events';
import { exportSnapshotFromSources, unpackSnapshot } from '../../map/snapshot';
import { type ExportSnapshotOptions, type LoadSnapshotOptions } from '../../map/types';
import type { SourceFactoryContract } from '../../services/source-factory';
import type { DocumentContract as WorkspaceDocument } from '../../services/contracts/document';
import type { SelectionContract as SelectionServiceImpl } from '../../services/contracts/selection';
import type { SourceContract as SourceServiceImpl } from '../../services/contracts/source';

interface Dependencies {
  sourceFactory: SourceFactoryContract;
  document: Pick<WorkspaceDocument, '_history' | '_selection' | '_sources'>;
  events: EventDispatcher;
  selection: Pick<SelectionServiceImpl, '_fireSelectionChange'>;
  source: Pick<SourceServiceImpl, 'addSource' | 'removeSource'>;
}

/** snapshot implementation, wired through explicit service dependencies. */
export class SnapshotServiceImpl {
  public async exportSnapshot(opts: ExportSnapshotOptions = {}): Promise<Blob> {
    return exportSnapshotFromSources(this.deps.document._sources, opts);
  }

  public async loadSnapshot(
    input: Blob | Uint8Array | ArrayBuffer,
    opts: LoadSnapshotOptions = {},
  ): Promise<string[]> {
    const replace = opts.replace !== false;
    const { datasets, resolvedIds } = await unpackSnapshot(input, opts);

    // Collision check before any side effects when replace=false
    if (!replace) {
      for (const id of resolvedIds) {
        if (this.deps.document._sources.has(id)) {
          throw new Error(
            `loadSnapshot: source "${id}" already exists (pass { replace: true } to overwrite)`,
          );
        }
      }
    }

    // History and selection no longer reference live features.
    this.deps.document._history.clear();
    this.deps.selection._fireSelectionChange(this.deps.document._selection.clear());
    this.deps.events.fire('historychange');

    const registered: string[] = [];
    for (let i = 0; i < datasets.length; i++) {
      const id = resolvedIds[i];
      if (replace && this.deps.document._sources.has(id)) this.deps.source.removeSource(id);
      const src = this.deps.sourceFactory.fromDataset(id, datasets[i]);
      await this.deps.source.addSource(id, src);
      registered.push(id);
    }
    return registered;
  }

  constructor(private readonly deps: Dependencies) {}
}
