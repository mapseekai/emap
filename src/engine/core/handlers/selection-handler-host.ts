import type { LayerRegistry } from '../../map/layer-registry';
import type { EditMode } from '../../map/edit-state-store';
import type { FeatureRef, QueriedFeature, QueryFeaturesOptions } from '../../map/types';
import type { MutableTopologySource } from '../../../domain/source/source';
import type { SelectMode } from './select-mode';

export interface SelectionHandlerHost {
  readonly layers: LayerRegistry;
  /**
   * Current modal edit mode. Selection gestures must stand down unless it is
   * `'none'` so a modal editor (draw / split / vertex / …) owns clicks while
   * active. Optional: hosts without edit modes simply never stand down.
   */
  getEditMode?(): EditMode;
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
