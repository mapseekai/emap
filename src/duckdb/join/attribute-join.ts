import type { MapshaperDataset } from '../../types/mapshaper-types';
import { defineDuckDbTool, requireToolInput, toolParams } from '../core/tool-definition';
import { runTwoInputTool } from '../core/runners/processing';
import type { ProcessingOptions } from '../core/types';
import { quoteIdentifier } from '../core/pipeline';
import { getDuckDbRuntime, type DuckDbRuntime } from '../runtime';

/**
 * @example
 * const options: AttributeJoinOptions = { leftKey: 'id', rightKey: 'id', joinType: 'left' };
 */
export interface AttributeJoinOptions extends ProcessingOptions {
  leftKey: string;
  rightKey: string;
  joinType?: 'left' | 'inner';
}
/**
 * @example
 * const result = await attributeJoin(parcels, table, { leftKey: 'id', rightKey: 'id' });
 */
export function attributeJoin(
  input: MapshaperDataset,
  join: MapshaperDataset,
  options: AttributeJoinOptions,
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
) {
  return runTwoInputTool(
    input,
    join,
    'attribute_join',
    options,
    (left, right, geometryColumn) => {
      const l = quoteIdentifier(left);
      const r = quoteIdentifier(right);
      const geom = quoteIdentifier(geometryColumn);
      const joinType = options.joinType === 'inner' ? 'INNER JOIN' : 'LEFT JOIN';
      return `SELECT\n  l.*,\n  r.* EXCLUDE (${quoteIdentifier(options.rightKey)}, ${geom})\nFROM ${l} AS l\n${joinType} ${r} AS r ON l.${quoteIdentifier(options.leftKey)} = r.${quoteIdentifier(options.rightKey)}`;
    },
    runtime,
  );
}
export const attributeJoinTool = defineDuckDbTool({
  id: 'attributeJoin',
  category: 'join',
  title: 'Attribute Join',
  description: 'Join attributes from a second dataset using matching key fields.',
  inputs: [
    {
      name: 'input',
      description: 'Target features that keep their geometry.',
      required: true,
      geometry: ['any'],
    },
    {
      name: 'join',
      description: 'Dataset providing additional attributes.',
      required: true,
      geometry: ['any'],
    },
  ],
  parameters: [
    {
      name: 'leftKey',
      description: 'Key field in the input dataset.',
      type: 'string',
      required: true,
    },
    {
      name: 'rightKey',
      description: 'Key field in the join dataset.',
      type: 'string',
      required: true,
    },
    {
      name: 'joinType',
      description: 'Whether unmatched input rows are retained.',
      type: 'enum',
      default: 'left',
      enumValues: ['left', 'inner'],
    },
  ],
  crs: 'any',
  units: 'none',
  output: {
    geometry: 'preserve',
    cardinality: 'variable',
    attributes: 'merge',
    mutatesInput: false,
  },
  cost: 'medium',
  agent: {
    summary: 'Join two layers by matching attribute keys.',
    whenToUse: ['Transfer fields between tables or layers that share IDs or codes.'],
    keywords: ['attribute join', 'table join', 'key join', 'lookup'],
  },
  execute: (context) =>
    attributeJoin(
      requireToolInput(context, 'input'),
      requireToolInput(context, 'join'),
      toolParams<AttributeJoinOptions>(context),
      context.runtime,
    ),
});
