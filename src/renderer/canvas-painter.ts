import { Painter } from './painter';
import { Transform } from '../geo/transform';
import type { ArcCollection, StrokeStyle, PointStyle, VertexDotStyle } from '../types/mapshaper-types';

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

  drawPaths(shapes: any[], style: StrokeStyle, arcs: ArcCollection): void {
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
  drawArcs(arcs: ArcCollection, style: StrokeStyle, filter?: (i: number) => boolean): void {
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

  drawPoints(_shapes: any[], _style: PointStyle): void {
    const ctx = this._ctx;
    const pr = this._pixelRatio;
    const mx = this._transform.mx * pr;
    const my = this._transform.my * pr;
    const bx = this._transform.bx * pr;
    const by = this._transform.by * pr;
    const radius = (Number(_style?.radius) || 4) * pr;
    const color = _style?.color || '#333';
    const fill = _style?.fill !== false;

    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;

    _shapes.forEach(shape => {
      if (!shape) return;
      const points = this._normalizePointShape(shape);
      points.forEach((p: number[]) => {
        const x = p[0] * mx + bx;
        const y = p[1] * my + by;
        ctx.moveTo(x + radius, y);
        ctx.arc(x, y, radius, 0, Math.PI * 2);
      });
    });

    if (fill) {
      ctx.fill();
    } else {
      ctx.stroke();
    }
  }

  /**
   * Draw vertex dots on the main canvas context.
   * Called during render() when in vertex edit mode.
   */
  drawVertexDots(
    shapes: any[],
    arcs: ArcCollection,
    style: VertexDotStyle = {},
  ): void {
    const ctx = this._ctx;

    const pr = this._pixelRatio;
    const mx = this._transform.mx * pr;
    const my = this._transform.my * pr;
    const bx = this._transform.bx * pr;
    const by = this._transform.by * pr;

    const dotColor = style.dotColor || '#333';
    const dotRadius = (style.dotRadius || 3) * pr;
    const hoverColor = style.hoverColor || '#cc6acc';
    const hoverRadius = (style.hoverRadius || 6) * pr;
    const hoverVertex = style.hoverVertex;
    let hoverPx: [number, number] | null = null;
    if (hoverVertex) {
      hoverPx = [
        hoverVertex[0] * mx + bx,
        hoverVertex[1] * my + by
      ];
    }

    // Draw normal vertex dots
    ctx.fillStyle = dotColor;
    ctx.beginPath();

    shapes.forEach(shape => {
      if (!shape) return;
      shape.forEach((part: number[]) => {
        part.forEach((arcId: number) => {
          const absId = arcId >= 0 ? arcId : ~arcId;
          const iter = arcs.getArcIter(absId);
          while (iter.hasNext()) {
            const x = iter.x * mx + bx;
            const y = iter.y * my + by;
            // Skip hover vertex (drawn separately with larger radius)
            if (hoverPx && Math.abs(x - hoverPx[0]) < 1 && Math.abs(y - hoverPx[1]) < 1) continue;
            ctx.moveTo(x + dotRadius, y);
            ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
          }
        });
      });
    });
    ctx.fill();

    // Draw hover highlight vertex
    if (hoverPx) {
      ctx.fillStyle = hoverColor;
      ctx.beginPath();
      ctx.arc(hoverPx[0], hoverPx[1], hoverRadius, 0, Math.PI * 2);
      ctx.fill();
    }
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
