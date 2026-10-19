import { FeatureAccessor } from '../../map/feature-accessor';
import type { PointLodPick } from '../../map/feature-query';
import {
  getLayerValue,
  setLayerValue,
  type MutableLayerValueIndex,
} from '../../map/structured-keys';
import { type QueriedFeature, type QueryFeaturesOptions } from '../../map/types';
import { getLayerId } from '../../../domain/source/layer-utils';
import type { MapshaperLayer } from '../../../shared/types/mapshaper-types';
import type { CacheContract as WorkspaceCache } from '../../../runtime/services/contracts/cache';
import type { DocumentContract as WorkspaceDocument } from '../../../runtime/services/contracts/document';
import type { LayerContract as LayerServiceImpl } from '../../../runtime/services/contracts/layers';
import type { SelectionContract as SelectionServiceImpl } from '../../../runtime/services/contracts/selection';

interface Dependencies {
  cache: Pick<WorkspaceCache, '_featureQuery'>;
  document: Pick<WorkspaceDocument, '_selection' | '_sources' | 'layers'>;
  layers: Pick<
    LayerServiceImpl,
    | '_featureMaskForPick'
    | '_filterMaskForRenderLayer'
    | '_getEffectiveLayers'
    | '_getVisibleLayerKeys'
    | '_resolveRenderLayerTarget'
  >;
  selection: Pick<SelectionServiceImpl, 'isSelected'>;
}

/** query implementation, wired through explicit service dependencies. */
export class QueryServiceImpl {
  public features!: FeatureAccessor;

  _isHoveringSelectedAt(point: { x: number; y: number }): boolean {
    if (this.deps.document._selection.size === 0) return false;
    return this.queryFeatures([point.x, point.y]).some((feature) =>
      this.deps.selection.isSelected(feature),
    );
  }

  _pointLodForPick(
    sourceId: string,
    layer: MapshaperLayer,
    bounds: readonly number[],
  ): PointLodPick | null {
    return this._lodProvider?.(sourceId, layer, bounds) ?? null;
  }

  public queryFeatures(
    geometryOrOptions?:
      | [number, number]
      | [[number, number], [number, number]]
      | QueryFeaturesOptions,
    options?: QueryFeaturesOptions,
  ): QueriedFeature[] {
    const visibleKeys = this.deps.layers._getVisibleLayerKeys();
    this.deps.cache._featureQuery.setPointLodProvider?.((sourceId, layer, bounds) =>
      this._pointLodForPick(sourceId, layer, bounds),
    );
    const results = this.deps.cache._featureQuery.query(geometryOrOptions, options, visibleKeys);
    const renderRanks: MutableLayerValueIndex<number> = new globalThis.Map<
      string,
      Map<string, number>
    >();
    const effectiveLayers = this.deps.layers._getEffectiveLayers();
    for (let rank = 0; rank < effectiveLayers.length; rank++) {
      const styleLayer = effectiveLayers[rank];
      if (styleLayer.layout?.visibility === 'none') continue;
      const source = this.deps.document._sources.get(styleLayer.source);
      if (!source) continue;
      const sourceLayer = styleLayer['source-layer']
        ? this.deps.document.layers.resolve(styleLayer.source, styleLayer['source-layer'])
        : source.getLayers()[0];
      if (!sourceLayer) continue;
      const sourceLayerIndex = source.getLayers().indexOf(sourceLayer);
      if (sourceLayerIndex === -1) continue;
      const layerId = getLayerId(sourceLayer, sourceLayerIndex);
      setLayerValue(renderRanks, styleLayer.source, layerId, rank);
    }
    results.sort(
      (a, b) =>
        (getLayerValue(renderRanks, b.source, b.layer) ?? -1) -
        (getLayerValue(renderRanks, a.source, a.layer) ?? -1),
    );
    return results;
  }

  _lodProvider:
    | ((sourceId: string, layer: MapshaperLayer, bounds: readonly number[]) => PointLodPick | null)
    | null = null;
  setPointLodProvider(provider: NonNullable<QueryServiceImpl['_lodProvider']>): () => void {
    if (this._lodProvider) throw new Error('A point LOD provider is already registered');
    this._lodProvider = provider;
    return () => {
      if (this._lodProvider === provider) this._lodProvider = null;
    };
  }
  dispose(): void {
    this._lodProvider = null;
  }

  constructor(private readonly deps: Dependencies) {
    this.features = new FeatureAccessor({
      layers: this.deps.document.layers,
      _resolveRenderLayerTarget: (id) => this.deps.layers._resolveRenderLayerTarget(id),
      _filterMaskForRenderLayer: (id) => this.deps.layers._filterMaskForRenderLayer(id),
    });
    this.deps.cache._featureQuery.setFeatureMaskProvider(this.deps.layers._featureMaskForPick);
  }
}
