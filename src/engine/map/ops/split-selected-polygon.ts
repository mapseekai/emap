import type { MapshaperAdapter } from '../../../integrations/mapshaper/adapter';
import type {
  MapshaperDataset,
  MapshaperLayer,
  PathShape,
} from '../../../shared/types/mapshaper-types';
import type { SplitCutter } from '../types';
import {
  arcEndpoints,
  type Coordinate,
  normalizeConsecutiveCoordinates,
  segmentIntersection,
  shapeSegments,
  unsignedArcId,
  validatePolygon,
  validatePolygonArcReferences,
} from './geometry-2d';
import { SplitGeometryValidationError } from './split-selected-error';
import type { SplitPieces } from './split-selected-line';

const EPSILON = Number.EPSILON * 1024;

function properCrossings(
  shape: PathShape,
  cutter: readonly Coordinate[],
  arcs: NonNullable<MapshaperDataset['arcs']>,
  adapter: MapshaperAdapter,
): Set<string> {
  const lengths = cutter
    .slice(1)
    .map((point, index) => Math.hypot(point[0] - cutter[index]![0], point[1] - cutter[index]![1]));
  const offsets = lengths.reduce<number[]>((all, length) => [...all, all.at(-1)! + length], [0]);
  const events: Array<{ point: Coordinate; distance: number }> = [];
  for (let index = 1; index < cutter.length; index++) {
    const start = cutter[index - 1]!,
      end = cutter[index]!,
      length = lengths[index - 1]!;
    if (length === 0) continue;
    for (const [boundaryStart, boundaryEnd] of shapeSegments(shape, arcs)) {
      const point = segmentIntersection(start, end, boundaryStart, boundaryEnd);
      if (point)
        events.push({
          point,
          distance: offsets[index - 1]! + Math.hypot(point[0] - start[0], point[1] - start[1]),
        });
    }
  }
  const groups: Array<{
    distance: number;
    events: Array<{ point: Coordinate; distance: number }>;
  }> = [];
  for (const event of events.sort((left, right) => left.distance - right.distance)) {
    const group = groups.at(-1);
    if (group?.distance === event.distance) group.events.push(event);
    else groups.push({ distance: event.distance, events: [event] });
  }
  const totalLength = offsets.at(-1)!;
  const pointAt = (distance: number): Coordinate => {
    const clamped = Math.max(0, Math.min(totalLength, distance));
    const segment = offsets.findIndex(
      (_offset, index) => index + 1 < offsets.length && clamped <= offsets[index + 1]!,
    );
    const start = cutter[segment]!,
      end = cutter[segment + 1]!,
      length = lengths[segment]!;
    const t = length === 0 ? 0 : (clamped - offsets[segment]!) / length;
    return [start[0] + t * (end[0] - start[0]), start[1] + t * (end[1] - start[1])];
  };
  const closed = cutter[0]![0] === cutter.at(-1)![0] && cutter[0]![1] === cutter.at(-1)![1];
  const distanceError = EPSILON * Math.max(totalLength, 1);
  const seamPoint = cutter[0]!;
  const seam =
    closed &&
    groups.length > 1 &&
    Math.abs(groups[0]!.distance) <= distanceError &&
    Math.abs(groups.at(-1)!.distance - totalLength) <= distanceError &&
    groups[0]!.events.some(
      (event) => event.point[0] === seamPoint[0] && event.point[1] === seamPoint[1],
    ) &&
    groups
      .at(-1)!
      .events.some((event) => event.point[0] === seamPoint[0] && event.point[1] === seamPoint[1]);
  const crossings = new Set<string>();
  for (let index = 0; index < groups.length; index++) {
    if (seam && index === groups.length - 1) continue;
    const group = groups[index]!;
    const previous =
      index === 0 ? (closed ? groups.at(seam ? -2 : -1) : undefined) : groups[index - 1];
    const next = index + 1 < groups.length ? groups[index + 1] : closed ? groups[0] : undefined;
    const previousDistance = previous?.distance ?? 0;
    const nextDistance = next?.distance ?? totalLength;
    if (!closed && (group.distance === previousDistance || group.distance === nextDistance))
      continue;
    const beforeEnd = seam && index === 0 ? totalLength : group.distance;
    const afterStart = seam && index === 0 ? 0 : group.distance;
    const before = pointAt((previousDistance + beforeEnd) / 2);
    const afterEnd =
      next === groups[0] ? (seam ? totalLength : totalLength + nextDistance) : nextDistance;
    const after = pointAt((afterStart + afterEnd) / 2);
    if (
      adapter.testPointInPolygon(before[0], before[1], shape, arcs) !==
      adapter.testPointInPolygon(after[0], after[1], shape, arcs)
    ) {
      for (const event of group.events) crossings.add(`${event.point[0]},${event.point[1]}`);
    }
  }
  return crossings;
}

function endpointKeys(shape: PathShape, arcs: NonNullable<MapshaperDataset['arcs']>): Set<string> {
  const keys = new Set<string>();
  for (const part of shape)
    for (const id of part) {
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
  cutter: Extract<SplitCutter, { type: 'polyline' }>,
  adapter: MapshaperAdapter,
): SplitPieces[] {
  const arcs = dataset.arcs;
  const layer = dataset.layers[layerIndex];
  if (!arcs || !layer?.shapes || layer.geometry_type !== 'polygon')
    throw new SplitGeometryValidationError('geometry', 'Selected layer has no path geometry');
  const cutterCoordinates = normalizeConsecutiveCoordinates(cutter.coordinates);
  if (cutterCoordinates.length < 2)
    throw new SplitGeometryValidationError('cutter', 'Line cutter needs at least two coordinates');

  const crossingIds = new Set<number>();
  for (const featureId of selectedIds) {
    const shape = layer.shapes[featureId] as PathShape | null;
    if (!shape) continue;
    validatePolygonArcReferences(shape, arcs);
    validatePolygon(shape, arcs, adapter);
    if (properCrossings(shape, cutterCoordinates, arcs, adapter).size >= 2)
      crossingIds.add(featureId);
  }
  if (!crossingIds.size) return [];

  const cutterArcId = arcs.size();
  adapter.appendEmptyArc(arcs);
  for (const point of cutterCoordinates) adapter.appendVertex(arcs, [point[0], point[1]]);
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
    const tiles = adapter
      .buildPolygonMosaic(arcs, new Set([...boundaryIds, ...cutterIds]))
      .filter((tile) => {
        const anchor = adapter.getShapeAnchor(tile, arcs);
        return anchor !== null && adapter.testPointInPolygon(anchor[0], anchor[1], original, arcs);
      })
      .filter((tile) => adapter.getShapeArea(tile, arcs) > 0);
    if (tiles.length < 2) continue;
    const coveredArea = tiles.reduce((sum, tile) => sum + adapter.getShapeArea(tile, arcs), 0);
    const tolerance = Math.max(originalArea * 1e-10, Number.EPSILON * 1024);
    if (Math.abs(coveredArea - originalArea) > tolerance)
      throw new SplitGeometryValidationError(
        'geometry',
        'polygon split failed coverage validation',
      );
    results.push({ featureId, pieces: tiles });
  }
  return results;
}
