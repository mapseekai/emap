import type { EditHistory } from '../../../domain/edit/edit-history';
import type { TransactionInternal } from '../../../domain/edit/transaction';
import type { HighlightManager } from '../../../engine/map/highlight-manager';
import type { LayerRegistry } from '../../../engine/map/layer-registry';
import type { Selection } from '../../../engine/map/selection';
import type { MutableTopologySource } from '../../../domain/source/source';

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
