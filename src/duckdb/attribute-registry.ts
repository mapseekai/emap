import type { MapshaperDataset } from '../types/mapshaper-types';
import { isGeographicCrs } from '../geo/crs-resolver';
import { DuckDbOperationError } from './errors';
import {
  processAttributeWithDuckDb,
  type DuckDbAttributeOperationSpec,
  type DuckDbAttributeOptions,
} from './attribute-executor';
import { getDuckDbRuntime, type DuckDbRuntime } from './runtime';

export type DuckDbAttributeOperationId =
  | 'area'
  | 'length'
  | 'perimeter'
  | 'geometryType'
  | 'isValid'
  | 'isEmpty'
  | 'isSimple'
  | 'x'
  | 'y'
  | 'centroidX'
  | 'centroidY';

export interface DuckDbAttributeOperationOptions extends DuckDbAttributeOptions {
  failOnGeographicCrs?: boolean;
}

interface DuckDbNamedAttributeOperationSpec extends DuckDbAttributeOperationSpec {
  defaultOutputColumn: string;
  rejectGeographicCrs: boolean;
}

export const DUCKDB_ATTRIBUTE_OPERATION_SPECS: Record<
  DuckDbAttributeOperationId,
  DuckDbNamedAttributeOperationSpec
> = {
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

async function processNamedAttributeOperation(
  dataset: MapshaperDataset,
  opts: DuckDbAttributeOperationOptions,
  spec: DuckDbNamedAttributeOperationSpec,
  runtime: DuckDbRuntime | null,
): Promise<MapshaperDataset> {
  const failOnGeographicCrs = opts.failOnGeographicCrs ?? true;
  if (spec.rejectGeographicCrs && failOnGeographicCrs && isGeographicCrs(dataset)) {
    throw new DuckDbOperationError(
      'validation',
      `DuckDB ${spec.id} uses coordinate units; reproject to a projected CRS before measuring.`,
      { field: 'crs' },
    );
  }

  return processAttributeWithDuckDb(
    dataset,
    {
      layer: opts.layer,
      outputLayer: opts.outputLayer,
      geometryColumn: opts.geometryColumn,
      outputColumn: opts.outputColumn ?? spec.defaultOutputColumn,
    },
    spec,
    runtime,
  );
}

export function getDuckDbAttributeOperationSpec(
  operation: DuckDbAttributeOperationId,
): DuckDbNamedAttributeOperationSpec {
  return DUCKDB_ATTRIBUTE_OPERATION_SPECS[operation];
}

export function areaDatasetWithDuckDb(
  dataset: MapshaperDataset,
  opts: DuckDbAttributeOperationOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return processNamedAttributeOperation(
    dataset,
    opts,
    DUCKDB_ATTRIBUTE_OPERATION_SPECS.area,
    runtime,
  );
}

export function lengthDatasetWithDuckDb(
  dataset: MapshaperDataset,
  opts: DuckDbAttributeOperationOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return processNamedAttributeOperation(
    dataset,
    opts,
    DUCKDB_ATTRIBUTE_OPERATION_SPECS.length,
    runtime,
  );
}

export function perimeterDatasetWithDuckDb(
  dataset: MapshaperDataset,
  opts: DuckDbAttributeOperationOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return processNamedAttributeOperation(
    dataset,
    opts,
    DUCKDB_ATTRIBUTE_OPERATION_SPECS.perimeter,
    runtime,
  );
}

export function geometryTypeDatasetWithDuckDb(
  dataset: MapshaperDataset,
  opts: DuckDbAttributeOperationOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return processNamedAttributeOperation(
    dataset,
    opts,
    DUCKDB_ATTRIBUTE_OPERATION_SPECS.geometryType,
    runtime,
  );
}

export function isValidDatasetWithDuckDb(
  dataset: MapshaperDataset,
  opts: DuckDbAttributeOperationOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return processNamedAttributeOperation(
    dataset,
    opts,
    DUCKDB_ATTRIBUTE_OPERATION_SPECS.isValid,
    runtime,
  );
}

export function isEmptyDatasetWithDuckDb(
  dataset: MapshaperDataset,
  opts: DuckDbAttributeOperationOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return processNamedAttributeOperation(
    dataset,
    opts,
    DUCKDB_ATTRIBUTE_OPERATION_SPECS.isEmpty,
    runtime,
  );
}

export function isSimpleDatasetWithDuckDb(
  dataset: MapshaperDataset,
  opts: DuckDbAttributeOperationOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return processNamedAttributeOperation(
    dataset,
    opts,
    DUCKDB_ATTRIBUTE_OPERATION_SPECS.isSimple,
    runtime,
  );
}

export function xDatasetWithDuckDb(
  dataset: MapshaperDataset,
  opts: DuckDbAttributeOperationOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return processNamedAttributeOperation(dataset, opts, DUCKDB_ATTRIBUTE_OPERATION_SPECS.x, runtime);
}

export function yDatasetWithDuckDb(
  dataset: MapshaperDataset,
  opts: DuckDbAttributeOperationOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return processNamedAttributeOperation(dataset, opts, DUCKDB_ATTRIBUTE_OPERATION_SPECS.y, runtime);
}

export function centroidXDatasetWithDuckDb(
  dataset: MapshaperDataset,
  opts: DuckDbAttributeOperationOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return processNamedAttributeOperation(
    dataset,
    opts,
    DUCKDB_ATTRIBUTE_OPERATION_SPECS.centroidX,
    runtime,
  );
}

export function centroidYDatasetWithDuckDb(
  dataset: MapshaperDataset,
  opts: DuckDbAttributeOperationOptions = {},
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  return processNamedAttributeOperation(
    dataset,
    opts,
    DUCKDB_ATTRIBUTE_OPERATION_SPECS.centroidY,
    runtime,
  );
}
