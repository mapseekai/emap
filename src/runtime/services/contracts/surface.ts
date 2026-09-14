import type { MapOptions } from '../../../engine/map/types';
import type { ControlPosition } from '../../../ui/control';

/** Explicit service contract. Providers implement this boundary; consumers do not import implementations. */
export interface SurfaceContract {
  /** @internal */
  _container: HTMLElement;
  /** @internal */
  _canvasContainer: HTMLElement;
  /** @internal */
  _controlContainers: globalThis.Map<ControlPosition, HTMLElement>;
  getCanvasContainer(): HTMLElement;
  /** @internal */
  _createCanvasContainer(): HTMLElement;
  initialize(options: { container?: MapOptions['container'] }): void;
  dispose(): void;
}
