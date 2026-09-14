import type { EditPainter } from '../../rendering/painter';

/** Implementations own their native canvas/GPU allocation; consumers only draw primitives. */
export interface PainterFactory {
  create(canvas: HTMLCanvasElement): EditPainter;
}
