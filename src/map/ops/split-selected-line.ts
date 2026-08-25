import type { MapshaperAdapter } from '../../adapter/mapshaper-adapter';
import type { MapshaperDataset, MapshaperLayer, PathShape } from '../../types/mapshaper-types';
import type { SplitCutter } from '../types';
import { SplitGeometryValidationError } from './split-selected-error';

export interface SplitPieces {
  featureId: number;
  pieces: PathShape[];
}

export interface PolylineSplitOutcome {
  pieces: SplitPieces[];
  pointOnSelectedPath: boolean;
}

type Coordinate = readonly [number, number];
type ArcCutPoint = { x: number; y: number; i: number };

const INTERSECTION_EPSILON = Number.EPSILON * 64;

function coordinateKey([x, y]: Coordinate): string {
  return `${x},${y}`;
}

function arcEndpoints(arcs: NonNullable<MapshaperDataset['arcs']>, signedArcId: number): [Coordinate, Coordinate] {
  const iterator = arcs.getArcIter(signedArcId < 0 ? ~signedArcId : signedArcId);
  let first: [number, number] | undefined;
  let last: [number, number] | undefined;
  while (iterator.hasNext()) {
    const coordinate: [number, number] = [iterator.x, iterator.y];
    first ??= coordinate;
    last = coordinate;
  }
  if (!first || !last) throw new SplitGeometryValidationError('geometry', 'Encountered an empty path arc');
  return signedArcId < 0 ? [last, first] : [first, last];
}

function pathEndpoints(shape: PathShape, arcs: NonNullable<MapshaperDataset['arcs']>): Set<string> {
  const endpoints = new Set<string>();
  for (const part of shape) {
    if (part.length === 0) continue;
    const [start] = arcEndpoints(arcs, part[0]!);
    const [, end] = arcEndpoints(arcs, part[part.length - 1]!);
    endpoints.add(coordinateKey(start));
    endpoints.add(coordinateKey(end));
  }
  return endpoints;
}

function partitionShape(shape: PathShape, cutCoordinates: ReadonlySet<string>, arcs: NonNullable<MapshaperDataset['arcs']>, adapter: MapshaperAdapter): PathShape[] {
  const pieces: PathShape[] = [];
  for (const part of shape) {
    let current: number[] = [];
    for (const signedArcId of part) {
      current.push(signedArcId);
      const [, end] = arcEndpoints(arcs, signedArcId);
      if (cutCoordinates.has(coordinateKey(end))) {
        const piece: PathShape = [[...current]];
        if (adapter.getShapePerimeter(piece, arcs) !== 0) pieces.push(piece);
        current = [];
      }
    }
    if (current.length > 0) {
      const piece: PathShape = [[...current]];
      if (adapter.getShapePerimeter(piece, arcs) !== 0) pieces.push(piece);
    }
  }
  return pieces;
}

function pointTolerance(point: Coordinate, a: Coordinate, b: Coordinate): number {
  return Math.max(1, Math.abs(point[0]), Math.abs(point[1]), Math.abs(a[0]), Math.abs(a[1]), Math.abs(b[0]), Math.abs(b[1])) * INTERSECTION_EPSILON;
}

function collectPointCutPoints(shape: PathShape, arcs: NonNullable<MapshaperDataset['arcs']>, point: Coordinate, adapter: MapshaperAdapter): { matches: boolean; cutPoints: ArcCutPoint[] } {
  const endpointKeys = pathEndpoints(shape, arcs);
  const cutPoints: ArcCutPoint[] = [];
  const seen = new Set<string>();
  let matches = false;
  adapter.forEachSegmentInShape(shape, arcs, (i, _j, xx, yy) => {
    const a: [number, number] = [xx[i]!, yy[i]!];
    const b: [number, number] = [xx[_j]!, yy[_j]!];
    const closest = adapter.findClosestPointOnSeg(point[0], point[1], a[0], a[1], b[0], b[1], 0);
    const dx = point[0] - closest[0];
    const dy = point[1] - closest[1];
    const tolerance = pointTolerance(point, a, b);
    if (dx * dx + dy * dy > tolerance * tolerance) return;
    matches = true;
    if (endpointKeys.has(coordinateKey(closest))) return;
    const key = `${closest[0]},${closest[1]},${i}`;
    if (seen.has(key)) return;
    seen.add(key);
    cutPoints.push({ x: closest[0], y: closest[1], i });
  });
  return { matches, cutPoints };
}

function segmentCross(a: Coordinate, b: Coordinate, c: Coordinate): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function validateLineCutter(shape: PathShape, arcs: NonNullable<MapshaperDataset['arcs']>, coordinates: readonly Coordinate[], adapter: MapshaperAdapter): void {
  for (let cutterIndex = 1; cutterIndex < coordinates.length; cutterIndex += 1) {
    const c = coordinates[cutterIndex - 1]!;
    const d = coordinates[cutterIndex]!;
    adapter.forEachSegmentInShape(shape, arcs, (i, j, xx, yy) => {
      const a: [number, number] = [xx[i]!, yy[i]!];
      const b: [number, number] = [xx[j]!, yy[j]!];
      const denominator = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
      const scale = Math.max(1, Math.abs(a[0]), Math.abs(a[1]), Math.abs(b[0]), Math.abs(b[1]), Math.abs(c[0]), Math.abs(c[1]), Math.abs(d[0]), Math.abs(d[1]));
      const epsilon = scale * INTERSECTION_EPSILON;
      if (Math.abs(denominator) <= epsilon) {
        if (Math.abs(segmentCross(a, b, c)) <= epsilon) throw new SplitGeometryValidationError('cutter', 'Cutter overlaps a selected path segment');
        return;
      }
      const acx = c[0] - a[0];
      const acy = c[1] - a[1];
      const targetT = (acx * (d[1] - c[1]) - acy * (d[0] - c[0])) / denominator;
      const cutterT = (acx * (b[1] - a[1]) - acy * (b[0] - a[0])) / denominator;
      if (targetT < -epsilon || targetT > 1 + epsilon || cutterT < -epsilon || cutterT > 1 + epsilon) return;
      if (targetT <= epsilon || targetT >= 1 - epsilon || cutterT <= epsilon || cutterT >= 1 - epsilon) {
        throw new SplitGeometryValidationError('cutter', 'Cutter must cross selected paths at interior points');
      }
    });
  }
}

function cutterEndpointKeys(shape: PathShape, arcs: NonNullable<MapshaperDataset['arcs']>): Set<string> {
  const keys = new Set<string>();
  for (const part of shape) {
    for (const signedArcId of part) {
      const [start, end] = arcEndpoints(arcs, signedArcId);
      keys.add(coordinateKey(start));
      keys.add(coordinateKey(end));
    }
  }
  return keys;
}

function splitPoint(dataset: MapshaperDataset, layerIndex: number, selectedIds: ReadonlySet<number>, point: Coordinate, adapter: MapshaperAdapter): PolylineSplitOutcome {
  const arcs = dataset.arcs;
  const layer = dataset.layers[layerIndex];
  if (!arcs || !layer?.shapes) throw new SplitGeometryValidationError('geometry', 'Selected layer has no path geometry');
  const cutPoints: ArcCutPoint[] = [];
  let pointOnSelectedPath = false;
  for (const featureId of selectedIds) {
    const shape = layer.shapes[featureId] as PathShape | null;
    if (!shape) continue;
    if (pathEndpoints(shape, arcs).has(coordinateKey(point))) {
      pointOnSelectedPath = true;
      continue;
    }
    const collected = collectPointCutPoints(shape, arcs, point, adapter);
    pointOnSelectedPath ||= collected.matches;
    cutPoints.push(...collected.cutPoints);
  }
  if (!pointOnSelectedPath) throw new SplitGeometryValidationError('cutter', 'Point cutter is not on a selected path');
  if (cutPoints.length === 0) return { pieces: [], pointOnSelectedPath };
  adapter.insertCutPoints(dataset, cutPoints);
  const cutCoordinates = new Set(cutPoints.map(({ x, y }) => coordinateKey([x, y])));
  const pieces: SplitPieces[] = [];
  for (const featureId of selectedIds) {
    const shape = layer.shapes[featureId] as PathShape | null;
    if (!shape) continue;
    const partitioned = partitionShape(shape, cutCoordinates, arcs, adapter);
    if (partitioned.length >= 2) pieces.push({ featureId, pieces: partitioned });
  }
  return { pieces, pointOnSelectedPath };
}

function splitLine(dataset: MapshaperDataset, layerIndex: number, selectedIds: ReadonlySet<number>, coordinates: readonly Coordinate[], adapter: MapshaperAdapter): PolylineSplitOutcome {
  const arcs = dataset.arcs;
  const layer = dataset.layers[layerIndex];
  if (!arcs || !layer?.shapes) throw new SplitGeometryValidationError('geometry', 'Selected layer has no path geometry');
  if (coordinates.length < 2) throw new SplitGeometryValidationError('cutter', 'Line cutter needs at least two coordinates');
  for (const featureId of selectedIds) {
    const shape = layer.shapes[featureId] as PathShape | null;
    if (shape) validateLineCutter(shape, arcs, coordinates, adapter);
  }
  const cutterArcId = arcs.size();
  adapter.appendEmptyArc(arcs);
  for (const coordinate of coordinates) adapter.appendVertex(arcs, [coordinate[0], coordinate[1]]);
  const cutterShape: PathShape = [[cutterArcId]];
  const cutterLayer: MapshaperLayer = { geometry_type: 'polyline', shapes: [cutterShape] };
  dataset.layers.push(cutterLayer);
  adapter.addIntersectionCuts(dataset, { no_snap: true, rebuild_topology: true });
  const cutCoordinates = cutterEndpointKeys(cutterLayer.shapes![0] as PathShape, arcs);
  const pieces: SplitPieces[] = [];
  for (const featureId of selectedIds) {
    const shape = layer.shapes[featureId] as PathShape | null;
    if (!shape) continue;
    const partitioned = partitionShape(shape, cutCoordinates, arcs, adapter);
    if (partitioned.length >= 2) pieces.push({ featureId, pieces: partitioned });
  }
  return { pieces, pointOnSelectedPath: false };
}

export function splitSelectedPolylines(dataset: MapshaperDataset, layerIndex: number, selectedIds: ReadonlySet<number>, cutter: SplitCutter, adapter: MapshaperAdapter): PolylineSplitOutcome {
  if (cutter.type === 'point') return splitPoint(dataset, layerIndex, selectedIds, cutter.coordinates, adapter);
  return splitLine(dataset, layerIndex, selectedIds, cutter.coordinates, adapter);
}
