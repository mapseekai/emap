import type { Control } from './control';
import type { Emap, FeatureRef } from '../map/map';
import { getLayerId, normalizePointShape } from '../source/layer-utils';
import type {
  ArcCollection,
  MapshaperLayer,
  PathShape,
} from '../types/mapshaper-types';

/** Visual style for the rubber-band lasso path. */
export interface LassoSelectStyle {
  /** Stroke color. Default `'#0078ff'`. */
  stroke?: string;
  /** Stroke width in CSS pixels. Default `1.5`. */
  strokeWidth?: number;
  /** Fill color of the closed shape preview. Default `'rgba(0, 120, 255, 0.1)'`. */
  fill?: string;
  /** SVG `stroke-dasharray` value. Default `'4 3'` (subtly dashed). */
  strokeDasharray?: string;
}

export interface LassoSelectControlOptions {
  /**
   * Restrict the selection to a subset of layer ids. When omitted, every
   * visible layer participates (matching `queryFeatures` default).
   */
  layers?: string[];
  /** Visual style of the lasso polyline. */
  style?: LassoSelectStyle;
  /**
   * Pixel diagonal threshold below which the drag is treated as no-op.
   * Default `4`.
   */
  dragThreshold?: number;
  /**
   * Select features that intersect the lasso boundary or interior, not only
   * features fully contained by it. Default `true`, matching box-select.
   */
  includeIntersecting?: boolean;
}

/**
 * Shift+drag free-form polygon feature selection. Sibling of
 * `BoxSelectControl` — same activation gesture, same modifier conventions,
 * different shape.
 *
 * The lasso path is recorded in pixel coordinates as the user drags. On
 * release, the closed polygon is used to test each candidate feature's
 * geometry; survivors are passed to `Emap.select`.
 *
 * Modifier-key conventions (layered on top of shift):
 * - shift only → mode `'replace'`
 * - shift + ctrl/meta → mode `'add'`
 * - shift + alt → mode `'toggle'`
 *
 * Coexistence with `BoxSelectControl`: both consume shift+drag. Pick one,
 * or install both and switch between them at runtime via `enable()` /
 * `disable()`.
 *
 * Hit-test semantics: by default, features are selected when their geometry
 * intersects or is contained by the lasso, matching box-select's inclusive
 * feel. Set `includeIntersecting: false` for strict containment.
 */
export class LassoSelectControl implements Control {
  private _options: LassoSelectControlOptions;
  private _dragThreshold: number;
  private _enabled: boolean = true;

  private _map: Emap | null = null;
  private _container: HTMLElement | null = null;
  private _svg: SVGSVGElement | null = null;
  private _polyline: SVGPolylineElement | null = null;
  private _canvasContainer: HTMLElement | null = null;

  /** Drag state — pixel-space path. null when not dragging. */
  private _path: Array<[number, number]> | null = null;

  // Bound handlers
  private _onMouseDownBound: (e: MouseEvent) => void;
  private _onMouseMoveBound: (e: MouseEvent) => void;
  private _onMouseUpBound: (e: MouseEvent) => void;

  constructor(options: LassoSelectControlOptions = {}) {
    this._options = options;
    this._dragThreshold = options.dragThreshold ?? 4;
    this._onMouseDownBound = this._onMouseDown.bind(this);
    this._onMouseMoveBound = this._onMouseMove.bind(this);
    this._onMouseUpBound = this._onMouseUp.bind(this);
  }

  onAdd(map: Emap): HTMLElement {
    this._map = map;
    this._canvasContainer = map.getCanvasContainer();

    // SVG overlay — absolutely positioned, full canvas-container size,
    // pointer-events: none so it doesn't eat mouse events.
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'emap-lasso-select');
    svg.style.position = 'absolute';
    svg.style.left = '0';
    svg.style.top = '0';
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.pointerEvents = 'none';
    svg.style.display = 'none';

    const polyline = document.createElementNS(svgNS, 'polyline');
    const style = this._options.style ?? {};
    polyline.setAttribute('stroke', style.stroke ?? '#0078ff');
    polyline.setAttribute('stroke-width', String(style.strokeWidth ?? 1.5));
    polyline.setAttribute('fill', style.fill ?? 'rgba(0, 120, 255, 0.1)');
    polyline.setAttribute('stroke-dasharray', style.strokeDasharray ?? '4 3');
    polyline.setAttribute('points', '');
    svg.appendChild(polyline);

    this._canvasContainer.appendChild(svg);
    this._svg = svg;
    this._polyline = polyline;

    this._canvasContainer.addEventListener('mousedown', this._onMouseDownBound);

    // 0×0 corner anchor (Control protocol expects an element to attach).
    const container = document.createElement('div');
    container.className = 'emap-ctrl emap-lasso-select-anchor';
    container.style.width = '0';
    container.style.height = '0';
    container.style.pointerEvents = 'none';
    this._container = container;
    return container;
  }

  onRemove(): void {
    if (this._canvasContainer) {
      this._canvasContainer.removeEventListener('mousedown', this._onMouseDownBound);
    }
    window.removeEventListener('mousemove', this._onMouseMoveBound);
    window.removeEventListener('mouseup', this._onMouseUpBound);

    if (this._svg?.parentNode) this._svg.parentNode.removeChild(this._svg);
    if (this._container?.parentNode) this._container.parentNode.removeChild(this._container);

    this._map = null;
    this._canvasContainer = null;
    this._svg = null;
    this._polyline = null;
    this._container = null;
    this._path = null;
  }

  /** Disable the control — shift+drag becomes a no-op until re-enabled. */
  disable(): void {
    this._enabled = false;
    if (this._path) this._cancelDrag();
  }

  enable(): void { this._enabled = true; }
  isEnabled(): boolean { return this._enabled; }

  // ---------------------------------------------------------------------------

  private _onMouseDown(e: MouseEvent): void {
    if (!this._enabled) return;
    if (!e.shiftKey) return;
    if (e.button !== 0) return;
    if (!this._canvasContainer || !this._svg || !this._polyline) return;

    e.preventDefault();
    const px = this._eventToContainerPx(e);
    this._path = [px];
    this._polyline.setAttribute('points', `${px[0]},${px[1]}`);
    this._svg.style.display = 'block';

    window.addEventListener('mousemove', this._onMouseMoveBound);
    window.addEventListener('mouseup', this._onMouseUpBound);
  }

  private _onMouseMove(e: MouseEvent): void {
    if (!this._path || !this._polyline) return;
    const px = this._eventToContainerPx(e);
    this._path.push(px);
    // Cheap append — re-serializing the whole points string is fine even
    // for thousand-point paths because SVG attribute updates are cheap.
    this._polyline.setAttribute('points', this._path.map((p) => `${p[0]},${p[1]}`).join(' '));
  }

  private _onMouseUp(e: MouseEvent): void {
    const path = this._path;
    if (!path || !this._map || !this._svg) {
      this._cleanupDrag();
      return;
    }

    this._svg.style.display = 'none';

    // Reject paths too short to be meaningful or whose bbox is below threshold.
    if (path.length < 3) {
      this._cleanupDrag();
      return;
    }
    const bbox = pathBBox(path);
    const dx = bbox[2] - bbox[0];
    const dy = bbox[3] - bbox[1];
    if (Math.hypot(dx, dy) < this._dragThreshold) {
      this._cleanupDrag();
      return;
    }

    // Closed polygon — append starting point so ray-casting wraps cleanly.
    const closed = path.slice();
    closed.push(path[0]);

    // Stage 1 — bbox prefilter via the existing query API.
    const candidates = this._map.queryFeatures(
      [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
      this._options.layers ? { layers: this._options.layers } : undefined,
    );

    // Stage 2: geometry refinement against the lasso polygon.
    const refs: FeatureRef[] = [];
    const seen = new Set<string>();
    const includeIntersecting = this._options.includeIntersecting !== false;
    for (const f of candidates) {
      const key = `${f.source}|${f.layer}|${f.id}`;
      if (seen.has(key)) continue;
      if (!featureMatchesLasso(this._map, f, closed, includeIntersecting)) continue;
      seen.add(key);
      refs.push({ source: f.source, layer: f.layer, id: f.id });
    }

    const mode = modeFromEvent(e);
    this._map.select(refs, { mode });
    this._cleanupDrag();
  }

  private _cancelDrag(): void {
    if (this._svg) this._svg.style.display = 'none';
    this._cleanupDrag();
  }

  private _cleanupDrag(): void {
    this._path = null;
    window.removeEventListener('mousemove', this._onMouseMoveBound);
    window.removeEventListener('mouseup', this._onMouseUpBound);
  }

  private _eventToContainerPx(e: MouseEvent): [number, number] {
    if (!this._canvasContainer) return [0, 0];
    const rect = this._canvasContainer.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }
}

// ---------------------------------------------------------------------------
// Module-private helpers — exported only for the test file.
// ---------------------------------------------------------------------------

/**
 * Even-odd ray-cast point-in-polygon test. The `polygon` may be open or
 * closed (last point == first point) — we don't require either form,
 * because we wrap via `j = (i - 1 + n) % n` modulo arithmetic. Self-
 * intersecting polygons follow standard even-odd semantics (which usually
 * matches the user's drawn intent).
 */
export function pointInPolygon(point: [number, number], polygon: Array<[number, number]>): boolean {
  const [x, y] = point;
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    // Standard half-open edge test — counts crossings strictly above the
    // ray (y < yi vs y < yj inequality direction differs by edge slope).
    const intersect = (yi > y) !== (yj > y) &&
      x < (xj - xi) * (y - yi) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** [xmin, ymin, xmax, ymax] of a 2-D point sequence. */
function pathBBox(path: Array<[number, number]>): [number, number, number, number] {
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  for (const [x, y] of path) {
    if (x < xmin) xmin = x;
    if (y < ymin) ymin = y;
    if (x > xmax) xmax = x;
    if (y > ymax) ymax = y;
  }
  return [xmin, ymin, xmax, ymax];
}

export function featureMatchesLasso(
  map: Emap,
  ref: { source: string; layer: string; id: number; geometryType?: string },
  lasso: Array<[number, number]>,
  includeIntersecting: boolean,
): boolean {
  const resolved = resolveFeatureShape(map, ref);
  if (!resolved) return false;

  if (resolved.layer.geometry_type === 'point') {
    const points = normalizePointShape(resolved.shape);
    if (points.length === 0) return false;
    const pixelPoints = points.map(([x, y]) => map.project(x, y) as [number, number]);
    return includeIntersecting
      ? pixelPoints.some((p) => pointInPolygonOrOnBoundary(p, lasso))
      : pixelPoints.every((p) => pointInPolygonOrOnBoundary(p, lasso));
  }

  if (!resolved.arcs) return false;
  const parts = pathShapeToPixelParts(map, resolved.shape as PathShape, resolved.arcs);
  if (parts.length === 0) return false;
  const isPolygonFeature = resolved.layer.geometry_type === 'polygon';
  return includeIntersecting
    ? pathIntersectsPolygon(parts, lasso, isPolygonFeature)
    : pathContainedByPolygon(parts, lasso, isPolygonFeature);
}

function resolveFeatureShape(
  map: Emap,
  ref: { source: string; layer: string; id: number },
): { layer: MapshaperLayer; shape: unknown; arcs?: ArcCollection } | null {
  const source = map.getSource(ref.source);
  if (!source) return null;

  let layer = map.layers?.resolve(ref.source, ref.layer) as MapshaperLayer | null | undefined;
  if (!layer) {
    const dataset = source.getDataset?.();
    layer = dataset?.layers.find((l: MapshaperLayer, i: number) =>
      getLayerId(l, i) === ref.layer || l?.name === ref.layer || l?.id === ref.layer,
    );
  }
  if (!layer?.shapes) return null;
  const shape = layer.shapes?.[ref.id];
  if (!shape) return null;
  return { layer, shape, arcs: source.getArcs?.() };
}

function pathShapeToPixelParts(map: Emap, shape: PathShape, arcs: ArcCollection): Array<Array<[number, number]>> {
  const parts: Array<Array<[number, number]>> = [];
  for (const part of shape) {
    const points: Array<[number, number]> = [];
    const iter = arcs.getShapeIter?.(part);
    if (iter) {
      while (iter.hasNext()) points.push(map.project(iter.x, iter.y) as [number, number]);
    } else {
      for (const rawArcId of part) {
        const arcId = rawArcId >= 0 ? rawArcId : ~rawArcId;
        const arcIter = arcs.getArcIter(arcId);
        while (arcIter.hasNext()) points.push(map.project(arcIter.x, arcIter.y) as [number, number]);
      }
    }
    if (points.length > 0) parts.push(points);
  }
  return parts;
}

function pathIntersectsPolygon(
  parts: Array<Array<[number, number]>>,
  polygon: Array<[number, number]>,
  isPolygonFeature: boolean,
): boolean {
  for (const part of parts) {
    if (part.some((p) => pointInPolygonOrOnBoundary(p, polygon))) return true;
    if (partSegmentsIntersectPolygon(part, polygon, isPolygonFeature)) return true;
  }
  if (isPolygonFeature && polygon.some((p) => pointInMultiPolygon(p, parts))) return true;
  return false;
}

function pathContainedByPolygon(
  parts: Array<Array<[number, number]>>,
  polygon: Array<[number, number]>,
  closeParts: boolean,
): boolean {
  for (const part of parts) {
    if (!part.every((p) => pointInPolygonOrOnBoundary(p, polygon))) return false;
    if (partSegmentsIntersectPolygon(part, polygon, closeParts)) return false;
  }
  return true;
}

function partSegmentsIntersectPolygon(
  part: Array<[number, number]>,
  polygon: Array<[number, number]>,
  closePart: boolean,
): boolean {
  const partClosed = closePart ? closePath(part) : part;
  const polyClosed = closePath(polygon);
  for (let i = 0; i < partClosed.length - 1; i++) {
    const a = partClosed[i];
    const b = partClosed[i + 1];
    for (let j = 0; j < polyClosed.length - 1; j++) {
      const c = polyClosed[j];
      const d = polyClosed[j + 1];
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

function pointInMultiPolygon(point: [number, number], parts: Array<Array<[number, number]>>): boolean {
  let inside = false;
  for (const part of parts) {
    if (pointOnPolygonBoundary(point, part)) return true;
    if (pointInPolygon(point, part)) inside = !inside;
  }
  return inside;
}

function pointInPolygonOrOnBoundary(point: [number, number], polygon: Array<[number, number]>): boolean {
  return pointOnPolygonBoundary(point, polygon) || pointInPolygon(point, polygon);
}

function pointOnPolygonBoundary(point: [number, number], polygon: Array<[number, number]>): boolean {
  const closed = closePath(polygon);
  for (let i = 0; i < closed.length - 1; i++) {
    if (pointOnSegment(point, closed[i], closed[i + 1])) return true;
  }
  return false;
}

function closePath(path: Array<[number, number]>): Array<[number, number]> {
  if (path.length < 2) return path;
  const first = path[0];
  const last = path[path.length - 1];
  if (samePoint(first, last)) return path;
  return [...path, first];
}

function segmentsIntersect(
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number],
): boolean {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);

  if (isZero(abC) && pointOnSegment(c, a, b)) return true;
  if (isZero(abD) && pointOnSegment(d, a, b)) return true;
  if (isZero(cdA) && pointOnSegment(a, c, d)) return true;
  if (isZero(cdB) && pointOnSegment(b, c, d)) return true;

  return (abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0);
}

function pointOnSegment(p: [number, number], a: [number, number], b: [number, number]): boolean {
  if (!isZero(cross(a, b, p))) return false;
  return p[0] >= Math.min(a[0], b[0]) - EPSILON &&
    p[0] <= Math.max(a[0], b[0]) + EPSILON &&
    p[1] >= Math.min(a[1], b[1]) - EPSILON &&
    p[1] <= Math.max(a[1], b[1]) + EPSILON;
}

function cross(a: [number, number], b: [number, number], c: [number, number]): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function samePoint(a: [number, number], b: [number, number]): boolean {
  return Math.abs(a[0] - b[0]) <= EPSILON && Math.abs(a[1] - b[1]) <= EPSILON;
}

function isZero(n: number): boolean {
  return Math.abs(n) <= EPSILON;
}

const EPSILON = 1e-9;

/** Translate an event's modifiers into a select mode. */
function modeFromEvent(e: MouseEvent): 'replace' | 'add' | 'toggle' {
  if (e.altKey) return 'toggle';
  if (e.ctrlKey || e.metaKey) return 'add';
  return 'replace';
}
