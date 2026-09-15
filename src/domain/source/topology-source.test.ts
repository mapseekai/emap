import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mapshaper from 'mapshaper';
import { unzipSync, strFromU8, zipSync } from 'fflate';
import { TopologySource } from './topology-source';
import {
  getDefaultMapshaperAdapter,
  type MapshaperAdapter,
} from '../../integrations/mapshaper/adapter';
import type { MapshaperDataset } from '../../shared/types/mapshaper-types';
import { FormatRegistry, registerFormat, unregisterFormat } from './format-registry';

function setPrivate(target: object, key: string, value: unknown): void {
  Reflect.set(target, key, value);
}

const TWO_GIB = 2 * 1024 * 1024 * 1024;

const FAKE_DATASET = {
  layers: [{ name: 'lyr', geometry_type: 'polygon', shapes: [[[0]]], data: null }],
  arcs: undefined,
  info: {},
};

describe('TopologySource.export', () => {
  const originalExport = Reflect.get(mapshaper.internal as object, 'exportFileContent');

  beforeEach(() => {
    Reflect.set(mapshaper.internal as object, 'exportFileContent', vi.fn());
  });

  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'exportFileContent', originalExport);
  });

  it('rejects when no dataset is loaded', async () => {
    const source = new TopologySource('test');
    await expect(source.export({ format: 'geojson' })).rejects.toThrow(/no dataset/);
  });

  it('forwards the format string verbatim to mapshaper', async () => {
    const exportSpy = vi.fn(() => [
      { filename: 'lyr.json', content: '{"type":"FeatureCollection","features":[]}' },
    ]);
    Reflect.set(mapshaper.internal as object, 'exportFileContent', exportSpy);

    const source = new TopologySource('test');
    setPrivate(source, '_dataset', FAKE_DATASET);

    await source.export({ format: 'geojson' });

    expect(exportSpy).toHaveBeenCalledTimes(1);
    const callArgs = exportSpy.mock.calls[0] as unknown[];
    expect(callArgs[1]).toMatchObject({ format: 'geojson' });
  });

  it('returns a single Blob for GeoJSON output', async () => {
    const payload = '{"type":"FeatureCollection","features":[]}';
    Reflect.set(
      mapshaper.internal as object,
      'exportFileContent',
      vi.fn(() => [{ filename: 'lyr.json', content: payload }]),
    );

    const source = new TopologySource('test');
    setPrivate(source, '_dataset', FAKE_DATASET);

    const blob = await source.export({ format: 'geojson' });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/geo+json');
    const text = await blob.text();
    expect(text).toBe(payload);
  });

  it('returns a single Blob for TopoJSON output', async () => {
    const payload = '{"type":"Topology","arcs":[],"objects":{}}';
    Reflect.set(
      mapshaper.internal as object,
      'exportFileContent',
      vi.fn(() => [{ filename: 'lyr.topojson', content: payload }]),
    );

    const source = new TopologySource('test');
    setPrivate(source, '_dataset', FAKE_DATASET);

    const blob = await source.export({ format: 'topojson' });
    expect(blob.type).toBe('application/json');
    expect(await blob.text()).toBe(payload);
  });

  it('zips multi-file shapefile output into one application/zip Blob', async () => {
    const shp = new Uint8Array([1, 2, 3, 4]);
    const shx = new Uint8Array([5, 6]);
    const dbf = new Uint8Array([7, 8, 9]);
    const prj = 'GEOGCS["WGS 84",...]';
    Reflect.set(
      mapshaper.internal as object,
      'exportFileContent',
      vi.fn(() => [
        { filename: 'lyr.shp', content: shp },
        { filename: 'lyr.shx', content: shx },
        { filename: 'lyr.dbf', content: dbf },
        { filename: 'lyr.prj', content: prj },
      ]),
    );

    const source = new TopologySource('test');
    setPrivate(source, '_dataset', FAKE_DATASET);

    const blob = await source.export({ format: 'shapefile' });
    expect(blob.type).toBe('application/zip');

    // Verify the zip contains all four files with correct content
    const buf = new Uint8Array(await blob.arrayBuffer());
    const entries = unzipSync(buf);
    expect(Object.keys(entries).sort()).toEqual(['lyr.dbf', 'lyr.prj', 'lyr.shp', 'lyr.shx']);
    expect(entries['lyr.shp']).toEqual(shp);
    expect(entries['lyr.shx']).toEqual(shx);
    expect(entries['lyr.dbf']).toEqual(dbf);
    expect(strFromU8(entries['lyr.prj'])).toBe(prj);
  });

  it('restores the retained simplification interval after export', async () => {
    Reflect.set(
      mapshaper.internal as object,
      'exportFileContent',
      vi.fn(() => [{ filename: 'lyr.json', content: '{}' }]),
    );

    const setRetainedInterval = vi.fn();
    const fakeArcs = {
      getRetainedInterval: () => 0.0123,
      setRetainedInterval,
    };
    const source = new TopologySource('test');
    setPrivate(source, '_dataset', { ...FAKE_DATASET, arcs: fakeArcs });

    await source.export({ format: 'geojson' });

    // Should be called twice: zero before export, restore after
    expect(setRetainedInterval).toHaveBeenCalledTimes(2);
    expect(setRetainedInterval.mock.calls[0][0]).toBe(0);
    expect(setRetainedInterval.mock.calls[1][0]).toBe(0.0123);
  });

  it('restores the retained interval even when exportFileContent throws', async () => {
    Reflect.set(
      mapshaper.internal as object,
      'exportFileContent',
      vi.fn(() => {
        throw new Error('boom');
      }),
    );

    const setRetainedInterval = vi.fn();
    const fakeArcs = {
      getRetainedInterval: () => 0.5,
      setRetainedInterval,
    };
    const source = new TopologySource('test');
    setPrivate(source, '_dataset', { ...FAKE_DATASET, arcs: fakeArcs });

    await expect(source.export({ format: 'geojson' })).rejects.toThrow(/boom/);
    expect(setRetainedInterval).toHaveBeenCalledTimes(2);
    expect(setRetainedInterval.mock.calls[1][0]).toBe(0.5);
  });

  it('produces byte-equal Blobs across repeated export calls', async () => {
    Reflect.set(
      mapshaper.internal as object,
      'exportFileContent',
      vi.fn(() => [{ filename: 'lyr.json', content: '{"a":1}' }]),
    );

    const source = new TopologySource('test');
    setPrivate(source, '_dataset', FAKE_DATASET);

    const a = await source.export({ format: 'geojson' });
    const b = await source.export({ format: 'geojson' });
    expect(await a.text()).toBe(await b.text());
  });

  it('routes msx through exportPackedDatasets (not exportFileContent)', async () => {
    const exportFileContent = vi.fn();
    const exportPackedDatasets = vi.fn(async () => [
      { filename: 'mapshaper_snapshot.msx', content: new Uint8Array([0xff, 0xfe, 0xfd]) },
    ]);
    Reflect.set(mapshaper.internal as object, 'exportFileContent', exportFileContent);
    const originalPack = Reflect.get(mapshaper.internal as object, 'exportPackedDatasets');
    Reflect.set(mapshaper.internal as object, 'exportPackedDatasets', exportPackedDatasets);

    try {
      const source = new TopologySource('test');
      setPrivate(source, '_dataset', FAKE_DATASET);
      const blob = await source.export({ format: 'msx' });

      expect(exportFileContent).not.toHaveBeenCalled();
      expect(exportPackedDatasets).toHaveBeenCalledTimes(1);
      const args = exportPackedDatasets.mock.calls[0] as unknown[];
      expect(args[0]).toEqual([FAKE_DATASET]);
      expect(args[1]).toMatchObject({ compact: true });
      expect(blob.type).toBe('application/octet-stream');
      const buf = new Uint8Array(await blob.arrayBuffer());
      expect(Array.from(buf)).toEqual([0xff, 0xfe, 0xfd]);
    } finally {
      Reflect.set(mapshaper.internal as object, 'exportPackedDatasets', originalPack);
    }
  });

  it('msx export serializes a compacted copy, leaving the live dataset untouched', async () => {
    const adapter = getDefaultMapshaperAdapter();
    const source = new TopologySource('msx-orphan');
    await source.setData({
      filename: 'a.geojson',
      content: new TextEncoder().encode(
        JSON.stringify({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'Polygon',
                coordinates: [
                  [
                    [0, 0],
                    [1, 0],
                    [1, 1],
                    [0, 1],
                    [0, 0],
                  ],
                ],
              },
            },
          ],
        }),
      ),
    });
    const live = source.getDataset()!;
    const liveArcCount = live.arcs!.size();
    // Append an unreferenced (orphan) arc directly to the live collection.
    adapter.appendArc(live.arcs!, [
      [5, 5],
      [6, 6],
    ]);
    expect(live.arcs!.size()).toBe(liveArcCount + 1);

    // Note: TopologySource stores the adapter as `this._adapter`. If it holds the
    // process-wide singleton (getDefaultMapshaperAdapter()), spying on `adapter`
    // here intercepts the call; if a future refactor hands sources their own
    // instance, spy on `getPrivate(source, '_adapter')` instead.
    const seen: number[] = [];
    const spy = vi
      .spyOn(adapter, 'exportPackedDatasets')
      .mockImplementation(async (datasets: MapshaperDataset[]) => {
        const dataset = datasets[0]!;
        seen.push(dataset.arcs!.size());
        expect(dataset).not.toBe(live); // must be a copy
        return [{ filename: 'a.msx', content: new Uint8Array([0]) }];
      });
    try {
      await source.export({ format: 'msx' });
    } finally {
      spy.mockRestore();
    }
    expect(seen).toEqual([liveArcCount]); // orphan compacted away in the copy
    expect(live.arcs!.size()).toBe(liveArcCount + 1); // live dataset untouched
  });
});

describe('TopologySource.setData', () => {
  it.each([
    ['roads.shp', 'roads.shp', 'first.zip', 'second.zip'],
    ['roads.shp', 'ROADS.SHP', 'first.zip', 'second.zip'],
    ['roads.shp', 'ROADS.SHP', 'first.zip', undefined],
    ['ROADS.SHP', 'roads.shp', undefined, 'second.zip'],
    ['nested/roads.shp', 'roads.shp', undefined, 'second.zip'],
    ['roads.geojson', 'ROADS.GEOJSON', undefined, undefined],
  ] as const)('rejects conflicting input basenames %s / %s from %s / %s without replacing live data', async (firstName, secondName, firstArchive, secondArchive) => {
    const source = new TopologySource('t');
    const firstContent = new TextEncoder().encode('{"type":"Point","coordinates":[1,2]}');
    const secondContent = new TextEncoder().encode('{"type":"Point","coordinates":[3,4]}');
    await source.setData({ filename: 'original.geojson', content: firstContent });
    const original = source.getDataset();
    const onData = vi.fn();
    source.on('data', onData);

    const load = source.setData([
      {
        filename: firstArchive ?? firstName,
        content: firstArchive ? zipSync({ [firstName]: firstContent }) : firstContent,
      },
      {
        filename: secondArchive ?? secondName,
        content: secondArchive ? zipSync({ [secondName]: secondContent }) : secondContent,
      },
    ]);

    await expect(load).rejects.toThrow(/duplicate basename/i);
    await expect(load).rejects.toThrow(firstArchive ?? firstName);
    await expect(load).rejects.toThrow(secondArchive ?? secondName);
    expect(source.getDataset()).toBe(original);
    expect(onData).not.toHaveBeenCalled();
  });

  it('imports distinct files from multiple archives and a loose input', async () => {
    const source = new TopologySource('t');
    const bytes = new TextEncoder().encode('{"type":"Point","coordinates":[1,2]}');
    const archives: Uint8Array[] = [];
    for (const name of ['roads', 'districts']) {
      const input = new TopologySource(name);
      await input.setData({ filename: `${name}.geojson`, content: bytes });
      archives.push(
        new Uint8Array(await (await input.export({ format: 'shapefile' })).arrayBuffer()),
      );
    }

    await source.setData([
      { filename: 'first.zip', content: archives[0] },
      { filename: 'second.zip', content: archives[1] },
      { filename: 'places.geojson', content: bytes },
    ]);

    expect(source.getLayers().map((layer) => layer.name)).toEqual(['roads', 'districts', 'places']);
    expect(source.getLayers().map((layer) => layer.shapes?.length)).toEqual([1, 1, 1]);
  });

  it('rejects conflicting auxiliary files even when archive primary files differ', async () => {
    const source = new TopologySource('t');
    const bytes = new TextEncoder().encode('{"type":"Point","coordinates":[1,2]}');
    const load = source.setData([
      {
        filename: 'first.zip',
        content: zipSync({ 'roads.shp': bytes, 'shared.dbf': new Uint8Array([1]) }),
      },
      {
        filename: 'second.zip',
        content: zipSync({ 'districts.shp': bytes, 'SHARED.DBF': new Uint8Array([2]) }),
      },
    ]);

    await expect(load).rejects.toThrow(/duplicate basename.*SHARED\.DBF/i);
    await expect(load).rejects.toThrow('first.zip/shared.dbf');
    await expect(load).rejects.toThrow('second.zip/SHARED.DBF');
    expect(source.getDataset()).toBeUndefined();
  });

  it('imports every shapefile in one zip', async () => {
    const runImport = vi.fn(async () => FAKE_DATASET);
    const splitSelfIntersectingPolygonRings = vi.fn();
    const adapter = {
      runImport,
      splitSelfIntersectingPolygonRings,
    } as unknown as MapshaperAdapter;
    const source = new TopologySource('t', { adapter });
    const content = zipSync({
      'roads.shp': new Uint8Array([1]),
      'roads.dbf': new Uint8Array([2]),
      'districts.SHP': new Uint8Array([3]),
      'districts.DBF': new Uint8Array([4]),
    });

    await source.setData({ filename: 'multiple.zip', content });

    expect(runImport).toHaveBeenCalledTimes(1);
    expect(runImport.mock.calls[0][0]).toBe('-i "roads.shp" "districts.SHP"');
    expect(Object.keys(runImport.mock.calls[0][1]).sort()).toEqual([
      'districts.DBF',
      'districts.SHP',
      'roads.dbf',
      'roads.shp',
    ]);
  });

  it('splits self-touching polygon rings after importing a zipped Shapefile', async () => {
    const runImport = vi.fn(async () => FAKE_DATASET);
    const splitSelfIntersectingPolygonRings = vi.fn();
    const adapter = {
      runImport,
      splitSelfIntersectingPolygonRings,
    } as unknown as MapshaperAdapter;
    const source = new TopologySource('t', { adapter });
    const content = zipSync({
      'land.shp': new Uint8Array([1]),
      'land.dbf': new Uint8Array([2]),
    });

    await source.setData({ filename: 'land.zip', content });

    expect(splitSelfIntersectingPolygonRings).toHaveBeenCalledOnce();
    expect(splitSelfIntersectingPolygonRings).toHaveBeenCalledWith(FAKE_DATASET);
  });

  it('splits self-touching rings after importing TopoJSON through a .json file', async () => {
    const dataset = {
      ...FAKE_DATASET,
      info: { input_files: ['land.json'], input_formats: ['topojson'] },
    };
    const runImport = vi.fn(async () => dataset);
    const splitSelfIntersectingPolygonRings = vi.fn();
    const adapter = {
      runImport,
      splitSelfIntersectingPolygonRings,
    } as unknown as MapshaperAdapter;
    const source = new TopologySource('t', { adapter });

    await source.setData({
      filename: 'land.json',
      content: new TextEncoder().encode('{\"type\":\"Topology\"}'),
    });

    expect(splitSelfIntersectingPolygonRings).toHaveBeenCalledOnce();
    expect(splitSelfIntersectingPolygonRings).toHaveBeenCalledWith(dataset);
  });

  it('does not normalize non-Shapefile layers in a mixed import', async () => {
    const runImport = vi.fn(async () => FAKE_DATASET);
    const splitSelfIntersectingPolygonRings = vi.fn();
    const adapter = {
      runImport,
      splitSelfIntersectingPolygonRings,
    } as unknown as MapshaperAdapter;
    const source = new TopologySource('t', { adapter });

    await source.setData([
      { filename: 'land.shp', content: new Uint8Array([1]) },
      { filename: 'overlay.geojson', content: new Uint8Array([123, 125]) },
    ]);

    expect(splitSelfIntersectingPolygonRings).not.toHaveBeenCalled();
  });

  it('rejects Shapefile imports when the adapter lacks ring normalization', async () => {
    const adapter = {
      runImport: vi.fn(async () => FAKE_DATASET),
    } as unknown as MapshaperAdapter;
    const source = new TopologySource('t', { adapter });

    await expect(
      source.setData({ filename: 'land.shp', content: new Uint8Array([1]) }),
    ).rejects.toThrow(/splitSelfIntersectingPolygonRings/);
  });

  it('derives filenames from root-relative URLs before import', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/geo+json' }),
      arrayBuffer: async () => new Uint8Array([123, 125]).buffer,
    } as Response);
    const runImport = vi.fn(async () => FAKE_DATASET);

    try {
      const source = new TopologySource('roads', {
        adapter: { runImport },
      });

      await source.setData('/data/roads.geojson');

      expect(fetchSpy).toHaveBeenCalledWith('/data/roads.geojson', expect.any(Object));
      expect(runImport).toHaveBeenCalledTimes(1);
      expect(runImport.mock.calls[0][0]).toBe('-i "roads.geojson"');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('rejects oversized URL imports from Content-Length before buffering the body', async () => {
    const arrayBuffer = vi.fn(async () => new Uint8Array(5).buffer);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        'Content-Type': 'application/geo+json',
        'Content-Length': '5',
      }),
      arrayBuffer,
    } as unknown as Response);
    const source = new TopologySource('roads', { resourceLimits: { maxInputBytes: 4 } });

    try {
      await expect(source.setData('/data/roads.geojson')).rejects.toThrow(/input byte limit/i);
      expect(arrayBuffer).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('rejects streamed URL imports that exceed the byte limit without Content-Length', async () => {
    const response = new Response(new Uint8Array([1, 2, 3, 4, 5]), {
      headers: { 'Content-Type': 'application/geo+json' },
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
    const source = new TopologySource('roads', { resourceLimits: { maxInputBytes: 4 } });

    try {
      await expect(source.setData('/data/roads.geojson')).rejects.toThrow(/input byte limit/i);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('applies the input byte limit to the total size of multi-file imports', async () => {
    const runImport = vi.fn(async () => FAKE_DATASET);
    const source = new TopologySource('roads', {
      adapter: { runImport },
      resourceLimits: { maxInputBytes: 4 },
    });

    await expect(
      source.setData([
        { filename: 'a.geojson', content: new Uint8Array(3) },
        { filename: 'b.geojson', content: new Uint8Array(2) },
      ]),
    ).rejects.toThrow(/input byte limit/i);
    expect(runImport).not.toHaveBeenCalled();
  });

  it('marks GeoJSON imports as EPSG:4326 when mapshaper provides no CRS metadata', async () => {
    // RFC 7946 fixes GeoJSON to WGS84 lon/lat; without this the CRS stays
    // "unknown" and GeoParquet exports write `crs: null`.
    const runImport = vi.fn(async () => ({ ...FAKE_DATASET, info: {} }));
    const source = new TopologySource('t', { adapter: { runImport } });

    await source.setData({ filename: 'a.geojson', content: new Uint8Array([123, 125]) });

    expect(source.getDataset()?.info?.crs_string).toBe('EPSG:4326');
  });

  it('does not mark shapefile imports as EPSG:4326 without CRS metadata', async () => {
    const runImport = vi.fn(async () => ({ ...FAKE_DATASET, info: {} }));
    const splitSelfIntersectingPolygonRings = vi.fn();
    const adapter = {
      runImport,
      splitSelfIntersectingPolygonRings,
    } as unknown as MapshaperAdapter;
    const source = new TopologySource('t', { adapter });

    await source.setData({ filename: 'a.shp', content: new Uint8Array([0]) });

    expect(source.getDataset()?.info?.crs_string).toBeUndefined();
  });

  it('does not override CRS metadata already carried by the imported dataset', async () => {
    const runImport = vi.fn(async () => ({
      ...FAKE_DATASET,
      info: { prj: 'PROJCS["X",AUTHORITY["EPSG","3857"]]' },
    }));
    const source = new TopologySource('t', { adapter: { runImport } });

    await source.setData({ filename: 'a.geojson', content: new Uint8Array([123, 125]) });

    expect(source.getDataset()?.info?.crs_string).toBeUndefined();
    expect(source.getCRS()).toBe('EPSG:3857');
  });

  it('normalizes imported data before committing or firing data', async () => {
    const imported = { ...FAKE_DATASET, info: { crs_string: 'EPSG:4326' } };
    const normalized = { ...FAKE_DATASET, info: { crs_string: 'EPSG:3857' } };
    const source = new TopologySource('managed', {
      adapter: { runImport: vi.fn(async () => imported) },
    });
    const normalize = vi.fn(async () => normalized);
    const observed: unknown[] = [];
    source.setDatasetNormalizer(normalize);
    source.on('data', () => observed.push(source.getDataset()));

    await source.setData({ filename: 'a.geojson', content: new Uint8Array([1]) });

    expect(normalize).toHaveBeenCalledWith(imported);
    expect(source.getDataset()).toBe(normalized);
    expect(observed).toEqual([normalized]);
  });

  it('keeps the previous dataset when normalization fails', async () => {
    const previous = { ...FAKE_DATASET, info: { crs_string: 'EPSG:3857' } };
    const source = new TopologySource('managed', {
      adapter: {
        runImport: vi.fn(async () => ({
          ...FAKE_DATASET,
          info: { crs_string: 'EPSG:4326' },
        })),
      },
    });
    source.setDataset(previous);
    source.setDatasetNormalizer(async () => {
      throw new Error('projection failed');
    });
    const dataEvents = vi.fn();
    source.on('data', dataEvents);

    await expect(
      source.setData({ filename: 'a.geojson', content: new Uint8Array([1]) }),
    ).rejects.toThrow('projection failed');

    expect(source.getDataset()).toBe(previous);
    expect(dataEvents).not.toHaveBeenCalled();
  });

  it('runs the normalizer commit assertion before committing normalized data', async () => {
    const imported = { ...FAKE_DATASET, info: { crs_string: 'EPSG:4326' } };
    const normalized = { ...FAKE_DATASET, info: { crs_string: 'EPSG:3857' } };
    const source = new TopologySource('managed', {
      adapter: { runImport: vi.fn(async () => imported) },
    });
    const assertCommittable = vi.fn();
    source.setDatasetNormalizer(async () => ({ dataset: normalized, assertCommittable }));

    await source.setData({ filename: 'a.geojson', content: new Uint8Array([1]) });

    expect(assertCommittable).toHaveBeenCalledTimes(1);
    expect(source.getDataset()).toBe(normalized);
  });

  it('keeps the previous dataset when the normalizer commit assertion fails', async () => {
    const previous = { ...FAKE_DATASET, info: { crs_string: 'EPSG:3857' } };
    const source = new TopologySource('managed', {
      adapter: {
        runImport: vi.fn(async () => ({
          ...FAKE_DATASET,
          info: { crs_string: 'EPSG:4326' },
        })),
      },
    });
    source.setDataset(previous);
    source.setDatasetNormalizer(async () => ({
      dataset: { ...FAKE_DATASET, info: { crs_string: 'EPSG:4490' } },
      assertCommittable: () => {
        throw new Error('Map CRS changed during source normalization for "managed"');
      },
    }));
    const dataEvents = vi.fn();
    source.on('data', dataEvents);

    await expect(
      source.setData({ filename: 'a.geojson', content: new Uint8Array([1]) }),
    ).rejects.toThrow('Map CRS changed during source normalization');

    expect(source.getDataset()).toBe(previous);
    expect(dataEvents).not.toHaveBeenCalled();
  });

  it('passes direct text formats to the importer as strings', async () => {
    const runImport = vi.fn(async () => FAKE_DATASET);
    const adapter = {
      runImport,
      splitSelfIntersectingPolygonRings: vi.fn(),
    } as unknown as MapshaperAdapter;
    const source = new TopologySource('t', { adapter });

    await source.setData({
      filename: 'data.kml',
      content: new TextEncoder().encode('<kml/>'),
    });

    expect(typeof runImport.mock.calls[0][1]['data.kml']).toBe('string');
  });

  it('passes array-input KML to the importer as a string', async () => {
    const runImport = vi.fn(async () => FAKE_DATASET);
    const adapter = {
      runImport,
      splitSelfIntersectingPolygonRings: vi.fn(),
    } as unknown as MapshaperAdapter;
    const source = new TopologySource('t', { adapter });

    await source.setData([{ filename: 'a.kml', content: new TextEncoder().encode('<kml/>') }]);

    expect(typeof runImport.mock.calls[0][1]['a.kml']).toBe('string');
  });
  it('imports KML bytes with polygon Placemarks (real mapshaper)', async () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Placemark><name>box</name><Polygon><outerBoundaryIs><LinearRing>
<coordinates>0,0 1,0 1,1 0,1 0,0</coordinates>
</LinearRing></outerBoundaryIs></Polygon></Placemark>
</Document></kml>`;
    const source = new TopologySource('kml');

    await source.setData({ filename: 'data.kml', content: new TextEncoder().encode(kml) });

    const layers = source.getLayers();
    expect(layers.map((layer) => layer.geometry_type)).toEqual(['polygon']);
    expect(layers[0].shapes?.length).toBe(1);
    expect(source.getExtent().width).toBeGreaterThan(0);
  });
});

describe('TopologySource.reproject', () => {
  it('keeps the source CRS available while real mapshaper projects GeoJSON coordinates', async () => {
    const source = new TopologySource('test');
    const content = new TextEncoder().encode(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates: [-122.405, 37.7819] },
          },
          {
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates: [-122.395, 37.7919] },
          },
        ],
      }),
    );

    await source.setData({ filename: 'points.geojson', content });
    await source.reproject('EPSG:3857');

    const extent = source.getExtent();
    expect(source.getCRS()).toBe('EPSG:3857');
    expect(extent.xmin).toBeLessThan(-10_000_000);
    expect(extent.ymin).toBeGreaterThan(4_000_000);
  });

  it('reprojects projected coordinates whose CRS is represented only by crs_string', async () => {
    const source = new TopologySource('test');
    const content = new TextEncoder().encode(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates: [-7_000_000, 5_500_000] },
          },
        ],
      }),
    );

    await source.setData({ filename: 'point.geojson', content });
    const dataset = source.getDataset()!;
    setPrivate(source, '_dataset', {
      ...dataset,
      info: { crs_string: 'EPSG:3857' },
    });

    await source.reproject('EPSG:4326');

    const extent = source.getExtent();
    expect(source.getCRS()).toBe('EPSG:4326');
    expect(extent.xmin).toBeGreaterThan(-70);
    expect(extent.xmin).toBeLessThan(-50);
    expect(extent.ymin).toBeGreaterThan(30);
    expect(extent.ymin).toBeLessThan(50);
  });

  it('resolves EPSG targets before calling mapshaper directly', async () => {
    const source = new TopologySource('test');
    const dataset = { ...FAKE_DATASET, info: {} };
    const resultDataset = { ...FAKE_DATASET, info: {} };

    setPrivate(source, '_dataset', dataset);

    const adapter = getDefaultMapshaperAdapter();
    const runOnDatasetSpy = vi.spyOn(adapter, 'runOnDataset').mockResolvedValue(resultDataset);

    try {
      await source.reproject('EPSG:4490');

      expect(runOnDatasetSpy).toHaveBeenCalledTimes(1);
      const cmd = runOnDatasetSpy.mock.calls[0][0];
      expect(cmd).toContain('-proj ');
      expect(cmd).toContain('+ellps=GRS80');
      expect(cmd).not.toContain('EPSG:4490');
      expect(source.getDataset()?.info?.crs_string).toBe('EPSG:4490');
    } finally {
      runOnDatasetSpy.mockRestore();
    }
  });
  it('blocks independent CRS changes while the source is managed by a map', async () => {
    const dataset = {
      ...FAKE_DATASET,
      info: { crs_string: 'EPSG:3857' },
    };
    const runOnDataset = vi.fn(async () => dataset);
    const source = new TopologySource('managed', {
      adapter: { runOnDataset },
    });
    source.setDataset(dataset);
    source.setManagedCRS(() => 'EPSG:3857');

    await expect(source.reproject('EPSG:4326')).rejects.toThrow(
      'use map.reproject() to change its CRS',
    );
    expect(runOnDataset).not.toHaveBeenCalled();
  });

  it('reprojects a managed source to the current map CRS', async () => {
    const dataset = { ...FAKE_DATASET, info: { crs_string: 'EPSG:3857' } };
    const projected = { ...FAKE_DATASET, info: {} };
    const runOnDataset = vi.fn(async () => projected);
    const source = new TopologySource('managed', {
      adapter: { copyDataset: (value: object) => ({ ...value }), runOnDataset },
    });
    source.setDataset(dataset);
    source.setManagedCRS(() => 'EPSG:3857');

    await source.reproject('EPSG:3857');

    expect(runOnDataset).toHaveBeenCalledTimes(1);
    expect(source.getDataset()).toBe(projected);
    expect(source.getDataset()?.info?.crs_string).toBe('EPSG:3857');
  });

  it('rejects a managed reprojection when the owning map CRS changes mid-flight', async () => {
    const dataset = { ...FAKE_DATASET, info: { crs_string: 'EPSG:3857' } };
    const { promise, resolve } = Promise.withResolvers<object>();
    const runOnDataset = vi.fn(() => promise);
    const source = new TopologySource('managed', {
      adapter: { copyDataset: (value: object) => ({ ...value }), runOnDataset },
    });
    source.setDataset(dataset);
    let managedCrs = 'EPSG:3857';
    source.setManagedCRS(() => managedCrs);

    const reprojection = source.reproject('EPSG:3857');
    await vi.waitFor(() => expect(runOnDataset).toHaveBeenCalled());
    managedCrs = 'EPSG:4490';
    resolve({ ...FAKE_DATASET, info: {} });

    await expect(reprojection).rejects.toThrow('Map CRS changed during reprojection');
    expect(source.getDataset()).toBe(dataset);
  });

  it('rejects a managed reprojection when the dataset is replaced mid-flight', async () => {
    const dataset = { ...FAKE_DATASET, info: { crs_string: 'EPSG:3857' } };
    const { promise, resolve } = Promise.withResolvers<object>();
    const runOnDataset = vi.fn(() => promise);
    const source = new TopologySource('managed', {
      adapter: { copyDataset: (value: object) => ({ ...value }), runOnDataset },
    });
    source.setDataset(dataset);
    source.setManagedCRS(() => 'EPSG:3857');

    const reprojection = source.reproject('EPSG:3857');
    await vi.waitFor(() => expect(runOnDataset).toHaveBeenCalled());
    source.setDataset({ ...FAKE_DATASET, info: { crs_string: 'EPSG:3857' } }, false);
    resolve({ ...FAKE_DATASET, info: {} });

    await expect(reprojection).rejects.toThrow('changed during reprojection');
  });

  it('uses caller-provided CRS metadata when the projection input is already resolved', async () => {
    const source = new TopologySource('test');
    const dataset = { ...FAKE_DATASET, info: { crs_string: 'EPSG:4326' } };
    const resultDataset = { ...FAKE_DATASET, info: { crs_string: 'EPSG:4326' } };
    setPrivate(source, '_dataset', dataset);

    const adapter = getDefaultMapshaperAdapter();
    const runOnDatasetSpy = vi
      .spyOn(adapter, 'runOnDataset')
      .mockImplementation(async (_cmd, input) => {
        expect(input.info?.crs_string).toBe('EPSG:4326');
        return resultDataset;
      });

    try {
      await source.reproject('+proj=longlat +ellps=GRS80 +no_defs +type=crs', 'EPSG:4490');

      expect(source.getDataset()?.info?.crs_string).toBe('EPSG:4490');
      expect(source.getDataset()?.info?.prj).toBeUndefined();
      expect(source.getDataset()?.info?.wkt1).toBeUndefined();
    } finally {
      runOnDatasetSpy.mockRestore();
    }
  });
});

describe('TopologySource snapshot round-trip (real mapshaper)', () => {
  // Tiny single-feature polygon — survives the full Pack→Unpack pipeline.
  const TINY_GEOJSON = JSON.stringify({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: 'box', score: 7 },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
              [0, 0],
            ],
          ],
        },
      },
    ],
  });

  function importGeoJSON(filename: string, contentString: string): Promise<TopologySource> {
    return new Promise((resolve, reject) => {
      const source = new TopologySource('rt');
      source.on('data', () => resolve(source));
      source.on('error', (e: any) => reject(e?.error ?? e));
      source.setData({ filename, content: new TextEncoder().encode(contentString) });
    });
  }

  function summarize(source: TopologySource) {
    const ds = source.getDataset()!;
    return {
      layerNames: ds.layers.map((l: any) => l.name),
      geoms: ds.layers.map((l: any) => l.geometry_type),
      shapeCounts: ds.layers.map((l: any) => l.shapes?.length ?? 0),
      arcCount: ds.arcs ? ((ds.arcs as any).size?.() ?? null) : null,
    };
  }

  it('round-trips layer names, geometry types, shape counts, and arc count via .msx', async () => {
    const original = await importGeoJSON('box.geojson', TINY_GEOJSON);
    const before = summarize(original);

    const blob = await original.export({ format: 'msx' });
    expect(blob.type).toBe('application/octet-stream');
    const bytes = new Uint8Array(await blob.arrayBuffer());

    await new Promise<void>((resolve, reject) => {
      const fresh = new TopologySource('rt2');
      fresh.on('data', () => {
        const after = summarize(fresh);
        try {
          expect(after.layerNames).toEqual(before.layerNames);
          expect(after.geoms).toEqual(before.geoms);
          expect(after.shapeCounts).toEqual(before.shapeCounts);
          expect(after.arcCount).toEqual(before.arcCount);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
      fresh.on('error', (e: any) => reject(e?.error ?? e));
      fresh.setData({ filename: 'roundtrip.msx', content: bytes });
    });
  });
});

describe('TopologySource.setData multi-file', () => {
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');

  let parseCommandsSpy: ReturnType<typeof vi.fn>;
  let runParsedCommandsSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    parseCommandsSpy = vi.fn((_cmd: string) => [{ name: 'i', options: {} }]) as ReturnType<
      typeof vi.fn
    >;
    runParsedCommandsSpy = vi.fn((commands: any[], _job: any, cb: any) => {
      cb(null, {
        catalog: {
          getDefaultTargets: () => [
            {
              // Echo back the inputFiles so the test can assert on them
              dataset: { layers: [], info: { _injected: commands[0]?.options?.input } },
            },
          ],
        },
      });
    }) as ReturnType<typeof vi.fn>;
    Reflect.set(mapshaper.internal as object, 'parseCommands', parseCommandsSpy);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', runParsedCommandsSpy);
  });

  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
    vi.unstubAllGlobals();
  });

  it('fromUrl resolves after loading a URL-backed dataset', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'application/geo+json' },
      arrayBuffer: async () => bytes.buffer,
    }));
    vi.stubGlobal('fetch', fetchSpy);

    const source = await TopologySource.fromUrl('url-source', 'https://example.test/data.geojson');

    expect(source.id).toBe('url-source');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.test/data.geojson',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-i "data.geojson"');
    expect(source.getDataset()?.info?._injected['data.geojson']).toEqual(bytes);
  });

  it('rejects an oversized URL ZIP before buffering the response body', async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'content-length' ? '2048' : 'application/zip',
      },
      arrayBuffer,
    }));
    vi.stubGlobal('fetch', fetchSpy);

    const source = new TopologySource('zip-source', {
      zipLimits: { maxCompressedBytes: 1024 },
    });

    await expect(source.setData('https://example.test/data.zip')).rejects.toThrow(
      /maxCompressedBytes/,
    );
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('rejects a URL ZIP above the default 2 GiB compressed limit before buffering', async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'content-length' ? String(TWO_GIB + 1) : 'application/zip',
      },
      arrayBuffer,
    }));
    vi.stubGlobal('fetch', fetchSpy);

    const source = new TopologySource('zip-source');

    await expect(source.setData('https://example.test/data.zip')).rejects.toThrow(
      `maxCompressedBytes ${TWO_GIB}`,
    );
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('accepts a URL ZIP at the default 2 GiB compressed boundary', async () => {
    const zip = zipSync({ 'a.shp': new Uint8Array([1, 2, 3]) });
    const arrayBuffer = vi.fn(async () =>
      zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength),
    );
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'content-length' ? String(TWO_GIB) : 'application/zip',
      },
      arrayBuffer,
    }));
    vi.stubGlobal('fetch', fetchSpy);

    const source = new TopologySource('zip-source');

    await expect(source.setData('https://example.test/data.zip')).resolves.toBe(source);
    expect(arrayBuffer).toHaveBeenCalledOnce();
    expect(parseCommandsSpy).toHaveBeenCalledOnce();
  });

  it('fromBytes resolves after loading an in-memory dataset', async () => {
    const content = new Uint8Array([9, 8, 7]);

    const source = await TopologySource.fromBytes('bytes-source', content, {
      filename: 'upload.topojson',
    });

    expect(source.id).toBe('bytes-source');
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-i "upload.topojson"');
    expect(source.getDataset()?.info?._injected['upload.topojson']).toEqual(content);
  });

  it('fromBytes defaults to a geojson filename based on the source id', async () => {
    await TopologySource.fromBytes('local-layer', new ArrayBuffer(4));

    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-i "local-layer.geojson"');
    const passedCommands = runParsedCommandsSpy.mock.calls[0][0] as any[];
    expect(passedCommands[0].options.input['local-layer.geojson']).toBeInstanceOf(Uint8Array);
  });

  it('emits one -i command listing every primary file when given an array', async () => {
    const source = new TopologySource('test');
    source.setData([
      { filename: 'a.geojson', content: new Uint8Array([1]) },
      { filename: 'b.geojson', content: new Uint8Array([2]) },
    ]);
    // setData is async via _updateData; wait one microtask cycle
    await new Promise((r) => setTimeout(r, 0));
    expect(parseCommandsSpy).toHaveBeenCalled();
    const cmd = parseCommandsSpy.mock.calls[0][0] as string;
    expect(cmd).toBe('-i "a.geojson" "b.geojson"');
  });

  it('passes every file to mapshaper as inputFiles', async () => {
    const source = new TopologySource('test');
    const errs: unknown[] = [];
    source.on('error', (e: unknown) => errs.push(e));
    source.setData([
      { filename: 'a.geojson', content: new Uint8Array([1, 2, 3]) },
      { filename: 'b.geojson', content: new Uint8Array([4, 5]) },
    ]);
    await new Promise((r) => setTimeout(r, 0));
    expect(errs).toEqual([]);
    const passedCommands = runParsedCommandsSpy.mock.calls[0][0] as any[];
    const inputFiles = passedCommands[0].options.input;
    expect(inputFiles['a.geojson']).toEqual(new Uint8Array([1, 2, 3]));
    expect(inputFiles['b.geojson']).toEqual(new Uint8Array([4, 5]));
  });

  it('still works for a single-file (non-array) input', async () => {
    const source = new TopologySource('test');
    source.setData({ filename: 'single.geojson', content: new Uint8Array([7]) });
    await new Promise((r) => setTimeout(r, 0));
    const cmd = parseCommandsSpy.mock.calls[0][0] as string;
    expect(cmd).toBe('-i "single.geojson"');
  });

  it('quotes filenames containing embedded double quotes', async () => {
    const source = new TopologySource('test');
    source.setData([{ filename: 'we"ird.geojson', content: new Uint8Array([1]) }]);
    await new Promise((r) => setTimeout(r, 0));
    const cmd = parseCommandsSpy.mock.calls[0][0] as string;
    expect(cmd).toBe('-i "we\\"ird.geojson"');
  });

  it('empty array fires error and runs no command', async () => {
    const source = new TopologySource('test');
    const errs: any[] = [];
    source.on('error', (e: any) => errs.push(e));
    source.setData([]);
    await new Promise((r) => setTimeout(r, 0));
    expect(parseCommandsSpy).not.toHaveBeenCalled();
    expect(errs).toHaveLength(1);
    expect(String(errs[0].error)).toMatch(/empty array/i);
  });
});

// ---------------------------------------------------------------------------
// Bounded ZIP extraction
// ---------------------------------------------------------------------------

describe('TopologySource._extractZip — resource limits', () => {
  function callExtract(
    source: TopologySource,
    data: Uint8Array,
  ): Promise<Record<string, Uint8Array | string>> {
    return Reflect.get(source, '_extractZip').call(source, data);
  }

  function withDeclaredUncompressedSize(data: Uint8Array, byteLength: number): Uint8Array {
    const patched = data.slice();
    const view = new DataView(patched.buffer, patched.byteOffset, patched.byteLength);
    for (let offset = 0; offset + 4 <= patched.byteLength; offset++) {
      const signature = view.getUint32(offset, true);
      if (signature === 0x04034b50) view.setUint32(offset + 22, byteLength, true);
      if (signature === 0x02014b50) view.setUint32(offset + 24, byteLength, true);
    }
    return patched;
  }

  it('accepts a normal multi-file shapefile zip with default limits', async () => {
    const buf = zipSync({
      'a.shp': new Uint8Array([1, 2, 3]),
      'a.dbf': new Uint8Array([4, 5]),
      'a.prj': new TextEncoder().encode('GEOGCS[]'),
    });
    const source = new TopologySource('t');
    const out = await callExtract(source, buf);
    expect(Object.keys(out).sort()).toEqual(['a.dbf', 'a.prj', 'a.shp']);
  });

  it('rejects duplicate basenames from different ZIP directories', async () => {
    const buf = zipSync({
      'a/roads.shp': new Uint8Array([1]),
      'b/ROADS.SHP': new Uint8Array([2]),
    });
    const source = new TopologySource('t');

    await expect(callExtract(source, buf)).rejects.toThrow(/duplicate basename.*roads\.shp/i);
  });

  it('rejects a ZIP whose compressed input exceeds maxCompressedBytes', async () => {
    const buf = zipSync({ 'a.shp': new Uint8Array([1, 2, 3]) });
    const source = new TopologySource('t', {
      zipLimits: { maxCompressedBytes: buf.byteLength - 1 },
    });

    await expect(callExtract(source, buf)).rejects.toThrow(/maxCompressedBytes/);
  });

  it('accepts a ZIP at the configured compressed-input boundary', async () => {
    const buf = zipSync({ 'a.shp': new Uint8Array([1, 2, 3]) });
    const source = new TopologySource('t', {
      zipLimits: { maxCompressedBytes: buf.byteLength },
    });

    await expect(callExtract(source, buf)).resolves.toHaveProperty('a.shp');
  });

  it('accepts a 201 MiB archive with the default maxBytes limit', async () => {
    const buf = zipSync({ 'large.shp': new Uint8Array(201 * 1024 * 1024) });
    const source = new TopologySource('t', {
      zipLimits: { maxRatio: Number.POSITIVE_INFINITY },
    });
    await expect(callExtract(source, buf)).resolves.toHaveProperty('large.shp');
  }, 15_000);

  it('throws when entry count exceeds maxEntries', async () => {
    const entries: Record<string, Uint8Array> = {};
    for (let i = 0; i < 12; i++) entries[`f${i}.shp`] = new Uint8Array([i]);
    const buf = zipSync(entries);
    const source = new TopologySource('t', { zipLimits: { maxEntries: 5 } });
    await expect(callExtract(source, buf)).rejects.toThrow(/maxEntries/);
  });

  it('rejects a declared uncompressed total above the default 2 GiB maxBytes', async () => {
    const buf = withDeclaredUncompressedSize(
      zipSync({ 'large.shp': new Uint8Array([1]) }),
      TWO_GIB + 1,
    );
    const source = new TopologySource('t', {
      zipLimits: { maxRatio: Number.POSITIVE_INFINITY },
    });

    await expect(callExtract(source, buf)).rejects.toThrow(`maxBytes ${TWO_GIB}`);
  });

  it('throws when uncompressed total exceeds maxBytes', async () => {
    const buf = zipSync({ 'big.shp': new Uint8Array(2048) });
    const source = new TopologySource('t', { zipLimits: { maxBytes: 1024 } });
    await expect(callExtract(source, buf)).rejects.toThrow(/maxBytes/);
  });

  it('throws when compression ratio exceeds maxRatio', async () => {
    // 100 KB of zeros compresses to a few hundred bytes — easily >100x ratio
    const buf = zipSync({ 'zeros.shp': new Uint8Array(100 * 1024) });
    const source = new TopologySource('t', { zipLimits: { maxRatio: 5 } });
    await expect(callExtract(source, buf)).rejects.toThrow(/maxRatio/);
  });

  it('user-supplied higher limits permit previously-rejected payloads', async () => {
    const entries: Record<string, Uint8Array> = {};
    for (let i = 0; i < 12; i++) entries[`f${i}.shp`] = new Uint8Array([i]);
    const buf = zipSync(entries);
    const source = new TopologySource('t', {
      zipLimits: { maxEntries: 100, maxRatio: 1000 },
    });
    const out = await callExtract(source, buf);
    expect(Object.keys(out)).toHaveLength(12);
  });
});

// ---------------------------------------------------------------------------
// setData race versioning
// ---------------------------------------------------------------------------

describe('TopologySource.setData — race versioning', () => {
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');

  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });

  it('superseded setData chain swallows its own data event', async () => {
    // Async runParsedCommands so the first call's resolution lands AFTER the
    // second setData supersedes it.
    let firstResolve: ((dataset: any) => void) | null = null;
    Reflect.set(
      mapshaper.internal as object,
      'parseCommands',
      vi.fn(() => [{ name: 'i', options: {} }]),
    );
    Reflect.set(
      mapshaper.internal as object,
      'runParsedCommands',
      vi.fn((_cmds: any[], _job: any, cb: any) => {
        // First call: defer; second call: resolve immediately with a marker.
        if (!firstResolve) {
          firstResolve = (dataset: any) =>
            cb(null, {
              catalog: { getDefaultTargets: () => [{ dataset }] },
            });
        } else {
          cb(null, {
            catalog: {
              getDefaultTargets: () => [{ dataset: { layers: [], info: { winner: 'B' } } }],
            },
          });
        }
      }),
    );

    const source = new TopologySource('t');
    const events: string[] = [];
    source.on('data', () => events.push(`data:${source.getDataset()?.info?.winner ?? '?'}`));
    source.on('error', () => events.push('error'));

    source.setData({ filename: 'a.geojson', content: new Uint8Array([1]) });
    source.setData({ filename: 'b.geojson', content: new Uint8Array([2]) });

    // Let the second chain resolve.
    await new Promise((r) => setTimeout(r, 0));
    // Now resolve the first (stale) chain — it must NOT fire data.
    firstResolve?.({ layers: [], info: { winner: 'A' } });
    await new Promise((r) => setTimeout(r, 0));

    expect(events).toEqual(['data:B']);
    expect(source.getDataset()?.info?.winner).toBe('B');
  });

  it('aborts the previous URL fetch when superseded', () => {
    const signals: AbortSignal[] = [];
    const fetchSpy = vi.fn((_url: string, opts: any) => {
      signals.push(opts.signal);
      // Never resolve — we only care about whether the signal aborts.
      return new Promise(() => {});
    });
    const originalFetch = (globalThis as any).fetch;
    (globalThis as any).fetch = fetchSpy;
    try {
      const source = new TopologySource('t');
      source.setData('http://example.com/a.json');
      source.setData('http://example.com/b.json');

      expect(signals).toHaveLength(2);
      expect(signals[0].aborted).toBe(true);
      expect(signals[1].aborted).toBe(false);
    } finally {
      (globalThis as any).fetch = originalFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// setData awaitable contract (Friction #9)
// ---------------------------------------------------------------------------

describe('TopologySource.setData — awaitable', () => {
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');

  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });

  it('resolves to the source only after the import completes', async () => {
    Reflect.set(
      mapshaper.internal as object,
      'parseCommands',
      vi.fn(() => [{ name: 'i', options: {} }]),
    );
    Reflect.set(
      mapshaper.internal as object,
      'runParsedCommands',
      vi.fn((_c: any[], _j: any, cb: any) => {
        cb(null, {
          catalog: {
            getDefaultTargets: () => [{ dataset: { layers: [{ name: 'L' }], info: {} } }],
          },
        });
      }),
    );

    const source = new TopologySource('await-ok');
    const ret = await source.setData({ filename: 'a.geojson', content: new Uint8Array([1]) });

    expect(ret).toBe(source);
    const layers = source.getLayers();
    expect(layers).toHaveLength(1);
    // getLayers() is typed MapshaperLayer[] — `.name` is reachable without
    // an `any` cast (compile-time guarantee + runtime shape check).
    expect(layers[0].name).toBe('L');
  });

  it('rejects when the import fails', async () => {
    Reflect.set(
      mapshaper.internal as object,
      'parseCommands',
      vi.fn(() => [{ name: 'i', options: {} }]),
    );
    Reflect.set(
      mapshaper.internal as object,
      'runParsedCommands',
      vi.fn((_c: any[], _j: any, cb: any) => {
        cb(new Error('boom'));
      }),
    );

    const source = new TopologySource('await-fail');
    await expect(
      source.setData({ filename: 'b.geojson', content: new Uint8Array([1]) }),
    ).rejects.toThrow('boom');
  });

  it('superseded call resolves early; the winner owns the loaded data', async () => {
    let firstResolve: ((dataset: any) => void) | null = null;
    Reflect.set(
      mapshaper.internal as object,
      'parseCommands',
      vi.fn(() => [{ name: 'i', options: {} }]),
    );
    Reflect.set(
      mapshaper.internal as object,
      'runParsedCommands',
      vi.fn((_c: any[], _j: any, cb: any) => {
        if (!firstResolve) {
          firstResolve = (dataset: any) =>
            cb(null, { catalog: { getDefaultTargets: () => [{ dataset }] } });
        } else {
          cb(null, {
            catalog: {
              getDefaultTargets: () => [{ dataset: { layers: [], info: { winner: 'B' } } }],
            },
          });
        }
      }),
    );

    const source = new TopologySource('await-race');
    const p1 = source.setData({ filename: 'a.geojson', content: new Uint8Array([1]) });
    const p2 = source.setData({ filename: 'b.geojson', content: new Uint8Array([2]) });

    await expect(p1).resolves.toBe(source); // superseded → resolves early, no throw
    await expect(p2).resolves.toBe(source);

    firstResolve?.({ layers: [], info: { winner: 'A' } });
    await new Promise((r) => setTimeout(r, 0));
    expect(source.getDataset()?.info?.winner).toBe('B'); // stale chain never overwrote
  });
});
describe('TopologySource point import', () => {
  it('loads GeoJSON Point data with point geometry, shapes, and finite extent', async () => {
    const geojson = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'a' },
          geometry: { type: 'Point', coordinates: [120, 30] },
        },
      ],
    };
    const source = new TopologySource('points');

    await source.setData({
      filename: 'points.geojson',
      content: new TextEncoder().encode(JSON.stringify(geojson)),
    });

    const layers = source.getLayers();
    expect(layers).toHaveLength(1);
    expect(layers[0].geometry_type).toBe('point');
    expect(layers[0].shapes?.[0]).toEqual([[120, 30]]);

    const extent = source.getExtent();
    expect(Number.isFinite(extent.xmin)).toBe(true);
    expect(Number.isFinite(extent.ymin)).toBe(true);
    expect(Number.isFinite(extent.xmax)).toBe(true);
    expect(Number.isFinite(extent.ymax)).toBe(true);
  });
});

describe('TopologySource format plugin routing', () => {
  let formats: FormatRegistry;
  beforeEach(() => {
    formats = new FormatRegistry();
  });
  afterEach(() => formats.dispose());
  const PLUGIN_DATASET = {
    layers: [{ name: 'plug', geometry_type: 'point' as const, shapes: [[[1, 2]]] }],
    arcs: undefined,
    info: {},
  };

  afterEach(() => {
    unregisterFormat(formats, 'test-plugin');
  });

  function registerTestPlugin() {
    const importBinary = vi.fn(async () => PLUGIN_DATASET);
    const exportHandler = vi.fn(async () => [
      { filename: 'out.parquet', content: new Uint8Array([1, 2, 3]) },
    ]);
    registerFormat(formats, {
      name: 'test-plugin',
      extensions: ['parquet', 'geoparquet', 'arrow', 'arrows', 'feather'],
      importBinary,
      exportFormats: {
        geoparquet: exportHandler,
        geoarrow: exportHandler,
        flatgeobuf: exportHandler,
      },
    });
    return { importBinary, exportHandler };
  }

  it('routes .parquet files to the registered plugin instead of mapshaper', async () => {
    const { importBinary } = registerTestPlugin();
    const source = new TopologySource('p', { formats });
    const content = new Uint8Array([0xde, 0xad]);
    await source.setData({ filename: 'data.parquet', content });
    expect(importBinary).toHaveBeenCalledWith(content, 'data.parquet');
    expect(source.getLayers()[0].name).toBe('plug');
  });

  it('normalizes GeoParquet plugin imports without changing GeoArrow routing', async () => {
    registerTestPlugin();
    const adapter = getDefaultMapshaperAdapter();
    const splitSpy = vi.spyOn(adapter, 'splitSelfIntersectingPolygonRings');
    try {
      const parquet = new TopologySource('parquet', { formats });
      await parquet.setData({
        filename: 'data.parquet',
        content: new Uint8Array([1]),
      });
      expect(splitSpy).toHaveBeenCalledOnce();
      expect(splitSpy).toHaveBeenCalledWith(PLUGIN_DATASET);

      splitSpy.mockClear();
      const arrow = new TopologySource('arrow', { formats });
      await arrow.setData({
        filename: 'data.arrow',
        content: new Uint8Array([1]),
      });
      expect(splitSpy).not.toHaveBeenCalled();
    } finally {
      splitSpy.mockRestore();
    }
  });

  it('throws a registration hint for plugin extensions when unregistered', async () => {
    const source = new TopologySource('p', { formats });
    await expect(
      source.setData({ filename: 'data.parquet', content: new Uint8Array([1]) }),
    ).rejects.toThrow(/@mapseekai\/emap\/arrow/);
  });

  it('rejects mixing plugin files with other inputs', async () => {
    registerTestPlugin();
    const source = new TopologySource('p', { formats });
    await expect(
      source.setData([
        { filename: 'a.parquet', content: new Uint8Array([1]) },
        { filename: 'b.geojson', content: new Uint8Array([1]) },
      ]),
    ).rejects.toThrow(/cannot be combined/);
  });

  it('exports plugin formats through the registered handler with correct MIME', async () => {
    const { exportHandler } = registerTestPlugin();
    const source = new TopologySource('p', { formats });
    setPrivate(source, '_dataset', FAKE_DATASET);
    const blob = await source.export({ format: 'geoparquet', encoding: 'wkb' });
    expect(exportHandler).toHaveBeenCalledWith(
      FAKE_DATASET,
      expect.objectContaining({ format: 'geoparquet', encoding: 'wkb' }),
    );
    expect(blob.type).toBe('application/vnd.apache.parquet');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('exports FlatGeobuf through the registered handler with its MIME type', async () => {
    const { exportHandler } = registerTestPlugin();
    const source = new TopologySource('p', { formats });
    setPrivate(source, '_dataset', FAKE_DATASET);
    const blob = await source.export({ format: 'flatgeobuf' as never });
    expect(exportHandler).toHaveBeenCalledWith(
      FAKE_DATASET,
      expect.objectContaining({ format: 'flatgeobuf' }),
    );
    expect(blob.type).toBe('application/x-flatgeobuf');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('throws a registration hint for geoparquet export when unregistered', async () => {
    const source = new TopologySource('p', { formats });
    setPrivate(source, '_dataset', FAKE_DATASET);
    await expect(source.export({ format: 'geoparquet' })).rejects.toThrow(
      /@mapseekai\/emap\/arrow/,
    );
  });

  it('throws a FlatGeobuf plugin hint when export is unregistered', async () => {
    const source = new TopologySource('p', { formats });
    setPrivate(source, '_dataset', FAKE_DATASET);
    await expect(source.export({ format: 'flatgeobuf' as never })).rejects.toThrow(
      /FlatGeobuf format plugin/,
    );
  });
});
