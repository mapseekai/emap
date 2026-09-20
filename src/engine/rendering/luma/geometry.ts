import earcut from 'earcut';
import Flatbush from 'flatbush';
import { normalizePointShape } from '../../../domain/source/layer-utils';
import {
  absArcId,
  type ArcCollection,
  type FeatureShape,
  type PathShape,
  type PointMarkerShape,
} from '../../../shared/types/mapshaper-types';
import type { GeometryBuffer } from '../../../integrations/luma/types';

export type Point = readonly [number, number];
export type Shapes = readonly (FeatureShape | null | undefined)[];

/** Split map coordinates instead of rounding the authoritative dataset. */
export function packPosition(target: number[], x: number, y: number): void {
  const hx = Math.fround(x),
    hy = Math.fround(y);
  target.push(hx, hy, x - hx, y - hy);
}
export function readPart(arcs: ArcCollection, part: readonly number[]): Point[] {
  const points: Point[] = [];
  for (const id of part) {
    const iter = arcs.getArcIter(id);
    while (iter.hasNext()) {
      if (!Number.isFinite(iter.x) || !Number.isFinite(iter.y)) continue;
      const previous = points[points.length - 1];
      if (!previous || previous[0] !== iter.x || previous[1] !== iter.y)
        points.push([iter.x, iter.y]);
    }
  }
  return points;
}
export function pointGeometry(points: readonly Point[]): GeometryBuffer {
  const vertices = new Float32Array(points.length*4);
  let count=0;
  for (const [x,y] of points) if (Number.isFinite(x) && Number.isFinite(y)) {
    const hx=Math.fround(x), hy=Math.fround(y), i=count++*4;
    vertices[i]=hx; vertices[i+1]=hy; vertices[i+2]=x-hx; vertices[i+3]=y-hy;
  }
  return {kind:'point', vertices:count===points.length?vertices:vertices.subarray(0,count*4), count};
}
export function pointsFromShapes(
  shapes: Shapes,
  ids?: Uint32Array,
  components?: Uint32Array,
): GeometryBuffer {
  const vertices: number[] = [];
  for (let k = 0, n = ids?.length ?? shapes.length; k < n; k++) {
    const shape = shapes[ids?.[k] ?? k];
    if (!shape) continue;
    const points = normalizePointShape(shape);
    const start = components?.[k] ?? 0,
      end = components ? start + 1 : points.length;
    for (let i = start; i < end; i++) {
      const p = points[i];
      if (p && Number.isFinite(p[0]) && Number.isFinite(p[1])) packPosition(vertices, p[0], p[1]);
    }
  }
  return { kind: 'point', vertices: Float32Array.from(vertices), count: vertices.length / 4 };
}
export function lineGeometry(paths: Iterable<readonly Point[]>): GeometryBuffer {
  const vertices: number[] = [];
  for (const path of paths) {
    let distance = 0;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1],
        b = path[i];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!Number.isFinite(length) || length === 0) continue;
      packPosition(vertices, a[0], a[1]);
      packPosition(vertices, b[0], b[1]);
      const high = Math.fround(distance);
      vertices.push(high, distance - high);
      distance += length;
    }
  }
  return { kind: 'line', vertices: Float32Array.from(vertices), count: vertices.length / 10 };
}
export function arcIdsFromShapes(shapes: Shapes, ids?: Uint32Array): Int32Array {
  const seen = new Set<number>(),
    ordered: number[] = [];
  for (let k = 0, n = ids?.length ?? shapes.length; k < n; k++) {
    const shape = shapes[ids?.[k] ?? k] as PathShape | null | undefined;
    if (!shape) continue;
    for (const part of shape)
      for (const id of part) {
        if (!seen.has(absArcId(id))) {
          seen.add(absArcId(id));
          ordered.push(id);
        }
      }
  }
  return Int32Array.from(ordered);
}
interface Ring {
  points: readonly Point[];
  area: number;
  bounds: [number, number, number, number];
  parent: number;
  depth: number;
}
function containsPoint(ring: readonly Point[], p: Point): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
/** Even-odd nesting is independent of winding and preserves nested islands. */
export function triangulateRings(paths: readonly (readonly Point[])[]): {
  positions: Point[];
  indices: number[];
} {
  const rings: Ring[] = [];
  for (const points of paths) {
    if (points.length < 3) continue;
    const origin = points[0];
    let area = 0;
    const bounds: Ring['bounds'] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < points.length; i++) {
      const a = points[i],
        b = points[(i + 1) % points.length];
      area += (a[0] - origin[0]) * (b[1] - origin[1]) - (b[0] - origin[0]) * (a[1] - origin[1]);
      bounds[0] = Math.min(bounds[0], a[0]);
      bounds[1] = Math.min(bounds[1], a[1]);
      bounds[2] = Math.max(bounds[2], a[0]);
      bounds[3] = Math.max(bounds[3], a[1]);
    }
    if (area !== 0 && Number.isFinite(area))
      rings.push({ points, area: Math.abs(area), bounds, parent: -1, depth: 0 });
  }
  const positions: Point[] = [],
    indices: number[] = [];
  if (!rings.length) return { positions, indices };
  const spatial = new Flatbush(rings.length);
  for (const ring of rings) spatial.add(...ring.bounds);
  spatial.finish();
  for (let i = 0; i < rings.length; i++) {
    const ring = rings[i],
      p = ring.points[0];
    let parentArea = Infinity;
    for (const j of spatial.search(p[0], p[1], p[0], p[1])) {
      const other = rings[j];
      if (other.area <= ring.area || other.area >= parentArea) continue;
      if (
        other.bounds[0] > ring.bounds[0] ||
        other.bounds[1] > ring.bounds[1] ||
        other.bounds[2] < ring.bounds[2] ||
        other.bounds[3] < ring.bounds[3]
      )
        continue;
      if (containsPoint(other.points, p)) {
        ring.parent = j;
        parentArea = other.area;
      }
    }
  }
  for (const ring of rings) {
    for (let parent = ring.parent; parent >= 0; parent = rings[parent].parent) ring.depth++;
  }
  const children: Ring[][] = rings.map(() => []);
  for (const ring of rings) if (ring.parent >= 0) children[ring.parent].push(ring);
  for (let i = 0; i < rings.length; i++) {
    const shell = rings[i];
    if (shell.depth % 2) continue;
    const group = [shell, ...children[i]];
    const coordinates: number[] = [],
      holes: number[] = [];
    const offset = positions.length;
    for (let j = 0; j < group.length; j++) {
      if (j > 0) holes.push(coordinates.length / 2);
      for (const p of group[j].points) {
        coordinates.push(p[0], p[1]);
        positions.push(p);
      }
    }
    for (const index of earcut(coordinates, holes)) indices.push(offset + index);
  }
  return { positions, indices };
}
export function polygonGeometry(features: Iterable<readonly (readonly Point[])[]>): GeometryBuffer {
  const vertices: number[] = [],
    indices: number[] = [];
  for (const feature of features) {
    const triangles = triangulateRings(feature),
      offset = vertices.length / 4;
    for (const p of triangles.positions) packPosition(vertices, p[0], p[1]);
    for (const index of triangles.indices) indices.push(offset + index);
  }
  return {
    kind: 'fill',
    vertices: Float32Array.from(vertices),
    indices: Uint32Array.from(indices),
    count: indices.length,
  };
}
const markerCache = new Map<PointMarkerShape, readonly number[]>();
export function markerVertices(shape: PointMarkerShape = 'circle'): readonly number[] {
  const cached = markerCache.get(shape);
  if (cached) return cached;
  let result: number[] = [];
  if (shape === 'square') result = [-1, -1, 1, -1, 1, 1, -1, 1];
  else if (shape === 'cross')
    result = [
      -0.4, -1, 0.4, -1, 0.4, -0.4, 1, -0.4, 1, 0.4, 0.4, 0.4, 0.4, 1, -0.4, 1, -0.4, 0.4, -1, 0.4,
      -1, -0.4, -0.4, -0.4,
    ];
  else if (shape === 'x')
    result = [
      -1, -0.6, -0.6, -1, 0, -0.4, 0.6, -1, 1, -0.6, 0.4, 0, 1, 0.6, 0.6, 1, 0, 0.4, -0.6, 1, -1,
      0.6, -0.4, 0,
    ];
  else if (shape !== 'circle') {
    const sides =
      shape === 'star'
        ? 10
        : shape === 'diamond'
          ? 4
          : shape === 'pentagon'
            ? 5
            : shape === 'hexagon'
              ? 6
              : shape === 'octagon'
                ? 8
                : 3;
    const start =
      shape === 'triangle-down'
        ? Math.PI / 2
        : shape === 'hexagon'
          ? 0
          : shape === 'octagon'
            ? Math.PI / 8
            : -Math.PI / 2;
    for (let i = 0; i < sides; i++) {
      const angle = start + (i * Math.PI * 2) / sides;
      const radius = shape === 'star' && i % 2 === 1 ? 0.45 : 1;
      result.push(Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
  }
  markerCache.set(shape, result);
  return result;
}
