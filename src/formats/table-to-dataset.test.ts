import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  Binary,
  Bool,
  Field,
  FixedSizeList,
  Float64,
  Int32,
  Int64,
  RecordBatch,
  Schema,
  Struct,
  Table,
  TimestampMillisecond,
  Utf8,
  makeData,
  vectorFromArray,
  type Data,
} from 'apache-arrow';
import {
  fromArrowTable,
  recordsFromArrowTable,
  resetTableImportWarnings,
} from './table-to-dataset';
import { WkbWriter } from './wkb';

function tableFromColumns(
  cols: Array<{ field: Field; data: Data }>,
  metadata?: Map<string, string>,
): Table {
  const fields = cols.map((c) => c.field);
  const length = cols[0].data.length;
  const schema = new Schema(fields, metadata);
  const structData = makeData({
    type: new Struct(fields),
    children: cols.map((c) => c.data),
    length,
    nullCount: 0,
  });
  return new Table(schema, [new RecordBatch(schema, structData)]);
}

function wkbColumn(name: string, write: (w: WkbWriter) => void): { field: Field; data: Data } {
  const w = new WkbWriter();
  write(w);
  const { bytes, valueOffsets } = w.finish();
  const data = makeData({
    type: new Binary(),
    length: valueOffsets.length - 1,
    data: bytes,
    valueOffsets,
    nullCount: 0,
  });
  return { field: new Field(name, new Binary(), true), data };
}

describe('recordsFromArrowTable', () => {
  beforeEach(() => resetTableImportWarnings());
  afterEach(() => vi.restoreAllMocks());

  it('converts scalar Arrow columns to records without geometry metadata', () => {
    const nameVec = vectorFromArray(['alpha', 'beta'], new Utf8());
    const countVec = vectorFromArray([1, 2], new Int32());
    const activeVec = vectorFromArray([true, false], new Bool());
    const idVec = vectorFromArray([10n, null], new Int64());
    const tsVec = vectorFromArray(
      [new Date('2024-01-02T00:00:00Z'), null],
      new TimestampMillisecond(),
    );

    const records = recordsFromArrowTable(
      tableFromColumns([
        { field: new Field('name', new Utf8(), true), data: nameVec.data[0] },
        { field: new Field('count', new Int32(), true), data: countVec.data[0] },
        { field: new Field('active', new Bool(), true), data: activeVec.data[0] },
        { field: new Field('id', new Int64(), true), data: idVec.data[0] },
        { field: new Field('ts', new TimestampMillisecond(), true), data: tsVec.data[0] },
      ]),
    );

    expect(records[0]).toEqual({
      name: 'alpha',
      count: 1,
      active: true,
      id: 10,
      ts: new Date('2024-01-02T00:00:00.000Z'),
    });
    expect(records[1]).toEqual({
      name: 'beta',
      count: 2,
      active: false,
      id: null,
      ts: null,
    });
  });

  it('skips requested columns such as __emap_rowid', () => {
    const rowidVec = vectorFromArray([0, 1], new Int32());
    const nameVec = vectorFromArray(['alpha', 'beta'], new Utf8());

    const records = recordsFromArrowTable(
      tableFromColumns([
        { field: new Field('__emap_rowid', new Int32(), true), data: rowidVec.data[0] },
        { field: new Field('name', new Utf8(), true), data: nameVec.data[0] },
      ]),
      { skipColumns: ['__emap_rowid'] },
    );

    expect(records).toEqual([{ name: 'alpha' }, { name: 'beta' }]);
  });

  it('returns empty records for empty scalar results', () => {
    const idVec = vectorFromArray([], new Int32());

    expect(
      recordsFromArrowTable(
        tableFromColumns([{ field: new Field('id', new Int32(), true), data: idVec.data[0] }]),
      ),
    ).toEqual([]);
  });
});

describe('fromArrowTable', () => {
  beforeEach(() => resetTableImportWarnings());
  afterEach(() => vi.restoreAllMocks());

  it('uses geo metadata primary_column over name heuristics', () => {
    const decoy = wkbColumn('geometry', (w) => {
      w.writePoint(0, 0);
      w.endRow();
    });
    const real = wkbColumn('the_geom', (w) => {
      w.writePoint(5, 6);
      w.endRow();
    });
    const meta = new Map([
      [
        'geo',
        JSON.stringify({
          version: '1.1.0',
          primary_column: 'the_geom',
          columns: { the_geom: { encoding: 'WKB' } },
        }),
      ],
    ]);
    const dataset = fromArrowTable(tableFromColumns([decoy, real], meta));
    expect(dataset.layers[0].shapes![0]).toEqual([[5, 6]]);
  });

  it('detects geoarrow extension types without geo metadata', () => {
    const xs = Float64Array.from([1, 2]);
    const ys = Float64Array.from([3, 4]);
    const coordType = new Struct([
      new Field('x', new Float64(), false),
      new Field('y', new Float64(), false),
    ]);
    const coordData = makeData({
      type: coordType,
      length: 2,
      nullCount: 0,
      children: [
        makeData({ type: new Float64(), length: 2, data: xs, nullCount: 0 }),
        makeData({ type: new Float64(), length: 2, data: ys, nullCount: 0 }),
      ],
    });
    const field = new Field(
      'geom',
      coordType,
      true,
      new Map([['ARROW:extension:name', 'geoarrow.point']]),
    );
    const dataset = fromArrowTable(tableFromColumns([{ field, data: coordData }]));
    expect(dataset.layers[0].geometry_type).toBe('point');
    expect(dataset.layers[0].shapes).toEqual([[[1, 3]], [[2, 4]]]);
  });

  it('reads interleaved FixedSizeList coordinates', () => {
    const flat = Float64Array.from([1, 10, 2, 20, 3, 30]);
    const coordType = new FixedSizeList(2, new Field('xy', new Float64(), false));
    const coordData = makeData({
      type: coordType,
      length: 3,
      nullCount: 0,
      child: makeData({ type: new Float64(), length: 6, data: flat, nullCount: 0 }),
    });
    const field = new Field(
      'geom',
      coordType,
      true,
      new Map([['ARROW:extension:name', 'geoarrow.point']]),
    );
    const dataset = fromArrowTable(tableFromColumns([{ field, data: coordData }]));
    expect(dataset.layers[0].shapes).toEqual([[[1, 10]], [[2, 20]], [[3, 30]]]);
  });

  it('converts BigInt and Timestamp attributes, preserving nulls', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const geom = wkbColumn('geometry', (w) => {
      w.writePoint(0, 0);
      w.endRow();
      w.writePoint(1, 1);
      w.endRow();
    });
    const idVec = vectorFromArray([10n, null], new Int64());
    const tsVec = vectorFromArray(
      [new Date('2024-01-02T00:00:00Z'), null],
      new TimestampMillisecond(),
    );
    const dataset = fromArrowTable(
      tableFromColumns([
        geom,
        { field: new Field('id', new Int64(), true), data: idVec.data[0] },
        { field: new Field('ts', new TimestampMillisecond(), true), data: tsVec.data[0] },
      ]),
    );
    const recs = dataset.layers[0].data!.getRecords!() as Array<Record<string, unknown>>;
    expect(recs[0].id).toBe(10);
    expect(typeof recs[0].id).toBe('number');
    expect(recs[0].ts).toBeInstanceOf(Date);
    expect((recs[0].ts as Date).toISOString()).toBe('2024-01-02T00:00:00.000Z');
    expect(recs[1].id).toBeNull();
    expect(recs[1].ts).toBeNull();
  });

  it('handles chunked tables (multiple record batches)', () => {
    const a = wkbColumn('geometry', (w) => {
      w.writePoint(1, 1);
      w.endRow();
    });
    const b = wkbColumn('geometry', (w) => {
      w.writePoint(2, 2);
      w.endRow();
    });
    const schema = new Schema([a.field]);
    const mk = (col: { field: Field; data: Data }) =>
      new RecordBatch(
        schema,
        makeData({ type: new Struct([col.field]), children: [col.data], length: 1, nullCount: 0 }),
      );
    const table = new Table(schema, [mk(a), mk(b)]);
    expect(table.batches).toHaveLength(2);
    const dataset = fromArrowTable(table);
    expect(dataset.layers[0].shapes).toEqual([[[1, 1]], [[2, 2]]]);
  });

  it('splits mixed-geometry WKB tables into one layer per type', () => {
    const geom = wkbColumn('geometry', (w) => {
      w.writePoint(1, 1);
      w.endRow();
      w.writeLineString(Float64Array.from([0, 1]), Float64Array.from([0, 1]), 0, 2);
      w.endRow();
    });
    const dataset = fromArrowTable(tableFromColumns([geom]));
    const types = dataset.layers.map((l) => l.geometry_type).sort();
    expect(types).toEqual(['point', 'polyline']);
  });

  it('throws a clear error when no geometry column exists', () => {
    const idVec = vectorFromArray([1, 2], new Float64());
    expect(() =>
      fromArrowTable(
        tableFromColumns([{ field: new Field('id', new Float64(), true), data: idVec.data[0] }]),
      ),
    ).toThrow(/No geometry column/);
  });
});
