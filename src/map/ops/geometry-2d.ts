import type { MapshaperAdapter } from '../../adapter/mapshaper-adapter';
import type { MapshaperDataset, PathShape } from '../../types/mapshaper-types';
import { SplitGeometryValidationError } from './split-selected-error';

const EPSILON = Number.EPSILON * 1024;

export type Coordinate = readonly [number, number];

export function coordinateKey([x, y]: Coordinate): string {
  return `${x},${y}`;
}

export function unsignedArcId(id: number): number {
  return id < 0 ? -id - 1 : id;
}

export function arcEndpoints(
  arcs: NonNullable<MapshaperDataset['arcs']>,
  signedArcId: number,
): [Coordinate, Coordinate] {
  const iterator = arcs.getArcIter(unsignedArcId(signedArcId));
  let first: Coordinate | undefined;
  let last: Coordinate | undefined;
  while (iterator.hasNext()) {
    const coordinate: Coordinate = [iterator.x, iterator.y];
    first ??= coordinate;
    last = coordinate;
  }
  if (!first || !last)
    throw new SplitGeometryValidationError('geometry', 'Encountered an empty path arc');
  return signedArcId < 0 ? [last, first] : [first, last];
}

export function cross(a: Coordinate, b: Coordinate, c: Coordinate): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function orientationTolerance(a: Coordinate, b: Coordinate, c: Coordinate): number {
  const abx = b[0] - a[0],
    aby = b[1] - a[1],
    acx = c[0] - a[0],
    acy = c[1] - a[1];
  return EPSILON * (Math.abs(abx * acy) + Math.abs(aby * acx));
}

export function segmentIntersection(
  a: Coordinate,
  b: Coordinate,
  c: Coordinate,
  d: Coordinate,
): Coordinate | null {
  const abx = b[0] - a[0],
    aby = b[1] - a[1],
    cdx = d[0] - c[0],
    cdy = d[1] - c[1];
  const denominator = abx * cdy - aby * cdx;
  const tolerance = EPSILON * (Math.abs(abx * cdy) + Math.abs(aby * cdx));
  if (Math.abs(denominator) <= tolerance) return null;
  const cax = c[0] - a[0],
    cay = c[1] - a[1];
  const t = (cax * cdy - cay * cdx) / denominator,
    u = (cax * aby - cay * abx) / denominator;
  if (t < -EPSILON || t > 1 + EPSILON || u < -EPSILON || u > 1 + EPSILON) return null;
  return [a[0] + t * abx, a[1] + t * aby];
}

export function normalizeConsecutiveCoordinates(
  coordinates: readonly Coordinate[],
): Coordinate[] {
  return coordinates.filter(
    (coordinate, index) =>
      index === 0 ||
      coordinate[0] !== coordinates[index - 1]![0] ||
      coordinate[1] !== coordinates[index - 1]![1],
  );
}

export function shapeSegments(
  shape: PathShape,
  arcs: NonNullable<MapshaperDataset['arcs']>,
): Array<[Coordinate, Coordinate]> {
  const segments: Array<[Coordinate, Coordinate]> = [];
  for (const part of shape) {
    const points: Coordinate[] = [];
    for (const id of part) {
      const iterator = arcs.getArcIter(unsignedArcId(id));
      const arc: Coordinate[] = [];
      while (iterator.hasNext()) arc.push([iterator.x, iterator.y]);
      if (id < 0) arc.reverse();
      if (!points.length) points.push(...arc);
      else points.push(...arc.slice(1));
    }
    for (let index = 1; index < points.length; index++)
      segments.push([points[index - 1]!, points[index]!]);
  }
  return segments;
}

export function segmentsConflict(
  a: Coordinate,
  b: Coordinate,
  c: Coordinate,
  d: Coordinate,
): boolean {
  if (segmentIntersection(a, b, c, d)) return true;
  if (
    Math.abs(cross(a, b, c)) > orientationTolerance(a, b, c) ||
    Math.abs(cross(a, b, d)) > orientationTolerance(a, b, d)
  )
    return false;
  return (
    [a, b].some(
      (point) =>
        point[0] >= Math.min(c[0], d[0]) - EPSILON &&
        point[0] <= Math.max(c[0], d[0]) + EPSILON &&
        point[1] >= Math.min(c[1], d[1]) - EPSILON &&
        point[1] <= Math.max(c[1], d[1]) + EPSILON,
    ) ||
    [c, d].some(
      (point) =>
        point[0] >= Math.min(a[0], b[0]) - EPSILON &&
        point[0] <= Math.max(a[0], b[0]) + EPSILON &&
        point[1] >= Math.min(a[1], b[1]) - EPSILON &&
        point[1] <= Math.max(a[1], b[1]) + EPSILON,
    )
  );
}

export function validatePolygonArcReferences(
  shape: PathShape,
  arcs: NonNullable<MapshaperDataset['arcs']>,
): void {
  for (const part of shape) {
    if (!Array.isArray(part) || !part.length)
      throw new SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid');
    for (const id of part) {
      if (typeof id !== 'number' || !Number.isSafeInteger(id))
        throw new SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid');
      const arcId = unsignedArcId(id);
      if (!Number.isSafeInteger(arcId) || arcId < 0 || arcId >= arcs.size())
        throw new SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid');
      const iterator = arcs.getArcIter(arcId);
      let vertices = 0;
      while (iterator.hasNext()) {
        if (!Number.isFinite(iterator.x) || !Number.isFinite(iterator.y))
          throw new SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid');
        vertices++;
      }
      if (vertices < 2)
        throw new SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid');
    }
  }
}

export function validatePolygon(
  shape: PathShape,
  arcs: NonNullable<MapshaperDataset['arcs']>,
  adapter: MapshaperAdapter,
): void {
  if (!shape.length || shape.some((part) => part.length === 0))
    throw new SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid');
  const rings = shape.map((part) => shapeSegments([part], arcs));
  for (let ringIndex = 0; ringIndex < rings.length; ringIndex++) {
    const segments = rings[ringIndex]!;
    if (
      segments.length < 3 ||
      segments[0]![0][0] !== segments.at(-1)![1][0] ||
      segments[0]![0][1] !== segments.at(-1)![1][1]
    )
      throw new SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid');
    for (let i = 0; i < segments.length; i++)
      for (let j = i + 1; j < segments.length; j++) {
        if (j === i + 1 || (i === 0 && j === segments.length - 1)) continue;
        if (segmentsConflict(...segments[i]!, ...segments[j]!))
          throw new SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid');
      }
    for (let otherIndex = 0; otherIndex < ringIndex; otherIndex++)
      for (const segment of segments)
        for (const other of rings[otherIndex]!)
          if (segmentsConflict(...segment, ...other))
            throw new SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid');
  }
  const pathData = adapter.exportPathData(shape, arcs, 'polygon').pathData;
  const anchors = shape.map((part) => adapter.getShapeAnchor([part], arcs));
  if (anchors.some((anchor) => anchor === null))
    throw new SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid');
  const parents = shape.map((_, index) => {
    const anchor = anchors[index]!;
    const candidates = shape.flatMap((ring, candidate) =>
      candidate !== index &&
      Math.abs(pathData[candidate]?.area ?? 0) > Math.abs(pathData[index]?.area ?? 0) &&
      adapter.testPointInRing(anchor[0], anchor[1], ring, arcs) !== 0
        ? [candidate]
        : [],
    );
    return (
      candidates.sort(
        (left, right) => Math.abs(pathData[left]?.area ?? 0) - Math.abs(pathData[right]?.area ?? 0),
      )[0] ?? null
    );
  });
  const depth = (index: number): number =>
    parents[index] === null ? 0 : depth(parents[index]!) + 1;
  for (let index = 0; index < shape.length; index++) {
    const area = pathData[index]?.area ?? 0;
    if (area === 0 || (depth(index) % 2 === 0) !== area > 0)
      throw new SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid');
  }
  if (!(adapter.getShapeArea(shape, arcs) > 0))
    throw new SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid');
}

export function shoelaceArea(ring: readonly Coordinate[]): number {
  return ring.reduce(
    (area, point, index) => area + point[0] * ring[(index + 1) % ring.length]![1] - point[1] * ring[(index + 1) % ring.length]![0],
    0,
  ) / 2;
}
