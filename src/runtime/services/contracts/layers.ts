import type { IconOptions } from '../../../engine/map/icon';
import type { LabelOptions } from '../../../engine/map/label';
import type { LayerChangeReason } from '../../../engine/core/event-map';
import type { FilterResolver } from '../../../engine/map/filter-resolver';
import type { LayerSpecification } from '../../../engine/map/layer';
import type { MutableLayerKeyIndex } from '../../../engine/map/structured-keys';
import type { StyleExpression } from '../../../engine/map/style-expression';
import type { StyleResolver } from '../../../engine/map/style-resolver';

/** Explicit service contract. Providers implement this boundary; consumers do not import implementations. */
export interface LayerContract {
  /** @internal */
  _layers: LayerSpecification[];
  /** @internal */
  _styleResolver: StyleResolver;
  /** @internal */
  _filterResolver: FilterResolver;
  /** @internal */
  _effectiveLayersCache: LayerSpecification[];
  /** @internal */
  _defaultLayersDirty: boolean;
  addLayer(layer: LayerSpecification, before?: string): void;
  removeLayer(id: string): void;
  getLayer(id: string): LayerSpecification | undefined;
  getLayers(): readonly LayerSpecification[];
  getRenderedLayers(): readonly LayerSpecification[];
  setLayerVisibility(id: string, visibility: 'visible' | 'none'): void;
  setPaintProperty(id: string, name: string, value: unknown): void;
  setLayerIcon(id: string, options: IconOptions | null): void;
  setLayerLabel(id: string, options: LabelOptions | null): void;
  setFilter(id: string, expression: StyleExpression | null): void;
  getFilter(id: string): StyleExpression | undefined;
  moveLayer(id: string, beforeId?: string): void;
  /** @internal */
  _fireLayerChange(
    reason: LayerChangeReason,
    layerId?: string,
    renderedLayers?: readonly LayerSpecification[],
  ): void;
  /** @internal */
  _getEffectiveLayers(): LayerSpecification[];
  /** @internal */
  _getVisibleLayerKeys(): MutableLayerKeyIndex;
  /** @internal */
  _featureMaskForPick: (sourceId: string, dataLayerId: string) => Uint8Array | null;
  /** @internal */
  _resolveRenderLayerTarget(renderLayerId: string): {
    sourceId: string;
    layerId: string;
  } | null;
  /** @internal */
  _filterMaskForRenderLayer(renderLayerId: string): Uint8Array | null;
}
