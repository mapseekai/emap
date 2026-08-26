import { getDefaultMapshaperAdapter } from '../../adapter/mapshaper-adapter';
import type { MapshaperDataset, PathLayer, PathShape } from '../../types/mapshaper-types';
import { isPathLayer } from '../../types/mapshaper-types';
import { Err, type OpResult } from '../op-result';
import type { AddRingOptions, DeleteRingOptions, FeatureRef } from '../types';
import type { OpContext } from './_context';
import {
  type Coordinate,
  normalizeConsecutiveCoordinates,
  segmentsConflict,
  shapeSegments,
  shoelaceArea,
  validatePolygon,
  validatePolygonArcReferences,
} from './geometry-2d';
import { SplitGeometryValidationError } from './split-selected-error';

const EPSILON = Number.EPSILON * 1024;

type Ring = Coordinate[];

function isCoordinate(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    Number.isFinite(value[0]) &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[1])
  );
}

function normalizeRing(value: unknown): Ring | null {
  if (!Array.isArray(value) || !value.every(isCoordinate)) return null;
  const ring = normalizeConsecutiveCoordinates(value);
  if (ring.length === 0) return null;
  const first = ring[0]!;
  const last = ring.at(-1)!;
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  return ring.length >= 4 ? ring : null;
}

function ringSegments(ring: readonly Coordinate[]): Array<[Coordinate, Coordinate]> {
  return ring.slice(1).map((point, index) => [ring[index]!, point]);
}

function coordinateScale(coordinates: readonly Coordinate[]): number {
  const xs = coordinates.map((coordinate) => coordinate[0]);
  const ys = coordinates.map((coordinate) => coordinate[1]);
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
}

function distanceToSegment(point: Coordinate, start: Coordinate, end: Coordinate): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared));
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
}

function selectedPolygon(
  ctx: OpContext,
  refs: FeatureRef[],
): { sourceId: string; layerId: string; layer: PathLayer; featureId: number; dataset: MapshaperDataset } | OpResult<void> {
  if (refs.length !== 1) return Err.validation('selection', 'select exactly one polygon feature');
  const { source: sourceId, layer: layerId, id: featureId } = refs[0]!;
  const source = ctx.host._sources.get(sourceId);
  if (!source) return Err.notFound('source', sourceId);
  const layer = ctx.host.layers.resolve(sourceId, layerId);
  if (!layer) return Err.notFound('layer', layerId);
  if (!isPathLayer(layer) || layer.geometry_type !== 'polygon' || !layer.shapes)
    return Err.validation('selection', 'selected layer has no polygon geometry');
  if (!Number.isInteger(featureId) || featureId < 0 || featureId >= layer.shapes.length || !layer.shapes[featureId])
    return Err.validation('selection', `selected feature ${featureId} has no geometry`);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', sourceId);
  return { sourceId, layerId, layer, featureId, dataset };
}

function isFailure<T>(result: T | OpResult<void>): result is OpResult<void> {
  return typeof result === 'object' && result !== null && 'ok' in result;
}

function validateSelectedShape(shape: PathShape, arcs: NonNullable<MapshaperDataset['arcs']>): OpResult<void> | null {
  try {
    validatePolygonArcReferences(shape, arcs);
    validatePolygon(shape, arcs, getDefaultMapshaperAdapter());
    return null;
  } catch (error) {
    if (error instanceof SplitGeometryValidationError) return Err.validation('selection', error.reason);
    throw error;
  }
}

function validateNewRing(ring: Ring, shape: PathShape, arcs: NonNullable<MapshaperDataset['arcs']>): string | null {
  const segments = ringSegments(ring);
  if (Math.abs(shoelaceArea(ring)) === 0) return 'ring must enclose an area';
  for (let index = 0; index < segments.length; index++)
    for (let otherIndex = index + 1; otherIndex < segments.length; otherIndex++) {
      if (otherIndex === index + 1 || (index === 0 && otherIndex === segments.length - 1)) continue;
      if (segmentsConflict(...segments[index]!, ...segments[otherIndex]!)) return 'ring self-intersects';
    }
  const boundary = shapeSegments(shape, arcs);
  const tolerance = coordinateScale(ring) * EPSILON;
  for (const point of ring.slice(0, -1)) {
    if (!getDefaultMapshaperAdapter().testPointInPolygon(point[0], point[1], shape, arcs))
      return 'ring vertices must be strictly inside the selected polygon';
    if (boundary.some(([start, end]) => distanceToSegment(point, start, end) <= tolerance))
      return 'ring vertices must not lie on a polygon boundary';
  }
  for (const segment of segments)
    for (const edge of boundary)
      if (segmentsConflict(...segment, ...edge)) return 'ring intersects a polygon boundary';
  return null;
}

/** Adds an interior ring to the one selected polygon feature. */
export async function addRing(ctx: OpContext, options: AddRingOptions): Promise<OpResult<void>> {
  const refs = ctx.host._selection.getAll();
  if (refs.length > 0) {
    const sourceId = refs[0]!.source;
    const layerId = refs[0]!.layer;
    if (refs.some((ref) => ref.source !== sourceId || ref.layer !== layerId))
      return Err.validation('selection', 'selection spans multiple sources or layers');
  }
  const ring = normalizeRing(options.ring);
  if (!ring) return Err.validation('ring', 'ring coordinates are invalid');
  const selected = selectedPolygon(ctx, refs);
  if (isFailure(selected)) return selected;
  const shape = selected.layer.shapes![selected.featureId] as PathShape;
  const arcs = selected.dataset.arcs;
  if (!arcs) return Err.validation('selection', 'selected polygon geometry is invalid');
  const shapeError = validateSelectedShape(shape, arcs);
  if (shapeError) return shapeError;
  const ringError = validateNewRing(ring, shape, arcs);
  if (ringError) return Err.validation('ring', ringError);
  const adapter = getDefaultMapshaperAdapter();

  return ctx.runPreparedDatasetMutation(selected.sourceId, 'Add ring', (working, original) => {
    if (original !== selected.dataset) return Err.staleOperation(selected.sourceId, 'Add ring');
    const workingLayer = ctx.host.layers.resolveInLayers(working.layers, selected.layerId);
    if (!workingLayer || !isPathLayer(workingLayer) || workingLayer.geometry_type !== 'polygon' || !workingLayer.shapes)
      return Err.staleOperation(selected.sourceId, 'Add ring');
    const workingShape = workingLayer.shapes[selected.featureId] as PathShape | null;
    const workingArcs = working.arcs;
    if (!workingShape || !workingArcs) return Err.staleOperation(selected.sourceId, 'Add ring');
    const workingShapeError = validateSelectedShape(workingShape, workingArcs);
    if (workingShapeError) return workingShapeError;
    const workingRingError = validateNewRing(ring, workingShape, workingArcs);
    if (workingRingError) return Err.validation('ring', workingRingError);
    const exterior = shapeSegments([workingShape[0]!], workingArcs).map(([start]) => start);
    const hole = shoelaceArea(ring) * shoelaceArea(exterior) > 0 ? [...ring].reverse() : ring;
    const arcId = workingArcs.size();
    adapter.appendEmptyArc(workingArcs);
    for (const point of hole) adapter.appendVertex(workingArcs, [point[0], point[1]]);
    workingShape.splice(1, 0, [arcId]);
    return { value: undefined, selection: refs };
  });
}

/** Removes the interior ring containing the supplied point from the selected polygon. */
export async function deleteRing(ctx: OpContext, options: DeleteRingOptions): Promise<OpResult<void>> {
  const refs = ctx.host._selection.getAll();
  if (refs.length > 0) {
    const sourceId = refs[0]!.source;
    const layerId = refs[0]!.layer;
    if (refs.some((ref) => ref.source !== sourceId || ref.layer !== layerId))
      return Err.validation('selection', 'selection spans multiple sources or layers');
  }
  if (!isCoordinate(options.point)) return Err.validation('ring', 'point coordinates are invalid');
  const selected = selectedPolygon(ctx, refs);
  if (isFailure(selected)) return selected;
  const shape = selected.layer.shapes![selected.featureId] as PathShape;
  const arcs = selected.dataset.arcs;
  if (!arcs) return Err.validation('selection', 'selected polygon geometry is invalid');
  const shapeError = validateSelectedShape(shape, arcs);
  if (shapeError) return shapeError;
  const exterior = shapeSegments([shape[0]!], arcs).map(([start]) => start);
  const exteriorArea = shoelaceArea(exterior);
  const ringIndex = shape.findIndex((part, index) =>
    index > 0 && shoelaceArea(shapeSegments([part], arcs).map(([start]) => start)) * exteriorArea < 0 &&
      getDefaultMapshaperAdapter().testPointInPolygon(options.point[0], options.point[1], [part], arcs),
  );
  if (ringIndex === -1) return Err.validation('ring', 'no ring contains the point');
  const adapter = getDefaultMapshaperAdapter();

  return ctx.runPreparedDatasetMutation(selected.sourceId, 'Delete ring', (working, original) => {
    if (original !== selected.dataset) return Err.staleOperation(selected.sourceId, 'Delete ring');
    const workingLayer = ctx.host.layers.resolveInLayers(working.layers, selected.layerId);
    if (!workingLayer || !isPathLayer(workingLayer) || workingLayer.geometry_type !== 'polygon' || !workingLayer.shapes)
      return Err.staleOperation(selected.sourceId, 'Delete ring');
    const workingShape = workingLayer.shapes[selected.featureId] as PathShape | null;
    const workingArcs = working.arcs;
    if (!workingShape || !workingArcs) return Err.staleOperation(selected.sourceId, 'Delete ring');
    const workingShapeError = validateSelectedShape(workingShape, workingArcs);
    if (workingShapeError) return workingShapeError;
    workingShape.splice(ringIndex, 1);
    adapter.cleanArcReferences(working);
    return { value: undefined, selection: refs };
  });
}
