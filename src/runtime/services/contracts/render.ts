import type { RenderPass } from './render-pass';
import type { PointLodPick } from '../../../engine/map/feature-query';
import type { RenderRequest } from '../../../engine/map/types';
import type { MapshaperLayer } from '../../../shared/types/mapshaper-types';

/** Renderer boundary: consumers never obtain Canvas, painter or scheduler state. */
export interface RenderContract {
  registerPass(pass: RenderPass, stage?: 'before-layers' | 'after-layers'): () => void;
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
