import { tableFromIPC } from 'apache-arrow';
import { createTestMap, fixtureSet } from '../../../test/utils/plugin-test-map';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerArrowFormats } from './index';
import { setArrowTable, toArrowTableFromSource } from './index';
import {
  FormatRegistry,
  getExportHandler,
  getFormatForExtension,
} from '../../domain/source/format-registry';
import { TopologySource } from '../../domain/source/topology-source';
import { datasetFromGeoJSON } from '../../../test/utils/arrow';
import { toArrowTable } from './dataset-to-table';
import { Emap } from '../../engine/map/map';
import { Selection } from '../../engine/map/selection';
import { EditHistory } from '../../domain/edit/edit-history';
function setPrivate(target: object, key: string, value: unknown): void {
  fixtureSet(target, key, value);
}
async function createBareMap(crs: string): Promise<Emap> {
  const map: Emap = await createTestMap();
  const projection = {
    crs,
    setCRS(nextCrs: string) {
      this.crs = nextCrs;
    },
  };
  setPrivate(map, '_sources', new globalThis.Map());
  setPrivate(map, '_sourceListeners', new globalThis.Map());
  setPrivate(map, '_layers', []);
  setPrivate(map, '_effectiveLayersCache', []);
  setPrivate(map, '_defaultLayersDirty', false);
  setPrivate(map, '_layerArcIdsCache', new globalThis.Map());
  setPrivate(map, '_listeners', {});
  setPrivate(map, '_selection', new Selection());
  setPrivate(map, '_history', new EditHistory());
  setPrivate(map, '_scheduleRender', vi.fn());
  setPrivate(map, '_projection', projection);
  setPrivate(map, '_viewport', { setCRS: vi.fn() });
  setPrivate(map, '_crsEstablished', true);
  return map;
}
async function pointDataset(coordinates: readonly [number, number], crs?: string) {
  const dataset = await datasetFromGeoJSON({
    type: 'Feature',
    properties: {},
    geometry: { type: 'Point', coordinates },
  });
  if (crs) dataset.info = { ...dataset.info, crs_string: crs };
  return dataset;
}
describe('Arrow module registration', () => {
  let formats: FormatRegistry;
  beforeEach(() => {
    formats = new FormatRegistry();
    registerArrowFormats(formats);
  });
  afterEach(() => formats.dispose());
  it.each([
    'setDataset',
    'replaceDataset',
  ] as const)('invalidates cached exports when %s recommits the same edited dataset', async (method) => {
    const dataset = await datasetFromGeoJSON({
      type: 'Feature',
      properties: { id: 1 },
      geometry: { type: 'Point', coordinates: [3, 4] },
    });
    const source = new TopologySource('same-object', { formats });
    source.setDataset(dataset);
    await source.export({ format: 'geoarrow' });
    dataset.layers[0].data!.getRecords!()[0].id = 2;
    await source[method](dataset);
    const blob = await source.export({ format: 'geoarrow' });
    expect(
      tableFromIPC(new Uint8Array(await blob.arrayBuffer()))
        .getChild('id')!
        .get(0),
    ).toBe(2);
  });

  it('registers import handling for all plugin extensions', () => {
    for (const ext of ['parquet', 'geoparquet', 'arrow', 'arrows', 'feather']) {
      expect(getFormatForExtension(formats, ext)?.name).toBe('geoarrow-formats');
    }
  });
  it('registers geoparquet and geoarrow export handlers', () => {
    expect(getExportHandler(formats, 'geoparquet')).toBeTypeOf('function');
    expect(getExportHandler(formats, 'geoarrow')).toBeTypeOf('function');
  });
  it('TopologySource accepts .arrow bytes end-to-end after registration', async () => {
    const dataset = await datasetFromGeoJSON({
      type: 'Feature',
      properties: { name: 'roundtrip' },
      geometry: { type: 'Point', coordinates: [100, 50] },
    });
    const source = new TopologySource('a', { formats });
    const { exportGeoArrow } = await import('./geoarrow-io');
    await source.setData({ filename: 'data.arrow', content: exportGeoArrow(dataset) });
    expect(source.getLayers()[0].geometry_type).toBe('point');
    expect(source.getLayers()[0].name).toBe('data');
    const blob = await source.export({ format: 'geoarrow' });
    expect(blob.type).toBe('application/vnd.apache.arrow.file');
    expect(blob.size).toBeGreaterThan(0);
  });
  it('setArrowTable / toArrowTableFromSource bridge in-memory tables', async () => {
    const dataset = await datasetFromGeoJSON({
      type: 'Feature',
      properties: { id: 9 },
      geometry: { type: 'Point', coordinates: [1, 2] },
    });
    const source = new TopologySource('mem');
    await source.setData({
      filename: 'seed.geojson',
      content: new TextEncoder().encode(
        JSON.stringify({ type: 'FeatureCollection', features: [] }),
      ),
    });
    const table = toArrowTable(dataset);
    await setArrowTable(source, table);
    expect(source.getLayers()[0].shapes![0]).toEqual([[1, 2]]);
    const back = toArrowTableFromSource(source);
    expect(back.numRows).toBe(1);
    expect(back.getChild('id')!.get(0)).toBe(9);
  });
  it('setArrowTable rejects a source without the internal mutation contract', async () => {
    const dataset = await datasetFromGeoJSON({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [1, 2] },
    });
    const table = toArrowTable(dataset);
    const source = new TopologySource('readonly');
    Reflect.set(source, 'replaceDataset', undefined);
    Reflect.set(source, 'setDataset', undefined);
    await expect(setArrowTable(source, table)).rejects.toThrow(
      'setArrowTable requires a mutable TopologySource',
    );
  });
  it('keeps the legacy mutable-hook fallback for detached custom sources', async () => {
    const incoming = await pointDataset([1, 2], 'EPSG:4326');
    const source = new TopologySource('detached-custom');
    Reflect.set(source, 'replaceDataset', undefined);
    const setDataset = vi.spyOn(source, 'setDataset');
    await setArrowTable(source, toArrowTable(incoming));
    expect(setDataset).toHaveBeenCalledOnce();
    expect(source.getLayers()[0].shapes?.[0]).toEqual([[1, 2]]);
    const map = await createBareMap('EPSG:4326');
    await expect(map.addSource('detached-custom', source)).rejects.toMatchObject({
      code: 'source-load-rejected',
    });
  });
  it('normalizes an Arrow table to the owning map CRS before committing it', async () => {
    const map = await createBareMap('EPSG:3857');
    const source = new TopologySource('managed');
    const previous = await pointDataset([0, 0], 'EPSG:3857');
    source.setDataset(previous);
    await map.addSource('managed', source);
    const incoming = await pointDataset([1, 2], 'EPSG:4326');
    await setArrowTable(source, toArrowTable(incoming));
    expect(source.getCRS()).toBe('EPSG:3857');
    expect(source.getLayers()[0].shapes?.[0]).toEqual([
      [expect.closeTo(111319.49, 2), expect.closeTo(222684.21, 2)],
    ]);
  });
  it('keeps the previous dataset when the owning map rejects the final commit', async () => {
    const source = new TopologySource('managed');
    const previous = await pointDataset([0, 0]);
    const incoming = await pointDataset([1, 2]);
    source.setDataset(previous);
    source.setDatasetNormalizer(async (dataset) => ({
      dataset,
      assertCommittable: () => {
        throw new Error('Map CRS changed during source normalization for "managed"');
      },
    }));
    await expect(setArrowTable(source, toArrowTable(incoming))).rejects.toThrow(
      'Map CRS changed during source normalization',
    );
    expect(source.getDataset()).toBe(previous);
  });
  it('rejects an Arrow replacement when the live dataset changes during normalization', async () => {
    const source = new TopologySource('managed');
    const previous = await pointDataset([0, 0]);
    const incoming = await pointDataset([1, 2]);
    const superseding = await pointDataset([3, 4]);
    source.setDataset(previous);
    let releaseNormalizer = () => {};
    const normalizerGate = new Promise<void>((resolve) => {
      releaseNormalizer = resolve;
    });
    source.setDatasetNormalizer(async (dataset) => {
      await normalizerGate;
      return dataset;
    });
    const replacement = setArrowTable(source, toArrowTable(incoming));
    source.setDataset(superseding);
    releaseNormalizer();
    await expect(replacement).rejects.toThrow(
      'TopologySource "managed" changed during dataset replacement',
    );
    expect(source.getDataset()).toBe(superseding);
  });
});
