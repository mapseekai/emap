import type { SelectionDiff, SelectMode } from '../../map/selection';
import type { FeatureRef, HighlightStyle, QueriedFeature } from '../../map/types';

/** Explicit service contract. Providers implement this boundary; consumers do not import implementations. */
export interface SelectionContract {
  setHighlightedFeatures(
    features: Array<QueriedFeature | FeatureRef>,
    style?: HighlightStyle,
  ): void;
  clearHighlightedFeatures(): void;
  setHighlightStyle(style: HighlightStyle): void;
  select(
    features: ReadonlyArray<FeatureRef>,
    options?: {
      mode?: SelectMode;
    },
  ): void;
  deselect(features: ReadonlyArray<FeatureRef>): void;
  clearSelection(): void;
  getSelection(): FeatureRef[];
  isSelected(feature: FeatureRef): boolean;
  /** @internal */
  _fireSelectionChange(diff: SelectionDiff): void;
  /** @internal */
  _clearHighlightsForLayer(sourceId: string, layerKeys: readonly string[]): void;
}
