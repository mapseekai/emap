import { describe, expect, it } from 'vitest';
import { TopologySource } from '../../../src/domain/source/topology-source';
import { asMutableTopologySource } from '../../../src/domain/source/source';
import { FeatureTranslateCommand } from '../../../src/domain/edit/commands/feature-translate';
import { exportSnapshotFromSources, unpackSnapshot } from '../../../src/engine/map/snapshot';
import { AffineTransform } from '../../../src/domain/geo/transform';
import { getDefaultMapshaperAdapter } from '../../../src/integrations/mapshaper/adapter';
import { PointLod } from '../../../src/engine/rendering/point-lod';
import type { MapshaperDataset } from '../../../src/shared/types/mapshaper-types';

function fixture() {
  const dataset: MapshaperDataset = {
    layers: [
      {
        name: 'points',
        geometry_type: 'point',
        shapes: Array.from({ length: 20_000 }, (_, id) => [[id === 0 ? 1 : 7, 1]]),
        data: getDefaultMapshaperAdapter().createDataTable(
          Array.from({ length: 20_000 }, (_, id) => ({ id })),
        ),
      },
    ],
    info: { crs_string: 'EPSG:4326' },
  };
  const source = new TopologySource('s');
  source.setDataset(dataset);
  const lod = new PointLod();
  const query = () =>
    lod.query(
      { id: 'dots', source: 's', type: 'circle' },
      dataset.layers[0],
      dataset,
      null,
      new AffineTransform(),
      [0, 0, 8, 8],
    );
  return { dataset, source, query };
}

describe('point LOD data and editing contracts', () => {
  it('preserves original point geometry and records through GeoJSON and source-only MSX export', async () => {
    const { dataset, source, query } = fixture();
    const before = JSON.stringify(dataset.layers[0].shapes);
    expect(query()!.featureIds).toHaveLength(1);
    const json = JSON.parse(await (await source.export({ format: 'geojson' })).text());
    expect(json.features).toHaveLength(20_000);
    expect(json.features[1].geometry.coordinates).toEqual([7, 1]);
    expect(json.features[1].properties.id).toBe(1);
    const snapshot = await exportSnapshotFromSources(
      new Map([['s', asMutableTopologySource(source)]]),
      { compact: false },
    );
    const restored = await unpackSnapshot(snapshot);
    expect(restored.resolvedIds).toEqual(['s']);
    expect(JSON.stringify(restored.datasets[0].layers[0].shapes)).toBe(before);
    expect(restored.datasets[0].layers[0].data!.getRecords()[1].id).toBe(1);
    expect(JSON.stringify(dataset.layers[0].shapes)).toBe(before);
  });

  it('reselects representatives after a real translation command, undo and redo', () => {
    const { dataset, source, query } = fixture();
    expect(query()!.featureIds).toEqual(new Uint32Array([0]));
    const command = new FeatureTranslateCommand({
      source,
      dx: 40,
      dy: 40,
      arcIds: [],
      pointFeatures: [{ layer: dataset.layers[0], featureId: 0 }],
    });
    command.do();
    expect(query()!.featureIds).toEqual(new Uint32Array([1]));
    command.undo();
    expect(query()!.featureIds).toEqual(new Uint32Array([0]));
    command.do();
    expect(query()!.featureIds).toEqual(new Uint32Array([1]));
    expect(dataset.layers[0].shapes).toHaveLength(20_000);
  });
});
