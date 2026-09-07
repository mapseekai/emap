import type { MapshaperDataset } from '../../types/mapshaper-types';
import type { DuckDbRuntime } from '../runtime';

/**
 * @example
 * const category: DuckDbToolCategory = 'overlay';
 */
export type DuckDbToolCategory =
  | 'overlay'
  | 'proximity'
  | 'aggregate'
  | 'join'
  | 'geometry'
  | 'transform'
  | 'selection'
  | 'dataManagement'
  | 'attributes';

export type DuckDbGeometryKind = 'point' | 'polyline' | 'polygon' | 'any';
export type DuckDbCrsRequirement = 'any' | 'known' | 'projected';
export type DuckDbToolCost = 'low' | 'medium' | 'high';
export type DuckDbParameterType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'string[]'
  | 'object[]';

/**
 * @example
 * const property: DuckDbToolObjectProperty = { name: 'field', description: 'Field name', type: 'string' };
 */
export interface DuckDbToolObjectProperty {
  name: string;
  description: string;
  type: Exclude<DuckDbParameterType, 'string[]' | 'object[]'>;
  required?: boolean;
  enumValues?: readonly string[];
}

/**
 * @example
 * const input: DuckDbToolInput = { name: 'input', description: 'Input dataset', required: true, geometry: ['any'] };
 */
export interface DuckDbToolInput {
  name: string;
  description: string;
  required: boolean;
  geometry: readonly DuckDbGeometryKind[];
  minCount?: number;
  maxCount?: number;
}

/**
 * @example
 * const parameter: DuckDbToolParameter = { name: 'distance', description: 'Distance', type: 'number', required: true };
 */
export interface DuckDbToolParameter {
  name: string;
  description: string;
  type: DuckDbParameterType;
  required?: boolean;
  default?: unknown;
  enumValues?: readonly string[];
  minimum?: number;
  exclusiveMinimum?: number;
  minItems?: number;
  itemProperties?: readonly DuckDbToolObjectProperty[];
}

/**
 * @example
 * const output: DuckDbToolOutput = { geometry: 'derived', cardinality: 'preserve', attributes: 'preserve', mutatesInput: false };
 */
export interface DuckDbToolOutput {
  geometry: 'preserve' | 'derived' | 'none';
  cardinality: 'preserve' | 'filter' | 'expand' | 'aggregate' | 'variable';
  attributes: 'preserve' | 'append' | 'replace' | 'merge';
  mutatesInput: false;
}

/**
 * @example
 * const agent: DuckDbAgentMetadata = { summary: 'Create buffers', whenToUse: ['Distance analysis'], keywords: ['buffer'] };
 */
export interface DuckDbAgentMetadata {
  summary: string;
  whenToUse: readonly string[];
  avoidWhen?: readonly string[];
  keywords: readonly string[];
  examples?: readonly string[];
}

/**
 * @example
 * const context: DuckDbToolExecutionContext = { inputs: { input: dataset }, params: { distance: 10 } };
 */
export interface DuckDbToolExecutionContext {
  inputs: Readonly<Record<string, MapshaperDataset>>;
  params?: Readonly<Record<string, unknown>>;
  runtime?: DuckDbRuntime | null;
}

/**
 * @example
 * const tool: DuckDbToolDefinition = duckDbToolbox.require('buffer');
 */
export interface DuckDbToolDefinition<TResult = MapshaperDataset> {
  id: string;
  category: DuckDbToolCategory;
  title: string;
  description: string;
  aliases?: readonly string[];
  inputs: readonly DuckDbToolInput[];
  parameters: readonly DuckDbToolParameter[];
  crs: DuckDbCrsRequirement;
  units?: 'dataset' | 'meters-or-dataset' | 'none';
  output: DuckDbToolOutput;
  cost: DuckDbToolCost;
  agent: DuckDbAgentMetadata;
  execute(context: DuckDbToolExecutionContext): Promise<TResult>;
}

export function defineDuckDbTool<const T extends DuckDbToolDefinition>(tool: T): T {
  return tool;
}

export function requireToolInput(
  context: DuckDbToolExecutionContext,
  name: string,
): MapshaperDataset {
  const dataset = context.inputs[name];
  if (!dataset) throw new Error(`DuckDB tool input '${name}' is required`);
  return dataset;
}

export function toolParams<T extends object>(context: DuckDbToolExecutionContext): T {
  return (context.params ?? {}) as T;
}
