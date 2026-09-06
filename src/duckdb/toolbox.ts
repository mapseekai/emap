import type {
  DuckDbToolCategory,
  DuckDbToolDefinition,
  DuckDbToolExecutionContext,
  DuckDbToolObjectPropertySpec,
  DuckDbToolParameterSpec,
} from './core/tool-definition';
import { DuckDbOperationError } from './errors';
import {
  clipTool,
  intersectTool,
  differenceTool,
  unionTool,
  symmetricDifferenceTool,
} from './overlay';
import { bufferTool, nearTool, nearestTool } from './proximity';
import { dissolveTool, collectTool } from './aggregate';
import { attributeJoinTool, spatialJoinTool, spatialSummaryJoinTool } from './join';
import {
  centroidTool,
  envelopeTool,
  convexHullTool,
  boundaryTool,
  simplifyTool,
  simplifyPreserveTopologyTool,
  densifyTool,
  multipartToSinglepartTool,
  extractVerticesTool,
} from './geometry';
import { pointToLineTool, lineToPolygonTool, polygonToLineTool } from './transform';
import { attributeFilterTool, spatialFilterTool, spatialRelationTool } from './selection';
import { mergeTool, appendTool, reprojectTool, repairGeometryTool } from './data-management';
import {
  areaTool,
  lengthTool,
  perimeterTool,
  geometryTypeTool,
  isValidTool,
  isEmptyTool,
  isSimpleTool,
  xTool,
  yTool,
  centroidXTool,
  centroidYTool,
} from './attributes';

export const DUCKDB_TOOLBOX = [
  clipTool,
  intersectTool,
  differenceTool,
  unionTool,
  symmetricDifferenceTool,
  bufferTool,
  nearTool,
  nearestTool,
  dissolveTool,
  collectTool,
  attributeJoinTool,
  spatialJoinTool,
  spatialSummaryJoinTool,
  centroidTool,
  envelopeTool,
  convexHullTool,
  boundaryTool,
  simplifyTool,
  simplifyPreserveTopologyTool,
  densifyTool,
  multipartToSinglepartTool,
  extractVerticesTool,
  pointToLineTool,
  lineToPolygonTool,
  polygonToLineTool,
  attributeFilterTool,
  spatialFilterTool,
  spatialRelationTool,
  mergeTool,
  appendTool,
  reprojectTool,
  repairGeometryTool,
  areaTool,
  lengthTool,
  perimeterTool,
  geometryTypeTool,
  isValidTool,
  isEmptyTool,
  isSimpleTool,
  xTool,
  yTool,
  centroidXTool,
  centroidYTool,
] as const satisfies readonly DuckDbToolDefinition[];

export type DuckDbToolId = (typeof DUCKDB_TOOLBOX)[number]['id'];

const TOOL_BY_ID = new Map<string, DuckDbToolDefinition>();
for (const tool of DUCKDB_TOOLBOX as readonly DuckDbToolDefinition[]) {
  TOOL_BY_ID.set(tool.id, tool);
  for (const alias of tool.aliases ?? []) TOOL_BY_ID.set(alias, tool);
}

export function listDuckDbTools(category?: DuckDbToolCategory): readonly DuckDbToolDefinition[] {
  return category ? DUCKDB_TOOLBOX.filter((tool) => tool.category === category) : DUCKDB_TOOLBOX;
}

export function getDuckDbTool(idOrAlias: string): DuckDbToolDefinition | undefined {
  return TOOL_BY_ID.get(idOrAlias);
}

export function requireDuckDbTool(idOrAlias: string): DuckDbToolDefinition {
  const tool = getDuckDbTool(idOrAlias);
  if (!tool) throw new Error(`Unknown DuckDB processing tool '${idOrAlias}'`);
  return tool;
}

/** Lightweight semantic discovery for Agent/UI callers. */
export function searchDuckDbTools(
  query: string,
  category?: DuckDbToolCategory,
): readonly DuckDbToolDefinition[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const tools = listDuckDbTools(category);
  if (terms.length === 0) return tools;
  return tools
    .map((tool) => {
      const haystack = [
        tool.id,
        tool.title,
        tool.description,
        ...(tool.aliases ?? []),
        ...tool.agent.keywords,
        ...tool.agent.whenToUse,
        ...(tool.agent.avoidWhen ?? []),
        ...(tool.agent.examples ?? []),
      ]
        .join(' ')
        .toLowerCase();
      const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
      return { tool, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.tool.id.localeCompare(b.tool.id))
    .map((entry) => entry.tool);
}

function validationError(toolId: string, field: string, message: string): DuckDbOperationError {
  return new DuckDbOperationError('validation', `DuckDB tool '${toolId}' ${message}`, { field });
}

function validateObjectProperty(
  toolId: string,
  field: string,
  value: unknown,
  spec: DuckDbToolObjectPropertySpec,
): void {
  if (value === undefined) {
    if (spec.required) throw validationError(toolId, field, `${field} is required`);
    return;
  }
  if (spec.type === 'string' && typeof value !== 'string') {
    throw validationError(toolId, field, `${field} must be a string`);
  }
  if (spec.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
    throw validationError(toolId, field, `${field} must be a finite number`);
  }
  if (spec.type === 'boolean' && typeof value !== 'boolean') {
    throw validationError(toolId, field, `${field} must be a boolean`);
  }
  if (spec.type === 'enum' && (typeof value !== 'string' || !spec.enumValues?.includes(value))) {
    throw validationError(
      toolId,
      field,
      `${field} must be one of ${spec.enumValues?.join(', ') ?? ''}`,
    );
  }
}

function validateParameter(toolId: string, value: unknown, spec: DuckDbToolParameterSpec): void {
  const field = spec.name;
  if (value === undefined) {
    if (spec.required) throw validationError(toolId, field, `${field} is required`);
    return;
  }
  switch (spec.type) {
    case 'string':
      if (typeof value !== 'string')
        throw validationError(toolId, field, `${field} must be a string`);
      break;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw validationError(toolId, field, `${field} must be a finite number`);
      }
      if (spec.minimum !== undefined && value < spec.minimum) {
        throw validationError(toolId, field, `${field} must be >= ${spec.minimum}`);
      }
      if (spec.exclusiveMinimum !== undefined && value <= spec.exclusiveMinimum) {
        throw validationError(toolId, field, `${field} must be > ${spec.exclusiveMinimum}`);
      }
      break;
    case 'boolean':
      if (typeof value !== 'boolean')
        throw validationError(toolId, field, `${field} must be a boolean`);
      break;
    case 'enum':
      if (typeof value !== 'string' || !spec.enumValues?.includes(value)) {
        throw validationError(
          toolId,
          field,
          `${field} must be one of ${spec.enumValues?.join(', ') ?? ''}`,
        );
      }
      break;
    case 'string[]':
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
        throw validationError(toolId, field, `${field} must be an array of strings`);
      }
      if (spec.minItems !== undefined && value.length < spec.minItems) {
        throw validationError(
          toolId,
          field,
          `${field} must contain at least ${spec.minItems} item(s)`,
        );
      }
      break;
    case 'object[]':
      if (!Array.isArray(value)) {
        throw validationError(toolId, field, `${field} must be an array of objects`);
      }
      if (spec.minItems !== undefined && value.length < spec.minItems) {
        throw validationError(
          toolId,
          field,
          `${field} must contain at least ${spec.minItems} item(s)`,
        );
      }
      value.forEach((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          throw validationError(
            toolId,
            `${field}[${index}]`,
            `${field}[${index}] must be an object`,
          );
        }
        const record = entry as Record<string, unknown>;
        const properties = spec.itemProperties ?? [];
        const knownProperties = new Set(properties.map((property) => property.name));
        for (const name of Object.keys(record)) {
          if (!knownProperties.has(name)) {
            throw validationError(
              toolId,
              `${field}[${index}].${name}`,
              `${field}[${index}].${name} is not supported`,
            );
          }
        }
        for (const property of properties) {
          validateObjectProperty(
            toolId,
            `${field}[${index}].${property.name}`,
            record[property.name],
            property,
          );
        }
      });
      break;
  }
}

function normalizeToolContext(
  tool: DuckDbToolDefinition,
  context: DuckDbToolExecutionContext,
): DuckDbToolExecutionContext {
  for (const input of tool.inputs) {
    if (input.required && !context.inputs[input.name]) {
      throw validationError(tool.id, input.name, `input '${input.name}' is required`);
    }
  }
  const params: Record<string, unknown> = { ...(context.params ?? {}) };
  const known = new Set(tool.parameters.map((parameter) => parameter.name));
  for (const name of Object.keys(params)) {
    if (!known.has(name))
      throw validationError(tool.id, name, `parameter '${name}' is not supported`);
  }
  for (const parameter of tool.parameters) {
    if (params[parameter.name] === undefined && parameter.default !== undefined) {
      params[parameter.name] = parameter.default;
    }
    validateParameter(tool.id, params[parameter.name], parameter);
  }
  return { ...context, params };
}

export async function executeDuckDbTool(idOrAlias: string, context: DuckDbToolExecutionContext) {
  const tool = requireDuckDbTool(idOrAlias);
  return tool.execute(normalizeToolContext(tool, context));
}

export const duckDbToolbox = {
  tools: DUCKDB_TOOLBOX,
  list: listDuckDbTools,
  get: getDuckDbTool,
  require: requireDuckDbTool,
  search: searchDuckDbTools,
  execute: executeDuckDbTool,
} as const;
