import { Painter, DrawOverlayState } from './painter';
import { AffineTransform } from '../geo/transform';
import { normalizePointShape } from '../source/layer-utils';
import type { ArcCollection, StrokeStyle, PointStyle, VertexDotStyle } from '../types/mapshaper-types';

// Minimal subset of CanvasRenderingContext2D used by getPixelColorFunction.
// Splitting it out lets tests inject a mock without a real DOM.
interface ColorParseCtx {
  fillStyle: string | CanvasGradient | CanvasPattern;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
}

/**
 * Returns a memoized function that converts a CSS color string into the
 * little-endian uint32 representation of one RGBA pixel. Lets fast-path
 * dot rendering skip the color parser on subsequent calls with the same
 * color. Equivalent to mapshaper `gui-canvas.mjs:115-130`.
 *
 * Optional `ctx` parameter is for tests; production usage creates an
 * internal 1×1 canvas.
 */
export function getPixelColorFunction(ctx?: ColorParseCtx): (rgba: string) => number {
  const cache = new Map<string, number>();
  let cx: ColorParseCtx;
  if (ctx) {
    cx = ctx;
  } else {
    const cnv = document.createElement('canvas');
    cnv.width = 1;
    cnv.height = 1;
    cx = cnv.getContext('2d')! as unknown as ColorParseCtx;
  }
  return (rgba: string): number => {
    const cached = cache.get(rgba);
    if (cached !== undefined) return cached;
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = rgba;
    cx.fillRect(0, 0, 1, 1);
    const buf = cx.getImageData(0, 0, 1, 1).data;
    // Little-endian read: bytes are R,G,B,A; uint32 is A<<24 | B<<16 | G<<8 | R
    const v = (buf[3] << 24) | (buf[2] << 16) | (buf[1] << 8) | buf[0];
    cache.set(rgba, v);
    return v;
  };
}

export class CanvasPainter implements Painter {
  private _ctx: CanvasRenderingContext2D;
  private _transform: AffineTransform = new AffineTransform();
  private _pixelRatio: number = window.devicePixelRatio || 1;

  constructor(private _canvas: HTMLCanvasElement) {
    const ctx = _canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context');
    this._ctx = ctx;
  }

  setTransform(transform: AffineTransform): void {
    this._transform = transform;
  }

  setPixelRatio(ratio: number): void {
    this._pixelRatio = ratio;
  }

  drawPaths(shapes: any[], style: StrokeStyle, arcs: ArcCollection): void {
    // Width 0 means "no outline" — skip the whole pass so callers can use it
    // to disable strokes (e.g. fill-only polygons) without paying any cost.
    if (style.width === 0) return;
    const ctx = this._ctx;
    const batchSize = 100; // Aligned with mapshaper 0.7.19 (gui-canvas.mjs:432)

    ctx.strokeStyle = style.color || '#333';
    ctx.lineWidth = (style.width ?? 1) * this._pixelRatio;
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

  // Multi-style shape batching: groups items by composite style key before
  // delegating to drawPaths. Equivalent to mapshaper's styleIndex pattern
  // (gui-canvas.mjs:241-281 — drawStyledPaths). Saves redundant canvas state
  // mutations when caller has heterogeneous styles (e.g., data-driven coloring).
  drawPathsBatch(
    items: Array<{ shape: any; style: StrokeStyle }>,
    arcs: ArcCollection,
  ): void {
    if (items.length === 0) return;
    const groups = new Map<string, { style: StrokeStyle; shapes: any[] }>();
    for (const it of items) {
      if (it.style.width === 0) continue;
      const key = this._styleKey(it.style);
      let g = groups.get(key);
      if (!g) {
        g = { style: it.style, shapes: [] };
        groups.set(key, g);
      }
      g.shapes.push(it.shape);
    }
    for (const g of groups.values()) {
      this.drawPaths(g.shapes, g.style, arcs);
    }
  }

  private _styleKey(s: StrokeStyle): string {
    const anyS = s as any;
    return `${s.color || '#333'}|${s.width ?? 1}|${anyS.lineCap || 'round'}|${anyS.lineJoin || 'round'}|${anyS.opacity ?? 1}`;
  }

  // Direct arc rendering for maximum performance (bypasses shape iteration)
  drawArcs(arcs: ArcCollection, style: StrokeStyle, filter?: (i: number) => boolean): void {
    if (style.width === 0) return;
    const ctx = this._ctx;
    const batchSize = 100; // Aligned with mapshaper 0.7.19 (gui-canvas.mjs:432)
    const n = arcs.size();

    ctx.strokeStyle = style.color || '#333';
    ctx.lineWidth = (style.width ?? 1) * this._pixelRatio;
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

  // Safety clamp on post-transform canvas coordinates. Browsers misbehave on
  // very large magnitudes (lines vanish, paths jitter), and mapshaper's
  // protectIterForDrawing (gui-canvas.mjs:626-639) clips the iterator to an
  // expanded viewport at scale > 100. emap takes the equivalent precaution at
  // the output side: any post-transform coord beyond ±MAX is clamped. Normal
  // coords are untouched (well within the limit).
  private static readonly _COORD_MAX = 1_000_000;

  private _clampCoord(v: number): number {
    const MAX = CanvasPainter._COORD_MAX;
    return v > MAX ? MAX : v < -MAX ? -MAX : v;
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
    x = this._clampCoord((iter.x * mx + bx) * 2 | 0);
    y = this._clampCoord((iter.y * my + by) * 2 | 0);
    ctx.moveTo(x / 2, y / 2);

    while (iter.hasNext()) {
      xp = x;
      yp = y;
      x = this._clampCoord((iter.x * mx + bx) * 2 | 0);
      y = this._clampCoord((iter.y * my + by) * 2 | 0);

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

  // Lazily-built color memoizer shared across all painters. Sized cache is
  // fine because realistic data uses a small palette.
  private static _pixelColorFn: ((rgba: string) => number) | null = null;
  private _getPixelColor(rgba: string): number {
    if (!CanvasPainter._pixelColorFn) {
      CanvasPainter._pixelColorFn = getPixelColorFunction();
    }
    return CanvasPainter._pixelColorFn(rgba);
  }

  /**
   * Direct-pixel fast path for small opaque dots. Equivalent to mapshaper
   * `gui-canvas.mjs:334-372 drawSquareDotsFaster`.
   *
   * - Reads the entire canvas via one `getImageData` (cost: one large allocation)
   * - Stamps a `size × size` block at each point via `Uint32Array` writes
   * - Pushes back with one `putImageData`
   *
   * Skipping the Canvas2D draw path beats the per-point overhead of
   * `ctx.arc/fill` by an order of magnitude on big point clouds.
   * Callers are responsible for the size/style preconditions
   * (see `_canUseFastDotPath`).
   */
  private drawSquareDotsFaster(
    points: Array<[number, number]>,
    color: string,
    size: number,
    ctx: CanvasRenderingContext2D,
  ): void {
    if (points.length === 0) return;
    const canvas = ctx.canvas;
    const w = canvas.width;
    const h = canvas.height;
    if (w === 0 || h === 0) return;

    const imageData = ctx.getImageData(0, 0, w, h);
    const pixels = new Uint32Array(imageData.data.buffer);
    const colorInt = this._getPixelColor(color);
    const half = Math.floor(size / 2);

    for (let i = 0; i < points.length; i++) {
      const px = points[i][0];
      const py = points[i][1];
      const cx = Math.round(px);
      const cy = Math.round(py);
      const x0 = cx - half < 0 ? 0 : cx - half;
      const y0 = cy - half < 0 ? 0 : cy - half;
      const x1 = cx + half >= w ? w - 1 : cx + half;
      const y1 = cy + half >= h ? h - 1 : cy + half;
      if (x1 < 0 || y1 < 0 || x0 >= w || y0 >= h) continue;
      for (let y = y0; y <= y1; y++) {
        const rowOffset = y * w;
        for (let x = x0; x <= x1; x++) {
          pixels[rowOffset + x] = colorInt;
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
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

    // Fast path: opaque fill, integer-rounded small square dots written
    // straight into the canvas backing buffer. Mapshaper `gui-canvas.mjs:306`
    // takes this path whenever the resulting pixel size is ≤ 6 — for big
    // point clouds it's 10–100× faster than `ctx.arc`.
    if (this._canUseFastDotPath(_style, radius, fill)) {
      const size = Math.max(1, Math.round(radius * 2));
      const points: Array<[number, number]> = [];
      _shapes.forEach(shape => {
        if (!shape) return;
        const pts = normalizePointShape(shape);
        pts.forEach((p: number[]) => {
          points.push([p[0] * mx + bx, p[1] * my + by]);
        });
      });
      this.drawSquareDotsFaster(points, color, size, ctx);
      return;
    }

    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;

    _shapes.forEach(shape => {
      if (!shape) return;
      const points = normalizePointShape(shape);
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
   * Gating predicate for the direct-pixel dot fast path. Conditions match
   * mapshaper `gui-canvas.mjs:306` plus emap-specific constraints:
   *  - `fill` must be true (fast path can't draw a stroke ring)
   *  - resulting pixel size must be a small integer (≤ 6, matches mapshaper)
   *  - PointStyle has no opacity field, so we don't need to gate on it
   */
  private _canUseFastDotPath(_style: PointStyle, radius: number, fill: boolean): boolean {
    if (!fill) return false;
    const size = Math.round(radius * 2);
    if (size <= 0) return false;
    if (size > 6) return false;
    return true;
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

    // Draw hover highlight: circle for actual vertex, square for interpolated
    // edge-midpoint (drag-to-insert affordance) — same convention as
    // DrawFeatureControl's snap indicator (vertex=⭕, edge=⬜).
    if (hoverPx) {
      ctx.fillStyle = hoverColor;
      ctx.beginPath();
      if (style.hoverType === 'interpolated') {
        ctx.rect(
          hoverPx[0] - hoverRadius,
          hoverPx[1] - hoverRadius,
          hoverRadius * 2,
          hoverRadius * 2,
        );
      } else {
        ctx.arc(hoverPx[0], hoverPx[1], hoverRadius, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }

  /**
   * Draw a fill for polygon shapes in vertex edit mode.
   *
   * IMPORTANT: Must use getShapeIter (not getArcIter) so that reversed arcs
   * (~arcId) are traversed backwards, preserving correct polygon winding order.
   * This is what mapshaper does via ShapeIter and is the reason plain getArcIter
   * produces incorrect fills (doesn't cover the whole polygon, or fills holes).
   */
  drawPolygonFill(
    shapes: any[],
    arcs: ArcCollection & { getShapeIter?: (part: number[]) => { x: number; y: number; hasNext(): boolean } },
    fillColor: string,
    filter?: (i: number) => boolean,
    /**
     * Multiplier on top of `fillColor`'s own alpha. `1` (default) leaves
     * the colour as-is; `0.5` halves the resulting alpha. Matches MapLibre's
     * `fill-opacity` semantics — independent of the colour's own alpha.
     */
    opacity?: number,
    /**
     * Fill rule for polygon coverage. Default `'nonzero'` matches mapshaper
     * 0.7.19 (gui-canvas.mjs:688 `ctx.fill()` with no arg). Use `'evenodd'`
     * when caller's data benefits from XOR-style hole/overlap handling.
     */
    fillRule: 'nonzero' | 'evenodd' = 'nonzero',
  ): void {
    if (!arcs.getShapeIter) return; // guard: need shape-aware iterator

    const ctx = this._ctx;
    const pr = this._pixelRatio;
    const mx = this._transform.mx * pr;
    const my = this._transform.my * pr;
    const bx = this._transform.bx * pr;
    const by = this._transform.by * pr;

    ctx.fillStyle = fillColor;
    const overrideAlpha = typeof opacity === 'number' && opacity !== 1;
    const prevAlpha = ctx.globalAlpha;
    if (overrideAlpha) {
      // `globalAlpha` multiplies into whatever alpha the rgba/hex string
      // already encodes, so callers can compose color-baked transparency
      // with this style-level opacity.
      ctx.globalAlpha = prevAlpha * Math.max(0, Math.min(1, opacity!));
    }

    // Single helper to apply the chosen rule. Branchless at the call site
    // and a no-arg call when nonzero so behavior is byte-identical to
    // mapshaper's default fill().
    const flush = () => {
      if (fillRule === 'evenodd') ctx.fill('evenodd');
      else ctx.fill();
    };

    // Smaller batches keep each fill() call's path object bounded —
    // Canvas2D engines slow superlinearly with subpath count, so 100
    // polygons/flush is the sweet spot for big topology datasets.
    const batchSize = 100;
    let counts = 0;

    ctx.beginPath();
    for (let sIdx = 0; sIdx < shapes.length; sIdx++) {
      const shape = shapes[sIdx];
      if (!shape) continue;

      let isVisible = true;
      if (filter) {
        // Find if this shape shares any arc with the viewport
        isVisible = false;
        for (const part of shape) {
          for (const arcId of part) {
            const absId = arcId >= 0 ? arcId : ~arcId;
            if (filter(absId)) {
              isVisible = true;
              break;
            }
          }
          if (isVisible) break;
        }
      }

      if (!isVisible) continue;

      // When batch limit reached, fill and start new path
      if (counts > 0 && counts >= batchSize) {
        flush();
        ctx.beginPath();
        counts = 0;
      }

      for (const part of shape) {
        // getShapeIter respects arc direction (reversed arcs traversed backwards)
        const iter = arcs.getShapeIter!(part);
        if (!iter.hasNext()) continue;

        let xp: number, yp: number;
        // Integer pixel snap for fills (mapshaper roundToPix). Stroked paths
        // use half-pixel snap for crisp 1px lines, but fill regions look
        // cleaner with integer-aligned edges (fewer seam shimmers between
        // adjacent polygons).
        let x = this._clampCoord(Math.round(iter.x * mx + bx));
        let y = this._clampCoord(Math.round(iter.y * my + by));
        ctx.moveTo(x, y);

        while (iter.hasNext()) {
          xp = x;
          yp = y;
          x = this._clampCoord(Math.round(iter.x * mx + bx));
          y = this._clampCoord(Math.round(iter.y * my + by));

          if (x !== xp || y !== yp) {
            ctx.lineTo(x, y);
          }
        }
        ctx.closePath();
      }

      counts++;
    }

    if (counts > 0) {
      flush();
    }
    if (overrideAlpha) ctx.globalAlpha = prevAlpha;
  }





  /**
   * Draw the in-progress feature creation overlay.
   * Renders placed vertices, connecting lines, rubber-band line to cursor,
   * and snap indicator.
   */
  drawDrawingOverlay(state: DrawOverlayState): void {
    const ctx = this._ctx;
    const pr = this._pixelRatio;
    const mx = this._transform.mx * pr;
    const my = this._transform.my * pr;
    const bx = this._transform.bx * pr;
    const by = this._transform.by * pr;

    const color = state.drawColor || '#0078ff';
    const verts = state.vertices;
    const cursor = state.cursorCoord;

    // Project helper
    const proj = (c: [number, number]): [number, number] => [
      c[0] * mx + bx,
      c[1] * my + by,
    ];

    // Draw placed segments (solid line)
    if (verts.length > 0) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 * pr;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.setLineDash([]);
      ctx.beginPath();
      const p0 = proj(verts[0]);
      ctx.moveTo(p0[0], p0[1]);
      for (let i = 1; i < verts.length; i++) {
        const p = proj(verts[i]);
        ctx.lineTo(p[0], p[1]);
      }
      ctx.stroke();
    }

    // Draw rubber-band line from last vertex to cursor (dashed)
    if (verts.length > 0 && cursor) {
      const lastP = proj(verts[verts.length - 1]);
      const curP = proj(cursor);

      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5 * pr;
      ctx.setLineDash([6 * pr, 4 * pr]);
      ctx.beginPath();
      ctx.moveTo(lastP[0], lastP[1]);
      ctx.lineTo(curP[0], curP[1]);

      // For polygon: draw closing line from cursor to first vertex
      if (state.geometryType === 'polygon' && verts.length >= 2) {
        const firstP = proj(verts[0]);
        ctx.moveTo(curP[0], curP[1]);
        ctx.lineTo(firstP[0], firstP[1]);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw vertex dots at each placed point
    if (verts.length > 0) {
      const dotRadius = 4 * pr;
      ctx.fillStyle = color;
      ctx.beginPath();
      for (const v of verts) {
        const p = proj(v);
        ctx.moveTo(p[0] + dotRadius, p[1]);
        ctx.arc(p[0], p[1], dotRadius, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    // Draw snap indicator. Edge snap uses a square (GIS convention for
    // "snap to segment"), vertex snap uses a circle. Same colour, same size.
    if (state.snapCoord) {
      const sp = proj(state.snapCoord);
      const snapRadius = 7 * pr;
      ctx.strokeStyle = '#ff4444';
      ctx.lineWidth = 2 * pr;
      ctx.beginPath();
      if (state.snapKind === 'edge') {
        ctx.rect(sp[0] - snapRadius, sp[1] - snapRadius, snapRadius * 2, snapRadius * 2);
      } else {
        ctx.arc(sp[0], sp[1], snapRadius, 0, Math.PI * 2);
      }
      ctx.stroke();
    }
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
