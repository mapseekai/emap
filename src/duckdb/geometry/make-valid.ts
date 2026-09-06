import type { MapshaperDataset } from '../../types/mapshaper-types';
import { getDuckDbRuntime, type DuckDbRuntime } from '../runtime';
import { runUnary, type GeometryOptions } from './_shared';
export function makeValid(
  input: MapshaperDataset,
  options: GeometryOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
) {
  return runUnary('makeValid', input, options, runtime);
}
