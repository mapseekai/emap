import type { FeatureQuery } from '../../../engine/map/feature-query';
import type { ArcCollection, MapshaperLayer } from '../../../shared/types/mapshaper-types';

/** Explicit service contract. Providers implement this boundary; consumers do not import implementations. */
export interface CacheContract {
  /** @internal */
  _layerArcIdsCache: globalThis.Map<string, globalThis.Map<MapshaperLayer, Uint32Array>>;
  /** @internal */
  _featureQuery: FeatureQuery;
  /** @internal */
  _getLayerArcIds(sourceId: string, ml: MapshaperLayer, arcs: ArcCollection): Uint32Array | null;
  prebuildSpatialIndex(sourceId?: string): void;
  clearSpatialIndex(sourceId?: string): void;
  /** @internal */
  _clearSpatialIndexesForSources(sourceIds: Iterable<string>): void;
  /** @internal */
  _invalidateShapeCachesForSources(sourceIds: Iterable<string>): void;
  /** @internal */
  _invalidateAllShapeCaches(): void;
  dispose(): void;
}
