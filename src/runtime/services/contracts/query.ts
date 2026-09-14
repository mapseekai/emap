import type { FeatureAccessor } from '../../../engine/map/feature-accessor';
import type { PointLodPick } from '../../../engine/map/feature-query';
import type { QueriedFeature, QueryFeaturesOptions } from '../../../engine/map/types';
import type { MapshaperLayer } from '../../../shared/types/mapshaper-types';

/** Explicit service contract. Providers implement this boundary; consumers do not import implementations. */
export interface QueryContract {
  features: FeatureAccessor;
  /** @internal */
  _isHoveringSelectedAt(point: { x: number; y: number }): boolean;
  /** @internal */
  _pointLodForPick(
    sourceId: string,
    layer: MapshaperLayer,
    bounds: readonly number[],
  ): PointLodPick | null;
  queryFeatures(
    geometryOrOptions?:
      | [number, number]
      | [[number, number], [number, number]]
      | QueryFeaturesOptions,
    options?: QueryFeaturesOptions,
  ): QueriedFeature[];
  /** @internal */
  _lodProvider:
    | ((sourceId: string, layer: MapshaperLayer, bounds: readonly number[]) => PointLodPick | null)
    | null;
  /** @internal */
  setPointLodProvider(provider: NonNullable<QueryContract['_lodProvider']>): () => void;
  dispose(): void;
}
