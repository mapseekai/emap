import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Table } from 'apache-arrow';
import '../formats'; // side effect: registers plugin + table converter
import { exportGeoArrow } from '../formats/geoarrow-io';
import { exportGeoParquet, importGeoParquetTable } from '../formats/geoparquet-io';
import { setParquetWasm } from '../formats/parquet-wasm-loader';
import { injectParquetWasmForTests } from '../formats/test-utils';
import * as datasetToTable from '../formats/dataset-to-table';
import {
  getTableConverter,
  registerTableConverter,
  unregisterTableConverter,
} from './format-registry';
import { TopologySource } from './topology-source';

const GEOJSON = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'a' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
      },
    },
  ],
});

async function makeSource(): Promise<TopologySource> {
  const source = new TopologySource('t');
  await source.setData({
    filename: 'a.geojson',
    content: new TextEncoder().encode(GEOJSON),
  });
  return source;
}

describe('TopologySource.getArrowTable', () => {
  it('builds a table for the current dataset', async () => {
    const source = await makeSource();
    const table = source.getArrowTable() as Table;
    expect(table.numRows).toBe(1);
  });

  it('returns the same instance while the data revision is unchanged', async () => {
    const source = await makeSource();
    expect(source.getArrowTable()).toBe(source.getArrowTable());
  });

  it('caches native and wkb encodings independently', async () => {
    const source = await makeSource();
    const native = source.getArrowTable({ encoding: 'native' });
    const wkb = source.getArrowTable({ encoding: 'wkb' });
    expect(native).not.toBe(wkb);
    expect(source.getArrowTable({ encoding: 'wkb' })).toBe(wkb);
  });

  it('rebuilds after markDataEdited', async () => {
    const source = await makeSource();
    const before = source.getArrowTable();
    source.markDataEdited();
    expect(source.getArrowTable()).not.toBe(before);
  });

  it('seedArrowTable installs a table served by the next matching get', async () => {
    const source = await makeSource();
    const seeded = source.getArrowTable({ encoding: 'wkb' });
    source.markDataEdited();
    source.seedArrowTable(seeded, { encoding: 'wkb' });
    expect(source.getArrowTable({ encoding: 'wkb' })).toBe(seeded);
  });

  it('throws a helpful error when the formats module is not loaded', async () => {
    const source = await makeSource();
    const saved = getTableConverter()!;
    unregisterTableConverter();
    try {
      expect(() => source.getArrowTable()).toThrow(/formats/);
    } finally {
      registerTableConverter(saved);
    }
  });

  it('resets the render LOD interval around rebuilds', async () => {
    const source = await makeSource();
    const arcs = source.getArcs()!;
    const spy = vi.spyOn(arcs, 'setRetainedInterval');
    arcs.setRetainedInterval(5);
    spy.mockClear();
    source.getArrowTable();
    // reset to 0 for the conversion, then restored to 5
    expect(spy.mock.calls.map((c) => c[0])).toEqual([0, 5]);
  });
});

describe('revision-0 cache seeding on import', () => {
  it('serves the imported table without converting', async () => {
    // Build .arrow bytes from a known dataset
    const seedSource = await makeSource();
    const bytes = exportGeoArrow(seedSource.getDataset()!);

    // Spy on the converter to prove getArrowTable never converts
    const real = getTableConverter()!;
    const spy = vi.fn(real.toTable.bind(real));
    registerTableConverter({ toTable: spy });
    try {
      const source = new TopologySource('arrow');
      await source.setData({ filename: 'a.arrow', content: bytes });
      const table = source.getArrowTable() as Table; // native: geoarrow default
      expect(table.numRows).toBe(1);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      registerTableConverter(real);
    }
  });
});

describe('export via arrow cache', () => {
  it('exports geoarrow without a second conversion when cached', async () => {
    const seedSource = await makeSource();
    const bytes = exportGeoArrow(seedSource.getDataset()!);
    const source = new TopologySource('arrow2');
    await source.setData({ filename: 'b.arrow', content: bytes });

    // `exportGeoArrow` calls `toArrowTable` directly (not through the
    // format-registry table converter), so the discriminating seam for
    // "served from cache, no rebuild" is `toArrowTable` itself.
    const spy = vi.spyOn(datasetToTable, 'toArrowTable');
    try {
      const blob = await source.export({ format: 'geoarrow' });
      expect(blob.size).toBeGreaterThan(0);
      expect(spy).not.toHaveBeenCalled(); // seeded revision-0 table served
    } finally {
      spy.mockRestore();
    }
  });

  describe('geoparquet', () => {
    beforeAll(async () => {
      await injectParquetWasmForTests();
    }, 30000);

    afterAll(() => setParquetWasm(null));

    it('exports geoparquet without a second conversion when cached', async () => {
      const seedSource = await makeSource();
      const parquetBytes = await exportGeoParquet(seedSource.getDataset()!);
      const source = new TopologySource('parquet1');
      await source.setData({ filename: 'c.parquet', content: parquetBytes });

      const spy = vi.spyOn(datasetToTable, 'toArrowTable');
      try {
        const blob = await source.export({ format: 'geoparquet' });
        expect(blob.size).toBeGreaterThan(0);
        expect(spy).not.toHaveBeenCalled(); // seeded revision-0 wkb table served
      } finally {
        spy.mockRestore();
      }
    });

    it('rebuilds through the geoparquet path (bbox column) on a cache miss', async () => {
      // GeoJSON import seeds nothing — the export MUST NOT route a generic
      // converter rebuild into the handler; exportGeoParquet's own rebuild
      // adds the GeoParquet 1.1 `bbox` covering column by default.
      //
      // The source CRS is pinned to EPSG:3857 (not the default EPSG:4326)
      // because crsStringToProjjsonAsync deliberately returns `undefined`
      // (no `crs` key — GeoParquet's implicit OGC:CRS84 default) for
      // EPSG:4326/CRS84. A 4326 source would make the CRS assertion below
      // pass vacuously even if CRS resolution were silently skipped; 3857
      // always yields an explicit PROJJSON block, making it the real
      // discriminator for this class of bug.
      const source = await makeSource();
      source.getDataset()!.info = { ...source.getDataset()!.info, crs_string: 'EPSG:3857' };
      const blob = await source.export({ format: 'geoparquet' });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const { table } = await importGeoParquetTable(bytes);
      expect(table.schema.fields.map((f) => f.name)).toContain('bbox');

      const geoMetadata = table.schema.metadata.get('geo');
      expect(geoMetadata).toBeTruthy();
      const geo = JSON.parse(geoMetadata!);
      const primaryColumn = geo.columns[geo.primary_column];
      expect(primaryColumn.crs?.id).toEqual({ authority: 'EPSG', code: 3857 });
    });

    it('does not serve a converter-built (unseeded) cache entry to export — the bbox column and strict CRS resolution would be silently lost', async () => {
      // Regression test for the bug where any fresh-revision cache hit was
      // treated as export-ready, regardless of how it got there. Simulate a
      // DuckDB-style call planting a generic converter entry under the same
      // `layer|wkb` key geoparquet export reads by default, then confirm
      // export still routes through its own rebuild path (bbox column
      // present) instead of forwarding the converter-built table as-is.
      const source = await makeSource();
      source.getArrowTable({ encoding: 'wkb' }); // plants a seeded:false entry
      const blob = await source.export({ format: 'geoparquet' });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const { table } = await importGeoParquetTable(bytes);
      expect(table.schema.fields.map((f) => f.name)).toContain('bbox');
    });

    it('skips a seeded cache hit and rebuilds when a content-affecting export option is set', async () => {
      // A cached table was built without knowledge of this export call's
      // options, so it cannot honor `reprojectToWgs84`/`bboxColumn`/
      // `geometryColumn`. Setting any of them must force the handler's own
      // rebuild path even though a seeded (trustworthy) cache hit exists.
      const seedSource = await makeSource();
      const parquetBytes = await exportGeoParquet(seedSource.getDataset()!);
      const source = new TopologySource('parquet-content-opts');
      await source.setData({ filename: 'd.parquet', content: parquetBytes });

      const spy = vi.spyOn(datasetToTable, 'toArrowTable');
      try {
        const blob = await source.export({ format: 'geoparquet', reprojectToWgs84: true });
        expect(blob.size).toBeGreaterThan(0);
        expect(spy).toHaveBeenCalled(); // rebuild path ran, seeded table was NOT forwarded as-is
      } finally {
        spy.mockRestore();
      }
    });
  });
});

describe('seedArrowTable forDataset race guard', () => {
  it('drops a seed whose forDataset no longer matches the current dataset', async () => {
    const source = await makeSource();
    const staleDataset = source.getDataset();
    const before = source.getArrowTable({ encoding: 'wkb' });

    // Simulate a concurrent op replacing the dataset before a stale seed
    // call lands.
    await source.setData({
      filename: 'b.geojson',
      content: new TextEncoder().encode(GEOJSON),
    });

    source.seedArrowTable(
      { fake: 'stale-table' },
      { encoding: 'wkb', forDataset: staleDataset },
    );

    // The stale seed must have been dropped: the wkb entry for the new
    // dataset is untouched (still whatever the new load produced, not the
    // fake table), so a fresh get either rebuilds or returns something
    // other than the injected fake.
    expect(source.getArrowTable({ encoding: 'wkb' })).not.toEqual({ fake: 'stale-table' });
    expect(source.getArrowTable({ encoding: 'wkb' })).not.toBe(before);
  });
});
