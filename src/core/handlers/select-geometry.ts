import { normalizePointShape, getLayerId } from '../../source/layer-utils';
import type {
  ArcCollection,
  MapshaperLayer,
  PathShape,
} from '../../types/mapshaper-types';
import type { Emap, FeatureRef } from '../../map/map';

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
export function pathBBox(path: Array<[number, number]>): [number, number, number, number] {
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

/** Dedupe `(source, layer, id)` triples — same feature can show up under
 *  multiple visible layers when a source has e.g. fill + line styling. */
export function dedupeRefs(features: ReadonlyArray<{ source: string; layer: string; id: number }>): FeatureRef[] {
  const seen = new Set<string>();
  const out: FeatureRef[] = [];
  for (const f of features) {
    const key = `${f.source}|${f.layer}|${f.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ source: f.source, layer: f.layer, id: f.id });
  }
  return out;
}
