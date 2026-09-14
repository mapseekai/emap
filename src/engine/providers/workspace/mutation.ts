import { deleteSelectedFeatures } from '../../map/delete-selected';
import type { CacheContract as WorkspaceCache } from '../../../runtime/services/contracts/cache';
import type { DocumentContract as WorkspaceDocument } from '../../../runtime/services/contracts/document';
import type { HistoryContract as HistoryServiceImpl } from '../../../runtime/services/contracts/history';
import type { SelectionContract as SelectionServiceImpl } from '../../../runtime/services/contracts/selection';
import type { RenderSignalsContract as RenderSignals } from '../../../runtime/services/contracts/signals';

interface Dependencies {
  cache: Pick<WorkspaceCache, '_invalidateShapeCachesForSources'>;
  document: Pick<WorkspaceDocument, '_history' | '_selection' | '_sources'>;
  history: Pick<HistoryServiceImpl, '_fireHistoryChange'>;
  selection: Pick<SelectionServiceImpl, '_fireSelectionChange'>;
  signals: RenderSignals;
}

/** mutation implementation, wired through explicit service dependencies. */
export class FeatureMutationService {
  public deleteSelected(): boolean {
    const refs = this.deps.document._selection.getAll();
    const deletion = deleteSelectedFeatures(refs, this.deps.document._sources);
    if (!deletion) return false;

    this.deps.document._history.push(deletion.command);
    this.deps.history._fireHistoryChange();

    // Invalidate caches keyed off `layer.shapes` for every touched source.
    this.deps.cache._invalidateShapeCachesForSources(deletion.sourceIds);

    // Clear the selection; the refs no longer exist.
    this.deps.selection._fireSelectionChange(this.deps.document._selection.clear());
    this.deps.signals.requestRender();

    return true;
  }

  constructor(private readonly deps: Dependencies) {}
}
