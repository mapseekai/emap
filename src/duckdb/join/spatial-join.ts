import type { MapshaperDataset } from '../../types/mapshaper-types';
import { defineDuckDbTool, requireToolInput, toolParams } from '../core/tool-definition';
import { processingValidation, runTwoInputTool } from '../core/runners/processing';
import type { ProcessingOptions } from '../core/types';
import { quoteIdentifier } from '../core/pipeline';
import { type DuckDbRuntime } from '../runtime';
import type { RelationOperationId } from '../core/relation/types';

/**
 * @example
 * const predicate: SpatialJoinPredicate = 'intersects';
 */
export type SpatialJoinPredicate = Exclude<RelationOperationId, 'distance' | 'distanceWithin'>;
/**
 * @example
 * const options: SpatialJoinOptions = { predicate: 'contains', joinType: 'left' };
 */
export interface SpatialJoinOptions extends ProcessingOptions {
  predicate?: SpatialJoinPredicate;
  joinType?: 'left' | 'inner';
}
const FUNCTIONS: Record<SpatialJoinPredicate, string> = {
  intersects: 'ST_Intersects',
  contains: 'ST_Contains',
  within: 'ST_Within',
  touches: 'ST_Touches',
  disjoint: 'ST_Disjoint',
  overlaps: 'ST_Overlaps',
  equals: 'ST_Equals',
  crosses: 'ST_Crosses',
  covers: 'ST_Covers',
  coveredBy: 'ST_CoveredBy',
  containsProperly: 'ST_ContainsProperly',
};
/**
 * @example
 * const result = await spatialJoin(polygons, points, { predicate: 'contains' });
 */
export function spatialJoin(
  input: MapshaperDataset,
  join: MapshaperDataset,
  options: SpatialJoinOptions = {},
  runtime: DuckDbRuntime | null = null,
) {
  const predicate = options.predicate ?? 'intersects';
  const fn = FUNCTIONS[predicate];
  if (!fn)
    throw processingValidation(
      'spatial join',
      `predicate '${String(predicate)}' is unsupported`,
      'predicate',
    );
  return runTwoInputTool(
    input,
    join,
    'spatial_join',
    options,
    (left, right, geometryColumn) => {
      const l = quoteIdentifier(left);
      const r = quoteIdentifier(right);
      const geom = quoteIdentifier(geometryColumn);
      const joinType = options.joinType === 'inner' ? 'INNER JOIN' : 'LEFT JOIN';
      return `SELECT\n  l.*,\n  r.* EXCLUDE (${geom})\nFROM ${l} AS l\n${joinType} ${r} AS r\n  ON ${fn}(l.${geom}, r.${geom})`;
    },
    runtime,
    true,
  );
}
export const spatialJoinTool = defineDuckDbTool({
  id: 'spatialJoin',
  category: 'join',
  title: 'Spatial Join',
  description:
    'Join attributes from matching spatial features, expanding rows for one-to-many matches.',
  inputs: [
    {
      name: 'input',
      description: 'Target features retaining geometry.',
      required: true,
      geometry: ['any'],
    },
    {
      name: 'join',
      description: 'Features supplying joined attributes.',
      required: true,
      geometry: ['any'],
    },
  ],
  parameters: [
    {
      name: 'predicate',
      description: 'Spatial predicate used for matching.',
      type: 'enum',
      default: 'intersects',
      enumValues: Object.keys(FUNCTIONS),
    },
    {
      name: 'joinType',
      description: 'Whether unmatched target features are retained.',
      type: 'enum',
      default: 'left',
      enumValues: ['left', 'inner'],
    },
  ],
  crs: 'known',
  units: 'none',
  output: { geometry: 'preserve', cardinality: 'expand', attributes: 'merge', mutatesInput: false },
  cost: 'high',
  agent: {
    summary: 'Transfer attributes by spatial relationship.',
    whenToUse: ['Associate each target feature with all spatially matching features.'],
    avoidWhen: ['You only need counts or summaries; use spatialSummaryJoin instead.'],
    keywords: ['spatial join', 'join by location', 'intersects join', 'location join'],
  },
  execute: (context) =>
    spatialJoin(
      requireToolInput(context, 'input'),
      requireToolInput(context, 'join'),
      toolParams<SpatialJoinOptions>(context),
      context.runtime,
    ),
});
