import type { EditPainter } from '../../../engine/rendering/painter';

export interface PainterFactoryContract {
  create(canvas: HTMLCanvasElement): EditPainter;
}
