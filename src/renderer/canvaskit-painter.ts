import { Painter } from './painter';
import { Transform } from '../geo/transform';
import type { CanvasKit, Canvas, Surface, Paint, Path } from 'canvaskit-wasm';

/**
 * CanvasKit (Skia WASM) based painter implementation.
 * @experimental This renderer is experimental and may have performance issues with very large datasets.
 * For production use with 400K+ polygons, consider using CanvasPainter instead.
 */
export class CanvasKitPainter implements Painter {
  private _surface: Surface | null = null;
  private _canvas: Canvas | null = null;
  private _ck: CanvasKit;
  private _transform: Transform = new Transform();
  private _pixelRatio: number = 1;
  private _htmlCanvas: HTMLCanvasElement;
  private _paint: Paint | null = null;

  constructor(ck: CanvasKit, canvas: HTMLCanvasElement) {
    this._ck = ck;
    this._htmlCanvas = canvas;
    this._initSurface();
  }

  private _initSurface(): void {
    if (this._surface) {
      this._surface.delete();
    }
    this._surface = this._ck.MakeWebGLCanvasSurface(this._htmlCanvas);
    if (!this._surface) {
      throw new Error('Failed to create CanvasKit surface');
    }
    this._canvas = this._surface.getCanvas();

    // Create a reusable paint object
    if (this._paint) this._paint.delete();
    this._paint = new this._ck.Paint();
    this._paint.setStyle(this._ck.PaintStyle.Stroke);
    this._paint.setAntiAlias(true);
    this._paint.setStrokeCap(this._ck.StrokeCap.Round);
    this._paint.setStrokeJoin(this._ck.StrokeJoin.Round);
  }

  prepare(_extent: any): void {
    // Called before each frame
  }

  setTransform(transform: Transform): void {
    this._transform = transform;
  }

  setPixelRatio(ratio: number): void {
    this._pixelRatio = ratio;
  }

  drawPaths(shapes: any[], style: any, arcs: any): void {
    if (!this._canvas || !this._paint) return;

    const path = new this._ck.Path();
    this._setupStyle(style);

    shapes.forEach(shape => {
      if (!shape) return;
      shape.forEach((part: number[]) => {
        part.forEach((arcId: number) => {
          const iter = arcs.getArcIter(arcId);
          this._addPathFromIter(path, iter);
        });
      });
    });

    this._canvas.drawPath(path, this._paint!);
    path.delete();
  }

  drawArcs(arcs: any, style: any, filter?: (i: number) => boolean): void {
    if (!this._canvas || !this._paint) return;

    const n = arcs.size();
    const batchSize = 500; // Flush path to GPU every N arcs
    this._setupStyle(style);

    // Disable anti-aliasing for large datasets (performance)
    if (n > 10000) {
      this._paint.setAntiAlias(false);
    } else {
      this._paint.setAntiAlias(true);
    }

    // Reuse a single path object per batch to enable GPU caching
    let path = new this._ck.Path();
    let count = 0;

    for (let i = 0; i < n; i++) {
      if (filter && !filter(i)) continue;

      const iter = arcs.getArcIter(i);
      this._addPathFromIter(path, iter);
      count++;

      // Batch flush: draw and reset path to reduce GPU command overhead
      if (count >= batchSize) {
        this._canvas.drawPath(path, this._paint!);
        path.delete();
        path = new this._ck.Path();
        count = 0;
      }
    }

    // Draw remaining arcs
    if (count > 0) {
      this._canvas.drawPath(path, this._paint!);
    }
    path.delete();
  }

  private _setupStyle(style: any): void {
    if (!this._paint) return;
    const color = this._parseColor(style.color || '#333');
    this._paint.setColor(color);
    this._paint.setStrokeWidth((style.width || 1) * this._pixelRatio);
  }

  private _parseColor(hex: string): Float32Array {
    // Parse hex color to CanvasKit color format [r, g, b, a]
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (result) {
      return this._ck.Color(
        parseInt(result[1], 16),
        parseInt(result[2], 16),
        parseInt(result[3], 16),
        1.0
      );
    }
    return this._ck.Color(51, 51, 51, 1.0); // default #333
  }

  private _addPathFromIter(path: Path, iter: any): void {
    // Cache transform values (critical for hot loop performance)
    const mx = this._transform.mx * this._pixelRatio;
    const my = this._transform.my * this._pixelRatio;
    const bx = this._transform.bx * this._pixelRatio;
    const by = this._transform.by * this._pixelRatio;

    let x: number, y: number, xp: number = 0, yp: number = 0;
    let count = 0;
    let first = true;

    while (iter.hasNext()) {
      // Use integer math for snapping (faster than division)
      x = (iter.x * mx + bx + 0.5) | 0;
      y = (iter.y * my + by + 0.5) | 0;

      if (first) {
        path.moveTo(x, y);
        first = false;
      } else if (x !== xp || y !== yp) {
        path.lineTo(x, y);
        count++;
      }
      xp = x;
      yp = y;
    }

    // Draw tiny line if all coords round to same location
    if (count === 0 && !first) {
      path.lineTo(xp + 1, yp);
    }
  }

  drawPoints(_shapes: any[], _style: any): void {
    if (!this._canvas || !this._paint) return;
    const pr = this._pixelRatio;
    const mx = this._transform.mx * pr;
    const my = this._transform.my * pr;
    const bx = this._transform.bx * pr;
    const by = this._transform.by * pr;
    const radius = (Number(_style?.radius) || 4) * pr;
    const color = this._parseColor(_style?.color || '#333');
    const fill = _style?.fill !== false;

    this._paint.setColor(color);
    this._paint.setStyle(fill ? this._ck.PaintStyle.Fill : this._ck.PaintStyle.Stroke);
    this._paint.setStrokeWidth(1 * pr);

    _shapes.forEach(shape => {
      if (!shape) return;
      const points = this._normalizePointShape(shape);
      points.forEach((p: number[]) => {
        const x = p[0] * mx + bx;
        const y = p[1] * my + by;
        this._canvas!.drawCircle(x, y, radius, this._paint!);
      });
    });

    // Reset to stroke for subsequent draw calls
    this._paint.setStyle(this._ck.PaintStyle.Stroke);
  }

  private _normalizePointShape(shape: any): number[][] {
    if (!shape) return [];
    if (typeof shape[0] === 'number') {
      return [shape as number[]];
    }
    if (Array.isArray(shape[0])) {
      return shape as number[][];
    }
    return [];
  }

  clear(): void {
    if (!this._canvas) return;
    this._canvas.clear(this._ck.WHITE);
  }

  resize(width: number, height: number): void {
    const pr = this._pixelRatio;
    this._htmlCanvas.width = width * pr;
    this._htmlCanvas.height = height * pr;
    this._htmlCanvas.style.width = width + 'px';
    this._htmlCanvas.style.height = height + 'px';
    this._initSurface();
  }

  flush(): void {
    if (this._surface) {
      this._surface.flush();
    }
  }

  dispose(): void {
    if (this._paint) this._paint.delete();
    if (this._surface) this._surface.delete();
    this._paint = null;
    this._surface = null;
    this._canvas = null;
  }
}
