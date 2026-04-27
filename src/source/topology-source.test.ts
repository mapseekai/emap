import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mapshaper from 'mapshaper';
import { unzipSync, strFromU8 } from 'fflate';
import { TopologySource } from './topology-source';

function setPrivate(target: object, key: string, value: unknown): void {
  Reflect.set(target, key, value);
}

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
    const exportSpy = vi.fn(() => [{ filename: 'lyr.json', content: '{"type":"FeatureCollection","features":[]}' }]);
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
      vi.fn(() => { throw new Error('boom'); }),
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
});

describe('TopologySource.setData multi-file', () => {
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');

  let parseCommandsSpy: ReturnType<typeof vi.fn>;
  let runParsedCommandsSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    parseCommandsSpy = vi.fn((_cmd: string) => [
      { name: 'i', options: {} },
    ]);
    runParsedCommandsSpy = vi.fn((commands: any[], _job: any, cb: any) => {
      cb(null, {
        catalog: {
          getDefaultTargets: () => [{
            // Echo back the inputFiles so the test can assert on them
            dataset: { layers: [], info: { _injected: commands[0]?.options?.input } },
          }],
        },
      });
    });
    Reflect.set(mapshaper.internal as object, 'parseCommands', parseCommandsSpy);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', runParsedCommandsSpy);
  });

  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
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
    source.setData([
      { filename: 'we"ird.geojson', content: new Uint8Array([1]) },
    ]);
    await new Promise((r) => setTimeout(r, 0));
    const cmd = parseCommandsSpy.mock.calls[0][0] as string;
    expect(cmd).toBe('-i "we\\"ird.geojson"');
  });

  it('empty array is a no-op (no command runs)', async () => {
    const source = new TopologySource('test');
    source.setData([]);
    await new Promise((r) => setTimeout(r, 0));
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });
});
