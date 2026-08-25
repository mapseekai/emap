import type { LayerRegistry } from '../../map/layer-registry';
import type { FeatureRef, QueriedFeature, QueryFeaturesOptions } from '../../map/types';
import type { MutableTopologySource } from '../../source/source';
import type { SelectMode } from './select-mode';

export interface SelectionHandlerHost {
  readonly layers: LayerRegistry;
  getCanvasContainer(): HTMLElement;
  getSource(id: string): MutableTopologySource | undefined;
  project(x: number, y: number): [number, number];
  queryFeatures(
    geometryOrOptions?:
      | [number, number]
      | [[number, number], [number, number]]
      | QueryFeaturesOptions,
    options?: QueryFeaturesOptions,
  ): QueriedFeature[];
  select(features: ReadonlyArray<FeatureRef>, options?: { mode?: SelectMode }): void;
  getSelection(): FeatureRef[];
}
