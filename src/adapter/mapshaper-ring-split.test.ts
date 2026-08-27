import { describe, expect, it } from 'vitest';
import { getDefaultMapshaperAdapter } from './mapshaper-adapter';
import type { MapshaperDataset, PathShape } from '../types/mapshaper-types';

const adapter = getDefaultMapshaperAdapter();

type RingSplitterAdapter = typeof adapter & {
  splitSelfIntersectingPolygonRings(dataset: MapshaperDataset): void;
};

async function pinchedPolygonDataset(): Promise<MapshaperDataset> {
  // One Shapefile-style pinched ring: the path enters a tangent hole at
  // (10,5), returns to the same vertex, then resumes the exterior shell.
  // It represents one shell plus one hole but arrives as a single part.
  const ring = [
    [0, 0],
    [10, 0],
    [10, 5],
    [8, 5],
    [8, 7],
    [10, 5],
    [10, 10],
    [0, 10],
    [0, 0],
  ];
  return adapter.runImport('-i "pinched.geojson"', {
    'pinched.geojson': JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'pinched' },
          geometry: { type: 'Polygon', coordinates: [ring] },
        },
      ],
    }),
  });
}

async function polygonDatasetFromRing(ring: number[][]): Promise<MapshaperDataset> {
  return adapter.runImport('-i "self-touching.geojson"', {
    'self-touching.geojson': JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'self-touching' },
          geometry: { type: 'Polygon', coordinates: [ring] },
        },
      ],
    }),
  });
}

describe('MapshaperAdapter.splitSelfIntersectingPolygonRings', () => {
  it('restores a tangent hole embedded in one self-touching Shapefile ring', async () => {
    const dataset = await pinchedPolygonDataset();
    const shape = dataset.layers[0]!.shapes![0] as PathShape;
    expect(shape).toHaveLength(1);

    (adapter as RingSplitterAdapter).splitSelfIntersectingPolygonRings(dataset);

    expect(shape).toHaveLength(2);
    const areas = adapter
      .exportPathData(shape, dataset.arcs!, 'polygon')
      .pathData.map((path) => Math.sign(path.area ?? 0));
    expect(areas).toEqual([1, -1]);
  });

  it('preserves non-contained opposite-winding lobes as separate exteriors', async () => {
    // Two non-contained lobes share (0,0). The larger positive lobe makes the
    // original part an exterior; after splitting, the negative lobe must be
    // reversed to another exterior instead of becoming an orphan hole that
    // mapshaper drops on polygon export.
    const dataset = await polygonDatasetFromRing([
      [0, 0],
      [3, 0],
      [3, 3],
      [0, 3],
      [0, 0],
      [0, -2],
      [-2, -2],
      [-2, 0],
      [0, 0],
    ]);
    const shape = dataset.layers[0]!.shapes![0] as PathShape;
    expect(shape).toHaveLength(1);

    (adapter as RingSplitterAdapter).splitSelfIntersectingPolygonRings(dataset);

    expect(shape).toHaveLength(2);
    const signs = adapter
      .exportPathData(shape, dataset.arcs!, 'polygon')
      .pathData.map((path) => Math.sign(path.area ?? 0));
    expect(signs).toEqual([1, 1]);
  });
});
