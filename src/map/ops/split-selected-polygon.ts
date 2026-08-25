import type { MapshaperAdapter } from '../../adapter/mapshaper-adapter';
import type { MapshaperDataset, MapshaperLayer, PathShape } from '../../types/mapshaper-types';
import type { SplitCutter } from '../types';
import { SplitGeometryValidationError } from './split-selected-error';
import type { SplitPieces } from './split-selected-line';

const EPSILON = Number.EPSILON * 1024;
type Coordinate = readonly [number, number];

function unsignedArcId(id: number): number {
  return id < 0 ? ~id : id;
}

function arcEndpoints(arcs: NonNullable<MapshaperDataset['arcs']>, id: number): [Coordinate, Coordinate] {
  const iterator = arcs.getArcIter(unsignedArcId(id));
  let first: Coordinate | undefined;
  let last: Coordinate | undefined;
  while (iterator.hasNext()) {
    const point: Coordinate = [iterator.x, iterator.y];
    first ??= point;
    last = point;
  }
  if (!first || !last) throw new SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid');
  return id < 0 ? [last, first] : [first, last];
}

function cross(a: Coordinate, b: Coordinate, c: Coordinate): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function orientationTolerance(a: Coordinate, b: Coordinate, c: Coordinate): number {
  const abx = b[0] - a[0], aby = b[1] - a[1], acx = c[0] - a[0], acy = c[1] - a[1];
  return EPSILON * (Math.abs(abx * acy) + Math.abs(aby * acx) + 1);
}


function segmentIntersection(a: Coordinate, b: Coordinate, c: Coordinate, d: Coordinate): Coordinate | null {
  const abx = b[0] - a[0], aby = b[1] - a[1], cdx = d[0] - c[0], cdy = d[1] - c[1];
  const denominator = abx * cdy - aby * cdx;
  const tolerance = EPSILON * (Math.abs(abx * cdy) + Math.abs(aby * cdx) + 1);
  if (Math.abs(denominator) <= tolerance) return null;
  const cax = c[0] - a[0], cay = c[1] - a[1];
  const t = (cax * cdy - cay * cdx) / denominator, u = (cax * aby - cay * abx) / denominator;
  if (t < -EPSILON || t > 1 + EPSILON || u < -EPSILON || u > 1 + EPSILON) return null;
  return [a[0] + t * abx, a[1] + t * aby];
}

function shapeSegments(shape: PathShape, arcs: NonNullable<MapshaperDataset['arcs']>): Array<[Coordinate, Coordinate]> {
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
    for (let index = 1; index < points.length; index++) segments.push([points[index - 1]!, points[index]!]);
  }
  return segments;
}

function segmentsConflict(a: Coordinate, b: Coordinate, c: Coordinate, d: Coordinate): boolean {
  if (segmentIntersection(a, b, c, d)) return true;
  if (Math.abs(cross(a, b, c)) > orientationTolerance(a, b, c) || Math.abs(cross(a, b, d)) > orientationTolerance(a, b, d)) return false;
  return [a, b].some((point) => point[0] >= Math.min(c[0], d[0]) - EPSILON && point[0] <= Math.max(c[0], d[0]) + EPSILON && point[1] >= Math.min(c[1], d[1]) - EPSILON && point[1] <= Math.max(c[1], d[1]) + EPSILON)
    || [c, d].some((point) => point[0] >= Math.min(a[0], b[0]) - EPSILON && point[0] <= Math.max(a[0], b[0]) + EPSILON && point[1] >= Math.min(a[1], b[1]) - EPSILON && point[1] <= Math.max(a[1], b[1]) + EPSILON);
}

function validatePolygon(shape: PathShape, arcs: NonNullable<MapshaperDataset['arcs']>, adapter: MapshaperAdapter): void {
  if (!shape.length || shape.some((part) => part.length === 0)) throw new SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid');
  const rings = shape.map((part) => shapeSegments([part], arcs));
  for (let ringIndex = 0; ringIndex < rings.length; ringIndex++) {
    const segments = rings[ringIndex]!;
    if (segments.length < 3 || segments[0]![0][0] !== segments.at(-1)![1][0] || segments[0]![0][1] !== segments.at(-1)![1][1]) throw new SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid');
    for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
      if (j === i + 1 || (i === 0 && j === segments.length - 1)) continue;
      if (segmentsConflict(...segments[i]!, ...segments[j]!)) throw new SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid');
    }
    for (let otherIndex = 0; otherIndex < ringIndex; otherIndex++) for (const segment of segments) for (const other of rings[otherIndex]!) {
      if (segmentsConflict(...segment, ...other)) throw new SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid');
    }
  }
  const pathData = adapter.exportPathData(shape, arcs, 'polygon').pathData;
  const anchors = shape.map((part) => adapter.getShapeAnchor([part], arcs));
  if (anchors.some((anchor) => anchor === null)) throw new SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid');
  const parents = shape.map((_, index) => {
    const anchor = anchors[index]!;
    const candidates = shape.flatMap((ring, candidate) => candidate !== index && Math.abs(pathData[candidate]?.area ?? 0) > Math.abs(pathData[index]?.area ?? 0) && adapter.testPointInRing(anchor[0], anchor[1], ring, arcs) !== 0 ? [candidate] : []);
    return candidates.sort((left, right) => Math.abs(pathData[left]?.area ?? 0) - Math.abs(pathData[right]?.area ?? 0))[0] ?? null;
  });
  const depth = (index: number): number => parents[index] === null ? 0 : depth(parents[index]!) + 1;
  for (let index = 0; index < shape.length; index++) {
    const area = pathData[index]?.area ?? 0;
    if (area === 0 || ((depth(index) % 2 === 0) !== (area > 0))) throw new SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid');
  }
  if (!(adapter.getShapeArea(shape, arcs) > 0)) throw new SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid');
}


function properCrossings(shape: PathShape, cutter: readonly Coordinate[], arcs: NonNullable<MapshaperDataset['arcs']>, adapter: MapshaperAdapter): Set<string> {
  const lengths = cutter.slice(1).map((point, index) => Math.hypot(point[0] - cutter[index]![0], point[1] - cutter[index]![1]));
  const offsets = lengths.reduce<number[]>((all, length) => [...all, all.at(-1)! + length], [0]);
  const events: Array<{ point: Coordinate; distance: number }> = [];
  for (let index = 1; index < cutter.length; index++) {
    const start = cutter[index - 1]!, end = cutter[index]!, length = lengths[index - 1]!;
    if (length === 0) continue;
    for (const [boundaryStart, boundaryEnd] of shapeSegments(shape, arcs)) {
      const point = segmentIntersection(start, end, boundaryStart, boundaryEnd);
      if (point) events.push({ point, distance: offsets[index - 1]! + Math.hypot(point[0] - start[0], point[1] - start[1]) });
    }
  }
  const groups: Array<{ distance: number; events: Array<{ point: Coordinate; distance: number }> }> = [];
  for (const event of events.sort((left, right) => left.distance - right.distance)) {
    const group = groups.at(-1);
    if (group?.distance === event.distance) group.events.push(event);
    else groups.push({ distance: event.distance, events: [event] });
  }
  const totalLength = offsets.at(-1)!;
  const pointAt = (distance: number): Coordinate => {
    const clamped = Math.max(0, Math.min(totalLength, distance));
    const segment = offsets.findIndex((_offset, index) => index + 1 < offsets.length && clamped <= offsets[index + 1]!);
    const start = cutter[segment]!, end = cutter[segment + 1]!, length = lengths[segment]!;
    const t = length === 0 ? 0 : (clamped - offsets[segment]!) / length;
    return [start[0] + t * (end[0] - start[0]), start[1] + t * (end[1] - start[1])];
  };
  const closed = cutter[0]![0] === cutter.at(-1)![0] && cutter[0]![1] === cutter.at(-1)![1];
  const distanceError = EPSILON * Math.max(totalLength, 1);
  const seamPoint = cutter[0]!;
  const seam = closed
    && groups.length > 1
    && Math.abs(groups[0]!.distance) <= distanceError
    && Math.abs(groups.at(-1)!.distance - totalLength) <= distanceError
    && groups[0]!.events.some((event) => event.point[0] === seamPoint[0] && event.point[1] === seamPoint[1])
    && groups.at(-1)!.events.some((event) => event.point[0] === seamPoint[0] && event.point[1] === seamPoint[1]);
  const crossings = new Set<string>();
  for (let index = 0; index < groups.length; index++) {
    if (seam && index === groups.length - 1) continue;
    const group = groups[index]!;
    const previous = index === 0 ? (closed ? groups.at(seam ? -2 : -1) : undefined) : groups[index - 1];
    const next = index + 1 < groups.length ? groups[index + 1] : (closed ? groups[0] : undefined);
    const previousDistance = previous?.distance ?? 0;
    const nextDistance = next?.distance ?? totalLength;
    if (!closed && (group.distance === previousDistance || group.distance === nextDistance)) continue;
    const beforeEnd = seam && index === 0 ? totalLength : group.distance;
    const afterStart = seam && index === 0 ? 0 : group.distance;
    const before = pointAt((previousDistance + beforeEnd) / 2);
    const afterEnd = next === groups[0] ? (seam ? totalLength : totalLength + nextDistance) : nextDistance;
    const after = pointAt((afterStart + afterEnd) / 2);
    if (adapter.testPointInPolygon(before[0], before[1], shape, arcs) !== adapter.testPointInPolygon(after[0], after[1], shape, arcs)) {
      for (const event of group.events) crossings.add(`${event.point[0]},${event.point[1]}`);
    }
  }
  return crossings;
}

function endpointKeys(shape: PathShape, arcs: NonNullable<MapshaperDataset['arcs']>): Set<string> {
  const keys = new Set<string>();
  for (const part of shape) for (const id of part) {
    const [start, end] = arcEndpoints(arcs, id);
    keys.add(`${start[0]},${start[1]}`);
    keys.add(`${end[0]},${end[1]}`);
  }
  return keys;
}

/** Splits each selected polygon independently against a single temporary polyline cutter. */
export function splitSelectedPolygons(
  dataset: MapshaperDataset,
  layerIndex: number,
  selectedIds: ReadonlySet<number>,
  cutter: Extract<SplitCutter, { type: 'line' }>,
  adapter: MapshaperAdapter,
): SplitPieces[] {
  const arcs = dataset.arcs;
  const layer = dataset.layers[layerIndex];
  if (!arcs || !layer?.shapes || layer.geometry_type !== 'polygon') throw new SplitGeometryValidationError('geometry', 'Selected layer has no path geometry');
  if (cutter.coordinates.length < 2) throw new SplitGeometryValidationError('cutter', 'Line cutter needs at least two coordinates');

  const crossingIds = new Set<number>();
  for (const featureId of selectedIds) {
    const shape = layer.shapes[featureId] as PathShape | null;
    if (!shape) continue;
    validatePolygon(shape, arcs, adapter);
    if (properCrossings(shape, cutter.coordinates, arcs, adapter).size >= 2) crossingIds.add(featureId);
  }
  if (!crossingIds.size) return [];

  const cutterArcId = arcs.size();
  adapter.appendEmptyArc(arcs);
  for (const point of cutter.coordinates) adapter.appendVertex(arcs, [point[0], point[1]]);
  const cutterLayer: MapshaperLayer = { geometry_type: 'polyline', shapes: [[[cutterArcId]]] };
  dataset.layers.push(cutterLayer);
  adapter.addIntersectionCuts(dataset, { no_snap: true, rebuild_topology: true });

  const cutterShape = cutterLayer.shapes![0] as PathShape;
  const cutterIds = new Set(cutterShape.flat().map(unsignedArcId));
  const cutterNodes = endpointKeys(cutterShape, arcs);
  const results: SplitPieces[] = [];
  for (const featureId of crossingIds) {
    const original = layer.shapes![featureId] as PathShape | null;
    if (!original) continue;
    const boundaryIds = new Set(original.flat().map(unsignedArcId));
    const boundaryNodes = endpointKeys(original, arcs);
    const sharedNodes = [...boundaryNodes].filter((node) => cutterNodes.has(node));
    if (sharedNodes.length < 2) continue;
    const originalArea = adapter.getShapeArea(original, arcs);
    const tiles = adapter.buildPolygonMosaic(arcs, new Set([...boundaryIds, ...cutterIds]))
      .filter((tile) => {
        const anchor = adapter.getShapeAnchor(tile, arcs);
        return anchor !== null && adapter.testPointInPolygon(anchor[0], anchor[1], original, arcs);
      })
      .filter((tile) => adapter.getShapeArea(tile, arcs) > 0);
    if (tiles.length < 2) continue;
    const coveredArea = tiles.reduce((sum, tile) => sum + adapter.getShapeArea(tile, arcs), 0);
    const tolerance = Math.max(originalArea * 1e-10, Number.EPSILON * 1024);
    if (Math.abs(coveredArea - originalArea) > tolerance) throw new SplitGeometryValidationError('geometry', 'polygon split failed coverage validation');
    results.push({ featureId, pieces: tiles });
  }
  return results;
}
