import { getDefaultMapshaperAdapter, type MapshaperAdapter } from '../../adapter/mapshaper-adapter';
import {
  isPathLayer,
  type MapshaperDataset,
  type MapshaperLayer,
  type PathLayer,
  type PathShape,
} from '../../types/mapshaper-types';
import { Err, type OpResult } from '../op-result';
import type { AddPartOptions, DeletePartOptions, FeatureRef } from '../types';
import type { OpContext } from './_context';
import {
  type Coordinate,
  normalizeConsecutiveCoordinates,
  SegmentConflictIndex,
  shapeSegments,
  shoelaceArea,
  validatePolygon,
  validatePolygonArcReferences,
} from './geometry-2d';
import { collectPolygonExteriors } from './reshape-selected-polygon';
import { getLayerId } from '../../source/layer-utils';
import { SplitGeometryValidationError } from './split-selected-error';

const EPSILON = Number.EPSILON * 1024;

type Part = Coordinate[];
type SelectedPath = {
  sourceId: string;
  layerId: string;
  layer: PathLayer;
  featureId: number;
  dataset: MapshaperDataset;
};

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

function isFailure(result: unknown): result is OpResult<void> {
  return typeof result === 'object' && result !== null && 'ok' in result && result.ok === false;
}

function lineSegments(part: readonly Coordinate[]): Array<[Coordinate, Coordinate]> {
  return part.slice(1).map((point, index) => [part[index]!, point]);
}

function normalizePart(value: unknown, polygon: boolean): Part | null {
  if (!Array.isArray(value) || !value.every(isCoordinate)) return null;
  const part = normalizeConsecutiveCoordinates(value);
  if (polygon) {
    const first = part[0];
    const last = part.at(-1);
    if (!first || !last) return null;
    if (first[0] !== last[0] || first[1] !== last[1]) part.push([first[0], first[1]]);
    return part.length >= 4 ? part : null;
  }
  return part.length >= 2 ? part : null;
}

function selectPath(ctx: OpContext, refs: FeatureRef[]): SelectedPath | OpResult<void> {
  if (refs.length !== 1) return Err.validation('selection', 'select exactly one feature');
  const { source: sourceId, layer: layerId, id: featureId } = refs[0]!;
  const source = ctx.host._sources.get(sourceId);
  if (!source) return Err.notFound('source', sourceId);
  const layer = ctx.host.layers.resolve(sourceId, layerId);
  if (!layer) return Err.notFound('layer', layerId);
  if (
    !isPathLayer(layer) ||
    (layer.geometry_type !== 'polygon' && layer.geometry_type !== 'polyline') ||
    !layer.shapes
  )
    return Err.validation('layer', 'selected layer must have polyline or polygon geometry');
  if (
    !Number.isInteger(featureId) ||
    featureId < 0 ||
    featureId >= layer.shapes.length ||
    !layer.shapes[featureId]
  )
    return Err.validation('selection', `selected feature ${featureId} has no geometry`);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', sourceId);
  return { sourceId, layerId, layer, featureId, dataset };
}

function validatePolygonShape(
  shape: PathShape,
  arcs: NonNullable<MapshaperDataset['arcs']>,
  adapter: MapshaperAdapter,
): OpResult<void> | null {
  try {
    validatePolygonArcReferences(shape, arcs);
    validatePolygon(shape, arcs, adapter);
    return null;
  } catch (error) {
    if (error instanceof SplitGeometryValidationError)
      return Err.validation('geometry', error.reason);
    throw error;
  }
}

function coordinateScale(coordinates: readonly Coordinate[]): number {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const [x, y] of coordinates) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return Math.max(maxX - minX, maxY - minY, 1);
}

function pointInRing(point: Coordinate, ring: readonly Coordinate[]): boolean {
  let inside = false;
  for (let index = 1; index < ring.length; index++) {
    const [ax, ay] = ring[index - 1]!;
    const [bx, by] = ring[index]!;
    if (
      ay > point[1] !== by > point[1] &&
      point[0] < ((bx - ax) * (point[1] - ay)) / (by - ay) + ax
    )
      inside = !inside;
  }
  return inside;
}

function partCoordinates(
  part: readonly number[],
  arcs: NonNullable<MapshaperDataset['arcs']>,
): Coordinate[] {
  const segments = shapeSegments([part.slice()], arcs);
  return segments.map(([start]) => start).concat(segments.at(-1)?.[1] ?? []);
}

function validateNewLine(
  part: Part,
  shape: PathShape,
  arcs: NonNullable<MapshaperDataset['arcs']>,
): string | null {
  const segments = lineSegments(part);
  if (new SegmentConflictIndex([segments], false).hasConflict()) return 'part self-intersects';
  if (new SegmentConflictIndex([shapeSegments(shape, arcs)]).conflictsWithAny(segments))
    return 'part conflicts with existing geometry';
  return null;
}

function validateNewPolygon(
  part: Part,
  shape: PathShape,
  arcs: NonNullable<MapshaperDataset['arcs']>,
  adapter: MapshaperAdapter,
): string | null {
  const segments = lineSegments(part);
  if (Math.abs(shoelaceArea(part)) === 0) return 'part must enclose an area';
  if (new SegmentConflictIndex([segments]).hasConflict()) return 'part self-intersects';
  const tolerance = coordinateScale(part) * EPSILON;
  const boundary = shapeSegments(shape, arcs);
  for (const point of part.slice(0, -1)) {
    if (adapter.testPointInPolygon(point[0], point[1], shape, arcs))
      return 'part overlaps an existing polygon';
    if (
      boundary.some(([start, end]) => {
        const dx = end[0] - start[0];
        const dy = end[1] - start[1];
        const t = Math.max(
          0,
          Math.min(
            1,
            ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy),
          ),
        );
        return (
          Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy)) <= tolerance
        );
      })
    )
      return 'part vertices must not lie on a polygon boundary';
  }
  if (new SegmentConflictIndex([boundary]).conflictsWithAny(segments))
    return 'part intersects existing geometry';
  const exteriors = collectPolygonExteriors(shape, arcs, adapter);
  for (const exterior of exteriors) {
    if (
      partCoordinates(shape[exterior.exteriorIndex]!, arcs)
        .slice(0, -1)
        .some((point) => pointInRing(point, part))
    )
      return 'part encloses an existing exterior';
  }
  const existing = exteriors[0];
  if (!existing) return 'selected polygon geometry is invalid';
  const existingCoordinates = partCoordinates(shape[existing.exteriorIndex]!, arcs);
  if (shoelaceArea(part) * shoelaceArea(existingCoordinates) < 0)
    return 'part orientation must match existing exteriors';
  return null;
}

function appendPart(
  part: Part,
  shape: PathShape,
  arcs: NonNullable<MapshaperDataset['arcs']>,
  adapter: MapshaperAdapter,
  polygon: boolean,
): void {
  const arcId = adapter.appendArc(arcs, polygon ? [...part].reverse() : part);
  shape.push([arcId]);
}

export async function addPart(ctx: OpContext, options: AddPartOptions): Promise<OpResult<void>> {
  const normalized = normalizePart(options.coordinates, false);
  if (!normalized)
    return Err.validation('part', 'part coordinates must contain at least two points');
  const refs = ctx.host._selection.getAll();
  const selected = selectPath(ctx, refs);
  if (isFailure(selected)) return selected;
  const polygon = selected.layer.geometry_type === 'polygon';
  const part = polygon ? normalizePart(normalized, true) : normalized;
  if (!part) return Err.validation('part', 'part coordinates must form a ring');
  if (!selected.dataset.arcs)
    return Err.validation('selection', 'selected path geometry is invalid');
  const adapter = getDefaultMapshaperAdapter();
  return ctx.runPreparedDatasetMutation(selected.sourceId, 'Add part', (working, original) => {
    if (original !== selected.dataset) return Err.staleOperation(selected.sourceId, 'Add part');
    const layer = ctx.host.layers.resolveInLayers(working.layers, selected.layerId);
    const workingArcs = working.arcs;
    if (
      !layer ||
      !isPathLayer(layer) ||
      layer.geometry_type !== selected.layer.geometry_type ||
      !layer.shapes ||
      !workingArcs
    )
      return Err.staleOperation(selected.sourceId, 'Add part');
    const workingShape = layer.shapes[selected.featureId] as PathShape | null;
    if (!workingShape) return Err.staleOperation(selected.sourceId, 'Add part');
    const workingShapeError = polygon
      ? validatePolygonShape(workingShape, workingArcs, adapter)
      : null;
    if (workingShapeError) return workingShapeError;
    const validation = polygon
      ? validateNewPolygon(part, workingShape, workingArcs, adapter)
      : validateNewLine(part, workingShape, workingArcs);
    if (validation) return Err.validation('part', validation);
    appendPart(part, workingShape, workingArcs, adapter, polygon);
    return { value: undefined, selection: refs };
  });
}

function closestPartIndex(
  point: Coordinate,
  shape: PathShape,
  arcs: NonNullable<MapshaperDataset['arcs']>,
  adapter: MapshaperAdapter,
): { index: number; distance: number } | null {
  let closest: { index: number; distance: number } | null = null;
  for (let index = 0; index < shape.length; index++) {
    for (const [start, end] of shapeSegments([shape[index]!], arcs)) {
      const nearest = adapter.findClosestPointOnSeg(
        point[0],
        point[1],
        start[0],
        start[1],
        end[0],
        end[1],
        0,
      );
      const distance = Math.hypot(point[0] - nearest[0], point[1] - nearest[1]);
      if (!closest || distance < closest.distance) closest = { index, distance };
    }
  }
  return closest;
}

function polygonPartIndex(
  point: Coordinate,
  shape: PathShape,
  arcs: NonNullable<MapshaperDataset['arcs']>,
  adapter: MapshaperAdapter,
): number {
  let candidate = -1;
  let candidateArea = Infinity;
  for (let index = 0; index < shape.length; index++) {
    if (!adapter.testPointInPolygon(point[0], point[1], [shape[index]!], arcs)) continue;
    const area = Math.abs(
      shoelaceArea(shapeSegments([shape[index]!], arcs).map(([start]) => start)),
    );
    if (area < candidateArea) {
      candidate = index;
      candidateArea = area;
    }
  }
  return candidate;
}

/** True when `ref` addresses `layer` under any identifier the layer registry accepts. */
function refMatchesLayer(
  ref: FeatureRef,
  sourceId: string,
  layer: MapshaperLayer,
  layerIndex: number,
): boolean {
  return (
    ref.source === sourceId &&
    (ref.layer === getLayerId(layer, layerIndex) ||
      ref.layer === layer.name ||
      ref.layer === layer.id)
  );
}

/** Drop the removed feature from `refs` and shift later ids of the same layer down by one. */
function selectionAfterFeatureRemoval(
  refs: FeatureRef[],
  sourceId: string,
  layer: MapshaperLayer,
  layerIndex: number,
  removedId: number | null,
): FeatureRef[] {
  if (removedId === null) return refs;
  return refs.flatMap((ref) => {
    if (!refMatchesLayer(ref, sourceId, layer, layerIndex)) return [ref];
    if (ref.id === removedId) return [];
    return [ref.id > removedId ? { ...ref, id: ref.id - 1 } : ref];
  });
}

/**
 * Removes the part hit by the supplied point, QGIS-style: no selection is
 * required — clicking a part deletes that part. Deleting a feature's last
 * remaining part removes the whole feature.
 */
export async function deletePart(
  ctx: OpContext,
  options: DeletePartOptions,
): Promise<OpResult<void>> {
  if (!isCoordinate(options.point)) return Err.validation('part', 'point coordinates are invalid');
  const adapter = getDefaultMapshaperAdapter();
  const tolerance = options.tolerance ?? 0;
  let searchedPolygon = false;
  for (const [sourceId, source] of ctx.host._sources) {
    const dataset = source.getDataset();
    if (!dataset?.arcs) continue;
    const result = await ctx.runPreparedDatasetMutation(
      sourceId,
      'Delete part',
      (working, original) => {
        if (original !== dataset) return Err.staleOperation(sourceId, 'Delete part');
        const workingArcs = working.arcs!;
        for (let layerIndex = 0; layerIndex < working.layers.length; layerIndex++) {
          const workingLayer = working.layers[layerIndex]!;
          if (
            !isPathLayer(workingLayer) ||
            (workingLayer.geometry_type !== 'polygon' &&
              workingLayer.geometry_type !== 'polyline') ||
            !workingLayer.shapes
          )
            continue;
          const polygon = workingLayer.geometry_type === 'polygon';
          if (polygon) searchedPolygon = true;
          for (let featureId = 0; featureId < workingLayer.shapes.length; featureId++) {
            const shape = workingLayer.shapes[featureId] as PathShape | null;
            if (!shape?.length) continue;
            const index = polygon
              ? polygonPartIndex(options.point, shape, workingArcs, adapter)
              : (() => {
                  const closest = closestPartIndex(options.point, shape, workingArcs, adapter);
                  return closest && closest.distance <= tolerance ? closest.index : -1;
                })();
            if (index === -1) continue;
            if (polygon) {
              const shapeError = validatePolygonShape(shape, workingArcs, adapter);
              if (shapeError) return shapeError;
            }
            shape.splice(index, 1);
            const removedId = shape.length === 0 ? featureId : null;
            if (removedId !== null) {
              workingLayer.shapes.splice(featureId, 1);
              workingLayer.data?.getRecords?.().splice(featureId, 1);
            }
            adapter.cleanArcReferences(working);
            return {
              value: undefined,
              selection: selectionAfterFeatureRemoval(
                ctx.host._selection.getAll(),
                sourceId,
                workingLayer,
                layerIndex,
                removedId,
              ),
            };
          }
        }
        return Err.validation('part', 'no part contains the point');
      },
    );
    if (result.ok) return result;
    if (result.error.kind !== 'validation') return result;
  }
  return Err.validation(
    'part',
    searchedPolygon ? 'no part contains the point' : 'no part near the point',
  );
}
