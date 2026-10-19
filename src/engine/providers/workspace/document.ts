import { EditHistory } from '../../../domain/edit/edit-history';
import { type TransactionInternal } from '../../../domain/edit/transaction';
import { HighlightManager } from '../../map/highlight-manager';
import { LayerRegistry } from '../../map/layer-registry';
import { Selection } from '../../map/selection';
import { type MutableTopologySource } from '../../../domain/source/source';

/** document implementation, wired through explicit service dependencies. */
export class WorkspaceDocument {
  _sources: globalThis.Map<string, MutableTopologySource> = new globalThis.Map<
    string,
    MutableTopologySource
  >();

  _layersCache?: LayerRegistry;

  get layers(): LayerRegistry {
    return this._layersCache ?? (this._layersCache = new LayerRegistry(this._sources));
  }

  _crsEstablished = false;

  _highlightManager: HighlightManager = new HighlightManager();

  _selection: Selection = new Selection();

  _history: EditHistory = new EditHistory();

  _activeTransaction: TransactionInternal | null = null;

  _removed = false;

  dispose(): void {
    this._removed = true;
    this._sources.clear();
    this._highlightManager.clearHighlightedFeatures();
    this._selection.clear();
  }
}
