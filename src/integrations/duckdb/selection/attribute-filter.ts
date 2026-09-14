import type { Table } from 'apache-arrow';
import { getDefaultMapshaperAdapter } from '../../mapshaper/adapter';
import { defineDuckDbTool, requireToolInput, toolParams } from '../core/tool-definition';
import { toArrowTable } from '../../arrow/dataset-to-table';
import { recordsFromArrowTable } from '../../arrow/table-to-dataset';
import type {
  FeatureShape,
  MapshaperDataset,
  MapshaperLayer,
} from '../../../shared/types/mapshaper-types';
import { DuckDbOperationError } from '../errors';
import { type DuckDbRuntime } from '../runtime';
import { validateDuckDbSelectSql } from '../core/query-sql';
import {
  nextTableName,
  quoteIdentifier,
  resolveUniqueColumnName,
  tableFieldNames,
} from '../core/pipeline';

/**
 * @example
 * const options: AttributeFilterOptions = { sql: 'SELECT name FROM input WHERE population > 1000' };
 */
export interface AttributeFilterOptions {
  geometryColumn?: string;
  inputLayer?: string | number;
  outputLayer?: string;
  rowIdColumn?: string;
  sql: string;
}

function resolveInputLayer(dataset: MapshaperDataset, selector?: string | number): MapshaperLayer {
  const layers = dataset.layers ?? [];
  if (layers.length === 0)
    throw new DuckDbOperationError('validation', 'DuckDB query input dataset has no layers');
  if (typeof selector === 'string') {
    const layer = layers.find(
      (candidate) => candidate.name === selector || candidate.id === selector,
    );
    if (!layer)
      throw new DuckDbOperationError(
        'validation',
        `DuckDB query input layer '${selector}' not found`,
        { field: 'inputLayer' },
      );
    return layer;
  }
  const index = selector ?? 0;
  const layer = layers[index];
  if (!layer)
    throw new DuckDbOperationError(
      'validation',
      `DuckDB query input layer index ${index} out of range (${layers.length} layers)`,
      { field: 'inputLayer' },
    );
  return layer;
}

function collectExistingColumnNames(layer: MapshaperLayer, geometryColumn: string): Set<string> {
  const names = new Set<string>([geometryColumn]);
  for (const record of layer.data?.getRecords?.() ?? []) {
    for (const name of Object.keys(record)) names.add(name);
  }
  return names;
}

function createInputDataset(
  dataset: MapshaperDataset,
  layer: MapshaperLayer,
  rowIdColumn: string,
): MapshaperDataset {
  const adapter = getDefaultMapshaperAdapter();
  const shapes = layer.shapes ?? [];
  const sourceRecords = layer.data?.getRecords?.() ?? [];
  const records = shapes.map((_, index) => ({
    ...(sourceRecords[index] ?? {}),
    [rowIdColumn]: index,
  }));
  return { ...dataset, layers: [{ ...layer, data: adapter.createDataTable(records) }] };
}

function resultRowIds(table: Table, rowIdColumn: string, rowCount: number): number[] {
  const vector = table.getChild(rowIdColumn);
  if (!vector) throw new Error(`DuckDB query result is missing row id column ${rowIdColumn}`);
  const rowIds: number[] = new Array(table.numRows);
  for (let row = 0; row < table.numRows; row++) {
    const value = vector.get(row);
    const rowId =
      typeof value === 'bigint'
        ? value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
          ? Number(value)
          : NaN
        : value;
    if (typeof rowId !== 'number' || !Number.isInteger(rowId) || rowId < 0 || rowId >= rowCount) {
      throw new Error(`DuckDB query result has invalid row id at row ${row}`);
    }
    rowIds[row] = rowId;
  }
  return rowIds;
}

type ShapeNode = number | ShapeNode[];
function cloneShapeNode(node: ShapeNode): ShapeNode {
  return Array.isArray(node) ? node.map((child) => cloneShapeNode(child)) : node;
}
function cloneShape(shape: FeatureShape | null): FeatureShape | null {
  return shape === null ? null : (cloneShapeNode(shape as ShapeNode) as FeatureShape);
}
function rebuildShapes(
  layer: MapshaperLayer,
  rowIds: readonly number[],
): (FeatureShape | null)[] | null {
  if (!layer.shapes) return null;
  return rowIds.map((rowId) => cloneShape(layer.shapes![rowId] ?? null));
}

/**
 * @example
 * const result = await attributeFilter(dataset, { sql: 'SELECT name FROM input WHERE population > 1000' });
 */
export async function attributeFilter(
  dataset: MapshaperDataset,
  opts: AttributeFilterOptions,
  runtime: DuckDbRuntime | null = null,
): Promise<MapshaperDataset> {
  if (!runtime)
    throw new DuckDbOperationError('runtime-unavailable', 'DuckDB runtime is not available');
  const geometryColumn = opts.geometryColumn ?? 'geometry';
  const requestedRowIdColumn = opts.rowIdColumn ?? '__emap_rowid';
  const inputLayer = resolveInputLayer(dataset, opts.inputLayer);
  const rowIdColumn = resolveUniqueColumnName(
    requestedRowIdColumn,
    collectExistingColumnNames(inputLayer, geometryColumn),
  );

  let input: Table;
  try {
    input = toArrowTable(createInputDataset(dataset, inputLayer, rowIdColumn), {
      encoding: 'wkb',
      geometryColumn,
      layer: 0,
    });
  } catch (err) {
    throw new DuckDbOperationError(
      'conversion-failed',
      'DuckDB query input could not be converted to Arrow',
      { cause: err },
    );
  }

  const inputTableName = nextTableName('emap_duckdb_query_input');
  const validated = validateDuckDbSelectSql(opts.sql, {
    availableColumns: tableFieldNames(input),
    geometryColumn,
    physicalTableName: inputTableName,
    rowIdColumn,
  });
  let conn: Awaited<ReturnType<DuckDbRuntime['connect']>> | undefined;
  let primaryError: unknown;
  try {
    conn = await runtime.connect();
    await conn.insertArrowTable(input, { name: inputTableName });
    const resultTable = await conn.query(validated.sql);
    try {
      const rowIds = resultRowIds(
        resultTable,
        validated.rowIdColumn,
        inputLayer.shapes?.length ?? 0,
      );
      const records = recordsFromArrowTable(resultTable, { skipColumns: [validated.rowIdColumn] });
      const outputLayer: MapshaperLayer = {
        ...inputLayer,
        name: opts.outputLayer ?? inputLayer.name,
        data: getDefaultMapshaperAdapter().createDataTable(records),
        shapes: rebuildShapes(inputLayer, rowIds),
      };
      return {
        ...dataset,
        layers: [outputLayer],
        info: dataset.info ? { ...dataset.info } : undefined,
      };
    } catch (err) {
      throw new DuckDbOperationError(
        'conversion-failed',
        'DuckDB query result could not be converted to a dataset',
        { cause: err },
      );
    }
  } catch (err) {
    if (err instanceof DuckDbOperationError) {
      primaryError = err;
      throw err;
    }
    const wrapped = new DuckDbOperationError('query-failed', 'DuckDB query failed', { cause: err });
    primaryError = wrapped;
    throw wrapped;
  } finally {
    let cleanupError: unknown;
    if (conn) {
      try {
        await conn.query(`DROP TABLE IF EXISTS ${quoteIdentifier(inputTableName)}`);
      } catch (err) {
        cleanupError = err;
      }
    }
    const closeError = await conn?.close?.().catch((err) => err);
    if ((cleanupError || closeError) && !primaryError) {
      throw new DuckDbOperationError('query-failed', 'DuckDB query cleanup failed', {
        cause: cleanupError ?? closeError,
      });
    }
  }
}

export const attributeFilterTool = defineDuckDbTool({
  id: 'attributeFilter',
  category: 'selection',
  title: 'Attribute Filter',
  description: 'Filter features with the validated restricted DuckDB SELECT syntax.',
  inputs: [{ name: 'input', description: 'Dataset to filter.', required: true, geometry: ['any'] }],
  parameters: [
    {
      name: 'sql',
      description: 'Restricted SELECT statement over logical table input.',
      type: 'string',
      required: true,
    },
  ],
  crs: 'any',
  units: 'none',
  output: {
    geometry: 'preserve',
    cardinality: 'filter',
    attributes: 'replace',
    mutatesInput: false,
  },
  cost: 'low',
  agent: {
    summary: 'Select features by attribute conditions.',
    whenToUse: ['Filter rows using field values, ordering or limits.'],
    avoidWhen: ['The condition depends on spatial relationships; use spatialFilter.'],
    keywords: ['attribute filter', 'where', 'select by attribute', 'query'],
  },
  execute: (context) =>
    attributeFilter(
      requireToolInput(context, 'input'),
      toolParams<AttributeFilterOptions>(context),
      context.runtime,
    ),
});
