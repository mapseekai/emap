import { getDefaultMapshaperAdapter, type MapshaperAdapter } from '../../adapter/mapshaper-adapter';
import type { MapshaperDataset, PathShape } from '../../types/mapshaper-types';
import { isPathLayer } from '../../types/mapshaper-types';
import { PathGeometryPatchCommand } from '../../edit/commands/path-geometry-patch';
import { FeatureAppendCommand } from '../../edit/commands/feature-append';
import { Err, type OpResult } from '../op-result';
import type { AddRingOptions, DeleteRingOptions, FillRingOptions } from '../types';
import type { OpContext } from './_context';
import {
  type Coordinate,
  coordinatesToArcSnapshot,
  normalizeConsecutiveCoordinates,
  SegmentConflictIndex,
  shapeSegments,
  shoelaceArea,
  validatePolygon,
  validatePolygonArcReferences,
} from './geometry-2d';
import { collectPolygonExteriors } from './reshape-selected-polygon';
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
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared),
        );
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
}

function validateTargetShape(
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

/**
 * Locate where `ring` belongs inside `shape`: the descriptor of the exterior
 * that should receive it as a hole. Returns `'outside'` when the ring does
 * not belong to this feature, or a reportable reason when it targets this
 * feature but conflicts with its boundary.
 */
function ringTarget(
  ring: Ring,
  shape: PathShape,
  arcs: NonNullable<MapshaperDataset['arcs']>,
  adapter: MapshaperAdapter,
): { exteriorIndex: number; insertIndex: number } | 'outside' | string {
  const boundary = shapeSegments(shape, arcs);
  const tolerance = coordinateScale(ring) * EPSILON;
  for (const point of ring.slice(0, -1)) {
    if (!adapter.testPointInPolygon(point[0], point[1], shape, arcs)) return 'outside';
    if (boundary.some(([start, end]) => distanceToSegment(point, start, end) <= tolerance))
      return 'ring vertices must not lie on a polygon boundary';
  }
  if (new SegmentConflictIndex([boundary]).conflictsWithAny(ringSegments(ring)))
    return 'ring intersects a polygon boundary';
  const exterior = collectPolygonExteriors(shape, arcs, adapter).find(({ exteriorIndex }) =>
    ring
      .slice(0, -1)
      .every((point) =>
        adapter.testPointInPolygon(point[0], point[1], [shape[exteriorIndex]!], arcs),
      ),
  );
  if (!exterior) return 'outside';
  return {
    exteriorIndex: exterior.exteriorIndex,
    insertIndex: Math.max(exterior.exteriorIndex, ...exterior.holeIndexes) + 1,
  };
}

/**
 * Adds an interior ring to the polygon feature containing it, QGIS-style: no
 * selection is required. Sources are scanned in registry order and the first
 * feature whose exterior fully contains the ring receives the hole.
 */
export async function addRing(ctx: OpContext, options: AddRingOptions): Promise<OpResult<void>> {
  const ring = normalizeRing(options.ring);
  if (!ring) return Err.validation('ring', 'ring coordinates are invalid');
  if (Math.abs(shoelaceArea(ring)) === 0)
    return Err.validation('ring', 'ring must enclose an area');
  if (new SegmentConflictIndex([ringSegments(ring)]).hasConflict())
    return Err.validation('ring', 'ring self-intersects');
  const adapter = getDefaultMapshaperAdapter();
  let genericFailure: OpResult<void> | null = null;
  let specificFailure: OpResult<void> | null = null;
  for (const [sourceId, source] of ctx.host._sources) {
    const dataset = source.getDataset();
    if (!dataset?.arcs) continue;
    const result = await ctx.runPreparedEditCommand(sourceId, 'Add ring', (planned) => {
      // Read-only planning against the LIVE dataset. `planned === dataset`
      // is guaranteed by the runner; the identity check pins the contract.
      if (planned !== dataset) return Err.staleOperation(sourceId, 'Add ring');
      const arcs = planned.arcs!;
      let reason: string | null = null;
      for (const layer of planned.layers) {
        if (!isPathLayer(layer) || layer.geometry_type !== 'polygon' || !layer.shapes) continue;
        for (let featureId = 0; featureId < layer.shapes.length; featureId++) {
          const shape = layer.shapes[featureId] as PathShape | null;
          if (!shape?.length) continue;
          // Cheap prefilter (unchanged semantics): skip features that cannot
          // contain the ring.
          if (
            !shape.some((part) =>
              adapter.testPointInPolygon(ring[0]![0], ring[0]![1], [part], arcs),
            )
          )
            continue;
          const target = ringTarget(ring, shape, arcs, adapter);
          if (target === 'outside') continue;
          if (typeof target === 'string') {
            reason = reason ?? target;
            continue;
          }
          const shapeError = validateTargetShape(shape, arcs, adapter);
          if (shapeError) return shapeError;
          const exteriorCoordinates = shapeSegments([shape[target.exteriorIndex]!], arcs).map(
            ([start]) => start,
          );
          const hole =
            shoelaceArea(ring) * shoelaceArea(exteriorCoordinates) > 0 ? [...ring].reverse() : ring;
          // Build the after shape WITHOUT touching the live one: the new ring
          // references the arc id the command will append at do() time.
          const afterShape = shape.slice();
          afterShape.splice(target.insertIndex, 0, [arcs.size()]);
          return {
            value: undefined,
            affectedSourceIds: [sourceId],
            command: new PathGeometryPatchCommand({
              source,
              shapePatches: [{ layer, featureId, before: shape, after: afterShape }],
              originalArcCount: arcs.size(),
              appendedArcs: [coordinatesToArcSnapshot(hole)],
              selection: ctx.host._selection,
              beforeSelection: ctx.host._selection.snapshot(),
              afterSelection: ctx.host._selection.getAll(),
              publishSelection: (diff) => ctx.host._fireSelectionChange(diff),
              label: 'Add ring',
            }),
          };
        }
      }
      return Err.validation('ring', reason ?? 'ring is not inside a polygon exterior');
    });
    if (result.ok) return result;
    if (result.error.kind !== 'validation') return result;
    if (result.error.reason === 'ring is not inside a polygon exterior') genericFailure ??= result;
    else specificFailure ??= result;
  }
  return (
    specificFailure ??
    genericFailure ??
    Err.validation('ring', 'ring is not inside a polygon exterior')
  );
}

/**
 * Removes the interior ring containing the supplied point, QGIS-style: no
 * selection is required — clicking inside a hole deletes that hole.
 */
export async function deleteRing(
  ctx: OpContext,
  options: DeleteRingOptions,
): Promise<OpResult<void>> {
  if (!isCoordinate(options.point)) return Err.validation('ring', 'point coordinates are invalid');
  const adapter = getDefaultMapshaperAdapter();
  const [px, py] = options.point;
  for (const [sourceId, source] of ctx.host._sources) {
    const dataset = source.getDataset();
    if (!dataset?.arcs) continue;
    const result = await ctx.runPreparedEditCommand(sourceId, 'Delete ring', (planned) => {
      if (planned !== dataset) return Err.staleOperation(sourceId, 'Delete ring');
      const arcs = planned.arcs!;
      for (const layer of planned.layers) {
        if (!isPathLayer(layer) || layer.geometry_type !== 'polygon' || !layer.shapes) continue;
        for (let featureId = 0; featureId < layer.shapes.length; featureId++) {
          const shape = layer.shapes[featureId] as PathShape | null;
          if (!shape?.length) continue;
          // Cheap prefilter (unchanged).
          if (!shape.some((part) => adapter.testPointInPolygon(px, py, [part], arcs))) continue;
          for (const group of collectPolygonExteriors(shape, arcs, adapter)) {
            if (!adapter.testPointInPolygon(px, py, [shape[group.exteriorIndex]!], arcs)) continue;
            const ringIndex = group.holeIndexes.find((holeIndex) =>
              adapter.testPointInPolygon(px, py, [shape[holeIndex]!], arcs),
            );
            if (ringIndex === undefined) continue;
            const shapeError = validateTargetShape(shape, arcs, adapter);
            if (shapeError) return shapeError;
            // Shape patch only: the ring's arc stays in the collection as an
            // orphan (reclaimed on export compaction / future clean op) so
            // arc ids captured by other history entries never shift.
            const afterShape = shape.filter((_, index) => index !== ringIndex);
            return {
              value: undefined,
              affectedSourceIds: [sourceId],
              command: new PathGeometryPatchCommand({
                source,
                shapePatches: [{ layer, featureId, before: shape, after: afterShape }],
                originalArcCount: arcs.size(),
                appendedArcs: [],
                selection: ctx.host._selection,
                beforeSelection: ctx.host._selection.snapshot(),
                afterSelection: ctx.host._selection.getAll(),
                publishSelection: (diff) => ctx.host._fireSelectionChange(diff),
                label: 'Delete ring',
              }),
            };
          }
        }
      }
      return Err.validation('ring', 'no ring contains the point');
    });
    if (result.ok) return result;
    if (result.error.kind !== 'validation') return result;
  }
  return Err.validation('ring', 'no ring contains the point');
}

/**
 * Fills the interior ring containing the supplied point with a new polygon
 * feature, QGIS Fill-Ring-style: the ring is preserved on the host feature
 * and the new feature shares the ring's arcs (reversed), so the two boundaries
 * stay coincident under later edits. No selection is required — clicking
 * inside a hole fills that hole.
 */
export async function fillRing(ctx: OpContext, options: FillRingOptions): Promise<OpResult<void>> {
  if (!isCoordinate(options.point)) return Err.validation('ring', 'point coordinates are invalid');
  const adapter = getDefaultMapshaperAdapter();
  const [px, py] = options.point;
  for (const [sourceId, source] of ctx.host._sources) {
    const dataset = source.getDataset();
    if (!dataset?.arcs) continue;
    const result = await ctx.runPreparedEditCommand(sourceId, 'Fill ring', (planned) => {
      if (planned !== dataset) return Err.staleOperation(sourceId, 'Fill ring');
      const arcs = planned.arcs!;
      for (const layer of planned.layers) {
        if (!isPathLayer(layer) || layer.geometry_type !== 'polygon' || !layer.shapes) continue;
        for (let featureId = 0; featureId < layer.shapes.length; featureId++) {
          const shape = layer.shapes[featureId] as PathShape | null;
          if (!shape?.length) continue;
          // Cheap prefilter (same as deleteRing).
          if (!shape.some((part) => adapter.testPointInPolygon(px, py, [part], arcs))) continue;
          for (const group of collectPolygonExteriors(shape, arcs, adapter)) {
            if (!adapter.testPointInPolygon(px, py, [shape[group.exteriorIndex]!], arcs)) continue;
            const ringIndex = group.holeIndexes.find((holeIndex) =>
              adapter.testPointInPolygon(px, py, [shape[holeIndex]!], arcs),
            );
            if (ringIndex === undefined) continue;
            const shapeError = validateTargetShape(shape, arcs, adapter);
            if (shapeError) return shapeError;
            // Share the hole's arcs: reverse traversal order and complement
            // each arc id so the new exterior ring winds like an exterior.
            const appendedShape: PathShape = [
              shape[ringIndex]!.slice()
                .reverse()
                .map((arcId) => ~arcId),
            ];
            const appendedRecord = layer.data?.getRecords?.() ? {} : null;
            return {
              value: undefined,
              affectedSourceIds: [sourceId],
              command: new FeatureAppendCommand({
                layer,
                source,
                appendedShape,
                appendedRecord,
                label: 'Fill ring',
              }),
            };
          }
        }
      }
      return Err.validation('ring', 'no ring contains the point');
    });
    if (result.ok) return result;
    if (result.error.kind !== 'validation') return result;
  }
  return Err.validation('ring', 'no ring contains the point');
}
