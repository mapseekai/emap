import type { MapshaperAdapter } from '../../adapter/mapshaper-adapter';
import type { MapshaperDataset, PathShape } from '../../types/mapshaper-types';
import {
  normalizeConsecutiveCoordinates,
  SegmentConflictIndex,
  shapeSegments,
  shoelaceArea,
  unsignedArcId,
  type Coordinate,
} from './geometry-2d';
import { clipLineBetween, collectLineContacts } from './reshape-selected-line';
export interface PolygonExterior {
  exteriorIndex: number;
  holeIndexes: number[];
}

function partCoordinates(
  part: readonly number[],
  arcs: NonNullable<MapshaperDataset['arcs']>,
): Coordinate[] {
  const points: Coordinate[] = [];
  for (const id of part) {
    const arc: Coordinate[] = [];
    const iterator = arcs.getArcIter(unsignedArcId(id));
    while (iterator.hasNext()) arc.push([iterator.x, iterator.y]);
    if (id < 0) arc.reverse();
    points.push(...(points.length === 0 ? arc : arc.slice(1)));
  }
  return points;
}

/** Groups rings using mapshaper's imported orientation and their original containment. */
export function collectPolygonExteriors(
  shape: PathShape,
  arcs: NonNullable<MapshaperDataset['arcs']>,
  adapter: MapshaperAdapter,
): PolygonExterior[] {
  if (shape.length === 0) return [];
  const exteriorSign = Math.sign(shoelaceArea(partCoordinates(shape[0]!, arcs)));
  const exteriors: PolygonExterior[] = shape.flatMap((part, index) =>
    Math.sign(shoelaceArea(partCoordinates(part, arcs))) === exteriorSign
      ? [{ exteriorIndex: index, holeIndexes: [] }]
      : [],
  );
  for (let holeIndex = 0; holeIndex < shape.length; holeIndex++) {
    if (Math.sign(shoelaceArea(partCoordinates(shape[holeIndex]!, arcs))) === exteriorSign)
      continue;
    const holePoints = partCoordinates(shape[holeIndex]!, arcs);
    const exterior = exteriors.find(({ exteriorIndex }) =>
      holePoints.some((point) =>
        adapter.testPointInPolygon(point[0], point[1], [shape[exteriorIndex]!], arcs),
      ),
    );
    exterior?.holeIndexes.push(holeIndex);
  }
  return exteriors;
}

function distance(a: Coordinate, b: Coordinate): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function pointAlongRing(points: readonly Coordinate[], distanceAlong: number): Coordinate {
  let travelled = 0;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1]!;
    const b = points[index]!;
    const length = distance(a, b);
    if (travelled + length >= distanceAlong) {
      const scale = length === 0 ? 0 : (distanceAlong - travelled) / length;
      return [a[0] + (b[0] - a[0]) * scale, a[1] + (b[1] - a[1]) * scale];
    }
    travelled += length;
  }
  return points.at(-1)!;
}

function forwardRingPath(points: readonly Coordinate[], from: number, to: number): Coordinate[] {
  const total = points
    .slice(1)
    .reduce((sum, point, index) => sum + distance(points[index]!, point), 0);
  const end = to < from ? to + total : to;
  const result = [pointAlongRing(points, from)];
  const lifted: Array<{ offset: number; point: Coordinate }> = [];
  let travelled = 0;
  for (let index = 1; index < points.length; index++) {
    travelled += distance(points[index - 1]!, points[index]!);
    for (let offset = travelled; offset < end; offset += total)
      if (offset > from) lifted.push({ offset, point: points[index]! });
  }
  lifted.sort((left, right) => left.offset - right.offset);
  for (const { point } of lifted) result.push(point);
  result.push(pointAlongRing(points, end % total));
  return normalizeConsecutiveCoordinates(result);
}

function lineMidpoint(points: readonly Coordinate[]): Coordinate {
  const total = points
    .slice(1)
    .reduce((sum, point, index) => sum + distance(points[index]!, point), 0);
  let travelled = 0;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1]!;
    const b = points[index]!;
    const length = distance(a, b);
    if (travelled + length >= total / 2) {
      const scale = (total / 2 - travelled) / length;
      return [a[0] + (b[0] - a[0]) * scale, a[1] + (b[1] - a[1]) * scale];
    }
    travelled += length;
  }
  return points[0]!;
}

function validCandidate(
  candidate: PathShape,
  holes: readonly number[][],
  otherExteriors: readonly number[][],
  arcs: NonNullable<MapshaperDataset['arcs']>,
  adapter: MapshaperAdapter,
): boolean {
  const candidateIndex = new SegmentConflictIndex([shapeSegments(candidate, arcs)]);
  if (candidateIndex.hasConflict()) return false;
  for (const hole of holes) {
    const coordinates = partCoordinates(hole, arcs);
    const anchor = coordinates[0];
    if (!anchor || !adapter.testPointInPolygon(anchor[0], anchor[1], candidate, arcs)) return false;
    if (candidateIndex.conflictsWithAny(shapeSegments([hole], arcs))) return false;
  }
  return !otherExteriors.some((part) =>
    partCoordinates(part, arcs)
      .slice(0, -1)
      .some((point) => adapter.testPointInPolygon(point[0], point[1], candidate, arcs)),
  );
}

/** Reshapes each contacted exterior, retaining its original holes and part order. */
export function reshapeSelectedPolygon(
  dataset: MapshaperDataset,
  layerIndex: number,
  featureId: number,
  line: readonly Coordinate[],
  adapter: MapshaperAdapter,
): PathShape | null {
  const arcs = dataset.arcs;
  const layer = dataset.layers[layerIndex];
  const original = layer?.shapes?.[featureId] as PathShape | null;
  if (!arcs || !original) throw new Error('Selected feature has no polygon geometry');
  const shape = original.map((part) => [...part]);
  const exteriors = collectPolygonExteriors(original, arcs, adapter);
  let changed = false;

  for (const { exteriorIndex, holeIndexes } of exteriors) {
    const part = original[exteriorIndex]!;
    const contacts = collectLineContacts(part, arcs, line, adapter);
    if (contacts.length < 2) continue;
    const first = contacts[0]!;
    const last = contacts.at(-1)!;
    const clipped = clipLineBetween(line, first.lineDist, last.lineDist);
    if (clipped.length < 2 || distance(clipped[0]!, clipped.at(-1)!) === 0) continue;
    const points = partCoordinates(part, arcs);
    const forward = forwardRingPath(points, first.targetDist, last.targetDist);
    const reverse = forwardRingPath(points, last.targetDist, first.targetDist);
    const candidateAPoints = normalizeConsecutiveCoordinates([
      ...forward,
      ...[...clipped].reverse().slice(1),
    ]);
    const candidateBPoints = normalizeConsecutiveCoordinates([...clipped, ...reverse.slice(1)]);
    const originalSign = Math.sign(shoelaceArea(points));
    if (Math.sign(shoelaceArea(candidateAPoints)) !== originalSign) candidateAPoints.reverse();
    if (Math.sign(shoelaceArea(candidateBPoints)) !== originalSign) candidateBPoints.reverse();
    const arcStart = arcs.size();
    const candidateA: PathShape = [[adapter.appendArc(arcs, candidateAPoints)]];
    const candidateB: PathShape = [[adapter.appendArc(arcs, candidateBPoints)]];
    const holes = holeIndexes.map((index) => original[index]!);
    const otherExteriors = exteriors
      .filter((group) => group.exteriorIndex !== exteriorIndex)
      .map((group) => original[group.exteriorIndex]!);
    const validA = validCandidate(candidateA, holes, otherExteriors, arcs, adapter);
    const validB = validCandidate(candidateB, holes, otherExteriors, arcs, adapter);
    if (!validA && !validB) {
      while (arcs.size() > arcStart) adapter.deleteLastArc(arcs);
      continue;
    }
    let useCandidateB = !validA && validB;
    if (validA && validB) {
      const midpoint = lineMidpoint(clipped);
      const midpointIsInside = adapter.testPointInPolygon(midpoint[0], midpoint[1], original, arcs);
      const areaA = Math.abs(shoelaceArea(candidateAPoints));
      const areaB = Math.abs(shoelaceArea(candidateBPoints));
      useCandidateB = midpointIsInside ? areaB < areaA : areaB > areaA;
    }
    if (useCandidateB) {
      adapter.deleteLastArc(arcs);
      adapter.deleteLastArc(arcs);
      shape[exteriorIndex] = [adapter.appendArc(arcs, candidateBPoints)];
    } else {
      adapter.deleteLastArc(arcs);
      shape[exteriorIndex] = candidateA[0]!;
    }
    changed = true;
  }
  return changed ? shape : null;
}
