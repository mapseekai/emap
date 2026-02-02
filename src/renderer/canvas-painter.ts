import { Painter } from './painter';
import { Transform } from '../geo/transform';

export class CanvasPainter implements Painter {
  private _ctx: CanvasRenderingContext2D;
  private _transform: Transform = new Transform();
  private _pixelRatio: number = window.devicePixelRatio || 1;

  constructor(private _canvas: HTMLCanvasElement) {
    const ctx = _canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context');
    this._ctx = ctx;
  }

  prepare(_extent: any): void {
    // Basic setup before drawing a frame
  }

  setTransform(transform: Transform): void {
    this._transform = transform;
  }

  setPixelRatio(ratio: number): void {
    this._pixelRatio = ratio;
  }

  drawPaths(shapes: any[], style: any, arcs: any): void {
    const ctx = this._ctx;
    const batchSize = 25; // Mapshaper uses batch of 25 for optimal performance

    ctx.strokeStyle = style.color || '#333';
    ctx.lineWidth = (style.width || 1) * this._pixelRatio;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    let count = 0;
    ctx.beginPath();

    shapes.forEach(shape => {
      if (!shape) return;

      shape.forEach((part: number[]) => {
        part.forEach((arcId: number) => {
          if (count > 0 && count % batchSize === 0) {
            ctx.stroke();
            ctx.beginPath();
          }
          const iter = arcs.getArcIter(arcId);
          this.drawPathSnapping(iter, ctx);
          count++;
        });
      });
    });
    ctx.stroke();
  }

  // Direct arc rendering for maximum performance (bypasses shape iteration)
  drawArcs(arcs: any, style: any, filter?: (i: number) => boolean): void {
    const ctx = this._ctx;
    const batchSize = 25;
    const n = arcs.size();

    ctx.strokeStyle = style.color || '#333';
    ctx.lineWidth = (style.width || 1) * this._pixelRatio;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    let count = 0;
    ctx.beginPath();

    for (let i = 0; i < n; i++) {
      if (filter && !filter(i)) continue;
      if (count > 0 && count % batchSize === 0) {
        ctx.stroke();
        ctx.beginPath();
      }
      const iter = arcs.getArcIter(i);
      this.drawPathSnapping(iter, ctx);
      count++;
    }
    ctx.stroke();
  }

  // Equivalent to mapshaper's drawPath2 with optimized rounding
  private drawPathSnapping(iter: any, ctx: CanvasRenderingContext2D): void {
    // Cache transform values in local variables (Chrome 80+ performance workaround)
    const mx = this._transform.mx * this._pixelRatio;
    const my = this._transform.my * this._pixelRatio;
    const bx = this._transform.bx * this._pixelRatio;
    const by = this._transform.by * this._pixelRatio;

    let x: number, y: number, xp: number, yp: number;
    let count = 0;
    if (!iter.hasNext()) return;

    // Use half-pixel snapping for crisper 1px lines (Mapshaper's roundToHalfPix)
    x = (iter.x * mx + bx) * 2 | 0;
    y = (iter.y * my + by) * 2 | 0;
    ctx.moveTo(x / 2, y / 2);

    while (iter.hasNext()) {
      xp = x;
      yp = y;
      x = (iter.x * mx + bx) * 2 | 0;
      y = (iter.y * my + by) * 2 | 0;

      if (x !== xp || y !== yp) {
        ctx.lineTo(x / 2, y / 2);
        count++;
      }
    }

    // Draw tiny line if all coords round to same location (Mapshaper behavior)
    if (count === 0) {
      ctx.lineTo(x / 2 + 0.1, y / 2);
    }
  }

  drawPoints(_shapes: any[], _style: any): void {
    // Point drawing logic
  }

  clear(): void {
    this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
  }

  resize(width: number, height: number): void {
    const pr = this._pixelRatio;
    this._canvas.width = width * pr;
    this._canvas.height = height * pr;
    this._canvas.style.width = width + 'px';
    this._canvas.style.height = height + 'px';
  }
}
