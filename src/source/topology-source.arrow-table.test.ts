import { describe, expect, it, vi } from 'vitest';
import type { Table } from 'apache-arrow';
import '../formats'; // side effect: registers plugin + table converter
import { exportGeoArrow } from '../formats/geoarrow-io';
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
});
