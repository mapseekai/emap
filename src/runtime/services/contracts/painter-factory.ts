import type { EditPainter } from '../../../engine/rendering/painter';

export interface PainterCreationOptions {
  readonly role: 'main' | 'overlay';
  readonly signal: AbortSignal;
  readonly invalidate: () => void;
  readonly report: (error: Error) => void;
}
export interface PainterFactoryContract {
  create(
    canvas: HTMLCanvasElement,
    options?: PainterCreationOptions,
  ): EditPainter | Promise<EditPainter>;
}
