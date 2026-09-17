import type { AffineTransform } from '../../../domain/geo/transform';
import type { CorePainter } from '../../../engine/rendering/painter';

/** A synchronous drawing hook on the existing map canvas, owned by its plugin. */
export interface RenderFrame {
  readonly transform: AffineTransform;
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly painter: CorePainter;
}
/** Async work must be scheduled outside the render callback. */
export type RenderPass = (frame: RenderFrame) => void;
