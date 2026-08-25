import { describe, expect, it } from 'vitest';
import { getDefaultMapshaperAdapter } from '../../adapter/mapshaper-adapter';
import type { MapshaperDataset, PathShape } from '../../types/mapshaper-types';
import { SplitGeometryValidationError } from './split-selected-error';
import { splitSelectedPolylines } from './split-selected-line';

const FIXTURE_NAME = 'selected-polyline-split.geojson';

async function importLines(coordinates: unknown[]): Promise<MapshaperDataset> {
  return getDefaultMapshaperAdapter().runImport(`-i "${FIXTURE_NAME}"`, {
    [FIXTURE_NAME]: JSON.stringify({
      type: 'FeatureCollection',
      features: coordinates.map((line, id) => ({
        type: 'Feature',
        properties: { id },
        geometry: { type: 'LineString', coordinates: line },
      })),
    }),
  });
}

function replaceFixtureShapeWithPieces(layer: NonNullable<MapshaperDataset['layers'][number]>, pieces: PathShape[]): void {
  const shapeIndex = layer.shapes!.findIndex((shape) => shape !== null);
  const sourceRecord = layer.data!.getRecordAt(shapeIndex)!;
  layer.shapes!.splice(shapeIndex, 1, ...pieces);
  const records = pieces.map(() => ({ ...sourceRecord }));
  layer.data!.getRecords().splice(shapeIndex, 1, ...records);
}

function exportLineCoordinates(dataset: MapshaperDataset): unknown[] {
  const file = getDefaultMapshaperAdapter().exportFileContent(dataset, { format: 'geojson' })[0]!;
  const collection = JSON.parse(String(file.content)) as GeoJSON.FeatureCollection;
  return collection.features
    .filter((feature) => feature.properties?.id !== undefined)
    .map((feature) => feature.geometry!.coordinates);
}

describe('splitSelectedPolylines', () => {
  it('splits an interior point into exact path pieces', async () => {
    const adapter = getDefaultMapshaperAdapter();
    const dataset = await importLines([[[0, 0], [10, 0]]]);

    const result = splitSelectedPolylines(dataset, 0, new Set([0]), { type: 'point', coordinates: [5, 0] }, adapter);

    expect(result.pointOnSelectedPath).toBe(true);
    expect(result.pieces).toHaveLength(1);
    expect(result.pieces[0]!.pieces).toHaveLength(2);
    replaceFixtureShapeWithPieces(dataset.layers[0]!, result.pieces[0]!.pieces);
    expect(exportLineCoordinates(dataset)).toEqual([[[0, 0], [5, 0]], [[5, 0], [10, 0]]]);
  });

  it('splits at an existing interior vertex', async () => {
    const adapter = getDefaultMapshaperAdapter();
    const dataset = await importLines([[[0, 0], [5, 0], [10, 0]]]);

    const result = splitSelectedPolylines(dataset, 0, new Set([0]), { type: 'point', coordinates: [5, 0] }, adapter);

    expect(result.pieces[0]!.pieces).toHaveLength(2);
    replaceFixtureShapeWithPieces(dataset.layers[0]!, result.pieces[0]!.pieces);
    expect(exportLineCoordinates(dataset)).toEqual([[[0, 0], [5, 0]], [[5, 0], [10, 0]]]);
  });

  it.each([[[0, 0]], [[10, 0]]] as const)('keeps an endpoint cutter (%j) as an on-path no-op', async (coordinates) => {
    const adapter = getDefaultMapshaperAdapter();
    const dataset = await importLines([[[0, 0], [10, 0]]]);

    const result = splitSelectedPolylines(dataset, 0, new Set([0]), { type: 'point', coordinates }, adapter);

    expect(result).toEqual({ pieces: [], pointOnSelectedPath: true });
  });

  it('rejects a visibly off-path point', async () => {
    const adapter = getDefaultMapshaperAdapter();
    const dataset = await importLines([[[0, 0], [10, 0]]]);

    const action = () =>
      splitSelectedPolylines(dataset, 0, new Set([0]), { type: 'point', coordinates: [5, 0.001] }, adapter);
    expect(action).toThrow(SplitGeometryValidationError);
    try {
      action();
    } catch (error) {
      expect(error).toMatchObject({ field: 'cutter', reason: expect.any(String) });
    }
  });

  it('accepts arithmetic epsilon but rejects a visible offset', async () => {
    const adapter = getDefaultMapshaperAdapter();
    const dataset = await importLines([[[0, 0], [1, 1]]]);

    const accepted = splitSelectedPolylines(dataset, 0, new Set([0]), {
      type: 'point', coordinates: [0.1 + 0.2, 0.3],
    }, adapter);
    expect(accepted.pieces[0]!.pieces).toHaveLength(2);

    expect(() => splitSelectedPolylines(dataset, 0, new Set([0]), { type: 'point', coordinates: [0.3, 0.300001] }, adapter)).toThrow(SplitGeometryValidationError);
  });

  it('splits only the touched multipart path into independent non-empty features', async () => {
    const adapter = getDefaultMapshaperAdapter();
    const dataset = await importLines([[[0, 0], [10, 0]], [[20, 0], [30, 0]]]);
    const layer = dataset.layers[0]!;
    layer.shapes![0] = [
      [...(layer.shapes![0] as PathShape)[0]!],
      [...(layer.shapes![1] as PathShape)[0]!],
    ];
    layer.shapes!.splice(1, 1);
    layer.data!.getRecords().splice(1, 1);

    const result = splitSelectedPolylines(dataset, 0, new Set([0]), { type: 'point', coordinates: [5, 0] }, adapter);

    expect(result.pieces[0]!.pieces).toHaveLength(3);
    replaceFixtureShapeWithPieces(layer, result.pieces[0]!.pieces);
    expect(exportLineCoordinates(dataset)).toEqual([[[0, 0], [5, 0]], [[5, 0], [10, 0]], [[20, 0], [30, 0]]]);
  });

  it('nodes a crossing cutter line and partitions at every crossing', async () => {
    const adapter = getDefaultMapshaperAdapter();
    const dataset = await importLines([[[0, 0], [10, 0], [20, 0], [30, 0]]]);

    const result = splitSelectedPolylines(dataset, 0, new Set([0]), { type: 'line', coordinates: [[5, -5], [5, 5], [15, 5], [15, -5], [25, -5], [25, 5]] }, adapter);

    expect(result.pieces[0]!.pieces).toHaveLength(4);
    replaceFixtureShapeWithPieces(dataset.layers[0]!, result.pieces[0]!.pieces);
    expect(exportLineCoordinates(dataset)).toEqual([
      [[0, 0], [5, 0]],
      [[5, 0], [10, 0], [15, 0]],
      [[15, 0], [20, 0], [25, 0]],
      [[25, 0], [30, 0]],
    ]);
  });

  it('deduplicates coincident cutter intersections and filters zero-length fragments', async () => {
    const adapter = getDefaultMapshaperAdapter();
    const dataset = await importLines([[[0, 0], [10, 0]]]);

    const result = splitSelectedPolylines(dataset, 0, new Set([0]), { type: 'line', coordinates: [[5, -5], [5, 5], [5, -5]] }, adapter);

    expect(result.pieces[0]!.pieces).toHaveLength(2);
    replaceFixtureShapeWithPieces(dataset.layers[0]!, result.pieces[0]!.pieces);
    expect(exportLineCoordinates(dataset)).toEqual([[[0, 0], [5, 0]], [[5, 0], [10, 0]]]);
  });

  it.each([
    ['target endpoint', [[0, -5], [0, 5]]],
    ['tangent contact', [[5, 0], [5, 5]]],
    ['collinear overlap', [[2, 0], [8, 0]]],
  ] as const)('ignores a %s line cutter contact', async (_name, coordinates) => {
    const adapter = getDefaultMapshaperAdapter();
    const dataset = await importLines([[[0, 0], [10, 0]]]);

    expect(splitSelectedPolylines(dataset, 0, new Set([0]), { type: 'line', coordinates }, adapter).pieces).toEqual([]);
  });

  it.each([
    ['target vertex', [[0, 0], [5, 0], [10, 0]], [[5, -5], [5, 5]]],
    ['cutter vertex', [[0, 0], [10, 0]], [[5, -5], [5, 0], [5, 5]]],
    ['small-scale crossing', [[0, 0], [1e-8, 0]], [[5e-9, -5e-9], [5e-9, 5e-9]]],
  ] as const)('splits a proper %s crossing', async (_name, target, coordinates) => {
    const adapter = getDefaultMapshaperAdapter();
    const dataset = await importLines([target]);

    const result = splitSelectedPolylines(dataset, 0, new Set([0]), { type: 'line', coordinates }, adapter);

    expect(result.pieces[0]!.pieces).toHaveLength(2);
  });
});
