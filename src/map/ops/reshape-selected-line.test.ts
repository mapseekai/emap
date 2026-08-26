import { describe, expect, it } from 'vitest';
import { getDefaultMapshaperAdapter } from '../../adapter/mapshaper-adapter';
import type { MapshaperDataset } from '../../types/mapshaper-types';
import { clipLineBetween, reshapeSelectedPolylines } from './reshape-selected-line';

const FIXTURE_NAME = 'selected-polyline-reshape.geojson';

async function importLines(coordinates: unknown[]): Promise<MapshaperDataset> {
  return getDefaultMapshaperAdapter().runImport(`-i "${FIXTURE_NAME}"`, {
    [FIXTURE_NAME]: JSON.stringify({
      type: 'FeatureCollection',
      features: coordinates.map((line, id) => ({
        type: 'Feature',
        properties: { id },
        geometry: Array.isArray(line)
          ? { type: 'LineString', coordinates: line }
          : (line as GeoJSON.Geometry),
      })),
    }),
  });
}

function exportLineCoordinates(dataset: MapshaperDataset): unknown[] {
  const file = getDefaultMapshaperAdapter().exportFileContent(dataset, { format: 'geojson' })[0]!;
  const collection = JSON.parse(String(file.content)) as GeoJSON.FeatureCollection;
  return collection.features
    .filter((feature) => feature.properties?.id !== undefined)
    .map((feature) => feature.geometry!.coordinates);
}

function reshape(
  dataset: MapshaperDataset,
  line: Array<[number, number]>,
): Array<{ featureId: number }> {
  const results = reshapeSelectedPolylines(dataset, 0, new Set([0]), line, getDefaultMapshaperAdapter());
  const shapes = dataset.layers[0]!.shapes!;
  for (const { featureId, shape } of results) shapes.splice(featureId, 1, shape);
  return results;
}

  it('clips a line at cumulative distances', () => {
    expect(clipLineBetween([[3, 0], [5, 2], [7, 0]], 0, Math.sqrt(8) * 2)).toEqual([
      [3, 0],
      [5, 2],
      [7, 0],
    ]);
  });

describe('reshapeSelectedPolylines', () => {
  it('leaves an open line unchanged after one transverse crossing', async () => {
    const dataset = await importLines([[[0, 0], [10, 0]]]);

    expect(reshape(dataset, [[5, 1], [5, -1]])).toEqual([]);
    expect(exportLineCoordinates(dataset)).toEqual([[[0, 0], [10, 0]]]);
  });

  it('replaces the segment between two endpoint contacts', async () => {
    const dataset = await importLines([[[0, 0], [10, 0]]]);

    expect(reshape(dataset, [[3, 0], [5, 2], [7, 0]])).toHaveLength(1);
    expect(exportLineCoordinates(dataset)).toEqual([[[0, 0], [3, 0], [5, 2], [7, 0], [10, 0]]]);
  });

  it('clips a reshape line between two transverse crossings', async () => {
    const dataset = await importLines([[[0, 0], [10, 0]]]);

    expect(reshape(dataset, [[3, -1], [3, 1], [7, 1], [7, -1]])).toHaveLength(1);
    expect(exportLineCoordinates(dataset)).toEqual([
      [[0, 0], [3, 0], [3, 1], [7, 1], [7, 0], [10, 0]],
    ]);
  });

  it('replaces the forward segment of a closed line without crossing its seam', async () => {
    const dataset = await importLines([[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]);

    expect(reshape(dataset, [[3, 0], [5, 2], [7, 0]])).toHaveLength(1);
    expect(exportLineCoordinates(dataset)).toEqual([
      [[3, 0], [5, 2], [7, 0], [10, 0], [10, 10], [0, 10], [0, 0], [3, 0]],
    ]);
  });

  it('reshapes only the contacted part of a multipart line', async () => {
    const dataset = await importLines([
      { type: 'MultiLineString', coordinates: [[[0, 0], [10, 0]], [[0, 10], [10, 10]]] },
    ]);

    expect(reshape(dataset, [[3, 0], [5, 2], [7, 0]])).toHaveLength(1);
    expect(exportLineCoordinates(dataset)).toEqual([
      [[[0, 0], [3, 0], [5, 2], [7, 0], [10, 0]], [[0, 10], [10, 10]]],
    ]);
  });

  it('is independent of reshape-line direction', async () => {
    const dataset = await importLines([[[0, 0], [10, 0]]]);

    expect(reshape(dataset, [[7, 0], [5, 2], [3, 0]])).toHaveLength(1);
    expect(exportLineCoordinates(dataset)).toEqual([[[0, 0], [3, 0], [5, 2], [7, 0], [10, 0]]]);
  });

  it('is independent of selected feature direction', async () => {
    const dataset = await importLines([[[10, 0], [0, 0]]]);

    expect(reshape(dataset, [[3, 0], [5, 2], [7, 0]])).toHaveLength(1);
    expect(exportLineCoordinates(dataset)).toEqual([[[10, 0], [7, 0], [5, 2], [3, 0], [0, 0]]]);
  });

  it('leaves a feature unchanged when the clipped reshape segment is degenerate', async () => {
    const dataset = await importLines([[[0, 0], [10, 0]]]);

    expect(reshape(dataset, [[3, 0], [3, 0], [3, 0]])).toEqual([]);
    expect(exportLineCoordinates(dataset)).toEqual([[[0, 0], [10, 0]]]);
  });
});
