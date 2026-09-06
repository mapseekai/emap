import type {
  DuckDbToolCategory,
  DuckDbToolDefinition,
  DuckDbToolExecutionContext,
} from './core/tool-definition';
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

export function executeDuckDbTool(idOrAlias: string, context: DuckDbToolExecutionContext) {
  return requireDuckDbTool(idOrAlias).execute(context);
}

export const duckDbToolbox = {
  tools: DUCKDB_TOOLBOX,
  list: listDuckDbTools,
  get: getDuckDbTool,
  require: requireDuckDbTool,
  search: searchDuckDbTools,
  execute: executeDuckDbTool,
} as const;
