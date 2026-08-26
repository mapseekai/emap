import type { ArcCutPoint, MapshaperAdapter } from '../../adapter/mapshaper-adapter';
import type { MapshaperDataset, PathShape } from '../../types/mapshaper-types';
import {
  arcEndpoints,
  coordinateKey,
  cross,
  normalizeConsecutiveCoordinates,
  segmentIntersection,
  unsignedArcId,
  type Coordinate,
} from './geometry-2d';

export interface Contact {
  point: [number, number];
  targetDist: number;
  lineDist: number;
}

type TargetSegment = {
  a: Coordinate;
  b: Coordinate;
  startDist: number;
  endDist: number;
  cutIndex: number;
};

const CONTACT_EPSILON = Number.EPSILON * 64;

function distance(a: Coordinate, b: Coordinate): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function isSamePoint(a: Coordinate, b: Coordinate): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function targetSegments(
  part: readonly number[],
  arcs: NonNullable<MapshaperDataset['arcs']>,
): TargetSegment[] {
  const segments: TargetSegment[] = [];
  let targetDist = 0;
  for (const signedArcId of part) {
    const iterator = arcs.getArcIter(unsignedArcId(signedArcId));
    const points: Coordinate[] = [];
    while (iterator.hasNext()) points.push([iterator.x, iterator.y]);
    if (signedArcId < 0) points.reverse();
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1]!;
      const b = points[index]!;
      const length = distance(a, b);
      const vertexData = arcs.getVertexData!();
      const arcOffset = vertexData.ii[unsignedArcId(signedArcId)]!;
      const cutIndex = arcOffset + (signedArcId < 0 ? points.length - index - 1 : index - 1);
      segments.push({ a, b, startDist: targetDist, endDist: targetDist + length, cutIndex });
      targetDist += length;
    }
  }
  return segments;
}

function lineDistanceAt(line: readonly Coordinate[], segmentIndex: number, point: Coordinate): number {
  let result = 0;
  for (let index = 1; index <= segmentIndex; index++) result += distance(line[index - 1]!, line[index]!);
  return result + distance(line[segmentIndex]!, point);
}

function isTransverseAtTargetVertex(
  segments: readonly TargetSegment[],
  segmentIndex: number,
  lineStart: Coordinate,
  lineEnd: Coordinate,
  point: Coordinate,
): boolean {
  const target = segments[segmentIndex]!;
  const closed =
    segments.length > 1 && isSamePoint(segments[0]!.a, segments.at(-1)!.b);
  const previous = isSamePoint(point, target.a)
    ? (segments[segmentIndex - 1] ?? (closed ? segments.at(-1) : undefined))
    : target;
  const next = isSamePoint(point, target.b)
    ? (segments[segmentIndex + 1] ?? (closed ? segments[0] : undefined))
    : target;
  if (!previous || !next) return false;
  return cross(lineStart, lineEnd, previous.a) * cross(lineStart, lineEnd, next.b) < 0;
}

export function collectLineContacts(
  part: readonly number[],
  arcs: NonNullable<MapshaperDataset['arcs']>,
  line: readonly Coordinate[],
  adapter: MapshaperAdapter,
): Contact[] {
  const contacts = new Map<string, Contact>();
  const segments = targetSegments(part, arcs);
  const add = (point: Coordinate, targetDist: number, lineDist: number) => {
    const key = coordinateKey(point);
    const existing = contacts.get(key);
    if (!existing || targetDist < existing.targetDist)
      contacts.set(key, { point: [point[0], point[1]], targetDist, lineDist });
  };

  for (let targetIndex = 0; targetIndex < segments.length; targetIndex++) {
    const target = segments[targetIndex]!;
    for (let lineIndex = 1; lineIndex < line.length; lineIndex++) {
      const c = line[lineIndex - 1]!;
      const d = line[lineIndex]!;
      const point = segmentIntersection(target.a, target.b, c, d);
      if (!point) continue;
      const targetAtVertex = isSamePoint(point, target.a) || isSamePoint(point, target.b);
      if (
        targetAtVertex &&
        !isTransverseAtTargetVertex(segments, targetIndex, c, d, point)
      )
        continue;
      const targetLength = target.endDist - target.startDist;
      add(point, target.startDist + Math.min(targetLength, distance(target.a, point)), lineDistanceAt(line, lineIndex - 1, point));
    }
  }

  for (const linePoint of [line[0]!, line[line.length - 1]!]) {
    let lineDist = linePoint === line[0] ? 0 : line.slice(1).reduce((sum, point, index) => sum + distance(line[index]!, point), 0);
    for (const target of segments) {
      const closest = adapter.findClosestPointOnSeg(
        linePoint[0], linePoint[1], target.a[0], target.a[1], target.b[0], target.b[1], 0,
      );
      const scale = Math.max(1, ...linePoint.map(Math.abs), ...target.a.map(Math.abs), ...target.b.map(Math.abs));
      if ((linePoint[0] - closest[0]) ** 2 + (linePoint[1] - closest[1]) ** 2 > (scale * CONTACT_EPSILON) ** 2)
        continue;
      const targetLength = target.endDist - target.startDist;
      add(closest, target.startDist + Math.min(targetLength, distance(target.a, closest)), lineDist);
    }
  }

  return [...contacts.values()].sort((left, right) => left.targetDist - right.targetDist);
}

export function clipLineBetween(
  line: readonly Coordinate[],
  fromDist: number,
  toDist: number,
): Coordinate[] {
  if (toDist < fromDist) {
    const length = line
      .slice(1)
      .reduce((total, point, index) => total + distance(line[index]!, point), 0);
    return clipLineBetween([...line].reverse(), length - fromDist, length - toDist);
  }
  const clipped: Coordinate[] = [];
  let travelled = 0;
  for (let index = 1; index < line.length; index++) {
    const a = line[index - 1]!;
    const b = line[index]!;
    const length = distance(a, b);
    const next = travelled + length;
    if (length > 0 && next >= fromDist && travelled <= toDist) {
      const start = Math.max(fromDist, travelled);
      const end = Math.min(toDist, next);
      const at = (offset: number): Coordinate => [
        a[0] + ((b[0] - a[0]) * (offset - travelled)) / length,
        a[1] + ((b[1] - a[1]) * (offset - travelled)) / length,
      ];
      clipped.push(at(start), at(end));
    }
    travelled = next;
  }
  return normalizeConsecutiveCoordinates(clipped);
}

function cutPointsForContacts(
  contacts: readonly Contact[],
  segments: readonly TargetSegment[],
): ArcCutPoint[] {
  return contacts.flatMap((contact) => {
    const segment = segments.find(
      (candidate) => contact.targetDist >= candidate.startDist && contact.targetDist <= candidate.endDist,
    );
    return segment ? [{ x: contact.point[0], y: contact.point[1], i: segment.cutIndex }] : [];
  });
}

function partArcIndexes(
  part: readonly number[],
  arcs: NonNullable<MapshaperDataset['arcs']>,
  first: Coordinate,
  last: Coordinate,
): { firstEnd: number; lastStart: number } | null {
  const firstEnd = part.findIndex((arc) => isSamePoint(arcEndpoints(arcs, arc)[1], first));
  const lastStart = part.findIndex((arc) => isSamePoint(arcEndpoints(arcs, arc)[0], last));
  return firstEnd === -1 || lastStart === -1 ? null : { firstEnd, lastStart };
}

export function reshapeSelectedPolylines(
  dataset: MapshaperDataset,
  layerIndex: number,
  selectedIds: ReadonlySet<number>,
  line: readonly Coordinate[],
  adapter: MapshaperAdapter,
): Array<{ featureId: number; shape: PathShape }> {
  const arcs = dataset.arcs;
  const layer = dataset.layers[layerIndex];
  if (!arcs || !layer?.shapes) throw new Error('Selected layer has no path geometry');
  const normalizedLine = normalizeConsecutiveCoordinates(line);
  const planned = new Map<number, Array<{ partIndex: number; first: Contact; last: Contact; clipped: Coordinate[] }>>();
  const cutPoints: ArcCutPoint[] = [];

  for (const featureId of selectedIds) {
    const shape = layer.shapes[featureId] as PathShape | null;
    if (!shape) continue;
    const featurePlans = shape.flatMap((part, partIndex) => {
      const contacts = collectLineContacts(part, arcs, normalizedLine, adapter);
      if (contacts.length < 2) return [];
      const first = contacts[0]!;
      const last = contacts.at(-1)!;
      const clipped = clipLineBetween(normalizedLine, first.lineDist, last.lineDist);
      if (clipped.length < 2 || distance(clipped[0]!, clipped.at(-1)!) === 0) return [];
      cutPoints.push(...cutPointsForContacts([first, last], targetSegments(part, arcs)));
      return [{ partIndex, first, last, clipped }];
    });
    if (featurePlans.length) planned.set(featureId, featurePlans);
  }
  if (!planned.size) return [];

  adapter.insertCutPoints(dataset, cutPoints);
  const results: Array<{ featureId: number; shape: PathShape }> = [];
  for (const [featureId, plans] of planned) {
    const shape = layer.shapes[featureId] as PathShape;
    const reshaped = shape.map((part) => [...part]);
    let changed = false;
    for (const plan of plans) {
      const part = reshaped[plan.partIndex]!;
      const indexes = partArcIndexes(part, arcs, plan.first.point, plan.last.point);
      if (!indexes) continue;
      const newArc = arcs.size();
      adapter.appendEmptyArc(arcs);
      for (const point of plan.clipped) adapter.appendVertex(arcs, [point[0], point[1]]);
      const closed = isSamePoint(arcEndpoints(arcs, part[0]!)[0], arcEndpoints(arcs, part.at(-1)!)[1]);
      const candidate = closed
        ? [newArc, ...part.slice(indexes.lastStart), ...part.slice(0, indexes.firstEnd + 1)]
        : [...part.slice(0, indexes.firstEnd + 1), newArc, ...part.slice(indexes.lastStart)];
      if (adapter.getShapePerimeter([candidate], arcs) === 0) {
        adapter.deleteLastArc(arcs);
        continue;
      }
      reshaped[plan.partIndex] = candidate;
      changed = true;
    }
    if (changed) results.push({ featureId, shape: reshaped });
  }
  return results;
}
