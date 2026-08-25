import { describe, expect, it } from 'vitest';
import { getDefaultMapshaperAdapter } from '../../adapter/mapshaper-adapter';
import type { MapshaperDataset, PathShape } from '../../types/mapshaper-types';
import { SplitGeometryValidationError } from './split-selected-error';
import { splitSelectedPolygons } from './split-selected-polygon';

const FIXTURE_NAME = 'selected-polygon-split.geojson';
const adapter = getDefaultMapshaperAdapter();
type Position = [number, number];
type PolygonCoordinates = Position[][];

async function importPolygons(geometries: GeoJSON.Polygon[] | GeoJSON.MultiPolygon[]): Promise<MapshaperDataset> {
  const dataset = await adapter.runImport(`-i "${FIXTURE_NAME}"`, {
    [FIXTURE_NAME]: JSON.stringify({ type: 'FeatureCollection', features: geometries.map((geometry, id) => ({ type: 'Feature', properties: { id }, geometry })) }),
  });
  dataset.info = {};
  return dataset;
}

function polygon(rings: PolygonCoordinates): GeoJSON.Polygon { return { type: 'Polygon', coordinates: rings }; }

function canonicalRing(ring: Position[]): Position[] {
  const open = ring.slice(0, -1);
  const rotations = open.map((_, start) => [...open.slice(start), ...open.slice(0, start)]);
  const reverse = [...open].reverse();
  rotations.push(...reverse.map((_, start) => [...reverse.slice(start), ...reverse.slice(0, start)]));
  return rotations.map((rotation) => [...rotation, rotation[0]!]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))[0]!;
}

function exportCanonicalGeometry(dataset: MapshaperDataset): GeoJSON.Geometry {
  const file = adapter.exportFileContent(dataset, { format: 'geojson' })[0]!;
  const parsed = JSON.parse(String(file.content)) as GeoJSON.FeatureCollection | GeoJSON.GeometryCollection | GeoJSON.Geometry;
  const geometries = parsed.type === 'FeatureCollection' ? parsed.features.map((feature) => feature.geometry!) : parsed.type === 'GeometryCollection' ? parsed.geometries : [parsed];
  const polygons = geometries.flatMap((geometry) => geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : []);
  return { type: 'MultiPolygon', coordinates: polygons.map((rings) => rings.map(canonicalRing).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) };
}

async function dissolvePieces(dataset: MapshaperDataset, pieces: PathShape[]): Promise<GeoJSON.Geometry> {
  const temporary = adapter.copyDataset(dataset);
  temporary.layers = [{ geometry_type: 'polygon', shapes: pieces.map((piece) => piece.map((part) => [...part])) }];
  return exportCanonicalGeometry(await adapter.runOnDatasetParsed([{ name: 'dissolve2', options: {} }], temporary));
}

function planarArea(shape: PathShape, arcs: NonNullable<MapshaperDataset['arcs']>): number {
  return Math.abs(adapter.exportPathData(shape, arcs, 'polygon').pathData.reduce((sum, path) => sum + (path.area ?? 0), 0));
}

function pieceArea(pieces: PathShape[], arcs: NonNullable<MapshaperDataset['arcs']>): number { return pieces.reduce((sum, piece) => sum + adapter.getShapeArea(piece, arcs), 0); }

async function expectConserved(dataset: MapshaperDataset, original: PathShape, pieces: PathShape[]): Promise<void> {
  const arcs = dataset.arcs!;
  const originalArea = adapter.getShapeArea(original, arcs);
  expect(Math.abs(pieceArea(pieces, arcs) - originalArea)).toBeLessThanOrEqual(Math.max(originalArea * 1e-10, Number.EPSILON * 1024));
  expect(await dissolvePieces(dataset, pieces)).toEqual(exportCanonicalGeometry({ arcs, layers: [{ geometry_type: 'polygon', shapes: [original] }] }));
}

function split(dataset: MapshaperDataset, selectedIds: ReadonlySet<number>, coordinates: Position[]) {
  return splitSelectedPolygons(dataset, 0, selectedIds, { type: 'line', coordinates }, adapter);
}

describe('splitSelectedPolygons', () => {
  it('splits a square at two crossings into area-conserving polygons', async () => {
    const dataset = await importPolygons([polygon([[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]])]);
    const original = dataset.layers[0]!.shapes![0] as PathShape;
    const result = split(dataset, new Set([0]), [[-1, 5], [11, 5]]);
    expect(result).toHaveLength(1);
    expect(result[0]!.pieces).toHaveLength(2);
    expect(result[0]!.pieces.map((piece) => planarArea(piece, dataset.arcs!)).sort()).toEqual([50, 50]);
    await expectConserved(dataset, original, result[0]!.pieces);
  });

  it('returns every tile from a cutter with repeated crossings', async () => {
    const dataset = await importPolygons([polygon([[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]])]);
    const original = dataset.layers[0]!.shapes![0] as PathShape;
    const result = split(dataset, new Set([0]), [[-1, 2], [11, 2], [11, 5], [-1, 5], [-1, 8], [11, 8]]);
    expect(result[0]!.pieces.length).toBeGreaterThan(2);
    await expectConserved(dataset, original, result[0]!.pieces);
  });

  it('preserves a hole while splitting its containing polygon', async () => {
    const dataset = await importPolygons([polygon([[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[3, 3], [3, 7], [7, 7], [7, 3], [3, 3]]])]);
    const original = dataset.layers[0]!.shapes![0] as PathShape;
    const result = split(dataset, new Set([0]), [[-1, 5], [11, 5]]);
    expect(result[0]!.pieces).toHaveLength(2);
    await expectConserved(dataset, original, result[0]!.pieces);
  });

  it('returns independent connected pieces for a MultiPolygon', async () => {
    const dataset = await importPolygons([{ type: 'MultiPolygon', coordinates: [[[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]], [[[6, 0], [10, 0], [10, 4], [6, 4], [6, 0]]]] }]);
    const original = dataset.layers[0]!.shapes![0] as PathShape;
    const result = split(dataset, new Set([0]), [[-1, 2], [11, 2]]);
    expect(result[0]!.pieces).toHaveLength(4);
    expect(result[0]!.pieces.every((piece) => piece.length === 1)).toBe(true);
    await expectConserved(dataset, original, result[0]!.pieces);
  });

  it('splits overlapping selected targets against their own coverage', async () => {
    const dataset = await importPolygons([polygon([[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]), polygon([[[5, -2], [15, -2], [15, 8], [5, 8], [5, -2]]])]);
    const originalAreas = dataset.layers[0]!.shapes!.map((shape) => adapter.getShapeArea(shape as PathShape, dataset.arcs!));
    const result = split(dataset, new Set([0, 1]), [[-1, 5], [16, 5]]);
    expect(result.map(({ featureId, pieces }) => [featureId, pieces.length])).toEqual([[0, 2], [1, 2]]);
    for (const { featureId, pieces } of result) {
      expect(Math.abs(pieceArea(pieces, dataset.arcs!) - originalAreas[featureId]!)).toBeLessThanOrEqual(Math.max(originalAreas[featureId]! * 1e-10, Number.EPSILON * 1024));
      await expectConserved(dataset, dataset.layers[0]!.shapes![featureId] as PathShape, pieces);
    }
  });

  it.each([
    ['polygon vertex', [[-1, -1], [0, 0], [11, 5]]],
    ['cutter vertex', [[-1, 5], [5, 5], [11, 5]]],
  ] as const)('splits through a %s crossing', async (_name, coordinates) => {
    const dataset = await importPolygons([polygon([[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]])]);
    expect(split(dataset, new Set([0]), coordinates)[0]!.pieces).toHaveLength(2);
  });

  it.each([['tangent', [[-1, 0], [0, 0], [-1, 1]]], ['single touch', [[-1, 5], [0, 5]]], ['boundary overlap', [[0, 0], [10, 0]]], ['inside-only cutter', [[2, 2], [8, 8]]] ] as const)('keeps a %s as a no-op', async (_name, coordinates) => {
    const dataset = await importPolygons([polygon([[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]])]);
    const before = dataset.layers[0]!.shapes!.length;
    expect(split(dataset, new Set([0]), coordinates)).toEqual([]);
    expect(dataset.layers[0]!.shapes).toHaveLength(before);
  });

  it('is translation-invariant at a large finite offset', async () => {
    const offset: Position = [1e12, -1e12];
    const origin = await importPolygons([polygon([[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]])]);
    const translated = await importPolygons([polygon([[[offset[0], offset[1]], [offset[0] + 10, offset[1]], [offset[0] + 10, offset[1] + 10], [offset[0], offset[1] + 10], [offset[0], offset[1]]]])]);
    const originPieces = split(origin, new Set([0]), [[-1, 5], [11, 5]])[0]!.pieces;
    const translatedPieces = split(translated, new Set([0]), [[offset[0] - 1, offset[1] + 5], [offset[0] + 11, offset[1] + 5]])[0]!.pieces;
    expect(translatedPieces).toHaveLength(originPieces.length);
    expect(translatedPieces.map((piece) => planarArea(piece, translated.arcs!)).sort()).toEqual(originPieces.map((piece) => planarArea(piece, origin.arcs!)).sort());
    await expectConserved(translated, translated.layers[0]!.shapes![0] as PathShape, translatedPieces);
  });

  it.each([
    ['overlapping shells', { type: 'MultiPolygon', coordinates: [[[[0, 0], [8, 0], [8, 8], [0, 8], [0, 0]]], [[[4, 4], [12, 4], [12, 12], [4, 12], [4, 4]]]] } as GeoJSON.MultiPolygon],
    ['outside hole', polygon([[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[20, 20], [24, 20], [24, 24], [20, 24], [20, 20]]])],
    ['crossing hole', polygon([[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[8, 2], [12, 2], [12, 8], [8, 8], [8, 2]]])],
    ['overlapping holes', polygon([[[0, 0], [12, 0], [12, 12], [0, 12], [0, 0]], [[2, 2], [7, 2], [7, 7], [2, 7], [2, 2]], [[5, 5], [10, 5], [10, 10], [5, 10], [5, 5]]])],
  ] as const)('rejects %s before no-op cutter mutation', async (_name, geometry) => {
    const dataset = await importPolygons([geometry]);
    const arcCount = dataset.arcs!.size(), layerCount = dataset.layers.length;
    expect(() => split(dataset, new Set([0]), [[2, 2], [3, 3]])).toThrow(new SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid'));
    expect(dataset.arcs!.size()).toBe(arcCount);
    expect(dataset.layers).toHaveLength(layerCount);
  });

  it('splits with a very long cutter', async () => {
    const dataset = await importPolygons([polygon([[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]])]);
    expect(split(dataset, new Set([0]), [[-1e9, 5], [1e9, 5]])[0]!.pieces).toHaveLength(2);
  });

  it('splits when a closed cutter starts and ends at a repeated boundary occurrence', async () => {
    const dataset = await importPolygons([polygon([[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]])]);
    const result = split(dataset, new Set([0]), [[0, 5], [10, 5], [10, 12], [-1, 12], [-1, 5], [0, 5]]);
    expect(result[0]!.pieces).toHaveLength(2);
  });

  it('retains a proper crossing before the cutter revisits it as an exterior V touch', async () => {
    const dataset = await importPolygons([polygon([[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]])]);
    const result = split(dataset, new Set([0]), [[-1, 5], [11, 5], [11, 11], [-1, 11], [-1, 4], [0, 5], [-1, 6]]);
    expect(result[0]!.pieces).toHaveLength(2);
  });

  it('counts duplicate proper visits at one boundary coordinate once after classification', async () => {
    const dataset = await importPolygons([polygon([[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]])]);
    const result = split(dataset, new Set([0]), [[-1, 5], [11, 5], [11, 11], [-1, 11], [-1, 5], [11, 5]]);
    expect(result[0]!.pieces).toHaveLength(2);
  });

  it('keeps a mixed exterior V touch and one crossing as a no-op', async () => {
    const dataset = await importPolygons([polygon([[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]])]);
    expect(split(dataset, new Set([0]), [[-1, 0], [0, 0], [-1, 1], [-1, 5], [5, 5]])).toEqual([]);
  });

  it('rejects a nested negative hole before no-op cutter mutation', async () => {
    const dataset = await importPolygons([polygon([[[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]], [[2, 2], [18, 2], [18, 18], [2, 18], [2, 2]], [[5, 5], [15, 5], [15, 15], [5, 15], [5, 5]]])]);
    const arcCount = dataset.arcs!.size();
    expect(() => split(dataset, new Set([0]), [[6, 6], [7, 7]])).toThrow(new SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid'));
    expect(dataset.arcs!.size()).toBe(arcCount);
  });

  it('accepts a positive island inside a hole', async () => {
    const dataset = await importPolygons([{ type: 'MultiPolygon', coordinates: [
      [[[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]], [[2, 2], [2, 18], [18, 18], [18, 2], [2, 2]]],
      [[[6, 6], [14, 6], [14, 14], [6, 14], [6, 6]]],
    ] }]);
    expect(split(dataset, new Set([0]), [[-1, 10], [21, 10]])[0]!.pieces.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects a self-intersecting selected polygon', async () => {
    const dataset = await importPolygons([polygon([[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]])]);
    const data = dataset.arcs!.getVertexData!(), start = data.ii[0]!;
    data.xx[start + 1] = 10; data.yy[start + 1] = 10; data.xx[start + 2] = 0;
    const before = dataset.layers[0]!.shapes!.length;
    expect(() => split(dataset, new Set([0]), [[-1, 5], [11, 5]])).toThrow(new SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid'));
    expect(dataset.layers[0]!.shapes).toHaveLength(before);
  });

  it('rejects coverage-defective selected polygon', async () => {
    const dataset = await importPolygons([polygon([[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]])]);
    dataset.layers[0]!.shapes![0] = [[]];
    const before = dataset.layers[0]!.shapes!.length;
    expect(() => split(dataset, new Set([0]), [[-1, 5], [11, 5]])).toThrow(new SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid'));
    expect(dataset.layers[0]!.shapes).toHaveLength(before);
  });
});
