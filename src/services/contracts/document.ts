import type { EditHistory } from '../../edit/edit-history';
import type { TransactionInternal } from '../../edit/transaction';
import type { HighlightManager } from '../../map/highlight-manager';
import type { LayerRegistry } from '../../map/layer-registry';
import type { Selection } from '../../map/selection';
import type { MutableTopologySource } from '../../source/source';

/** Explicit service contract. Providers implement this boundary; consumers do not import implementations. */
export interface DocumentContract {
  /** @internal */
  _sources: globalThis.Map<string, MutableTopologySource>;
  /** @internal */
  _layersCache?: LayerRegistry;
  get layers(): LayerRegistry;
  /** @internal */
  _crsEstablished: boolean;
  /** @internal */
  _highlightManager: HighlightManager;
  /** @internal */
  _selection: Selection;
  /** @internal */
  _history: EditHistory;
  /** @internal */
  _activeTransaction: TransactionInternal | null;
  /** @internal */
  _removed: boolean;
  dispose(): void;
}
