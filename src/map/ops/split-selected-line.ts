import type { MapshaperAdapter } from '../../adapter/mapshaper-adapter';
import type { MapshaperDataset, MapshaperLayer, PathShape } from '../../types/mapshaper-types';
import type { SplitCutter } from '../types';
import { SplitGeometryValidationError } from './split-selected-error';

export interface SplitPieces { featureId: number; pieces: PathShape[]; }
export interface PolylineSplitOutcome { pieces: SplitPieces[]; pointOnSelectedPath: boolean; }
type Coordinate = readonly [number, number];
type ArcCutPoint = { x: number; y: number; i: number };
const INTERSECTION_EPSILON = Number.EPSILON * 64;

function coordinateKey([x, y]: Coordinate): string { return `${x},${y}`; }
function arcEndpoints(arcs: NonNullable<MapshaperDataset['arcs']>, signedArcId: number): [Coordinate, Coordinate] {
  const iterator = arcs.getArcIter(signedArcId < 0 ? ~signedArcId : signedArcId);
  let first: [number, number] | undefined;
  let last: [number, number] | undefined;
  while (iterator.hasNext()) { const coordinate: [number, number] = [iterator.x, iterator.y]; first ??= coordinate; last = coordinate; }
  if (!first || !last) throw new SplitGeometryValidationError('geometry', 'Encountered an empty path arc');
  return signedArcId < 0 ? [last, first] : [first, last];
}
function pathEndpoints(shape: PathShape, arcs: NonNullable<MapshaperDataset['arcs']>): Set<string> {
  const endpoints = new Set<string>();
  for (const part of shape) {
    if (!part.length) continue;
    endpoints.add(coordinateKey(arcEndpoints(arcs, part[0]!)[0]));
    endpoints.add(coordinateKey(arcEndpoints(arcs, part[part.length - 1]!)[1]));
  }
  return endpoints;
}
function partitionShape(shape: PathShape, cutCoordinates: ReadonlySet<string>, arcs: NonNullable<MapshaperDataset['arcs']>, adapter: MapshaperAdapter): PathShape[] {
  const pieces: PathShape[] = [];
  for (const part of shape) {
    let current: number[] = [];
    for (const signedArcId of part) {
      current.push(signedArcId);
      if (cutCoordinates.has(coordinateKey(arcEndpoints(arcs, signedArcId)[1]))) {
        const piece: PathShape = [[...current]];
        if (adapter.getShapePerimeter(piece, arcs) !== 0) pieces.push(piece);
        current = [];
      }
    }
    if (current.length) {
      const piece: PathShape = [[...current]];
      if (adapter.getShapePerimeter(piece, arcs) !== 0) pieces.push(piece);
    }
  }
  return pieces;
}
function collectPointCutPoints(shape: PathShape, arcs: NonNullable<MapshaperDataset['arcs']>, point: Coordinate, adapter: MapshaperAdapter): ArcCutPoint[] {
  const endpointKeys = pathEndpoints(shape, arcs);
  const cutPoints: ArcCutPoint[] = [];
  const seen = new Set<string>();
  adapter.forEachSegmentInShape(shape, arcs, (i, j, xx, yy) => {
    const a: [number, number] = [xx[i]!, yy[i]!];
    const b: [number, number] = [xx[j]!, yy[j]!];
    const closest = adapter.findClosestPointOnSeg(point[0], point[1], a[0], a[1], b[0], b[1], 0);
    const scale = Math.max(1, Math.abs(point[0]), Math.abs(point[1]), Math.abs(a[0]), Math.abs(a[1]), Math.abs(b[0]), Math.abs(b[1]));
    const tolerance = scale * INTERSECTION_EPSILON;
    if ((point[0] - closest[0]) ** 2 + (point[1] - closest[1]) ** 2 > tolerance ** 2 || endpointKeys.has(coordinateKey(closest))) return;
    const cutIndex = Math.min(i, j);
    const key = `${closest[0]},${closest[1]},${cutIndex}`;
    if (!seen.has(key)) { seen.add(key); cutPoints.push({ x: closest[0], y: closest[1], i: cutIndex }); }
  });
  return cutPoints;
}
function directionsAtPartVertices(shape: PathShape, arcs: NonNullable<MapshaperDataset['arcs']>, key: string): Coordinate[][] {
  const matches: Coordinate[][] = [];
  for (const part of shape) {
    const iterator = arcs.getShapeIter!(part);
    const points: [number, number][] = [];
    while (iterator.hasNext()) points.push([iterator.x, iterator.y]);
    for (let index = 0; index < points.length; index += 1) {
      if (coordinateKey(points[index]!) !== key) continue;
      const directions: Coordinate[] = [];
      if (index > 0) directions.push([points[index - 1]![0] - points[index]![0], points[index - 1]![1] - points[index]![1]]);
      if (index + 1 < points.length) directions.push([points[index + 1]![0] - points[index]![0], points[index + 1]![1] - points[index]![1]]);
      matches.push(directions);
    }
  }
  return matches;
}
function hasSameDirection(targetDirections: Coordinate[], cutterDirections: Coordinate[]): boolean {
  return targetDirections.some((targetDirection) => cutterDirections.some((cutterDirection) => {
    const difference = Math.abs(
      Math.atan2(targetDirection[1], targetDirection[0]) -
      Math.atan2(cutterDirection[1], cutterDirection[0]),
    );
    return Math.min(difference, Math.abs(Math.PI * 2 - difference)) <= INTERSECTION_EPSILON;
  }));
}
function transverseAtVertex(targetDirections: Coordinate[], cutterDirections: Coordinate[]): boolean {
  if (targetDirections.length !== 2 || cutterDirections.length !== 2 || hasSameDirection(targetDirections, cutterDirections)) return false;
  const rays = [
    ...targetDirections.map((direction) => ({ owner: 'target', angle: Math.atan2(direction[1], direction[0]) })),
    ...cutterDirections.map((direction) => ({ owner: 'cutter', angle: Math.atan2(direction[1], direction[0]) })),
  ].sort((a, b) => a.angle - b.angle);
  return rays.every((ray, index) => ray.owner !== rays[(index + 1) % rays.length]!.owner);
}
function properLineCutCoordinates(shape: PathShape, arcs: NonNullable<MapshaperDataset['arcs']>, coordinates: readonly Coordinate[], adapter: MapshaperAdapter): Set<string> {
  const proper = new Set<string>();
  adapter.forEachSegmentInShape(shape, arcs, (i, j, xx, yy) => {
    const a: [number, number] = [xx[i]!, yy[i]!], b: [number, number] = [xx[j]!, yy[j]!];
    for (let n = 1; n < coordinates.length; n += 1) {
      const c = coordinates[n - 1]!, d = coordinates[n]!;
      const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1];
      const denominator = rx * sy - ry * sx;
      if (Math.abs(denominator) <= Math.hypot(rx, ry) * Math.hypot(sx, sy) * INTERSECTION_EPSILON) continue;
      const acx = c[0] - a[0], acy = c[1] - a[1];
      const targetT = (acx * sy - acy * sx) / denominator, cutterT = (acx * ry - acy * rx) / denominator;
      if (targetT < -INTERSECTION_EPSILON || targetT > 1 + INTERSECTION_EPSILON || cutterT < -INTERSECTION_EPSILON || cutterT > 1 + INTERSECTION_EPSILON) continue;
      const intersection: [number, number] = [a[0] + targetT * rx, a[1] + targetT * ry];
      const targetInterior = targetT > INTERSECTION_EPSILON && targetT < 1 - INTERSECTION_EPSILON;
      const cutterInterior = cutterT > INTERSECTION_EPSILON && cutterT < 1 - INTERSECTION_EPSILON;
      if (targetInterior && cutterInterior) { proper.add(coordinateKey(intersection)); continue; }
      const key = coordinateKey(intersection);
      const cutterDirections: Coordinate[] = cutterInterior
        ? [[c[0] - intersection[0], c[1] - intersection[1]], [d[0] - intersection[0], d[1] - intersection[1]]]
        : [];
      if (!cutterInterior) {
        for (let index = 0; index < coordinates.length; index += 1) {
          if (coordinateKey(coordinates[index]!) !== key) continue;
          if (index > 0) cutterDirections.push([coordinates[index - 1]![0] - coordinates[index]![0], coordinates[index - 1]![1] - coordinates[index]![1]]);
          if (index + 1 < coordinates.length) cutterDirections.push([coordinates[index + 1]![0] - coordinates[index]![0], coordinates[index + 1]![1] - coordinates[index]![1]]);
        }
      }
      const targetDirectionGroups: Coordinate[][] = [];
      if (targetInterior) targetDirectionGroups.push([[a[0] - intersection[0], a[1] - intersection[1]], [b[0] - intersection[0], b[1] - intersection[1]]]);
      else targetDirectionGroups.push(...directionsAtPartVertices(shape, arcs, key));
      if (targetDirectionGroups.some((directions) => transverseAtVertex(directions, cutterDirections))) proper.add(key);
    }
  });
  return proper;
}
function cutterEndpointKeys(shape: PathShape, arcs: NonNullable<MapshaperDataset['arcs']>): Set<string> {
  const keys = new Set<string>();
  for (const part of shape) for (const arc of part) { const [start, end] = arcEndpoints(arcs, arc); keys.add(coordinateKey(start)); keys.add(coordinateKey(end)); }
  return keys;
}
export function splitSelectedPolylines(dataset: MapshaperDataset, layerIndex: number, selectedIds: ReadonlySet<number>, cutter: SplitCutter, adapter: MapshaperAdapter): PolylineSplitOutcome {
  const arcs = dataset.arcs, layer = dataset.layers[layerIndex];
  if (!arcs || !layer?.shapes) throw new SplitGeometryValidationError('geometry', 'Selected layer has no path geometry');
  if (cutter.type === 'point') {
    const allCuts: ArcCutPoint[] = [], cutsByFeature = new Map<number, Set<string>>();
    let pointOnSelectedPath = false;
    for (const featureId of selectedIds) {
      const shape = layer.shapes[featureId] as PathShape | null;
      if (!shape) continue;
      const endpoints = pathEndpoints(shape, arcs);
      if (endpoints.has(coordinateKey(cutter.coordinates))) { pointOnSelectedPath = true; continue; }
      const cuts = collectPointCutPoints(shape, arcs, cutter.coordinates, adapter);
      if (cuts.length) { pointOnSelectedPath = true; allCuts.push(...cuts); cutsByFeature.set(featureId, new Set(cuts.map(({ x, y }) => coordinateKey([x, y])))); }
      else {
        let matched = false;
        adapter.forEachSegmentInShape(shape, arcs, (i, j, xx, yy) => {
          const closest = adapter.findClosestPointOnSeg(cutter.coordinates[0], cutter.coordinates[1], xx[i]!, yy[i]!, xx[j]!, yy[j]!, 0);
          const scale = Math.max(1, ...cutter.coordinates.map(Math.abs), Math.abs(xx[i]!), Math.abs(yy[i]!), Math.abs(xx[j]!), Math.abs(yy[j]!));
          matched ||= (cutter.coordinates[0] - closest[0]) ** 2 + (cutter.coordinates[1] - closest[1]) ** 2 <= (scale * INTERSECTION_EPSILON) ** 2;
        });
        pointOnSelectedPath ||= matched;
      }
    }
    if (!pointOnSelectedPath) throw new SplitGeometryValidationError('cutter', 'Point cutter is not on a selected path');
    if (!allCuts.length) return { pieces: [], pointOnSelectedPath };
    adapter.insertCutPoints(dataset, allCuts);
    const cutCoordinates = new Set(allCuts.map(({ x, y }) => coordinateKey([x, y]))), pieces: SplitPieces[] = [];
    for (const featureId of selectedIds) {
      const shape = layer.shapes[featureId] as PathShape | null;
      if (!shape || !cutsByFeature.get(featureId)?.size) continue;
      const partitioned = partitionShape(shape, cutCoordinates, arcs, adapter);
      if (partitioned.length >= 2) pieces.push({ featureId, pieces: partitioned });
    }
    return { pieces, pointOnSelectedPath };
  }
  if (cutter.coordinates.length < 2) throw new SplitGeometryValidationError('cutter', 'Line cutter needs at least two coordinates');
  const properCutsByFeature = new Map<number, Map<number, Set<string>>>();
  for (const featureId of selectedIds) {
    const shape = layer.shapes[featureId] as PathShape | null;
    if (!shape) continue;
    properCutsByFeature.set(featureId, new Map(shape.map((part, partIndex) => [partIndex, properLineCutCoordinates([part], arcs, cutter.coordinates, adapter)])));
  }
  const cutterArcId = arcs.size();
  adapter.appendEmptyArc(arcs);
  for (const coordinate of cutter.coordinates) adapter.appendVertex(arcs, [coordinate[0], coordinate[1]]);
  const cutterLayer: MapshaperLayer = { geometry_type: 'polyline', shapes: [[[cutterArcId]]] };
  dataset.layers.push(cutterLayer);
  adapter.addIntersectionCuts(dataset, { no_snap: true, rebuild_topology: true });
  const cutCoordinates = cutterEndpointKeys(cutterLayer.shapes![0] as PathShape, arcs), pieces: SplitPieces[] = [];
  for (const featureId of selectedIds) {
    const shape = layer.shapes[featureId] as PathShape | null;
    const cutsByPart = properCutsByFeature.get(featureId);
    if (!shape || !cutsByPart) continue;
    const partitioned = shape.flatMap((part, partIndex) => {
      const properCuts = cutsByPart.get(partIndex);
      return properCuts?.size
        ? partitionShape([part], new Set([...cutCoordinates].filter((key) => properCuts.has(key))), arcs, adapter)
        : [[...part] as number[]].map((unchanged) => [unchanged]);
    });
    if ([...cutsByPart.values()].some((cuts) => cuts.size) && partitioned.length >= 2) pieces.push({ featureId, pieces: partitioned });
  }
  return { pieces, pointOnSelectedPath: false };
}
