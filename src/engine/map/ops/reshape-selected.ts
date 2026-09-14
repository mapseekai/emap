import { getDefaultMapshaperAdapter } from '../../../integrations/mapshaper/adapter';
import { Err, okValue, type OpResult } from '../op-result';
import type { ReshapeSelectedOptions, ReshapeSelectedResult } from '../types';
import { normalizeConsecutiveCoordinates, type Coordinate } from './geometry-2d';
import { planReshapeSource } from './_reshape-plan';
import type { OpContext } from './_context';

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

/**
 * Reshape every path feature contacted by a user-drawn line, QGIS-style: no
 * selection is required. Every eligible source is planned before a single
 * composite command commits the contacted sources.
 */
export async function reshapeSelected(
  ctx: OpContext,
  options: ReshapeSelectedOptions,
): Promise<OpResult<ReshapeSelectedResult>> {
  const line: unknown = options.line;
  if (!isReshapeLine(line)) return Err.validation('line', 'line coordinates are invalid');
  const normalizedLine = normalizeConsecutiveCoordinates(line as Coordinate[]);
  const adapter = getDefaultMapshaperAdapter();
  const sourceIds = [...ctx.host._sources]
    .filter(([, source]) => !!source.getDataset()?.arcs)
    .map(([sourceId]) => sourceId);
  const result = await ctx.runPreparedEditCommandMany(
    sourceIds,
    (values: readonly ReshapeSelectedResult[]) => {
      const reshapedCount = values.reduce((total, value) => total + value.reshapedCount, 0);
      return `Reshape ${reshapedCount} feature${reshapedCount === 1 ? '' : 's'}`;
    },
    (sourceId, dataset, source) => {
      const plan = planReshapeSource({
        source,
        sourceId,
        dataset,
        line: normalizedLine,
        adapter,
        selection: ctx.host._selection,
        publishSelection: (diff) => ctx.host._fireSelectionChange(diff),
      });
      if (plan === null || plan === 'invalid') return null;
      return {
        value: { reshapedCount: plan.reshapedCount },
        affectedSourceIds: [sourceId],
        command: plan.command,
      };
    },
  );
  if (!result.ok) {
    return result.error.kind === 'validation'
      ? Err.validation('line', 'did not reshape any feature')
      : result;
  }
  const reshapedCount = result.value.reduce((total, value) => total + value.reshapedCount, 0);
  return reshapedCount === 0
    ? Err.validation('line', 'did not reshape any feature')
    : okValue({ reshapedCount });
}
