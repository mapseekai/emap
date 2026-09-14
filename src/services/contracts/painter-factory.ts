import type { EditPainter } from '../../renderer/painter';

export interface PainterFactoryContract {
  create(canvas: HTMLCanvasElement): EditPainter;
}
