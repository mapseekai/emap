import type { MapshaperDataset } from '../../../shared/types/mapshaper-types';
import { isGeographicCrs } from '../../../domain/geo/crs-resolver';
import { DuckDbOperationError } from '../errors';
import { runAttributeTool, type AttributeOperation } from '../core/runners/attribute';
import { type DuckDbRuntime } from '../runtime';
import type { AttributeOperationId, AttributeOptions } from './types';

export interface AttributeOperationDefinition extends AttributeOperation {
  defaultOutputColumn: string;
  rejectGeographicCrs: boolean;
}

export const ATTRIBUTE_OPERATIONS: Record<AttributeOperationId, AttributeOperationDefinition> = {
  area: {
    id: 'area',
    duckDbFunction: 'ST_Area',
    defaultOutputColumn: 'duckdb_area',
    rejectGeographicCrs: true,
  },
  length: {
    id: 'length',
    duckDbFunction: 'ST_Length',
    defaultOutputColumn: 'duckdb_length',
    rejectGeographicCrs: true,
  },
  perimeter: {
    id: 'perimeter',
    duckDbFunction: 'ST_Perimeter',
    defaultOutputColumn: 'duckdb_perimeter',
    rejectGeographicCrs: true,
  },
  geometryType: {
    id: 'geometryType',
    duckDbFunction: 'ST_GeometryType',
    defaultOutputColumn: 'duckdb_geometry_type',
    rejectGeographicCrs: false,
  },
  isValid: {
    id: 'isValid',
    duckDbFunction: 'ST_IsValid',
    defaultOutputColumn: 'duckdb_is_valid',
    rejectGeographicCrs: false,
  },
  isEmpty: {
    id: 'isEmpty',
    duckDbFunction: 'ST_IsEmpty',
    defaultOutputColumn: 'duckdb_is_empty',
    rejectGeographicCrs: false,
  },
  isSimple: {
    id: 'isSimple',
    duckDbFunction: 'ST_IsSimple',
    defaultOutputColumn: 'duckdb_is_simple',
    rejectGeographicCrs: false,
  },
  x: {
    id: 'x',
    duckDbFunction: 'ST_X',
    defaultOutputColumn: 'duckdb_x',
    rejectGeographicCrs: false,
  },
  y: {
    id: 'y',
    duckDbFunction: 'ST_Y',
    defaultOutputColumn: 'duckdb_y',
    rejectGeographicCrs: false,
  },
  centroidX: {
    id: 'centroidX',
    duckDbFunction: 'ST_X',
    buildExpression: (geometryColumn) => `ST_X(ST_Centroid(${geometryColumn}))`,
    defaultOutputColumn: 'duckdb_centroid_x',
    rejectGeographicCrs: false,
  },
  centroidY: {
    id: 'centroidY',
    duckDbFunction: 'ST_Y',
    buildExpression: (geometryColumn) => `ST_Y(ST_Centroid(${geometryColumn}))`,
    defaultOutputColumn: 'duckdb_centroid_y',
    rejectGeographicCrs: false,
  },
};

export async function runAttribute(
  operationId: AttributeOperationId,
  input: MapshaperDataset,
  options: AttributeOptions = {},
  runtime: DuckDbRuntime | null = null,
) {
  const operation = ATTRIBUTE_OPERATIONS[operationId];
  const failOnGeographicCrs = options.failOnGeographicCrs ?? true;

  if (operation.rejectGeographicCrs && failOnGeographicCrs && isGeographicCrs(input)) {
    throw new DuckDbOperationError(
      'validation',
      `DuckDB ${operation.id} uses coordinate units; reproject to a projected CRS before measuring.`,
      { field: 'crs' },
    );
  }

  return runAttributeTool(
    input,
    {
      signal: options.signal,
      layer: options.layer,
      outputLayer: options.outputLayer,
      geometryColumn: options.geometryColumn,
      outputColumn: options.outputColumn ?? operation.defaultOutputColumn,
    },
    operation,
    runtime,
  );
}
