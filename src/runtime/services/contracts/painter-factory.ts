import type { EditPainter } from '../../../engine/rendering/painter';

export interface PainterCreationOptions {
  readonly role: 'main' | 'overlay';
  readonly signal: AbortSignal;
  /** Derived geometry may wait until snapshot navigation ends; other changes redraw immediately. */
  readonly invalidate: (reason?: 'geometry') => void;
  readonly report: (error: Error) => void;
}
export interface PainterFactoryContract {
  create(
    canvas: HTMLCanvasElement,
    options?: PainterCreationOptions,
  ): EditPainter | Promise<EditPainter>;
}
