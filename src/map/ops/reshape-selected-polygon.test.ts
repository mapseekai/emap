import { describe, expect, it } from 'vitest';
import { getDefaultMapshaperAdapter } from '../../adapter/mapshaper-adapter';
import type { MapshaperDataset, PathShape } from '../../types/mapshaper-types';
import { collectPolygonExteriors, reshapeSelectedPolygon } from './reshape-selected-polygon';

const adapter = getDefaultMapshaperAdapter();
const FIXTURE_NAME = 'selected-polygon-reshape.geojson';
type Position = [number, number];

async function importPolygons(geometries: GeoJSON.Polygon[]): Promise<MapshaperDataset> {
  const dataset = await adapter.runImport(`-i "${FIXTURE_NAME}"`, {
    [FIXTURE_NAME]: JSON.stringify({
      type: 'FeatureCollection',
      features: geometries.map((geometry, id) => ({ type: 'Feature', properties: { id }, geometry })),
    }),
  });
  dataset.info = {};
  return dataset;
}

function polygon(rings: Position[][]): GeoJSON.Polygon {
  return { type: 'Polygon', coordinates: rings };
}

function exported(dataset: MapshaperDataset): GeoJSON.Geometry[] {
  const file = adapter.exportFileContent(dataset, { format: 'geojson' })[0]!;
  const result = JSON.parse(String(file.content)) as GeoJSON.FeatureCollection;
  return result.features.map((feature) => feature.geometry!);
}

function reshape(dataset: MapshaperDataset, line: Position[]): PathShape | null {
  return reshapeSelectedPolygon(dataset, 0, 0, line, adapter);
}

describe('reshapeSelectedPolygon', () => {
  it('replaces the square bottom edge with an inward reshape arc', async () => {
    const dataset = await importPolygons([
      polygon([[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]),
    ]);
    const original = adapter.getShapeArea(dataset.layers[0]!.shapes![0] as PathShape, dataset.arcs!);

    const shape = reshape(dataset, [[3, -2], [5, 3], [7, -2]]);

    expect(shape).not.toBeNull();
    dataset.layers[0]!.shapes![0] = shape!;
    expect(adapter.getShapeArea(shape!, dataset.arcs!)).toBeLessThan(original);
    const geometry = exported(dataset)[0] as GeoJSON.Polygon;
    expect(geometry.type).toBe('Polygon');
    expect(geometry.coordinates[0]).toContainEqual([5, 3]);
  });

  it('keeps a hole with its exterior when the reshape does not conflict', async () => {
    const dataset = await importPolygons([
      polygon([
        [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
        [[4, 5], [6, 5], [6, 7], [4, 7], [4, 5]],
      ]),
    ]);

    const shape = reshape(dataset, [[3, -2], [5, 2], [7, -2]]);

    expect(shape).not.toBeNull();
    dataset.layers[0]!.shapes![0] = shape!;
    const geometry = exported(dataset)[0] as GeoJSON.Polygon;
    expect(geometry.type).toBe('Polygon');
    expect(geometry.coordinates).toHaveLength(2);
    expect(geometry.coordinates[1]).toContainEqual([4, 5]);
  });

  it('rejects a reshape that would put a hole outside its exterior', async () => {
    const dataset = await importPolygons([
      polygon([
        [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
        [[4, 5], [6, 5], [6, 7], [4, 7], [4, 5]],
      ]),
    ]);

    expect(reshape(dataset, [[3, -2], [5, 8], [7, -2]])).toBeNull();
  });

  it('reshapes only the contacted exterior of a multipart polygon', async () => {
    const dataset = await importPolygons([
      { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
      { type: 'Polygon', coordinates: [[[20, 0], [30, 0], [30, 10], [20, 10], [20, 0]]] },
    ]);
    const untouched = dataset.layers[0]!.shapes![1] as PathShape;
    const untouchedArea = adapter.getShapeArea(untouched, dataset.arcs!);
    const shape = reshape(dataset, [[3, -2], [5, 3], [7, -2]]);

    expect(shape).not.toBeNull();
    expect(adapter.getShapeArea(untouched, dataset.arcs!)).toBe(untouchedArea);
  });

  it('groups imported rings by their mapshaper orientation', async () => {
    const dataset = await importPolygons([
      polygon([
        [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
        [[4, 5], [6, 5], [6, 7], [4, 7], [4, 5]],
      ]),
    ]);
    const shape = dataset.layers[0]!.shapes![0] as PathShape;

    expect(collectPolygonExteriors(shape, dataset.arcs!, adapter)).toMatchObject([
      { exteriorIndex: 0, holeIndexes: [1] },
    ]);
  });
});
