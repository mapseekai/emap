import type { MapshaperDataset } from '../../types/mapshaper-types';
import { DuckDbOperationError } from '../errors';
import { getDuckDbRuntime, type DuckDbRuntime } from '../runtime';
import {
  distanceRelation,
  runDistanceWithinRelation,
  runTopologicalRelation,
  type DuckDbRelationHelperOptions,
} from './_relation-engine';
import { RELATION_OPERATIONS, type DuckDbTopologicalRelationOperationId } from './_relation-types';

export type {
  DuckDbNamedRelationOperation,
  DuckDbRelationOperationId,
  DuckDbTopologicalRelationOperationId,
} from './_relation-types';
export type { DuckDbRelationHelperOptions } from './_relation-engine';
export { distanceRelation, getDuckDbRelationOperation } from './_relation-engine';

export function runNamedDuckDbRelationOperation(
  mode: string,
  operation: string,
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbRelationHelperOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  if (mode !== 'filter' && mode !== 'attribute') {
    throw new DuckDbOperationError('validation', `Unknown DuckDB relation mode '${mode}'`, {
      field: 'mode',
    });
  }
  if (
    !(operation in RELATION_OPERATIONS) &&
    operation !== 'distance' &&
    operation !== 'distanceWithin'
  ) {
    throw new DuckDbOperationError(
      'validation',
      `Unknown DuckDB relation operation '${operation}'`,
      { field: 'operation' },
    );
  }
  if (operation === 'distance') {
    if (mode === 'filter') {
      throw new DuckDbOperationError(
        'validation',
        "DuckDB relation operation 'distance' only supports attribute mode",
        { field: 'operation' },
      );
    }
    return distanceRelation(inputDataset, maskDataset, opts, runtime);
  }
  if (operation === 'distanceWithin') {
    return runDistanceWithinRelation(mode, inputDataset, maskDataset, opts, runtime);
  }
  return runTopologicalRelation(
    operation as DuckDbTopologicalRelationOperationId,
    mode,
    inputDataset,
    maskDataset,
    opts,
    runtime,
  );
}
