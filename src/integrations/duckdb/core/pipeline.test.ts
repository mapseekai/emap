import { describe, expect, it, vi } from 'vitest';
import {
  tableFromArrays,
  vectorFromArray,
  Dictionary,
  DateMillisecond,
  DateDay,
  TimestampMillisecond,
  Int32,
  Float32,
  Float64,
  Bool,
} from 'apache-arrow';
import { fromArrowTable } from '../../arrow/table-to-dataset';
import { runPipeline, arrowResultToDataset, datasetToArrowInput } from './pipeline';
import { datasetFromGeoJSON } from '../../../../test/utils/arrow';
import { toArrowTable } from '../../arrow/dataset-to-table';
import { Table, Schema, RecordBatch } from 'apache-arrow';
import type { DuckDbConnection, DuckDbRuntime } from '../runtime';

function setup() {
  const table = tableFromArrays({ value: [1] });
  const connection = {
    insertArrowTable: vi.fn(async () => {}),
    query: vi.fn(async (_sql: string, _signal?: AbortSignal) => table),
    close: vi.fn(async () => {}),
  } satisfies DuckDbConnection;
  const runtime = {
    ensureSpatial: vi.fn(async () => {}),
    connect: vi.fn(async () => connection),
  } satisfies DuckDbRuntime;
  const controller = new AbortController();
  const convertResult = vi.fn(() => 'converted');
  const operation = {
    label: 'cancel',
    runtime,
    signal: controller.signal,
    inputs: [{ table, prefix: 'cancel_test' }],
    buildSql: () => 'SELECT 1',
    convertResult,
  };
  return { connection, runtime, controller, operation, convertResult, table };
}

describe('pipeline cancellation ownership', () => {
  it('rejects before initialization or input preparation for a pre-aborted signal', async () => {
    const { operation, runtime, controller } = setup();
    controller.abort();
    await expect(runPipeline(operation)).rejects.toBe(controller.signal.reason);
    expect(runtime.ensureSpatial).not.toHaveBeenCalled();
    expect(runtime.connect).not.toHaveBeenCalled();
  });
  it('keeps shared initialization alive but does not connect after abort', async () => {
    const { operation, runtime, controller } = setup();
    let ready!: () => void;
    runtime.ensureSpatial.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          ready = resolve;
        }),
    );
    const work = runPipeline(operation);
    const failed = expect(work).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    ready();
    await failed;
    expect(runtime.connect).not.toHaveBeenCalled();
  });
  it.each([
    'insert',
    'query',
    'convert',
    'cleanup',
  ] as const)('does not return a result cancelled during %s and cleans up without the aborted signal', async (stage) => {
    const { operation, connection, controller, convertResult, table } = setup();
    if (stage === 'insert')
      connection.insertArrowTable.mockImplementation(async () => {
        controller.abort();
      });
    if (stage === 'query' || stage === 'cleanup')
      connection.query.mockImplementation(async (sql) => {
        if ((stage === 'query') === !sql.startsWith('DROP')) controller.abort();
        return table;
      });
    if (stage === 'convert')
      convertResult.mockImplementation(() => {
        controller.abort();
        return 'converted';
      });
    await expect(runPipeline(operation)).rejects.toMatchObject({ name: 'AbortError' });
    expect(connection.query).toHaveBeenLastCalledWith(expect.stringContaining('DROP TABLE'));
    expect(connection.close).toHaveBeenCalledOnce();
    if (stage === 'insert' || stage === 'query') expect(convertResult).not.toHaveBeenCalled();
  });
  it('waits for connection cleanup and reports cleanup failure on cancellation', async () => {
    const { operation, connection, controller, table } = setup();
    let close!: () => void;
    connection.query.mockImplementation(async () => {
      controller.abort();
      return table;
    });
    connection.close.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          close = resolve;
        }),
    );
    let settled = false;
    const work = runPipeline(operation).finally(() => {
      settled = true;
    });
    const failed = expect(work).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(connection.close).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    close();
    await failed;

    const next = setup();
    next.connection.query.mockImplementation(async () => {
      next.controller.abort();
      return next.table;
    });
    next.connection.close.mockRejectedValue(new Error('close failed'));
    await expect(runPipeline(next.operation)).rejects.toMatchObject({ name: 'AggregateError' });
  });
  it('preserves a pending-query cleanup failure instead of reporting a safe abort', async () => {
    const { operation, connection, controller } = setup();
    const cleanupError = new AggregateError([new Error('cancel failed')], 'pending cleanup failed');
    connection.query.mockImplementation(async (sql) => {
      if (!sql.startsWith('DROP')) {
        controller.abort();
        throw cleanupError;
      }
      return tableFromArrays({ value: [1] });
    });
    await expect(runPipeline(operation)).rejects.toBe(cleanupError);
    expect(connection.close).toHaveBeenCalledOnce();
  });
  it.each([
    undefined,
    null,
    false,
    0,
  ])('does not hide a falsy cleanup rejection (%s)', async (reason) => {
    const { operation, connection, controller, table } = setup();
    connection.query.mockImplementation(async () => {
      controller.abort(null);
      return table;
    });
    connection.close.mockRejectedValue(reason);
    await expect(runPipeline(operation)).rejects.toMatchObject({
      name: 'AggregateError',
      errors: [null, reason],
    });
  });
});

describe('Arrow input reuse', () => {
  it('reseeds bare WKB results after inheriting CRS without re-encoding the next input', async () => {
    const primary = await datasetFromGeoJSON({ type: 'Point', coordinates: [3, 4] });
    primary.info = { ...primary.info, crs_string: 'EPSG:3857' };
    const table = toArrowTable(primary, { encoding: 'wkb' });
    const schema = new Schema(
      table.schema.fields.map((field) => field.clone({ metadata: new Map() })),
    );
    const bare = new Table(
      schema,
      table.batches.map((batch) => new RecordBatch(schema, batch.data)),
    );
    const result = arrowResultToDataset(bare, { layerName: 'result' }, primary, 'test');
    const cached = datasetToArrowInput(result, { layer: 'result' }, 'test');
    expect(cached).not.toBe(bare);
    expect(datasetToArrowInput(result, { layer: 'result' }, 'test')).toBe(cached);
    bare.getChild('geometry')!.get(0).fill(0);
    expect(cached.getChild('geometry')!.get(0)[0]).toBe(1);
    const exported = toArrowTable(result, { encoding: 'wkb' });
    expect(JSON.parse(exported.schema.metadata.get('geo')!).columns.geometry.crs.id.code).toBe(
      3857,
    );
    result.attributeVersion = 1;
    expect(datasetToArrowInput(result, {}, 'test')).not.toBe(cached);
  });
});

describe('seed attribute normalization', () => {
  it.each([
    {
      label: 'dictionary dates',
      vector: () =>
        vectorFromArray(
          [new Date('2024-01-02')],
          new Dictionary(new DateMillisecond(), new Int32()),
        ),
      type: 'Float64',
      value: 1704153600000,
    },
    {
      label: 'Int32',
      vector: () => vectorFromArray([50000], new Int32()),
      type: 'Float64',
      value: 50000,
    },
    {
      label: 'Float32',
      vector: () => vectorFromArray([50000], new Float32()),
      type: 'Float64',
      value: 50000,
    },
    {
      label: 'all-null Float64',
      vector: () => vectorFromArray([null], new Float64()),
      type: 'Utf8',
      value: null,
    },
    {
      label: 'all-null Bool',
      vector: () => vectorFromArray([null], new Bool()),
      type: 'Utf8',
      value: null,
    },
    {
      label: 'all-null Date',
      vector: () => vectorFromArray([null], new DateMillisecond()),
      type: 'Utf8',
      value: null,
    },
    {
      label: 'DateDay',
      vector: () => vectorFromArray([new Date('2024-01-02')], new DateDay()),
      type: 'Date64<MILLISECOND>',
      value: 1704153600000,
    },
    {
      label: 'TimestampMillisecond',
      vector: () => vectorFromArray([new Date('2024-01-02')], new TimestampMillisecond()),
      type: 'Date64<MILLISECOND>',
      value: 1704153600000,
    },
  ])('keeps fresh SQL input semantics for $label', ({ vector, type, value }) => {
    const geometry = toArrowTable(
      { layers: [{ geometry_type: 'point', shapes: [[[1, 2]]] }] },
      { encoding: 'wkb' },
    ).getChild('geometry')!;
    const dataset = fromArrowTable(new Table({ geometry, value: vector() }));
    const fresh = toArrowTable(dataset, { encoding: 'wkb' });
    const cached = datasetToArrowInput(dataset, {}, 'review');
    expect(fresh.getChild('value')!.type.toString()).toBe(type);
    expect(fresh.getChild('value')!.get(0)).toBe(value);
    expect(cached.getChild('value')!.type.toString()).toBe(type);
    expect(cached.getChild('value')!.get(0)).toBe(value);
    expect(datasetToArrowInput(dataset, {}, 'review')).toBe(cached);
  });
});
