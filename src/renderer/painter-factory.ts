import { CanvasPainter } from './canvas-painter';
import { WebGLPainter } from './webgl-painter';
import type { Painter } from './painter';
import type { RendererType } from '../map/types';

export interface PainterFactoryOptions {
  renderer?: RendererType;
}

export interface PainterFactoryResult {
  painter: Painter;
  renderer: Exclude<RendererType, 'auto'>;
  requestedRenderer: RendererType;
}

interface PainterConstructors {
  CanvasPainter: new (canvas: HTMLCanvasElement) => Painter;
  WebGLPainter: new (canvas: HTMLCanvasElement) => Painter;
  warn: (message: string, error: unknown) => void;
}

const DEFAULT_CONSTRUCTORS: PainterConstructors = {
  CanvasPainter,
  WebGLPainter,
  warn: (message, error) => console.warn(message, error),
};

export function createPainter(
  canvas: HTMLCanvasElement,
  options: PainterFactoryOptions = {},
  constructors: PainterConstructors = DEFAULT_CONSTRUCTORS,
): PainterFactoryResult {
  const requestedRenderer = options.renderer ?? 'canvas';
  if (requestedRenderer === 'canvas') {
    return {
      painter: new constructors.CanvasPainter(canvas),
      renderer: 'canvas',
      requestedRenderer,
    };
  }

  try {
    return {
      painter: new constructors.WebGLPainter(canvas),
      renderer: 'webgl',
      requestedRenderer,
    };
  } catch (error) {
    constructors.warn(
      'emap: WebGL renderer unavailable, falling back to Canvas 2D',
      error,
    );
    return {
      painter: new constructors.CanvasPainter(canvas),
      renderer: 'canvas',
      requestedRenderer,
    };
  }
}
