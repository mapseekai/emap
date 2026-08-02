import { Painter, DrawOverlayState, type PolygonFillOptions } from './painter';
import { AffineTransform } from '../geo/transform';
import { normalizePointShape } from '../source/layer-utils';
import type {
  ArcCollection,
  ArcIterator,
  FeatureShape,
  PathShape,
  PointMarkerShape,
  StrokeStyle,
  PointStyle,
  VertexDotStyle,
} from '../types/mapshaper-types';

const POLYGON_FILL_BATCH_SHAPE_LIMIT = 100;
const POLYGON_FILL_BATCH_VERTEX_LIMIT = 12_000;
const ARC_STROKE_BATCH_ARC_LIMIT = 100;
const ARC_STROKE_BATCH_VERTEX_LIMIT = 12_000;
const STAR_INNER_RADIUS_RATIO = 0.45;
const CROSS_ARM_RADIUS_RATIO = 0.4;

function addRegularPolygonPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  sides: number,
  startAngle = -Math.PI / 2,
): void {
  for (let i = 0; i < sides; i++) {
    const angle = startAngle + (i * Math.PI * 2) / sides;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function addPointMarkerPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  shape: PointMarkerShape,
): void {
  switch (shape) {
    case 'circle':
      ctx.moveTo(x + radius, y);
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      return;
    case 'square':
      ctx.rect(x - radius, y - radius, radius * 2, radius * 2);
      return;
    case 'triangle':
      addRegularPolygonPath(ctx, x, y, radius, 3);
      return;
    case 'triangle-down':
      addRegularPolygonPath(ctx, x, y, radius, 3, Math.PI / 2);
      return;
    case 'diamond':
      addRegularPolygonPath(ctx, x, y, radius, 4);
      return;
    case 'pentagon':
      addRegularPolygonPath(ctx, x, y, radius, 5);
      return;
    case 'star':
      for (let i = 0; i < 10; i++) {
        const angle = -Math.PI / 2 + (i * Math.PI) / 5;
        const pointRadius = i % 2 === 0 ? radius : radius * STAR_INNER_RADIUS_RATIO;
        const px = x + Math.cos(angle) * pointRadius;
        const py = y + Math.sin(angle) * pointRadius;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      return;
    case 'cross': {
      const arm = radius * CROSS_ARM_RADIUS_RATIO;
      ctx.moveTo(x - arm, y - radius);
      ctx.lineTo(x + arm, y - radius);
      ctx.lineTo(x + arm, y - arm);
      ctx.lineTo(x + radius, y - arm);
      ctx.lineTo(x + radius, y + arm);
      ctx.lineTo(x + arm, y + arm);
      ctx.lineTo(x + arm, y + radius);
      ctx.lineTo(x - arm, y + radius);
      ctx.lineTo(x - arm, y + arm);
      ctx.lineTo(x - radius, y + arm);
      ctx.lineTo(x - radius, y - arm);
      ctx.lineTo(x - arm, y - arm);
      ctx.closePath();
      return;
    }
    case 'x': {
      const arm = radius * CROSS_ARM_RADIUS_RATIO;
      ctx.moveTo(x - radius, y - radius + arm);
      ctx.lineTo(x - radius + arm, y - radius);
      ctx.lineTo(x, y - arm);
      ctx.lineTo(x + radius - arm, y - radius);
      ctx.lineTo(x + radius, y - radius + arm);
      ctx.lineTo(x + arm, y);
      ctx.lineTo(x + radius, y + radius - arm);
      ctx.lineTo(x + radius - arm, y + radius);
      ctx.lineTo(x, y + arm);
      ctx.lineTo(x - radius + arm, y + radius);
      ctx.lineTo(x - radius, y + radius - arm);
      ctx.lineTo(x - arm, y);
      ctx.closePath();
      return;
    }
    case 'hexagon':
      addRegularPolygonPath(ctx, x, y, radius, 6, 0);
      return;
    case 'octagon':
      addRegularPolygonPath(ctx, x, y, radius, 8, Math.PI / 8);
  }
}

function absArcId(arcId: number): number {
  return arcId >= 0 ? arcId : ~arcId;
}

function bboxIntersects(a: readonly number[], b: readonly number[]): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function partIntersectsView(
  part: readonly number[],
  getSimpleShapeBbox: (shapeIds: number[], bbox: number[]) => void,
  viewBBox: readonly number[],
  bbox: number[],
): boolean {
  getSimpleShapeBbox(part as number[], bbox);
  return bboxIntersects(bbox, viewBBox);
}

function partPassesArcFilter(part: readonly number[], filter?: (i: number) => boolean): boolean {
  if (!filter) return true;
  for (const arcId of part) {
    if (filter(absArcId(arcId))) return true;
  }
  return false;
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

  drawPaths(
    shapes: readonly (FeatureShape | null | undefined)[],
    style: StrokeStyle,
    arcs: ArcCollection,
  ): void {
    // Width 0 means "no outline" — skip the whole pass so callers can use it
    // to disable strokes (e.g. fill-only polygons) without paying any cost.
    if (style.width === 0) return;
    const ctx = this._ctx;
    const batchSize = 100;

    ctx.strokeStyle = style.color || '#333';
    ctx.lineWidth = (style.width ?? 1) * this._pixelRatio;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash((style.dash ?? []).map((length) => length * this._pixelRatio));

    let count = 0;
    ctx.beginPath();

    shapes.forEach((shape) => {
      if (!shape) return;

      (shape as PathShape).forEach((part) => {
        part.forEach((arcId) => {
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
  drawArcs(
    arcs: ArcCollection,
    style: StrokeStyle,
    filter?: (i: number) => boolean,
    arcIds?: Uint32Array,
  ): void {
    if (style.width === 0) return;
    const ctx = this._ctx;
    const n = arcIds?.length ?? arcs.size();
    const vertexCounts = arcs.getVertexData?.().nn ?? null;

    ctx.strokeStyle = style.color || '#333';
    ctx.lineWidth = (style.width ?? 1) * this._pixelRatio;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash((style.dash ?? []).map((length) => length * this._pixelRatio));

    let arcCount = 0;
    let vertexCount = 0;
    let hasPath = false;
    ctx.beginPath();

    const flush = () => {
      if (!hasPath) return;
      ctx.stroke();
      ctx.beginPath();
      arcCount = 0;
      vertexCount = 0;
      hasPath = false;
    };

    for (let index = 0; index < n; index++) {
      const arcId = arcIds?.[index] ?? index;
      if (filter && !filter(arcId)) continue;
      const arcVertexCount = vertexCounts?.[arcId] ?? 1;
      if (
        hasPath &&
        (arcCount >= ARC_STROKE_BATCH_ARC_LIMIT ||
          vertexCount + arcVertexCount > ARC_STROKE_BATCH_VERTEX_LIMIT)
      ) {
        flush();
      }
      const iter = arcs.getArcIter(arcId);
      this.drawPathSnapping(iter, ctx);
      arcCount++;
      vertexCount += arcVertexCount;
      hasPath = true;
    }
    flush();
  }

  // Equivalent to mapshaper's drawPath2 with optimized rounding
  private drawPathSnapping(iter: ArcIterator, ctx: CanvasRenderingContext2D): void {
    // Cache transform values in local variables (Chrome 80+ performance workaround)
    const mx = this._transform.mx * this._pixelRatio;
    const my = this._transform.my * this._pixelRatio;
    const bx = this._transform.bx * this._pixelRatio;
    const by = this._transform.by * this._pixelRatio;

    let x: number, y: number, xp: number, yp: number;
    let count = 0;
    if (!iter.hasNext()) return;

    // Use half-pixel snapping for crisper 1px lines (Mapshaper's roundToHalfPix)
    x = ((iter.x * mx + bx) * 2) | 0;
    y = ((iter.y * my + by) * 2) | 0;
    ctx.moveTo(x / 2, y / 2);

    while (iter.hasNext()) {
      xp = x;
      yp = y;
      x = ((iter.x * mx + bx) * 2) | 0;
      y = ((iter.y * my + by) * 2) | 0;

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

  drawPoints(_shapes: readonly (FeatureShape | null | undefined)[], _style: PointStyle): void {
    const ctx = this._ctx;
    const pr = this._pixelRatio;
    const mx = this._transform.mx * pr;
    const my = this._transform.my * pr;
    const bx = this._transform.bx * pr;
    const by = this._transform.by * pr;
    const radius = (Number(_style?.radius) || 4) * pr;
    const color = _style?.color || '#333';
    const fill = _style?.fill !== false;
    const markerShape = _style?.shape ?? 'circle';
    const left = -radius;
    const top = -radius;
    const right = this._canvas.width + radius;
    const bottom = this._canvas.height + radius;

    ctx.fillStyle = color;
    ctx.strokeStyle = color;

    // Flush the accumulated path every `batchSize` points. A single Canvas2D
    // path holding tens of thousands of sub-paths makes fill()/stroke() cost
    // super-linear in Skia (an 80k-point fill measures ~18s); batching keeps
    // it linear (~10ms). Mirrors the batching in drawPaths()/drawArcs().
    const batchSize = 100;
    let count = 0;
    ctx.beginPath();

    _shapes.forEach((shape) => {
      if (!shape) return;
      const points = normalizePointShape(shape);
      points.forEach((p) => {
        const x = p[0] * mx + bx;
        const y = p[1] * my + by;
        if (x < left || x > right || y < top || y > bottom) return;
        if (count > 0 && count % batchSize === 0) {
          if (fill) ctx.fill();
          else ctx.stroke();
          ctx.beginPath();
        }
        addPointMarkerPath(ctx, x, y, radius, markerShape);
        count++;
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
    shapes: readonly (FeatureShape | null | undefined)[],
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
    const arcFilter = style.arcFilter;
    const left = -dotRadius;
    const top = -dotRadius;
    const right = this._canvas.width + dotRadius;
    const bottom = this._canvas.height + dotRadius;
    let hoverPx: [number, number] | null = null;
    if (hoverVertex) {
      hoverPx = [hoverVertex[0] * mx + bx, hoverVertex[1] * my + by];
    }

    // Draw normal vertex dots
    ctx.fillStyle = dotColor;
    ctx.beginPath();

    shapes.forEach((shape) => {
      if (!shape) return;
      (shape as PathShape).forEach((part) => {
        part.forEach((arcId) => {
          const absId = arcId >= 0 ? arcId : ~arcId;
          if (arcFilter && !arcFilter(absId)) return;
          const iter = arcs.getArcIter(absId);
          while (iter.hasNext()) {
            const x = iter.x * mx + bx;
            const y = iter.y * my + by;
            if (x < left || x > right || y < top || y > bottom) continue;
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
    shapes: readonly (FeatureShape | null | undefined)[],
    arcs: ArcCollection,
    fillColor: string,
    filter?: (i: number) => boolean,
    /**
     * Multiplier on top of `fillColor`'s own alpha. `1` (default) leaves
     * the colour as-is; `0.5` halves the resulting alpha. Matches MapLibre's
     * `fill-opacity` semantics, independent of the colour's own alpha.
     */
    opacity?: number,
    options: PolygonFillOptions = {},
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

    // Smaller batches keep each `fill('evenodd')` call's path object
    // bounded because Canvas2D engines slow superlinearly with subpath count.
    // Keep mapshaper's same-style batching idea, but also cap by vertex
    // budget because a few huge features can be much more expensive than
    // hundreds of tiny polygons. Do not split a single shape across flushes:
    // polygon holes have to stay in the same evenodd path as their shell.
    const viewBBox = options.viewBBox ?? null;
    const vertexCounts = arcs.getVertexData?.().nn ?? null;
    const getSimpleShapeBbox = viewBBox ? arcs.getSimpleShapeBbox : undefined;
    const bbox = [0, 0, 0, 0];
    let shapeCount = 0;
    let vertexCount = 0;

    ctx.beginPath();
    for (let sIdx = 0; sIdx < shapes.length; sIdx++) {
      const shape = shapes[sIdx];
      if (!shape) continue;

      const pathShape = shape as PathShape;
      let visiblePartCount = 0;
      let shapeVertexCount = 0;
      for (const part of pathShape) {
        const visible =
          getSimpleShapeBbox && viewBBox
            ? partIntersectsView(part, getSimpleShapeBbox, viewBBox, bbox)
            : partPassesArcFilter(part, filter);
        if (!visible) continue;
        visiblePartCount++;
        if (vertexCounts) {
          for (const arcId of part) {
            shapeVertexCount += vertexCounts[absArcId(arcId)] ?? 0;
          }
        } else {
          shapeVertexCount++;
        }
      }
      if (visiblePartCount === 0) continue;

      if (
        shapeCount > 0 &&
        (shapeCount >= POLYGON_FILL_BATCH_SHAPE_LIMIT ||
          vertexCount + shapeVertexCount > POLYGON_FILL_BATCH_VERTEX_LIMIT)
      ) {
        ctx.fill('evenodd');
        ctx.beginPath();
        shapeCount = 0;
        vertexCount = 0;
      }

      for (const part of pathShape) {
        const visible =
          getSimpleShapeBbox && viewBBox
            ? partIntersectsView(part, getSimpleShapeBbox, viewBBox, bbox)
            : partPassesArcFilter(part, filter);
        if (!visible) continue;
        // getShapeIter respects arc direction (reversed arcs traversed backwards)
        const iter = arcs.getShapeIter!(part);
        if (!iter.hasNext()) continue;

        let xp: number, yp: number;
        // Use half-pixel snapping for consistency and to avoid floating point math overhead
        let x = ((iter.x * mx + bx) * 2) | 0;
        let y = ((iter.y * my + by) * 2) | 0;
        ctx.moveTo(x / 2, y / 2);

        while (iter.hasNext()) {
          xp = x;
          yp = y;
          x = ((iter.x * mx + bx) * 2) | 0;
          y = ((iter.y * my + by) * 2) | 0;

          if (x !== xp || y !== yp) {
            ctx.lineTo(x / 2, y / 2);
          }
        }
      }

      shapeCount++;
      vertexCount += shapeVertexCount;
    }

    if (shapeCount > 0) {
      ctx.fill('evenodd');
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
    const proj = (c: [number, number]): [number, number] => [c[0] * mx + bx, c[1] * my + by];

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
