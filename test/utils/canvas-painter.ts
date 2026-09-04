import { AffineTransform } from '../../src/geo/transform';
import { CanvasPainter } from '../../src/renderer/canvas-painter';

interface CanvasPainterHarnessOptions {
  width?: number;
  height?: number;
  pixelRatio?: number;
  canvas?: HTMLCanvasElement;
}

export function createCanvasPainterHarness(
  context: CanvasRenderingContext2D | object,
  options: CanvasPainterHarnessOptions = {},
): { canvas: HTMLCanvasElement; painter: CanvasPainter } {
  const width = options.width ?? 100;
  const height = options.height ?? 100;
  const canvas =
    options.canvas ??
    ({
      width,
      height,
      style: {},
    } as unknown as HTMLCanvasElement);

  canvas.width = width;
  canvas.height = height;
  Object.defineProperty(canvas, 'getContext', {
    configurable: true,
    value: () => context,
  });

  const painter = new CanvasPainter(canvas);
  painter.setTransform(new AffineTransform());
  painter.setPixelRatio(options.pixelRatio ?? 1);
  return { canvas, painter };
}
