import type { Bounds } from '../../../domain/geo/bounds';
import type {
  Camera,
  AnimationOptions,
  CameraOptions,
  FitBoundsOptions,
  FlyToOptions,
} from '../../../domain/geo/camera';
import type { Projection } from '../../../domain/geo/projection';
import type { AffineTransform } from '../../../domain/geo/transform';
import type { Viewport } from '../../../domain/geo/viewport';

/** Explicit service contract. Providers implement this boundary; consumers do not import implementations. */
export interface ViewContract {
  /** @internal */
  _viewport: Viewport;
  /** @internal */
  _projection: Projection;
  /** @internal */
  _camera: Camera;
  getCRS(): string;
  getCenter(): [number, number];
  getZoom(): number;
  getTransform(): AffineTransform;
  getExtent(): Bounds;
  setExtent(bounds: Bounds): void;
  reset(): void;
  zoomIn(): void;
  zoomOut(): void;
  jumpTo(o: CameraOptions): this;
  setCenter(center: [number, number]): this;
  setZoom(zoom: number): this;
  easeTo(o: CameraOptions & AnimationOptions): this;
  panTo(center: [number, number], o?: AnimationOptions): this;
  panBy(offset: [number, number], o?: AnimationOptions): this;
  zoomTo(zoom: number, o?: AnimationOptions): this;
  flyTo(o: FlyToOptions): this;
  fitBounds(b: import('../../../domain/geo/bounds').Bounds, o?: FitBoundsOptions): this;
  stop(): this;
  project(x: number, y: number): [number, number];
  unproject(px: number, py: number): [number, number];
  dispose(): void;
}
