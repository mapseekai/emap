import { describe, expect, it } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { TopologySource } from '../../../src/domain/source/topology-source';

async function shapefile(name: string, x: number): Promise<Record<string, Uint8Array>> {
  const source = new TopologySource(name);
  await source.setData({
    filename: `${name}.geojson`,
    content: strToU8(
      JSON.stringify({
        type: 'Feature',
        properties: { label: name },
        geometry: {
          type: 'LineString',
          coordinates: [
            [x, 0],
            [x + 1, 1],
          ],
        },
      }),
    ),
  });
  return unzipSync(
    new Uint8Array(await (await source.export({ format: 'shapefile' })).arrayBuffer()),
  );
}

describe('ZIP Shapefile import', () => {
  it.each([
    false,
    true,
  ])('keeps independent layers in one dataset (array input: %s)', async (arrayInput) => {
    const first = await shapefile('roads', 0);
    const second = await shapefile('rivers', 10);
    const source = new TopologySource('archive');
    const input = { filename: 'layers.zip', content: zipSync({ ...first, ...second }) };
    await source.setData(arrayInput ? [input] : input);
    const dataset = source.getDataset()!;
    expect(dataset.layers.map((layer) => layer.name)).toEqual(['roads', 'rivers']);
    expect(dataset.layers.map((layer) => layer.data?.getRecords())).toEqual([
      [{ label: 'roads' }],
      [{ label: 'rivers' }],
    ]);
    expect(dataset.layers.map((layer) => layer.shapes?.length)).toEqual([1, 1]);
    expect(dataset.arcs!.size()).toBe(2);
    expect(dataset.arcs!.toArray()).toEqual([
      [
        [0, 0],
        [1, 1],
      ],
      [
        [10, 0],
        [11, 1],
      ],
    ]);
    expect(dataset.layers[0].shapes).not.toEqual(dataset.layers[1].shapes);
  });

  it.each([
    false,
    true,
  ])('uses the first available CRS and ignores later PRJs (first missing: %s)', async (missingFirst) => {
    const first = await shapefile('roads', 0);
    const second = await shapefile('rivers', 10);
    const third = await shapefile('rails', 20);
    if (missingFirst) delete first['roads.prj'];
    third['rails.prj'] = strToU8('invalid later projection must not be parsed');
    const source = new TopologySource('archive');
    await source.setData({
      filename: 'layers.zip',
      content: zipSync({ ...first, ...second, ...third }),
    });
    expect(source.getLayers()).toHaveLength(3);
    expect(source.getCRS()).toBe('EPSG:4326');
  });

  it('ignores non-Shapefile entries and rejects archives without SHP data', async () => {
    const files = await shapefile('roads', 0);
    const source = new TopologySource('archive');
    const junk = { 'a/info.json': strToU8('invalid'), 'b/info.json': strToU8('invalid') };
    await source.setData({ filename: 'layers.zip', content: zipSync({ ...files, ...junk }) });
    expect(source.getLayers().map((layer) => layer.name)).toEqual(['roads']);
    await expect(
      source.setData({
        filename: 'no-shapes.zip',
        content: zipSync({ 'data.geojson': strToU8('{"type":"Point","coordinates":[0,0]}') }),
      }),
    ).rejects.toThrow(/No .*shapefile/i);
  });

  it('takes CRS from SHP order even when PRJ entries have a different order', async () => {
    const first = await shapefile('roads', 0);
    const second = await shapefile('rivers', 10);
    const prj = first['roads.prj'];
    delete first['roads.prj'];
    delete second['rivers.prj'];
    const source = new TopologySource('archive');
    await source.setData({
      filename: 'layers.zip',
      content: zipSync({
        'rivers.PRJ': strToU8('invalid later CRS'),
        ...first,
        ...second,
        'roads.PRJ': prj,
      }),
    });
    expect(source.getCRS()).toBe('EPSG:4326');
    expect(source.getLayers().map((layer) => layer.name)).toEqual(['roads', 'rivers']);
  });

  it('imports all layers when no PRJ is present', async () => {
    const first = await shapefile('roads', 0);
    const second = await shapefile('rivers', 10);
    delete first['roads.prj'];
    delete second['rivers.prj'];
    const source = new TopologySource('archive');
    await source.setData({ filename: 'layers.zip', content: zipSync({ ...first, ...second }) });
    expect(source.getLayers()).toHaveLength(2);
    expect(source.getDataset()!.info?.prj).toBeUndefined();
  });
});
