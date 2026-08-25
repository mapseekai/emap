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

function scale(...points: Coordinate[]): number {
  return Math.max(1, ...points.flatMap(([x, y]) => [Math.abs(x), Math.abs(y)]));
}

function properSegmentIntersection(a: Coordinate, b: Coordinate, c: Coordinate, d: Coordinate): Coordinate | null {
  const tolerance = EPSILON * scale(a, b, c, d);
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  if (Math.abs(abC) <= tolerance || Math.abs(abD) <= tolerance || Math.abs(cdA) <= tolerance || Math.abs(cdB) <= tolerance) return null;
  if ((abC > 0) === (abD > 0) || (cdA > 0) === (cdB > 0)) return null;
  const denominator = (a[0] - b[0]) * (c[1] - d[1]) - (a[1] - b[1]) * (c[0] - d[0]);
  if (Math.abs(denominator) <= tolerance) return null;
  const determinantAB = a[0] * b[1] - a[1] * b[0], determinantCD = c[0] * d[1] - c[1] * d[0];
  return [
    (determinantAB * (c[0] - d[0]) - (a[0] - b[0]) * determinantCD) / denominator,
    (determinantAB * (c[1] - d[1]) - (a[1] - b[1]) * determinantCD) / denominator,
  ];
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
function validatePolygon(shape: PathShape, arcs: NonNullable<MapshaperDataset['arcs']>): void {
  if (!shape.length || shape.some((part) => part.length === 0)) throw new SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid');
  for (const part of shape) {
    const segments = shapeSegments([part], arcs);
    if (segments.length < 3) throw new SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid');
    const first = segments[0]![0], last = segments.at(-1)![1];
    if (first[0] !== last[0] || first[1] !== last[1]) throw new SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid');
    for (let i = 0; i < segments.length; i++) {
      for (let j = i + 1; j < segments.length; j++) {
        if (j === i + 1 || (i === 0 && j === segments.length - 1)) continue;
        if (properSegmentIntersection(...segments[i]!, ...segments[j]!)) throw new SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid');
      }
    }
  }
  if (!(adapterArea(shape, arcs) > 0)) throw new SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid');
}

function adapterArea(shape: PathShape, arcs: NonNullable<MapshaperDataset['arcs']>): number {
  // Mapshaper's path data assigns shell / hole winding; this independent shoelace sum
  // only gates malformed zero-area rings before the topology-mutating operation.
  let area = 0;
  for (const part of shape) {
    const segments = shapeSegments([part], arcs);
    area += segments.reduce((sum, [start, end]) => sum + start[0] * end[1] - end[0] * start[1], 0) / 2;
  }
  return Math.abs(area);
}

function properCrossings(shape: PathShape, cutter: readonly Coordinate[], arcs: NonNullable<MapshaperDataset['arcs']>): Set<string> {
  const crossings = new Set<string>();
  for (const [start, end] of shapeSegments(shape, arcs)) {
    for (let index = 1; index < cutter.length; index++) {
      const point = properSegmentIntersection(start, end, cutter[index - 1]!, cutter[index]!);
      if (point) crossings.add(`${point[0]},${point[1]}`);
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
    validatePolygon(shape, arcs);
    if (properCrossings(shape, cutter.coordinates, arcs).size >= 2) crossingIds.add(featureId);
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
