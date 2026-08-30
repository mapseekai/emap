import { getDefaultMapshaperAdapter } from '../../adapter/mapshaper-adapter';
import type { MapshaperDataset, PathShape } from '../../types/mapshaper-types';
import { Err, okValue, type OpResult } from '../op-result';
import type { ReshapeSelectedOptions, ReshapeSelectedResult } from '../types';
import { normalizeConsecutiveCoordinates, unsignedArcId, type Coordinate } from './geometry-2d';
import { planReshapeSource } from './_reshape-plan';
import type { OpContext } from './_context';
import { SplitGeometryValidationError } from './split-selected-error';

function isFiniteCoordinate(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    Number.isFinite(value[0]) &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[1])
  );
}

function isReshapeLine(value: unknown): value is Array<[number, number]> {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.every(isFiniteCoordinate) &&
    normalizeConsecutiveCoordinates(value).length >= 2
  );
}

/** Validate one polyline shape before passing it to legacy reshape geometry. */
export function validatePolylineFeatureShape(
  shape: PathShape | null | undefined,
  arcs: NonNullable<MapshaperDataset['arcs']>,
): void {
  if (!shape || shape.length === 0 || shape.some((part) => part.length === 0)) {
    throw new SplitGeometryValidationError('geometry', 'polyline geometry is invalid');
  }
  for (const part of shape) {
    for (const signedArcId of part) {
      const arcId = unsignedArcId(signedArcId);
      if (!Number.isSafeInteger(signedArcId) || arcId < 0 || arcId >= arcs.size()) {
        throw new SplitGeometryValidationError('geometry', 'polyline geometry is invalid');
      }
      const iterator = arcs.getArcIter(arcId);
      let vertices = 0;
      while (iterator.hasNext()) {
        if (!Number.isFinite(iterator.x) || !Number.isFinite(iterator.y)) {
          throw new SplitGeometryValidationError('geometry', 'polyline geometry is invalid');
        }
        vertices += 1;
      }
      if (vertices < 2)
        throw new SplitGeometryValidationError('geometry', 'polyline geometry is invalid');
    }
  }
}


/**
 * Reshape every path feature contacted by a user-drawn line, QGIS-style: no
 * selection is required. All polygon features whose boundary the line enters
 * and leaves, and all polyline features with at least two contacts, are
 * reshaped. Sources are scanned in registry order; each contacted source is
 * committed as its own undo step.
 */
export async function reshapeSelected(
  ctx: OpContext,
  options: ReshapeSelectedOptions,
): Promise<OpResult<ReshapeSelectedResult>> {
  const line: unknown = options.line;
  if (!isReshapeLine(line)) return Err.validation('line', 'line coordinates are invalid');
  const normalizedLine = normalizeConsecutiveCoordinates(line as Coordinate[]);
  const adapter = getDefaultMapshaperAdapter();
  let reshapedCount = 0;
  for (const [sourceId, source] of ctx.host._sources) {
    const dataset = source.getDataset();
    if (!dataset?.arcs) continue;
    const result = await ctx.runPreparedEditCommand(
      sourceId,
      'Reshape features',
      (planned, mutableSource) => {
        if (planned !== dataset) return Err.staleOperation(sourceId, 'Reshape features');
        const plan = planReshapeSource({
          source: mutableSource,
          sourceId,
          dataset: planned,
          line: normalizedLine,
          adapter,
          selection: ctx.host._selection,
          publishSelection: (diff) => ctx.host._fireSelectionChange(diff),
        });
        if (plan === null) return Err.validation('line', 'did not reshape any feature');
        if (plan === 'invalid') return Err.validation('geometry', 'path geometry is invalid');
        return {
          value: { reshapedCount: plan.reshapedCount },
          affectedSourceIds: [sourceId],
          command: plan.command,
        };
      },
    );
    if (result.ok) {
      reshapedCount += result.value.reshapedCount;
      continue;
    }
    if (result.error.kind !== 'validation') return result;
  }
  if (reshapedCount === 0) return Err.validation('line', 'did not reshape any feature');
  return okValue({ reshapedCount });
}
