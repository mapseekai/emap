import { CanvasPointIcons } from './icons/canvas';
import type { PointIcon } from './icons/images';
import { drawCanvasLabels, type LabelFrame } from './labels/manager';
import {
  type EditPainter,
  type DrawOverlayState,
  type ArrowDotPathOptions,
  type MeasurementOverlayState,
  type PolygonFillOptions,
} from './painter';
import { AffineTransform } from '../../domain/geo/transform';
import { normalizePointShape } from '../../domain/source/layer-utils';
import {
  EMAP_THEME_COLORS,
  EMAP_THEME_FALLBACKS,
  resolveThemeColor,
  type ThemeColorRole,
} from '../../ui/theme/colors';
import {
  absArcId,
  type ArcCollection,
  type ArcIterator,
  type FeatureShape,
  type PathShape,
  type PointMarkerShape,
  type StrokeStyle,
  type PointStyle,
  type VertexDotStyle,
} from '../../shared/types/mapshaper-types';

const ARC_STROKE_BATCH_ARC_LIMIT = 100;
const ARC_STROKE_BATCH_VERTEX_LIMIT = 12_000;
const ARROW_DOT_BATCH_SEGMENT_LIMIT = 12_000;
const VERTEX_DOT_BATCH_LIMIT = 100;
const ARROW_DOT_CACHE_ENTRY_LIMIT = 64;
const ARROW_DOT_CACHE_BYTE_LIMIT = 32 * 1024 * 1024;
// Small polygons often collapse to points at full extent. Retain their exact
// Canvas commands in bounded typed arrays; larger paths keep immediate drawing.
const FILL_PATH_CACHE_BYTES = 32 * 1024 * 1024;
type LayerContext = Parameters<NonNullable<EditPainter['setLayerContext']>>[0];
interface FillPathCache {
  sourceId: string;
  revision: number;
  shapes: readonly (FeatureShape | null | undefined)[];
  arcs: ArcCollection;
  view: string;
  interval: number | undefined;
  /** 0 immediate, 1 move-only fill, 2 empty fill, 3 fully culled. */
  states: Uint8Array;
  points: Int32Array;
  bytes: number;
}
const DEFAULT_ARROW_DOT_SPACING = 32;
const DEFAULT_ARROW_DOT_SIZE = 6;
const MIN_ARROW_DOT_VALUE = 0.1;
const STAR_INNER_RADIUS_RATIO = 0.45;
const CROSS_ARM_RADIUS_RATIO = 0.4;
const THEME_TOKEN_ROLES: Record<string, ThemeColorRole> = {
  [EMAP_THEME_COLORS.foreground]: 'foreground',
  [EMAP_THEME_COLORS.primary]: 'primary',
  [EMAP_THEME_COLORS.muted]: 'muted',
  [EMAP_THEME_COLORS.selection]: 'selection',
  [EMAP_THEME_COLORS.destructive]: 'destructive',
};
const THEME_ROLE_VARIABLES: Record<ThemeColorRole, readonly string[]> = {
  foreground: ['--foreground', '--emap-foreground'],
  primary: ['--primary', '--emap-primary', '--emap-accent'],
  muted: ['--muted', '--emap-muted'],
  selection: ['--selection-bg', '--emap-selection-bg'],
  destructive: ['--destructive', '--emap-destructive', '--emap-danger'],
};

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

const CLIP_LEFT = 1;
const CLIP_RIGHT = 2;
const CLIP_TOP = 4;
const CLIP_BOTTOM = 8;

function getClipOutCode(x: number, y: number, right: number, bottom: number): number {
  let code = 0;
  if (x < 0) code |= CLIP_LEFT;
  else if (x > right) code |= CLIP_RIGHT;
  if (y < 0) code |= CLIP_TOP;
  else if (y > bottom) code |= CLIP_BOTTOM;
  return code;
}

function clipSegmentToCanvas(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  right: number,
  bottom: number,
  output: Float64Array,
): boolean {
  let code0 = getClipOutCode(x0, y0, right, bottom);
  let code1 = getClipOutCode(x1, y1, right, bottom);

  while (true) {
    if ((code0 | code1) === 0) {
      output[0] = x0;
      output[1] = y0;
      output[2] = x1;
      output[3] = y1;
      return true;
    }
    if ((code0 & code1) !== 0) return false;

    const code = code0 || code1;
    let x = 0;
    let y = 0;
    if ((code & CLIP_TOP) !== 0) {
      x = x0 + ((x1 - x0) * -y0) / (y1 - y0);
    } else if ((code & CLIP_BOTTOM) !== 0) {
      y = bottom;
      x = x0 + ((x1 - x0) * (bottom - y0)) / (y1 - y0);
    } else if ((code & CLIP_RIGHT) !== 0) {
      x = right;
      y = y0 + ((y1 - y0) * (right - x0)) / (x1 - x0);
    } else {
      y = y0 + ((y1 - y0) * -x0) / (x1 - x0);
    }

    if (code === code0) {
      x0 = x;
      y0 = y;
      code0 = getClipOutCode(x0, y0, right, bottom);
    } else {
      x1 = x;
      y1 = y;
      code1 = getClipOutCode(x1, y1, right, bottom);
    }
  }
}

interface ArrowDotCacheEntry {
  arcs: ArcCollection;
  shapes: ArrowDotPathOptions['shapes'];
  shapeIndices: Uint32Array | undefined;
  geometryRevision: number;
  mx: number;
  my: number;
  bx: number;
  by: number;
  pixelRatio: number;
  canvasWidth: number;
  canvasHeight: number;
  spacing: number;
  size: number;
  commands: Float64Array;
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

export class CanvasPainter implements EditPainter {
  private _ctx: CanvasRenderingContext2D;
  private _layerContext: LayerContext = null;
  private _fillPathCaches = new Map<string, FillPathCache>();
  private _fillPathBytes = 0;
  private _fillPathTransform = '';
  private _seenLayers = new Set<string>();
  private _icons: CanvasPointIcons | null = null;
  /** @internal */
  drawPointIcons(
    shapes: readonly (FeatureShape | null | undefined)[],
    icon: PointIcon,
    ids?: Uint32Array,
    components?: Uint32Array,
  ): void {
    (this._icons ??= new CanvasPointIcons()).draw(
      this._ctx,
      this._transform,
      this._pixelRatio,
      shapes,
      icon,
      ids,
      components,
    );
  }
  /** @internal */
  clearIcons(): void {
    this._icons?.clear();
    this._icons = null;
  }
  private _transform: AffineTransform = new AffineTransform();
  private _pixelRatio: number = window.devicePixelRatio || 1;
  private _arrowDotCache = new Map<string, ArrowDotCacheEntry>();
  private _arrowDotCacheBytes = 0;
  private _arrowDotCacheByteLimit = ARROW_DOT_CACHE_BYTE_LIMIT;
  private _computedStyle: CSSStyleDeclaration | null | undefined;
  private _arcVisitMarks = new Uint32Array(0);
  private _arcVisitEpoch = 0;
  private _pathArcCache = new WeakMap<
    Uint32Array,
    {
      shapes: readonly (FeatureShape | null | undefined)[];
      arcs: ArcCollection;
      revision: number;
      arcIds: Int32Array;
    }
  >();

  constructor(private _canvas: HTMLCanvasElement) {
    const ctx = _canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context');
    this._ctx = ctx;
  }

  private _resolveColor(value: string | undefined, role: ThemeColorRole): string {
    const color = value || EMAP_THEME_COLORS[role];
    if (!color.trim().startsWith('var(')) return color;
    const fallbackRole = THEME_TOKEN_ROLES[color] ?? role;
    if (this._computedStyle === undefined) {
      const view = this._canvas.ownerDocument?.defaultView;
      this._computedStyle = view?.getComputedStyle?.(this._canvas) ?? null;
    }
    const computed = this._computedStyle;
    const semanticToken = EMAP_THEME_COLORS[fallbackRole];
    return resolveThemeColor(color, EMAP_THEME_FALLBACKS[fallbackRole], (name) => {
      if (color === semanticToken && name === semanticToken.slice(4, -1)) {
        for (const variable of THEME_ROLE_VARIABLES[fallbackRole]) {
          const value = computed?.getPropertyValue(variable).trim();
          if (value) return value;
        }
        return '';
      }
      return computed?.getPropertyValue(name) ?? '';
    });
  }

  setTransform(transform: AffineTransform): void {
    const key = [transform.mx, transform.my, transform.bx, transform.by].join(',');
    if (key !== this._fillPathTransform) this.clearGeometryCache();
    this._fillPathTransform = key;
    this._transform = transform;
  }

  setPixelRatio(ratio: number): void {
    if (ratio !== this._pixelRatio) this.clearGeometryCache();
    this._pixelRatio = ratio;
  }

  setLayerContext(context: LayerContext): void {
    this._layerContext = context;
    if (context) this._seenLayers.add(context.id);
  }

  clearGeometryCache(scope?: { sourceId?: string; layerId?: string }): void {
    for (const [id, cache] of this._fillPathCaches) {
      if (scope?.sourceId && scope.sourceId !== cache.sourceId) continue;
      if (scope?.layerId && scope.layerId !== id) continue;
      this._fillPathBytes -= cache.bytes;
      this._fillPathCaches.delete(id);
    }
  }

  finishFrame(): void {
    for (const id of this._fillPathCaches.keys()) {
      if (!this._seenLayers.has(id)) this.clearGeometryCache({ layerId: id });
    }
  }

  dispose(): void {
    this.clearGeometryCache();
    this.clearIcons();
    this._arrowDotCache.clear();
    this._arrowDotCacheBytes = 0;
    this._pathArcCache = new WeakMap();
    this._arcVisitMarks = new Uint32Array(0);
    this._layerContext = null;
    this._seenLayers.clear();
  }

  private _fillPathCache(
    shapes: readonly (FeatureShape | null | undefined)[],
    arcs: ArcCollection,
    viewBBox: readonly number[] | null,
    filter: ((i: number) => boolean) | undefined,
  ): FillPathCache | undefined {
    const layer = this._layerContext;
    // Unversioned overlays and arbitrary dynamic filters keep immediate paths.
    // Bounds-based part culling is reproducible from the view key below.
    if (!layer || (filter && (!viewBBox || !arcs.getSimpleShapeBbox))) return;
    const { mx, my, bx, by } = this._transform;
    const view = [mx, my, bx, by, this._pixelRatio, ...(viewBBox ?? [])].join(',');
    const interval = arcs.getRetainedInterval?.();
    let cache = this._fillPathCaches.get(layer.id);
    if (
      cache &&
      (cache.sourceId !== layer.sourceId ||
        cache.revision !== layer.revision ||
        cache.shapes !== shapes ||
        cache.arcs !== arcs ||
        cache.view !== view ||
        cache.interval !== interval)
    ) {
      this.clearGeometryCache({ layerId: layer.id });
      cache = undefined;
    }
    if (!cache) {
      const stateBytes = shapes.length * 9;
      if (this._fillPathBytes + stateBytes > FILL_PATH_CACHE_BYTES) return;
      cache = {
        sourceId: layer.sourceId,
        revision: layer.revision,
        shapes,
        arcs,
        view,
        interval,
        states: new Uint8Array(shapes.length),
        points: new Int32Array(shapes.length * 2),
        bytes: stateBytes,
      };
      this._fillPathBytes += stateBytes;
      this._fillPathCaches.set(layer.id, cache);
    }
    return cache;
  }

  drawPaths(
    shapes: readonly (FeatureShape | null | undefined)[],
    style: StrokeStyle,
    arcs: ArcCollection,
    arcFilter?: (i: number) => boolean,
    shapeIndices?: Uint32Array,
    geometryRevision?: number,
  ): void {
    if (style.width === 0) return;
    if (shapeIndices && geometryRevision !== undefined) {
      let cached = this._pathArcCache.get(shapeIndices);
      if (
        !cached ||
        cached.shapes !== shapes ||
        cached.arcs !== arcs ||
        cached.revision !== geometryRevision
      ) {
        const epoch = this._beginArcVisit(arcs.size());
        const ids: number[] = [];
        for (const shapeId of shapeIndices) {
          const shape = shapes[shapeId];
          if (!shape) continue;
          for (const part of shape as PathShape) {
            for (const signedId of part) {
              const id = absArcId(signedId);
              if (this._arcVisitMarks[id] === epoch) continue;
              this._arcVisitMarks[id] = epoch;
              ids.push(signedId);
            }
          }
        }
        cached = {
          shapes,
          arcs,
          revision: geometryRevision,
          arcIds: Int32Array.from(ids),
        };
        this._pathArcCache.set(shapeIndices, cached);
      }
      this.drawArcs(arcs, style, arcFilter, cached.arcIds);
      return;
    }
    const ctx = this._ctx;
    const vertexCounts = arcs.getVertexData?.().nn ?? null;
    const visitEpoch = this._beginArcVisit(arcs.size());

    this._applyStrokeStyle(style, style.dash ?? []);

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

    const shapeCount = shapeIndices?.length ?? shapes.length;
    for (let i = 0; i < shapeCount; i++) {
      const shape = shapes[shapeIndices?.[i] ?? i];
      if (!shape) continue;
      for (const part of shape as PathShape) {
        for (const signedArcId of part) {
          const arcId = absArcId(signedArcId);
          if (arcFilter && !arcFilter(arcId)) continue;
          if (this._arcVisitMarks[arcId] === visitEpoch) continue;
          this._arcVisitMarks[arcId] = visitEpoch;
          const arcVertexCount = vertexCounts?.[arcId] ?? 1;
          if (
            hasPath &&
            (arcCount >= ARC_STROKE_BATCH_ARC_LIMIT ||
              vertexCount + arcVertexCount > ARC_STROKE_BATCH_VERTEX_LIMIT)
          ) {
            flush();
          }
          this.drawPathSnapping(arcs.getArcIter(signedArcId), ctx);
          arcCount++;
          vertexCount += arcVertexCount;
          hasPath = true;
        }
      }
    }
    flush();
  }

  private _beginArcVisit(arcCount: number): number {
    if (this._arcVisitMarks.length < arcCount) this._arcVisitMarks = new Uint32Array(arcCount);
    this._arcVisitEpoch = (this._arcVisitEpoch + 1) >>> 0;
    if (this._arcVisitEpoch === 0) {
      this._arcVisitMarks.fill(0);
      this._arcVisitEpoch = 1;
    }
    return this._arcVisitEpoch;
  }

  // Direct arc rendering for maximum performance (bypasses shape iteration)
  drawArcs(
    arcs: ArcCollection,
    style: StrokeStyle,
    filter?: (i: number) => boolean,
    arcIds?: Uint32Array | Int32Array,
    arrowDot?: ArrowDotPathOptions,
  ): void {
    if (style.width === 0) return;
    if (style.dashType === 'arrow-dot' && arrowDot) {
      this.drawArrowDotPaths(arcs, style, filter, arrowDot);
      return;
    }

    const ctx = this._ctx;
    const n = arcIds?.length ?? arcs.size();
    const vertexCounts = arcs.getVertexData?.().nn ?? null;

    this._applyStrokeStyle(style, style.dash ?? []);

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
      const signedArcId = arcIds?.[index] ?? index;
      const arcId = absArcId(signedArcId);
      if (filter && !filter(arcId)) continue;
      const arcVertexCount = vertexCounts?.[arcId] ?? 1;
      if (
        hasPath &&
        (arcCount >= ARC_STROKE_BATCH_ARC_LIMIT ||
          vertexCount + arcVertexCount > ARC_STROKE_BATCH_VERTEX_LIMIT)
      ) {
        flush();
      }
      const iter = arcs.getArcIter(signedArcId);
      this.drawPathSnapping(iter, ctx);
      arcCount++;
      vertexCount += arcVertexCount;
      hasPath = true;
    }
    flush();
  }

  // Equivalent to mapshaper's drawPath2 with optimized rounding
  private drawPathSnapping(iter: ArcIterator, ctx: CanvasRenderingContext2D): void {
    const count = this._traceSnapped(iter, ctx);

    // Draw tiny line if all coords round to same location (Mapshaper behavior)
    if (count === 0 && Number.isFinite(iter.x) && Number.isFinite(iter.y)) {
      const x =
        ((iter.x * this._transform.mx * this._pixelRatio + this._transform.bx * this._pixelRatio) *
          2) |
        0;
      const y =
        ((iter.y * this._transform.my * this._pixelRatio + this._transform.by * this._pixelRatio) *
          2) |
        0;
      ctx.lineTo(x / 2 + 0.1, y / 2);
    }
  }

  private _applyStrokeStyle(style: StrokeStyle, dash: readonly number[]): void {
    const ctx = this._ctx;
    ctx.strokeStyle = this._resolveColor(style.color, 'foreground');
    ctx.lineWidth = (style.width ?? 1) * this._pixelRatio;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash(dash.map((length) => length * this._pixelRatio));
  }

  private _traceSnapped(
    iter: ArcIterator,
    ctx: Pick<CanvasRenderingContext2D, 'moveTo' | 'lineTo'>,
    point?: Int32Array,
  ): number {
    const mx = this._transform.mx * this._pixelRatio;
    const my = this._transform.my * this._pixelRatio;
    const bx = this._transform.bx * this._pixelRatio;
    const by = this._transform.by * this._pixelRatio;

    let x: number, y: number, xp: number, yp: number;
    let count = 0;
    // Mapshaper reuses iterators. An empty LOD arc can retain the previous
    // arc's x/y: distinguish it from a real point before drawing tiny strokes.
    if (!iter.hasNext()) return -1;

    x = ((iter.x * mx + bx) * 2) | 0;
    y = ((iter.y * my + by) * 2) | 0;
    ctx.moveTo(x / 2, y / 2);
    if (point) {
      point[0] = x;
      point[1] = y;
    }

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

    return count;
  }

  private drawArrowDotPaths(
    arcs: ArcCollection,
    style: StrokeStyle,
    filter: ((i: number) => boolean) | undefined,
    options: ArrowDotPathOptions,
  ): void {
    const ctx = this._ctx;
    const commands = this.getArrowDotCommands(arcs, style, filter, options);
    if (commands.length === 0) return;

    this._applyStrokeStyle(style, []);

    let segmentCount = 0;
    ctx.beginPath();
    for (let i = 0; i < commands.length; i += 4) {
      ctx.moveTo(commands[i], commands[i + 1]);
      ctx.lineTo(commands[i + 2], commands[i + 3]);
      segmentCount += 1;
      if (segmentCount >= ARROW_DOT_BATCH_SEGMENT_LIMIT) {
        ctx.stroke();
        ctx.beginPath();
        segmentCount = 0;
      }
    }
    if (segmentCount > 0) ctx.stroke();
  }

  private getArrowDotCommands(
    arcs: ArcCollection,
    style: StrokeStyle,
    filter: ((i: number) => boolean) | undefined,
    options: ArrowDotPathOptions,
  ): Float64Array {
    const transform = this._transform;
    const pixelRatio = this._pixelRatio;
    const spacing = Math.max(
      MIN_ARROW_DOT_VALUE,
      (style.arrowSpacing ?? DEFAULT_ARROW_DOT_SPACING) * pixelRatio,
    );
    const size = Math.max(
      MIN_ARROW_DOT_VALUE,
      (style.arrowSize ?? DEFAULT_ARROW_DOT_SIZE) * pixelRatio,
    );
    const cached = this._arrowDotCache.get(options.cacheKey);
    if (
      cached &&
      cached.arcs === arcs &&
      cached.shapes === options.shapes &&
      cached.shapeIndices === options.shapeIndices &&
      cached.geometryRevision === options.geometryRevision &&
      cached.mx === transform.mx &&
      cached.my === transform.my &&
      cached.bx === transform.bx &&
      cached.by === transform.by &&
      cached.pixelRatio === pixelRatio &&
      cached.canvasWidth === this._canvas.width &&
      cached.canvasHeight === this._canvas.height &&
      cached.spacing === spacing &&
      cached.size === size
    ) {
      this._arrowDotCache.delete(options.cacheKey);
      this._arrowDotCache.set(options.cacheKey, cached);
      return cached.commands;
    }

    const commands = this.buildArrowDotCommands(
      arcs,
      filter,
      options.shapes,
      options.shapeIndices,
      spacing,
      size,
    );
    this._storeArrowDotCache(options.cacheKey, {
      arcs,
      shapes: options.shapes,
      shapeIndices: options.shapeIndices,
      geometryRevision: options.geometryRevision,
      mx: transform.mx,
      my: transform.my,
      bx: transform.bx,
      by: transform.by,
      pixelRatio,
      canvasWidth: this._canvas.width,
      canvasHeight: this._canvas.height,
      spacing,
      size,
      commands,
    });
    return commands;
  }

  private _storeArrowDotCache(key: string, entry: ArrowDotCacheEntry): void {
    const previous = this._arrowDotCache.get(key);
    if (previous) {
      this._arrowDotCache.delete(key);
      this._arrowDotCacheBytes -= previous.commands.byteLength;
    }

    const bytes = entry.commands.byteLength;
    if (bytes > this._arrowDotCacheByteLimit) return;
    while (
      this._arrowDotCache.size > 0 &&
      (this._arrowDotCache.size >= ARROW_DOT_CACHE_ENTRY_LIMIT ||
        this._arrowDotCacheBytes + bytes > this._arrowDotCacheByteLimit)
    ) {
      const oldestKey = this._arrowDotCache.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = this._arrowDotCache.get(oldestKey);
      this._arrowDotCache.delete(oldestKey);
      if (oldest) this._arrowDotCacheBytes -= oldest.commands.byteLength;
    }
    this._arrowDotCache.set(key, entry);
    this._arrowDotCacheBytes += bytes;
  }

  private buildArrowDotCommands(
    arcs: ArcCollection,
    filter: ((i: number) => boolean) | undefined,
    shapes: ArrowDotPathOptions['shapes'],
    shapeIndices: Uint32Array | undefined,
    spacing: number,
    size: number,
  ): Float64Array {
    const commands: number[] = [];
    const clipped = new Float64Array(4);
    const mx = this._transform.mx * this._pixelRatio;
    const my = this._transform.my * this._pixelRatio;
    const bx = this._transform.bx * this._pixelRatio;
    const by = this._transform.by * this._pixelRatio;
    const right = this._canvas.width;
    const bottom = this._canvas.height;

    const shapeCount = shapeIndices?.length ?? shapes.length;
    for (let shapeIndex = 0; shapeIndex < shapeCount; shapeIndex++) {
      const shape = shapes[shapeIndices?.[shapeIndex] ?? shapeIndex];
      if (!shape) continue;
      for (const part of shape) {
        let visibleDistance = 0;
        let lastVisibleX = Number.NaN;
        let lastVisibleY = Number.NaN;

        for (const signedArcId of part) {
          if (filter && !filter(absArcId(signedArcId))) {
            visibleDistance = 0;
            lastVisibleX = Number.NaN;
            lastVisibleY = Number.NaN;
            continue;
          }

          const iter = arcs.getArcIter(signedArcId);
          if (!iter.hasNext()) continue;
          let x0 = iter.x * mx + bx;
          let y0 = iter.y * my + by;

          while (iter.hasNext()) {
            const x1 = iter.x * mx + bx;
            const y1 = iter.y * my + by;
            if (
              clipSegmentToCanvas(x0, y0, x1, y1, right, bottom, clipped) &&
              (clipped[0] !== clipped[2] || clipped[1] !== clipped[3])
            ) {
              if (
                !Number.isFinite(lastVisibleX) ||
                Math.abs(lastVisibleX - clipped[0]) > 0.01 ||
                Math.abs(lastVisibleY - clipped[1]) > 0.01
              ) {
                visibleDistance = 0;
              }
              visibleDistance = this.appendArrowDotSegment(
                commands,
                clipped[0],
                clipped[1],
                clipped[2],
                clipped[3],
                visibleDistance,
                spacing,
                size,
              );
              lastVisibleX = clipped[2];
              lastVisibleY = clipped[3];
            } else {
              visibleDistance = 0;
              lastVisibleX = Number.NaN;
              lastVisibleY = Number.NaN;
            }
            x0 = x1;
            y0 = y1;
          }
        }
      }
    }
    return Float64Array.from(commands);
  }

  private appendArrowDotSegment(
    commands: number[],
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    startDistance: number,
    spacing: number,
    size: number,
  ): number {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = Math.hypot(dx, dy);
    if (length === 0) return startDistance;

    const ux = dx / length;
    const uy = dy / length;
    const endDistance = startDistance + length;
    const dashLength = Math.min(spacing * 0.55, Math.max(spacing * 0.35, size * 1.5));
    const arrowOffset = spacing * 0.78;
    const halfWidth = size * 0.45;
    const backLength = Math.sqrt(size * size - halfWidth * halfWidth);
    let cycle = Math.floor(startDistance / spacing);

    while (cycle * spacing < endDistance) {
      const cycleStart = cycle * spacing;
      const visibleDashStart = Math.max(startDistance, cycleStart);
      const visibleDashEnd = Math.min(endDistance, cycleStart + dashLength);
      if (visibleDashEnd > visibleDashStart) {
        const t0 = (visibleDashStart - startDistance) / length;
        const t1 = (visibleDashEnd - startDistance) / length;
        commands.push(x0 + dx * t0, y0 + dy * t0, x0 + dx * t1, y0 + dy * t1);
      }

      const arrowDistance = cycleStart + arrowOffset;
      if (arrowDistance >= startDistance && arrowDistance < endDistance) {
        const t = (arrowDistance - startDistance) / length;
        const tipX = x0 + dx * t;
        const tipY = y0 + dy * t;
        const baseX = tipX - ux * backLength;
        const baseY = tipY - uy * backLength;
        const leftX = baseX - uy * halfWidth;
        const leftY = baseY + ux * halfWidth;
        const rightX = baseX + uy * halfWidth;
        const rightY = baseY - ux * halfWidth;
        commands.push(tipX, tipY, leftX, leftY, tipX, tipY, rightX, rightY);
      }
      cycle += 1;
    }
    return endDistance;
  }

  drawPoints(
    _shapes: readonly (FeatureShape | null | undefined)[],
    _style: PointStyle,
    shapeIndices?: Uint32Array,
    componentIndices?: Uint32Array,
  ): void {
    const ctx = this._ctx;
    const pr = this._pixelRatio;
    const mx = this._transform.mx * pr;
    const my = this._transform.my * pr;
    const bx = this._transform.bx * pr;
    const by = this._transform.by * pr;
    const radius = (_style.radius ?? 4) * pr;
    if (!Number.isFinite(radius) || radius <= 0) return;
    const color = this._resolveColor(_style?.color, 'foreground');
    const fill = _style?.fill !== false;
    const markerShape = _style?.shape ?? 'circle';
    const left = -radius;
    const top = -radius;
    const right = this._canvas.width + radius;
    const bottom = this._canvas.height + radius;

    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    if (!fill) {
      ctx.lineWidth = pr;
      ctx.lineJoin = 'miter';
      ctx.lineCap = 'butt';
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }

    // Flush the accumulated path every `batchSize` points. A single Canvas2D
    // path holding tens of thousands of sub-paths makes fill()/stroke() cost
    // super-linear in Skia (an 80k-point fill measures ~18s); batching keeps
    // it linear (~10ms). Mirrors the batching in drawPaths()/drawArcs().
    // Only opaque colors can share a fill without changing source-over alpha.
    // Canvas normalizes opaque sRGB paints to hex; other CSS colors take the
    // conservative per-point path, including modern color functions.
    const opaque = /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(String(ctx.fillStyle || color));
    const batchSize = opaque && (ctx.globalAlpha ?? 1) === 1 ? 100 : 1;
    let count = 0;
    ctx.beginPath();

    const shapeCount = shapeIndices?.length ?? _shapes.length;
    for (let shapeIndex = 0; shapeIndex < shapeCount; shapeIndex++) {
      const shape = _shapes[shapeIndices?.[shapeIndex] ?? shapeIndex];
      if (!shape) continue;
      const points = normalizePointShape(shape);
      const first = componentIndices?.[shapeIndex] ?? 0;
      const end = componentIndices ? first + 1 : points.length;
      for (let component = first; component < end; component++) {
        const p = points[component];
        if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
        const x = p[0] * mx + bx;
        const y = p[1] * my + by;
        if (x < left || x > right || y < top || y > bottom) continue;
        if (count > 0 && count % batchSize === 0) {
          if (fill) ctx.fill();
          else ctx.stroke();
          ctx.beginPath();
        }
        addPointMarkerPath(ctx, x, y, radius, markerShape);
        count++;
      }
    }

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

    const dotColor = this._resolveColor(style.dotColor, 'primary');
    const dotRadius = (style.dotRadius || 3) * pr;
    const hoverColor = this._resolveColor(style.hoverColor, 'primary');
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

    // Shared topology can reference the same arc from many features. Visit each
    // visible arc once, and flush small Canvas paths: large circle paths become
    // super-linear in Skia just like ordinary point rendering.
    ctx.fillStyle = dotColor;
    let dotCount = 0;
    const arcCount = typeof arcs.size === 'function' ? arcs.size() : 0;
    const visitEpoch = arcCount > 0 ? this._beginArcVisit(arcCount) : 0;
    const fallbackVisited = visitEpoch === 0 ? new Set<number>() : null;
    const flushDots = () => {
      if (dotCount === 0) return;
      ctx.fill();
      ctx.beginPath();
      dotCount = 0;
    };
    ctx.beginPath();

    for (const shape of shapes) {
      if (!shape) continue;
      for (const part of shape as PathShape) {
        for (const arcId of part) {
          const absId = absArcId(arcId);
          if (arcFilter && !arcFilter(absId)) continue;
          if (fallbackVisited) {
            if (fallbackVisited.has(absId)) continue;
            fallbackVisited.add(absId);
          } else {
            if (this._arcVisitMarks[absId] === visitEpoch) continue;
            this._arcVisitMarks[absId] = visitEpoch;
          }
          const iter = arcs.getArcIter(absId);
          while (iter.hasNext()) {
            const x = iter.x * mx + bx;
            const y = iter.y * my + by;
            if (x < left || x > right || y < top || y > bottom) continue;
            // Skip hover vertex (drawn separately with larger radius).
            if (hoverPx && Math.abs(x - hoverPx[0]) < 1 && Math.abs(y - hoverPx[1]) < 1) continue;
            if (dotCount >= VERTEX_DOT_BATCH_LIMIT) flushDots();
            ctx.moveTo(x + dotRadius, y);
            ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
            dotCount++;
          }
        }
      }
    }
    flushDots();

    if (style.selectedVertices?.length) {
      ctx.fillStyle = this._resolveColor(style.selectedColor, 'selection');
      ctx.beginPath();
      for (const vertex of style.selectedVertices) {
        const x = vertex[0] * mx + bx;
        const y = vertex[1] * my + by;
        ctx.arc(x, y, hoverRadius, 0, Math.PI * 2);
      }
      ctx.fill();
    }

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

  drawVertexBand(band: { x0: number; y0: number; x1: number; y1: number }): void {
    const pr = this._pixelRatio;
    const ctx = this._ctx;
    const x = Math.min(band.x0, band.x1) * pr;
    const y = Math.min(band.y0, band.y1) * pr;
    const width = Math.abs(band.x1 - band.x0) * pr;
    const height = Math.abs(band.y1 - band.y0) * pr;
    ctx.save();
    ctx.strokeStyle = this._resolveColor(EMAP_THEME_COLORS.selection, 'selection');
    ctx.lineWidth = pr;
    ctx.setLineDash([4 * pr, 3 * pr]);
    ctx.strokeRect(x, y, width, height);
    ctx.restore();
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

    const overrideAlpha = typeof opacity === 'number' && opacity !== 1;
    const prevAlpha = ctx.globalAlpha;
    if (overrideAlpha) {
      // `globalAlpha` multiplies into whatever alpha the rgba/hex string
      // already encodes, so callers can compose color-baked transparency
      // with this style-level opacity.
      ctx.globalAlpha = prevAlpha * Math.max(0, Math.min(1, opacity!));
    }

    const viewBBox = options.viewBBox ?? null;
    const buckets = options.styleBuckets;
    if (buckets) {
      for (let b = 0; b < buckets.buckets.length; b++) {
        if (buckets.buckets[b].length === 0) continue;
        ctx.fillStyle = this._resolveColor(buckets.colors[b], 'muted');
        this._fillShapeIndices(shapes, arcs, buckets.buckets[b], filter, viewBBox);
      }
    } else {
      ctx.fillStyle = this._resolveColor(fillColor, 'muted');
      this._fillShapeIndices(shapes, arcs, options.shapeIndices ?? null, filter, viewBBox);
    }

    if (overrideAlpha) ctx.globalAlpha = prevAlpha;
  }

  /**
   * Fill each independent feature separately. Its shell and holes share an
   * evenodd path, but another feature must not cancel its overlapping area.
   * Opacity uses normal per-feature source-over compositing. Style buckets
   * still avoid redundant style changes; viewport culling stays part-aware.
   */
  private _fillShapeIndices(
    shapes: readonly (FeatureShape | null | undefined)[],
    arcs: ArcCollection,
    indices: Uint32Array | null,
    filter: ((i: number) => boolean) | undefined,
    viewBBox: readonly [number, number, number, number] | number[] | null,
  ): void {
    const ctx = this._ctx;
    const getSimpleShapeBbox = viewBBox ? arcs.getSimpleShapeBbox?.bind(arcs) : undefined;
    const cache = this._fillPathCache(shapes, arcs, viewBBox, filter);
    const bbox = [0, 0, 0, 0];
    const point = cache ? new Int32Array(2) : undefined;
    const indexCount = indices ? indices.length : shapes.length;
    for (let k = 0; k < indexCount; k++) {
      const id = indices ? indices[k] : k;
      const state = cache?.states[id] ?? 0;
      if (state) {
        if (state === 3) continue;
        ctx.beginPath();
        if (state === 1) ctx.moveTo(cache!.points[id * 2] / 2, cache!.points[id * 2 + 1] / 2);
        ctx.fill('evenodd');
        continue;
      }
      const shape = shapes[id];
      if (!shape) continue;
      let segments = 0;
      let moves = 0;
      let hasVisiblePart = false;
      for (const part of shape as PathShape) {
        const visible =
          getSimpleShapeBbox && viewBBox
            ? partIntersectsView(part, getSimpleShapeBbox, viewBBox, bbox)
            : partPassesArcFilter(part, filter);
        if (!visible) continue;
        if (!hasVisiblePart) ctx.beginPath();
        hasVisiblePart = true;
        const count = this._traceSnapped(arcs.getShapeIter!(part), ctx, point);
        segments += Math.max(0, count);
        if (count >= 0) moves++;
      }
      if (cache && segments === 0 && moves <= 1) {
        cache.states[id] = !hasVisiblePart ? 3 : moves ? 1 : 2;
        if (moves) cache.points.set(point!, id * 2);
      }
      // Keep even move-only fills in the original order. Dropping these calls
      // changes native Canvas batching and dense translucent edge coverage.
      if (hasVisiblePart) ctx.fill('evenodd');
    }
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

    const color = this._resolveColor(state.drawColor, 'primary');
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
      ctx.strokeStyle = this._resolveColor(undefined, 'destructive');
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

  drawMeasurementOverlay(state: MeasurementOverlayState): void {
    const ctx = this._ctx;
    const pr = this._pixelRatio;
    const mx = this._transform.mx * pr;
    const my = this._transform.my * pr;
    const bx = this._transform.bx * pr;
    const by = this._transform.by * pr;
    const color = this._resolveColor(state.drawColor, 'primary');
    const project = (point: readonly [number, number]): [number, number] => [
      point[0] * mx + bx,
      point[1] * my + by,
    ];
    const drawPath = (path: readonly (readonly [number, number])[]): void => {
      const first = project(path[0]);
      ctx.moveTo(first[0], first[1]);
      for (let index = 1; index < path.length; index++) {
        const point = project(path[index]);
        ctx.lineTo(point[0], point[1]);
      }
    };

    if (state.mode === 'area' && state.fillPath && state.fillPath.length >= 3) {
      const previousAlpha = ctx.globalAlpha;
      ctx.globalAlpha = previousAlpha * 0.18;
      ctx.fillStyle = color;
      ctx.beginPath();
      drawPath(state.fillPath);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = previousAlpha;
    }

    if (state.committedPath.length >= 2) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 * pr;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.setLineDash([]);
      ctx.beginPath();
      drawPath(state.committedPath);
      ctx.stroke();
    }

    if (state.previewPath && state.previewPath.length >= 2) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5 * pr;
      ctx.setLineDash([6 * pr, 4 * pr]);
      ctx.beginPath();
      drawPath(state.previewPath);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (state.vertices.length > 0) {
      const radius = 4 * pr;
      ctx.fillStyle = color;
      ctx.beginPath();
      for (const vertex of state.vertices) {
        const point = project(vertex);
        ctx.moveTo(point[0] + radius, point[1]);
        ctx.arc(point[0], point[1], radius, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    const drawLabel = (
      text: string,
      coord: readonly [number, number],
      fontSize: number,
      background: string,
    ): void => {
      const point = project(coord);
      const padding = 4 * pr;
      const height = (fontSize + 4) * pr;
      ctx.font = `${fontSize * pr}px system-ui, sans-serif`;
      const width = ctx.measureText(text).width;
      ctx.fillStyle = background;
      ctx.fillRect(point[0], point[1] - height, width + padding * 2, height);
      ctx.fillStyle = color;
      ctx.fillText(text, point[0] + padding, point[1] - padding);
    };

    for (const segment of state.segmentLabels) {
      drawLabel(segment.label, segment.coord, 11, 'rgba(255, 255, 255, 0.78)');
    }

    if (state.label && state.labelCoord) {
      drawLabel(state.label, state.labelCoord, 12, 'rgba(255, 255, 255, 0.92)');
    }
  }

  drawRasterImage(
    image: CanvasImageSource,
    bounds: readonly [number, number, number, number],
    opacity = 1,
    smoothing = true,
    clipBounds?: readonly [number, number, number, number],
  ): void {
    const [left, top] = this._transform.project(bounds[0], bounds[3]);
    const [right, bottom] = this._transform.project(bounds[2], bounds[1]);
    if (![left, top, right, bottom, opacity].every(Number.isFinite) || opacity <= 0) return;
    const ctx = this._ctx,
      pr = this._pixelRatio;
    // Every raster edge shares the same device-pixel quantization. Fractional
    // antialiased clip edges otherwise leave seams or multiply translucent pixels.
    const x0 = Math.round(left * pr),
      y0 = Math.round(top * pr);
    const x1 = Math.round(right * pr),
      y1 = Math.round(bottom * pr);
    if (x1 <= x0 || y1 <= y0) return;
    let clip: [number, number, number, number] | undefined;
    if (clipBounds) {
      const [cl, ct] = this._transform.project(clipBounds[0], clipBounds[3]);
      const [cr, cb] = this._transform.project(clipBounds[2], clipBounds[1]);
      if (![cl, ct, cr, cb].every(Number.isFinite)) return;
      const cx0 = Math.max(x0, Math.round(cl * pr)),
        cy0 = Math.max(y0, Math.round(ct * pr));
      const cx1 = Math.min(x1, Math.round(cr * pr)),
        cy1 = Math.min(y1, Math.round(cb * pr));
      if (cx1 <= cx0 || cy1 <= cy0) return;
      clip = [cx0, cy0, cx1 - cx0, cy1 - cy0];
    }
    ctx.save();
    try {
      if (clip) {
        ctx.beginPath();
        ctx.rect(...clip);
        ctx.clip();
      }
      ctx.globalAlpha = Math.min(1, opacity);
      ctx.imageSmoothingEnabled = smoothing;
      ctx.drawImage(image, x0, y0, x1 - x0, y1 - y0);
    } finally {
      ctx.restore();
    }
  }

  /** @internal Renderer-owned label frame; configure labels through LayerSpecification. */
  drawLabels(frame: LabelFrame): void {
    drawCanvasLabels(this._ctx, frame, this._pixelRatio);
  }

  clear(): void {
    this._seenLayers.clear();
    this._computedStyle = undefined;
    this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
  }

  resize(width: number, height: number): void {
    this.clearGeometryCache();
    const pr = this._pixelRatio;
    this._canvas.width = width * pr;
    this._canvas.height = height * pr;
    this._canvas.style.width = width + 'px';
    this._canvas.style.height = height + 'px';
  }
}
