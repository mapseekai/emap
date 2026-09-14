import type { AffineDelta, RenderAction } from '../../../engine/map/types';

/** Explicit service contract. Providers implement this boundary; consumers do not import implementations. */
export interface RenderSignalsContract {
  requestRender(action?: RenderAction, navDelta?: AffineDelta, settle?: boolean): void;
  requestOverlay(): void;
}
