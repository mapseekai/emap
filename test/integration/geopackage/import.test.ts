import { describe, expect, it, vi } from 'vitest';
import { importGeoPackage } from '../../../src/integrations/geopackage/import';
import { geoPackagePlugin } from '../../../src/integrations/geopackage/plugin';
import {
  restoreGeoPackageDataset,
  transferGeoPackageDataset,
} from '../../../src/integrations/geopackage/transfer';
import { getDefaultMapshaperAdapter } from '../../../src/integrations/mapshaper/adapter';
import { Emap } from '../../../src/engine/map/map';
import { TopologySource } from '../../../src/domain/source/topology-source';
import {
  collection,
  fixtureGeoPackage,
  gpkg,
  line,
  polygon,
  testGeoPackageWasmUrl,
  wkb,
} from '../../utils/geopackage';

const shell = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
  [0, 0],
];
const hole = [
  [1, 1],
  [1, 2],
  [2, 2],
  [2, 1],
  [1, 1],
];
const row = (geometry: Uint8Array | null, name = 'sample') => ({ geometry, values: { name } });

async function multiple() {
  return fixtureGeoPackage([
    {
      name: 'areas',
      type: 'MULTIPOLYGON',
      rows: [
        row(
          gpkg(
            collection(6, [polygon([shell, hole]), polygon([shell.map(([x, y]) => [x + 10, y])])]),
          ),
        ),
      ],
    },
    {
      name: 'roads',
      type: 'LINESTRING',
      rows: [
        row(
          gpkg(
            line([
              [0, 0],
              [4, 0],
            ]),
          ),
        ),
      ],
    },
    {
      name: 'points',
      type: 'POINT',
      columns: { active: 'BOOLEAN', payload: 'BLOB', large: 'INTEGER' },
      rows: [
        {
          id: 9223372036854775807n,
          geometry: gpkg(wkb(1, [120.1234567890123, 30.1234567890123])),
          values: {
            name: '精确点',
            active: 1,
            payload: new Uint8Array([0, 255]),
            large: 9223372036854775806n,
          },
        },
        row(null, 'null geometry'),
        row(gpkg(wkb(1, [NaN, NaN]), 4326, 0, true, true), 'empty geometry'),
      ],
    },
    { name: 'empty_lines', type: 'LINESTRING', columns: { code: 'INTEGER' }, rows: [] },
  ]);
}
const options = async () => ({ wasmUrl: await testGeoPackageWasmUrl() });

describe('direct SQLite/WKB to one mapshaper dataset', () => {
  it('preserves all vector layers, null rows, full precision and attributes, excluding rasters', async () => {
    const bytes = await multiple();
    const adapter = getDefaultMapshaperAdapter();
    const importContent = vi.spyOn(adapter, 'createPathImporter').mockImplementation(() => {
      throw new Error('Nested-coordinate PathImporter is forbidden');
    });
    let data;
    try {
      data = await importGeoPackage(bytes, await options());
    } finally {
      importContent.mockRestore();
    }
    expect(data.layers.map((layer) => layer.name)).toEqual([
      'areas',
      'empty_lines',
      'points',
      'roads',
    ]);
    expect(data.info.crs_string).toBe('EPSG:4326');
    expect(data.info.input_formats).toEqual(['geopackage']);
    expect(data.arcs?.getVertexData?.().xx).toBeInstanceOf(Float64Array);
    expect(data.arcs?.getVertexData?.().yy).toBeInstanceOf(Float64Array);
    const points = data.layers.find((layer) => layer.name === 'points')!;
    // Stable primary-key order: ordinary ids precede the 64-bit id.
    expect(points.shapes).toEqual([null, null, [[120.1234567890123, 30.1234567890123]]]);
    expect(points.data?.getRecords?.()[2]).toMatchObject({
      fid: '9223372036854775807',
      large: '9223372036854775806',
      name: '精确点',
      active: true,
      payload: new Uint8Array([0, 255]),
    });
    expect(data.layers[1].geometry_type).toBe('polyline');
    expect(data.layers[1].data?.getFields?.()).toEqual(['fid', 'name', 'code']);
    expect(data.info.geopackage.tables).toHaveLength(4);
  });
  it('constructs shared-arc topology across different tables and normalizes hole winding', async () => {
    const data = await importGeoPackage(await multiple(), await options());
    const area = data.layers.find((layer) => layer.name === 'areas')!;
    const road = data.layers.find((layer) => layer.name === 'roads')!;
    const shape = area.shapes![0] as number[][];
    expect(shape).toHaveLength(3);
    const roadArcs = (road.shapes![0] as number[][]).flat().map((id) => (id < 0 ? ~id : id));
    expect(shape[0].some((id) => roadArcs.includes(id < 0 ? ~id : id))).toBe(true);
    const paths = getDefaultMapshaperAdapter().exportPathData(
      shape,
      data.arcs!,
      'polygon',
    ).pathData;
    expect(paths.filter((path) => (path.area ?? 0) > 0)).toHaveLength(2);
    expect(paths.filter((path) => (path.area ?? 0) < 0)).toHaveLength(1);
  });
  it('selects multiple named layers in the requested order without splitting the dataset', async () => {
    const data = await importGeoPackage(await multiple(), {
      ...(await options()),
      layers: ['roads', 'points'],
    });
    expect(data.layers.map((layer) => layer.name)).toEqual(['roads', 'points']);
    await expect(
      importGeoPackage(await multiple(), { ...(await options()), layers: ['missing'] }),
    ).rejects.toThrow('not found');
  });
  it('normalizes mixed CRS instead of relabeling coordinates', async () => {
    const bytes = await fixtureGeoPackage([
      { name: 'geographic', type: 'POINT', rows: [row(gpkg(wkb(1, [1, 1])))] },
      {
        name: 'projected',
        type: 'POINT',
        srs: 3857,
        rows: [row(gpkg(wkb(1, [111319.49079327357, 111325.1428663851]), 3857))],
      },
    ]);
    const data = await importGeoPackage(bytes, await options());
    const point = (data.layers[1].shapes![0] as number[][])[0];
    expect(point[0]).toBeCloseTo(1, 10);
    expect(point[1]).toBeCloseTo(1, 10);
    expect(data.info.geopackage.tables[1].sourceCrs).toBe('EPSG:3857');
    const projected = await importGeoPackage(bytes, {
      ...(await options()),
      targetCrs: 'EPSG:3857',
    });
    expect((projected.layers[0].shapes![0] as number[][])[0][0]).toBeCloseTo(111319.49079327357, 6);
  });
  it('refuses undefined/known CRS mixtures unless explicit source overrides are supplied', async () => {
    const bytes = await fixtureGeoPackage([
      { name: 'a', type: 'POINT', srs: 0, rows: [row(gpkg(wkb(1, [1, 1]), 0))] },
      { name: 'b', type: 'POINT', rows: [row(gpkg(wkb(1, [1, 1])))] },
    ]);
    await expect(importGeoPackage(bytes, await options())).rejects.toThrow('CRS');
    expect(
      (await importGeoPackage(bytes, { ...(await options()), sourceCrs: { a: 'EPSG:4326' } }))
        .layers,
    ).toHaveLength(2);
  });
  it('splits mixed collection families without losing their source row or null attributes', async () => {
    const bytes = await fixtureGeoPackage([
      {
        name: 'mixed',
        type: 'GEOMETRY',
        rows: [
          row(
            gpkg(
              collection(7, [
                wkb(1, [1, 2]),
                line([
                  [0, 0],
                  [1, 1],
                ]),
                polygon([shell]),
              ]),
            ),
          ),
          row(null),
        ],
      },
    ]);
    const data = await importGeoPackage(bytes, await options());
    expect(data.layers.map((layer) => layer.name)).toEqual([
      'mixed__point',
      'mixed__polyline',
      'mixed__polygon',
      'mixed__null',
    ]);
    expect(data.layers.map((layer) => layer.data?.getRecords?.()[0].fid)).toEqual([1, 1, 1, 2]);
    expect(data.layers[0].data?.getRecords?.()[0]).not.toBe(data.layers[1].data?.getRecords?.()[0]);
  });
  it('keeps XY for Z/M input and records the dimension reduction', async () => {
    const bytes = await fixtureGeoPackage([
      { name: 'z', type: 'POINT', rows: [row(gpkg(wkb(3001, [1, 2, 3, 4])))] },
    ]);
    const data = await importGeoPackage(bytes, await options());
    expect(data.layers[0].shapes).toEqual([[[1, 2]]]);
    expect(data.info.geopackage.tables[0]).toMatchObject({ hasZ: true, hasM: true });
  });
  it('handles quoted identifiers, reserved fields and rehydrates transferable native structures', async () => {
    const bytes = await fixtureGeoPackage([
      {
        name: 'odd " table',
        type: 'POINT',
        columns: { ['__proto__']: 'TEXT' },
        rows: [{ geometry: gpkg(wkb(1, [1, 2])), values: JSON.parse('{"__proto__":"safe"}') }],
      },
    ]);
    const data = await importGeoPackage(bytes, await options());
    const restored = restoreGeoPackageDataset(structuredClone(transferGeoPackageDataset(data)));
    expect(restored.layers[0].shapes).toEqual([[[1, 2]]]);
    expect(Object.hasOwn(restored.layers[0].data?.getRecords?.()[0] ?? {}, '__proto__')).toBe(true);
    expect(({} as Record<string, unknown>).safe).toBeUndefined();
  });
  it('enforces resource limits and does not publish partial results after cancellation', async () => {
    const bytes = await multiple();
    await expect(
      importGeoPackage(bytes, { ...(await options()), limits: { maxInputBytes: 10 } }),
    ).rejects.toThrow('input byte');
    await expect(
      importGeoPackage(bytes, { ...(await options()), limits: { maxDecodedBytes: 8 } }),
    ).rejects.toThrow('coordinate budget');
    await expect(
      importGeoPackage(bytes, { ...(await options()), limits: { maxFeatures: 1 } }),
    ).rejects.toThrow('feature limit');
    const controller = new AbortController();
    await expect(
      importGeoPackage(bytes, {
        ...(await options()),
        signal: controller.signal,
        onProgress: () => controller.abort(),
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect((await importGeoPackage(bytes, await options())).layers).toHaveLength(4);
  });
  it('retains an empty editable ArcCollection for path-only empty tables', async () => {
    const bytes = await fixtureGeoPackage([{ name: 'empty', type: 'POLYGON', rows: [] }]);
    const data = await importGeoPackage(bytes, await options());
    expect(data.layers[0].geometry_type).toBe('polygon');
    expect(data.layers[0].shapes).toEqual([]);
    expect(data.arcs?.size()).toBe(0);
  });
  it('does not start topology after cancellation from the topology progress callback', async () => {
    const bytes = await multiple();
    const controller = new AbortController();
    const build = vi.spyOn(getDefaultMapshaperAdapter(), 'buildTopology');
    try {
      await expect(
        importGeoPackage(bytes, {
          ...(await options()),
          signal: controller.signal,
          onProgress: (event) => {
            if (event.phase === 'topology') controller.abort();
          },
        }),
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(build).not.toHaveBeenCalled();
    } finally {
      build.mockRestore();
    }
  });
  it('rejects malformed geometry and tile-only files instead of silently dropping data', async () => {
    const bad = gpkg(wkb(1, [1, 2]));
    bad[0] = 0;
    await expect(
      importGeoPackage(
        await fixtureGeoPackage([{ name: 'bad', type: 'POINT', rows: [row(bad)] }]),
        await options(),
      ),
    ).rejects.toThrow('bad, row 1');
    await expect(importGeoPackage(await fixtureGeoPackage([]), await options())).rejects.toThrow(
      'no selected vector',
    );
  });
  it('registers and revokes the format with a native Cordis Fiber and loads all source layers', async () => {
    const map = await Emap.create({ preset: 'headless' });
    try {
      const fiber = map.ctx.plugin(geoPackagePlugin(await options()));
      await fiber.await();
      const source = new TopologySource('gpkg', { formats: map.formats });
      await source.setData({ filename: 'multi.gpkg', content: await multiple() });
      await map.addSource('gpkg', source);
      expect(source.getLayers()).toHaveLength(4);
      expect(source.getDataset()?.info?.input_files).toEqual(['multi.gpkg']);
      await fiber.dispose();
      expect(map.formats.getFormatForExtension('gpkg')).toBeUndefined();
    } finally {
      await map.dispose();
    }
  });
  it('cancels an in-flight source import when the native format Fiber is disposed', async () => {
    const bytes = await multiple();
    const map = await Emap.create({ preset: 'headless' });
    const fiber = map.ctx.plugin(
      geoPackagePlugin({
        ...(await options()),
        onProgress() {
          void fiber.dispose();
        },
      }),
    );
    try {
      await fiber.await();
      const source = new TopologySource('cancelled', { formats: map.formats });
      await expect(
        source.setData({ filename: 'multi.gpkg', content: bytes }),
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(source.getDataset()).toBeUndefined();
      await fiber.dispose();
      expect(map.formats.getFormatForExtension('gpkg')).toBeUndefined();
    } finally {
      await map.dispose();
    }
  });
});
