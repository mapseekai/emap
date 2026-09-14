import type { PointLodPick } from '../../map/feature-query';
import type { RenderRequest } from '../../map/types';
import type { MapshaperLayer } from '../../types/mapshaper-types';

/** Renderer boundary: consumers never obtain Canvas, painter or scheduler state. */
export interface RenderContract {
  render(request?: RenderRequest): void;
  resize(): void;
  beginNavigation(): void;
  updateNavigation(): void;
  endNavigation(): void;
  settleNavigation(delay: number): void;
  cancelNavigation(): void;
  clearLodCache(options?: { sourceId?: string; layerId?: string }): void;
  /** @internal */
  getPointLodPick(
    sourceId: string,
    layer: MapshaperLayer,
    bounds: readonly number[],
  ): PointLodPick | null;
  dispose(): void;
}
