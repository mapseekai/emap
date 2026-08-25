import { describe, expect, it } from 'vitest';
import { getDefaultMapshaperAdapter } from './mapshaper-adapter';
import type { ArcCollection, MapshaperDataset, PathShape } from '../types/mapshaper-types';

const FIXTURE_NAME = 'split-primitives.geojson';

async function importFeatures(features: GeoJSON.Feature[]): Promise<MapshaperDataset> {
  return getDefaultMapshaperAdapter().runImport(`-i "${FIXTURE_NAME}"`, {
    [FIXTURE_NAME]: JSON.stringify({
      type: 'FeatureCollection',
      crs: { type: 'name', properties: { name: 'EPSG:3857' } },
      features,
    }),
  });
}

function unsignedArcId(id: number): number {
  return id < 0 ? ~id : id;
}

function coordinates(shape: PathShape, arcs: ArcCollection): Array<[number, number]> {
  const iter = arcs.getShapeIter!(shape[0]!);
  const points: Array<[number, number]> = [];
  while (iter.hasNext()) points.push([iter.x, iter.y]);
  return points;
}

describe('mapshaper feature-split primitives', () => {
  it('builds a filtered polygon mosaic from intersection-cut boundary and cutter arcs', async () => {
    const adapter = getDefaultMapshaperAdapter();
    const dataset = await importFeatures([
      {
        type: 'Feature',
        properties: { kind: 'boundary' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [1000, 1000],
              [1010, 1000],
              [1010, 1010],
              [1000, 1010],
              [1000, 1000],
            ],
          ],
        },
      },
      {
        type: 'Feature',
        properties: { kind: 'cutter' },
        geometry: { type: 'LineString', coordinates: [[1000, 1005], [1010, 1005]] },
      },
    ]);
    const boundaryShape = dataset.layers[0]!.shapes![0] as PathShape;
    const cutterShape = dataset.layers[1]!.shapes![0] as PathShape;

    adapter.addIntersectionCuts(dataset, { no_snap: true, rebuild_topology: true });
    const arcIds = new Set([...boundaryShape, ...cutterShape].flat().map(unsignedArcId));
    const tiles = adapter.buildPolygonMosaic(dataset.arcs!, arcIds);

    expect(tiles).toHaveLength(2);
    expect(
      tiles.reduce((sum, tile) => sum + adapter.getShapeArea(tile, dataset.arcs!), 0),
    ).toBeCloseTo(100, 10);
    expect(adapter.getShapePerimeter(tiles[0]!, dataset.arcs!)).toBeCloseTo(30, 10);
    const anchor = adapter.getShapeAnchor(tiles[0]!, dataset.arcs!);
    expect(anchor).toEqual([1005, 1002.5]);

    const originalPart = tiles[0]![0]!;
    originalPart[0] = Number.NaN;
    expect(tiles[1]![0]![0]).not.toBeNaN();
  });

  it('inserts a cut point and remaps the original line shape to divided arcs', async () => {
    const adapter = getDefaultMapshaperAdapter();
    const dataset = await importFeatures([
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: [[0, 0], [10, 0]] },
      },
    ]);
    const shape = dataset.layers[0]!.shapes![0] as PathShape;
    const initialArcId = unsignedArcId(shape[0]![0]!);
    const segmentStartVertexId = dataset.arcs!.getVertexData!().ii[initialArcId]!;

    adapter.insertCutPoints(dataset, [{ x: 5, y: 0, i: segmentStartVertexId }]);

    expect(shape[0]).toHaveLength(2);
    expect(coordinates(shape, dataset.arcs!)).toEqual([
      [0, 0],
      [5, 0],
      [10, 0],
    ]);
  });

  it('cleans only unreferenced temporary cutter arcs without changing target partitioning', async () => {
    const adapter = getDefaultMapshaperAdapter();
    const dataset = await importFeatures([
      {
        type: 'Feature',
        properties: { kind: 'target' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [1000, 1000],
              [1010, 1000],
              [1010, 1010],
              [1000, 1010],
              [1000, 1000],
            ],
          ],
        },
      },
      {
        type: 'Feature',
        properties: { kind: 'temporary-cutter' },
        geometry: { type: 'LineString', coordinates: [[1000, 1005], [1010, 1005]] },
      },
    ]);
    const targetLayer = dataset.layers[0]!;
    const targetShape = targetLayer.shapes![0] as PathShape;

    adapter.addIntersectionCuts(dataset, { no_snap: true, rebuild_topology: true });
    const before = adapter.exportPathData(targetShape, dataset.arcs!, 'polygon').pathData[0]!.points;
    const partitionBefore = targetShape.map((part) => [...part]);
    const arcCountBefore = dataset.arcs!.size();
    dataset.layers.splice(1, 1);
    adapter.cleanArcReferences(dataset);

    expect(dataset.arcs!.size()).toBeLessThan(arcCountBefore);
    expect(targetShape).toEqual(partitionBefore);
    expect(adapter.exportPathData(targetShape, dataset.arcs!, 'polygon').pathData[0]!.points).toEqual(
      before,
    );
  });
});
