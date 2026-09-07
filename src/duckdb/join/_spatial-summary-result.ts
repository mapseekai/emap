import type { Table } from 'apache-arrow';
import { getDefaultMapshaperAdapter } from '../../adapter/mapshaper-adapter';
import { recordsFromArrowTable } from '../../arrow/table-to-dataset';
import type { FeatureShape, MapshaperDataset, MapshaperLayer } from '../../types/mapshaper-types';
import type { NormalizedAggregation } from './_spatial-summary-types';

export function createTargetInputDataset(
  dataset: MapshaperDataset,
  layer: MapshaperLayer,
  rowIdColumn: string,
): MapshaperDataset {
  const sourceRecords = layer.data?.getRecords?.() ?? [];
  const rowCount = layer.shapes?.length ?? sourceRecords.length;
  const records = Array.from({ length: rowCount }, (_, index) => ({
    ...(sourceRecords[index] ?? {}),
    [rowIdColumn]: index,
  }));
  return {
    ...dataset,
    layers: [{ ...layer, data: getDefaultMapshaperAdapter().createDataTable(records) }],
  };
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
  return layer.shapes ? rowIds.map((rowId) => cloneShape(layer.shapes![rowId] ?? null)) : null;
}

export function aggregateRowsByTargetId(
  resultTable: Table,
  rowIdColumn: string,
  aggregations: readonly NormalizedAggregation[],
  targetRowCount: number,
): Map<number, Record<string, unknown>> {
  const expectedColumns = [
    rowIdColumn,
    ...aggregations.map((aggregation) => aggregation.outputColumn),
  ];
  for (const name of expectedColumns) {
    if (!resultTable.schema.fields.some((field) => field.name === name)) {
      throw new Error(`DuckDB spatial summary join result is missing column ${name}`);
    }
  }

  const records = recordsFromArrowTable(resultTable);
  const rows = new Map<number, Record<string, unknown>>();
  for (const [index, record] of records.entries()) {
    const rawRowId = record[rowIdColumn];
    const rowId =
      typeof rawRowId === 'bigint' &&
      rawRowId >= BigInt(Number.MIN_SAFE_INTEGER) &&
      rawRowId <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(rawRowId)
        : rawRowId;
    if (
      typeof rowId !== 'number' ||
      !Number.isSafeInteger(rowId) ||
      rowId < 0 ||
      rowId >= targetRowCount
    ) {
      throw new Error(`DuckDB spatial summary join result has invalid row id at row ${index}`);
    }
    if (rows.has(rowId)) {
      throw new Error(`DuckDB spatial summary join result has duplicate row id ${rowId}`);
    }
    const values: Record<string, unknown> = {};
    for (const aggregation of aggregations) {
      Object.defineProperty(values, aggregation.outputColumn, {
        configurable: true,
        enumerable: true,
        value: record[aggregation.outputColumn],
        writable: true,
      });
    }
    rows.set(rowId, values);
  }
  return rows;
}

function emptyAggregateValues(
  aggregations: readonly NormalizedAggregation[],
): Record<string, unknown> {
  return Object.fromEntries(
    aggregations.map((aggregation) => [
      aggregation.outputColumn,
      aggregation.operation === 'count' ? 0 : null,
    ]),
  );
}

export function rebuildSpatialSummaryDataset(
  targetDataset: MapshaperDataset,
  targetLayer: MapshaperLayer,
  rowIds: readonly number[],
  aggregateRows: ReadonlyMap<number, Record<string, unknown>>,
  aggregations: readonly NormalizedAggregation[],
  outputLayerName: unknown,
): MapshaperDataset {
  const sourceRecords = targetLayer.data?.getRecords?.() ?? [];
  const defaults = emptyAggregateValues(aggregations);
  const records = rowIds.map((rowId) => ({
    ...(sourceRecords[rowId] ?? {}),
    ...(aggregateRows.get(rowId) ?? defaults),
  }));
  const outputLayer: MapshaperLayer = {
    ...targetLayer,
    name: typeof outputLayerName === 'string' ? outputLayerName : targetLayer.name,
    data: getDefaultMapshaperAdapter().createDataTable(records),
    shapes: rebuildShapes(targetLayer, rowIds),
  };
  return {
    ...targetDataset,
    layers: [outputLayer],
    info: targetDataset.info ? { ...targetDataset.info } : undefined,
  };
}
