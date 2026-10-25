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
import { getSeededArrowTable } from './table-cache';
import { toArrowTable, toCachedArrowTable } from './dataset-to-table';

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

  it('preserves an enumerable own __proto__ column without mutating the record prototype', () => {
    const protoVec = vectorFromArray([7], new Int32());

    const [record] = recordsFromArrowTable(
      tableFromColumns([
        { field: new Field('__proto__', new Int32(), true), data: protoVec.data[0] },
      ]),
    );

    expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
    expect(Object.hasOwn(record, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(record, '__proto__')).toMatchObject({
      enumerable: true,
      writable: true,
      configurable: true,
      value: 7,
    });
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

  it.each(['id', '__proto__'])('does not seed duplicate attribute names: %s', (name) => {
    const geometry = wkbColumn('geometry', (writer) => {
      writer.writePoint(1, 2);
      writer.endRow();
    });
    const parsed = fromArrowTable(
      tableFromColumns([
        geometry,
        {
          field: new Field(name, new Float64(), true),
          data: vectorFromArray([1], new Float64()).data[0],
        },
        {
          field: new Field(name, new Float64(), true),
          data: vectorFromArray([2], new Float64()).data[0],
        },
      ]),
    );
    expect(parsed.layers[0].data!.getRecords!()[0][name]).toBe(2);
    expect(
      getSeededArrowTable(parsed, parsed.layers[0], { encoding: 'wkb' }, undefined, 'input'),
    ).toBeUndefined();
  });

  it('does not seed WKB paths changed by import cleanup or lossy Int64 attributes', () => {
    const geometry = wkbColumn('geometry', (writer) => {
      writer.writeLineString(
        Float64Array.from([0, 1, 1, 2]),
        Float64Array.from([0, 1, 1, 0]),
        0,
        4,
      );
      writer.endRow();
    });
    const raw = tableFromColumns([geometry]);
    const parsed = fromArrowTable(raw);
    expect(
      getSeededArrowTable(parsed, parsed.layers[0], { encoding: 'wkb' }, undefined, 'input'),
    ).toBeUndefined();
    const points = wkbColumn('geometry', (writer) => {
      writer.writePoint(1, 2);
      writer.endRow();
    });
    const ids = vectorFromArray([9007199254740993n], new Int64());
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const lossy = fromArrowTable(
      tableFromColumns([points, { field: new Field('id', new Int64(), true), data: ids.data[0] }]),
    );
    expect(
      getSeededArrowTable(lossy, lossy.layers[0], { encoding: 'wkb' }, undefined, 'input'),
    ).toBeUndefined();
  });

  it('does not seed WKB Z coordinates that import drops', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bytes = new Uint8Array(29);
    const view = new DataView(bytes.buffer);
    view.setUint8(0, 1);
    view.setUint32(1, 1001, true);
    view.setFloat64(5, 1, true);
    view.setFloat64(13, 2, true);
    view.setFloat64(21, 3, true);
    const data = makeData({
      type: new Binary(),
      length: 1,
      data: bytes,
      valueOffsets: Int32Array.from([0, 29]),
      nullCount: 0,
    });
    const parsed = fromArrowTable(
      tableFromColumns([{ field: new Field('geometry', new Binary(), true), data }]),
    );
    expect(parsed.layers[0].shapes).toEqual([[[1, 2]]]);
    expect(
      getSeededArrowTable(parsed, parsed.layers[0], { encoding: 'wkb' }, undefined, 'input'),
    ).toBeUndefined();
  });

  it.each([false, true])('does not restore discarded EWKB SRID (nested: %s)', (nested) => {
    const base = toArrowTable(
      {
        layers: [{ geometry_type: 'point', shapes: [[[1, 2]]] }],
        info: { crs_string: 'EPSG:4326' },
      },
      { encoding: 'wkb' },
    );
    const point = new Uint8Array(25);
    const view = new DataView(point.buffer);
    view.setUint8(0, 1);
    view.setUint32(1, 0x20000001, true);
    view.setUint32(5, 3857, true);
    view.setFloat64(9, 1, true);
    view.setFloat64(17, 2, true);
    let bytes = point;
    if (nested) {
      bytes = new Uint8Array(34);
      const multi = new DataView(bytes.buffer);
      multi.setUint8(0, 1);
      multi.setUint32(1, 4, true);
      multi.setUint32(5, 1, true);
      bytes.set(point, 9);
    }
    const dataset = fromArrowTable(
      tableFromColumns(
        [{ field: base.schema.fields[0], data: vectorFromArray([bytes], new Binary()).data[0] }],
        base.schema.metadata,
      ),
    );
    expect(dataset.info?.crs_string).toBe('EPSG:4326');
    expect(dataset.layers[0].shapes).toEqual([[[1, 2]]]);
    const cached = toCachedArrowTable(dataset, { encoding: 'wkb' });
    expect(cached.getChild('geometry')!.get(0)).toEqual(base.getChild('geometry')!.get(0));
    expect((cached.getChild('geometry')!.get(0) as Uint8Array).byteLength).toBe(21);
  });

  it('does not restore a native coordinate null after import coerces it to zero', () => {
    const base = toArrowTable({
      layers: [{ geometry_type: 'point', shapes: [[[0, 2]]] }],
      info: { crs_string: 'EPSG:4326' },
    });
    const type = new Struct([
      new Field('x', new Float64(), true),
      new Field('y', new Float64(), true),
    ]);
    const data = makeData({
      type,
      length: 1,
      nullCount: 0,
      children: [
        vectorFromArray([null], new Float64()).data[0],
        vectorFromArray([2], new Float64()).data[0],
      ],
    });
    const field = new Field('geometry', type, true, base.schema.fields[0].metadata);
    const dataset = fromArrowTable(tableFromColumns([{ field, data }], base.schema.metadata));
    expect(dataset.layers[0].shapes).toEqual([[[0, 2]]]);
    const cached = toCachedArrowTable(dataset);
    expect(cached.getChild('geometry')!.get(0).toJSON()).toEqual({ x: 0, y: 2 });
    expect(toCachedArrowTable(dataset)).toBe(cached);
  });

  it.each([
    'point',
    'polyline',
    'polygon',
  ] as const)('normalizes singleton WKB Multi %s before reuse', (kind) => {
    const writer = new WkbWriter();
    if (kind === 'point') writer.writePoint(1, 2);
    else if (kind === 'polyline')
      writer.writeLineString(Float64Array.from([0, 2]), Float64Array.from([0, 2]), 0, 2);
    else
      writer.writePolygons(Float64Array.from([0, 0, 2, 2, 0]), Float64Array.from([0, 2, 2, 0, 0]), [
        [[0, 5]],
      ]);
    writer.endRow();
    const single = writer.finish().bytes;
    const bytes = new Uint8Array(single.byteLength + 9);
    const view = new DataView(bytes.buffer);
    view.setUint8(0, 1);
    view.setUint32(1, kind === 'point' ? 4 : kind === 'polyline' ? 5 : 6, true);
    view.setUint32(5, 1, true);
    bytes.set(single, 9);
    const dataset = fromArrowTable(new Table({ geometry: vectorFromArray([bytes], new Binary()) }));
    const cached =
      getSeededArrowTable(dataset, dataset.layers[0], { encoding: 'wkb' }, undefined, 'input') ??
      toCachedArrowTable(dataset, { encoding: 'wkb' });
    expect(cached.getChild('geometry')!.get(0)).toEqual(single);
  });

  it.each([
    'point',
    'polyline',
    'polygon',
  ] as const)('normalizes an all-singleton native Multi %s schema before reuse', (kind) => {
    const writer = new WkbWriter();
    if (kind === 'point') {
      writer.writePoint(1, 2);
      writer.endRow();
      writer.writeMultiPoint([
        [3, 4],
        [5, 6],
      ]);
    } else if (kind === 'polyline') {
      writer.writeLineString(Float64Array.from([0, 2]), Float64Array.from([0, 2]), 0, 2);
      writer.endRow();
      writer.writeMultiLineString(
        Float64Array.from([3, 4, 5, 6]),
        Float64Array.from([3, 4, 5, 6]),
        [
          [0, 2],
          [2, 4],
        ],
      );
    } else {
      const xs = Float64Array.from([0, 0, 2, 2, 0, 5, 5, 7, 7, 5]);
      const ys = Float64Array.from([0, 2, 2, 0, 0, 5, 7, 7, 5, 5]);
      writer.writePolygons(xs, ys, [[[0, 5]]]);
      writer.endRow();
      writer.writePolygons(xs, ys, [[[0, 5]], [[5, 10]]]);
    }
    writer.endRow();
    const { bytes, valueOffsets } = writer.finish();
    const input = fromArrowTable(
      tableFromColumns([
        {
          field: new Field('geometry', new Binary(), true),
          data: makeData({ type: new Binary(), length: 2, data: bytes, valueOffsets }),
        },
      ]),
    );
    input.info = { ...input.info, crs_string: 'EPSG:4326' };
    const sliced = toArrowTable(input).slice(0, 1);
    const parsed = fromArrowTable(sliced);
    const fresh = toArrowTable(parsed);
    const cached = toCachedArrowTable(parsed);
    expect(cached.getChild('geometry')!.type.toString()).toBe(
      fresh.getChild('geometry')!.type.toString(),
    );
    expect(cached.schema.fields[0].metadata.get('ARROW:extension:name')).toBe(
      kind === 'point'
        ? 'geoarrow.point'
        : kind === 'polyline'
          ? 'geoarrow.linestring'
          : 'geoarrow.polygon',
    );
  });

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

  it.each([
    'future-encoding',
    'wkb',
    '',
    null,
    42,
  ])('rejects unsupported geo metadata encoding %j instead of losing geometry', (encoding) => {
    const geom = wkbColumn('geometry', (w) => {
      w.writePoint(5, 6);
      w.endRow();
    });
    geom.field.metadata.set('ARROW:extension:name', 'geoarrow.wkb');
    const metadata = new Map([
      [
        'geo',
        JSON.stringify({
          primary_column: 'geometry',
          columns: { geometry: { encoding } },
        }),
      ],
    ]);

    expect(() => fromArrowTable(tableFromColumns([geom], metadata))).toThrow(
      /Unsupported geometry encoding .* for column 'geometry'/,
    );
  });

  it.each([
    ['geometry', undefined],
    ['geometry', 'geometry'],
    ['shape', undefined],
    ['shape', 'shape'],
  ] as const)('rejects unsupported GeoArrow extensions on %s (override: %s)', (name, geometryColumn) => {
    const geom = wkbColumn(name, (w) => {
      w.writePoint(5, 6);
      w.endRow();
    });
    geom.field.metadata.set('ARROW:extension:name', 'geoarrow.future-encoding');

    expect(() => fromArrowTable(tableFromColumns([geom]), { geometryColumn })).toThrow(
      `Unsupported GeoArrow extension 'geoarrow.future-encoding' for column '${name}'`,
    );
  });

  it('keeps geo metadata precedence over an unsupported extension on the chosen column', () => {
    const geom = wkbColumn('shape', (w) => {
      w.writePoint(5, 6);
      w.endRow();
    });
    geom.field.metadata.set('ARROW:extension:name', 'geoarrow.future-encoding');
    const metadata = new Map([
      [
        'geo',
        JSON.stringify({
          primary_column: 'shape',
          columns: { shape: { encoding: 'WKB', crs: null } },
        }),
      ],
    ]);

    const dataset = fromArrowTable(tableFromColumns([geom], metadata));
    expect(dataset.layers[0].shapes).toEqual([[[5, 6]]]);
    expect(dataset.info?.crs_string).toBe('EPSG:4326');
  });

  it('keeps WKB name detection with null geo metadata and unrelated Arrow extensions', () => {
    const geom = wkbColumn('geometry', (w) => {
      w.writePoint(5, 6);
      w.endRow();
    });
    geom.field.metadata.set('ARROW:extension:name', 'example.binary');

    const dataset = fromArrowTable(tableFromColumns([geom], new Map([['geo', 'null']])));
    expect(dataset.layers[0].shapes).toEqual([[[5, 6]]]);
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

  it('preserves special attribute names without mutating imported record prototypes', () => {
    const geom = wkbColumn('geometry', (w) => {
      w.writePoint(0, 0);
      w.endRow();
    });
    const protoVec = vectorFromArray([7], new Int32());
    const constructorVec = vectorFromArray(['safe'], new Utf8());
    const dataset = fromArrowTable(
      tableFromColumns([
        geom,
        { field: new Field('__proto__', new Int32(), true), data: protoVec.data[0] },
        { field: new Field('constructor', new Utf8(), true), data: constructorVec.data[0] },
      ]),
    );
    const [record] = dataset.layers[0].data!.getRecords!() as Array<Record<string, unknown>>;

    expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
    expect(Object.hasOwn(record, '__proto__')).toBe(true);
    expect(record.__proto__).toBe(7);
    expect(Object.hasOwn(record, 'constructor')).toBe(true);
    expect(record.constructor).toBe('safe');
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
