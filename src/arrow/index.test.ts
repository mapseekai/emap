import { describe, expect, it } from 'vitest';
import './index'; // module side effect registers the plugin
import { setArrowTable, toArrowTableFromSource } from './index';
import { getExportHandler, getFormatForExtension } from '../source/format-registry';
import { TopologySource } from '../source/topology-source';
import { datasetFromGeoJSON } from './test-utils';

describe('Arrow module registration', () => {
  it('registers import handling for all plugin extensions', () => {
    for (const ext of ['parquet', 'geoparquet', 'arrow', 'arrows', 'feather']) {
      expect(getFormatForExtension(ext)?.name).toBe('geoarrow-formats');
    }
  });

  it('registers geoparquet and geoarrow export handlers', () => {
    expect(getExportHandler('geoparquet')).toBeTypeOf('function');
    expect(getExportHandler('geoarrow')).toBeTypeOf('function');
  });

  it('TopologySource accepts .arrow bytes end-to-end after registration', async () => {
    const dataset = await datasetFromGeoJSON({
      type: 'Feature',
      properties: { name: 'roundtrip' },
      geometry: { type: 'Point', coordinates: [100, 50] },
    });
    const source = new TopologySource('a');
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

    const table = (await import('./dataset-to-table')).toArrowTable(dataset);
    setArrowTable(source, table);
    expect(source.getLayers()[0].shapes![0]).toEqual([[1, 2]]);

    const back = toArrowTableFromSource(source);
    expect(back.numRows).toBe(1);
    expect(back.getChild('id')!.get(0)).toBe(9);
  });
});
