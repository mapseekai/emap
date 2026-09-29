import type { RenderPass } from './render-pass';
import type { PointLodPick } from '../../../engine/map/feature-query';
import type { RenderRequest } from '../../../engine/map/types';
import type { MapshaperLayer } from '../../../shared/types/mapshaper-types';

/** Renderer boundary: consumers never obtain Canvas, painter or scheduler state. */
export interface RenderContract {
  /** Actual main-map backend, absent for externally supplied unreported painters. */
  readonly backend?: import('../../../engine/map/renderer').RendererBackend | null;
  /** Top-first order shared by vector sources and source-scoped render passes. */
  setSourceOrder(order: readonly string[]): void;
  getSourceOrder(): readonly string[];
  registerPass(
    pass: RenderPass,
    stage?: 'before-layers' | 'after-layers' | { readonly sourceId: string },
  ): () => void;
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
  /** Physical asynchronous cleanup; may reject until disposal is retried. */
  readonly closed?: Promise<void>;
  dispose(): void;
}
