import type { MapshaperDataset } from '../../types/mapshaper-types';
import type { DuckDbRuntime } from '../runtime';

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

export interface DuckDbToolObjectPropertySpec {
  name: string;
  description: string;
  type: Exclude<DuckDbParameterType, 'string[]' | 'object[]'>;
  required?: boolean;
  enumValues?: readonly string[];
}

export interface DuckDbToolInputSpec {
  name: string;
  description: string;
  required: boolean;
  geometry: readonly DuckDbGeometryKind[];
  minCount?: number;
  maxCount?: number;
}

export interface DuckDbToolParameterSpec {
  name: string;
  description: string;
  type: DuckDbParameterType;
  required?: boolean;
  default?: unknown;
  enumValues?: readonly string[];
  minimum?: number;
  exclusiveMinimum?: number;
  minItems?: number;
  itemProperties?: readonly DuckDbToolObjectPropertySpec[];
}

export interface DuckDbToolOutputSpec {
  geometry: 'preserve' | 'derived' | 'none';
  cardinality: 'preserve' | 'filter' | 'expand' | 'aggregate' | 'variable';
  attributes: 'preserve' | 'append' | 'replace' | 'merge';
  mutatesInput: false;
}

export interface DuckDbAgentMetadata {
  summary: string;
  whenToUse: readonly string[];
  avoidWhen?: readonly string[];
  keywords: readonly string[];
  examples?: readonly string[];
}

export interface DuckDbToolExecutionContext {
  inputs: Readonly<Record<string, MapshaperDataset>>;
  params?: Readonly<Record<string, unknown>>;
  runtime?: DuckDbRuntime | null;
}

export interface DuckDbToolDefinition<TResult = MapshaperDataset> {
  id: string;
  category: DuckDbToolCategory;
  title: string;
  description: string;
  aliases?: readonly string[];
  inputs: readonly DuckDbToolInputSpec[];
  parameters: readonly DuckDbToolParameterSpec[];
  crs: DuckDbCrsRequirement;
  units?: 'dataset' | 'meters-or-dataset' | 'none';
  output: DuckDbToolOutputSpec;
  cost: DuckDbToolCost;
  agent: DuckDbAgentMetadata;
  execute(context: DuckDbToolExecutionContext): Promise<TResult>;
}

export function defineDuckDbTool<T extends DuckDbToolDefinition>(tool: T): T {
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
