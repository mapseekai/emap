import mapshaper from 'mapshaper';
import { describe, expect, it, vi } from 'vitest';
import { getDefaultMapshaperAdapter } from './adapter';
import type {
  ArcCollection,
  MapshaperDataset,
  PathShape,
} from '../../shared/types/mapshaper-types';

// Mock ArcCollection mirroring split-shared-arcs.test.ts: tracks vertex data
// plus retained interval / flatness so the batch APIs can be asserted against
// real adapter behavior without importing mapshaper internals.
function makeArcs(options?: { withZz?: boolean }) {
  let nn = new Int32Array([2, 2]);
  let xx = new Float64Array([0, 0, 1, 1]);
  let yy = new Float64Array([0, 1, 1, 0]);
  let zz: Float64Array | null = options?.withZz ? new Float64Array([5, 5, 5, 5]) : null;
  let retained = 0;
  const arcs = {
    size: () => nn.length,
    isFlat: () => zz === null,
    getRetainedInterval: () => retained,
    setRetainedInterval: (v: number) => {
      retained = v;
    },
    getVertexData: () => {
      const ii = new Int32Array(nn.length);
      let cursor = 0;
      for (let i = 0; i < nn.length; i++) {
        ii[i] = cursor;
        cursor += nn[i]!;
      }
      return { xx, yy, zz, nn, ii, bb: null };
    },
    updateVertexData(
      newNn: Int32Array,
      newXx: Float64Array,
      newYy: Float64Array,
      newZz: Float64Array | null,
    ) {
      nn = newNn;
      xx = newXx;
      yy = newYy;
      zz = newZz;
      retained = 0; // mapshaper resets `_zlimit` only when the new zz is null; this flat mock always does.
    },
  } as any;
  return {
    arcs,
    state: () => ({ nn, xx, yy, zz, retained }),
  };
}

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

describe('MapshaperAdapter.createArcCollection', () => {
  const adapter = getDefaultMapshaperAdapter();

  it('preserves supplied simplification thresholds and fills missing slices with Infinity', () => {
    const arcs = adapter.createArcCollection!([
      {
        xx: new Float64Array([0, 1, 2]),
        yy: new Float64Array([0, 1, 0]),
        zz: new Float64Array([Infinity, 3, Infinity]),
      },
      {
        xx: new Float64Array([2, 3]),
        yy: new Float64Array([0, 0]),
      },
    ]);

    expect(arcs.isFlat?.()).toBe(false);
    expect(Array.from(arcs.getVertexData!().zz!)).toEqual([
      Infinity,
      3,
      Infinity,
      Infinity,
      Infinity,
    ]);
  });

  it('keeps threshold-free input flat', () => {
    const arcs = adapter.createArcCollection!([
      {
        xx: new Float64Array([0, 1]),
        yy: new Float64Array([0, 1]),
        zz: null,
      },
    ]);

    expect(arcs.isFlat?.()).toBe(true);
    expect(arcs.getVertexData!().zz).toBeNull();
  });
});

describe('MapshaperAdapter.appendArcs / truncateArcs', () => {
  it('appends multiple arcs in one call and returns the first new arc id', () => {
    const { arcs, state } = makeArcs();
    const adapter = getDefaultMapshaperAdapter();
    const first = adapter.appendArcs(arcs, [
      { xx: new Float64Array([2, 3]), yy: new Float64Array([2, 3]) },
      { xx: new Float64Array([4]), yy: new Float64Array([4]) },
    ]);
    expect(first).toBe(2);
    expect(Array.from(state().nn)).toEqual([2, 2, 2, 1]);
    expect(Array.from(state().xx)).toEqual([0, 0, 1, 1, 2, 3, 4]);
  });
  it('rejects an arc with mismatched xx and yy buffer lengths', () => {
    const { arcs } = makeArcs();
    const adapter = getDefaultMapshaperAdapter();
    expect(() =>
      adapter.appendArcs(arcs, [
        { xx: new Float64Array([2, 3]), yy: new Float64Array([2]), zz: new Float64Array([1, 1]) },
      ]),
    ).toThrow('appendArcs: arc at index 0 has mismatched buffer lengths (xx=2, yy=1, zz=2)');
  });

  it('rejects an arc with mismatched xx and zz buffer lengths', () => {
    const { arcs } = makeArcs();
    const adapter = getDefaultMapshaperAdapter();
    expect(() =>
      adapter.appendArcs(arcs, [
        {
          xx: new Float64Array([2, 3]),
          yy: new Float64Array([2, 3]),
          zz: new Float64Array([1]),
        },
      ]),
    ).toThrow('appendArcs: arc at index 0 has mismatched buffer lengths (xx=2, yy=2, zz=1)');
  });

  it('preserves the retained interval across append and truncate', () => {
    const { arcs, state } = makeArcs();
    const adapter = getDefaultMapshaperAdapter();
    arcs.setRetainedInterval(42);
    adapter.appendArcs(arcs, [{ xx: new Float64Array([9]), yy: new Float64Array([9]) }]);
    expect(state().retained).toBe(42);
    adapter.truncateArcs(arcs, 2);
    expect(state().retained).toBe(42);
  });

  it('fills Infinity zz for appended arcs missing zz when the collection keeps thresholds', () => {
    const { arcs, state } = makeArcs({ withZz: true });
    const adapter = getDefaultMapshaperAdapter();
    adapter.appendArcs(arcs, [{ xx: new Float64Array([7, 8]), yy: new Float64Array([7, 8]) }]);
    expect(Array.from(state().zz!)).toEqual([5, 5, 5, 5, Infinity, Infinity]);
  });

  it('keeps caller-supplied zz slices on appended arcs', () => {
    const { arcs, state } = makeArcs({ withZz: true });
    const adapter = getDefaultMapshaperAdapter();
    adapter.appendArcs(arcs, [
      { xx: new Float64Array([7]), yy: new Float64Array([7]), zz: new Float64Array([3]) },
    ]);
    expect(Array.from(state().zz!)).toEqual([5, 5, 5, 5, 3]);
  });

  it('truncateArcs drops tail vertex data and restores arc count', () => {
    const { arcs, state } = makeArcs();
    const adapter = getDefaultMapshaperAdapter();
    adapter.appendArcs(arcs, [{ xx: new Float64Array([2, 3]), yy: new Float64Array([2, 3]) }]);
    adapter.truncateArcs(arcs, 2);
    expect(state().nn.length).toBe(2);
    expect(Array.from(state().xx)).toEqual([0, 0, 1, 1]);
  });

  it('truncateArcs throws when target exceeds current arc count', () => {
    const { arcs } = makeArcs();
    const adapter = getDefaultMapshaperAdapter();
    expect(() => adapter.truncateArcs(arcs, 5)).toThrow();
  });

  it('appendArcs with an empty list is a no-op returning current size', () => {
    const { arcs, state } = makeArcs();
    const adapter = getDefaultMapshaperAdapter();
    expect(adapter.appendArcs(arcs, [])).toBe(2);
    expect(Array.from(state().nn)).toEqual([2, 2]);
  });

  it('delegates appendArc to appendArcs', () => {
    const { arcs } = makeArcs();
    const adapter = getDefaultMapshaperAdapter();
    const appendArcs = vi.spyOn(adapter, 'appendArcs');

    expect(adapter.appendArc(arcs, [[2, 3]])).toBe(2);

    expect(appendArcs).toHaveBeenCalledOnce();
    expect(appendArcs).toHaveBeenCalledWith(arcs, [
      { xx: new Float64Array([2]), yy: new Float64Array([3]) },
    ]);
  });

  it('delegates deleteLastArc to truncateArcs', () => {
    const { arcs } = makeArcs();
    const adapter = getDefaultMapshaperAdapter();
    const truncateArcs = vi.spyOn(adapter, 'truncateArcs');

    adapter.deleteLastArc(arcs);

    expect(truncateArcs).toHaveBeenCalledOnce();
    expect(truncateArcs).toHaveBeenCalledWith(arcs, 1);
  });

  it('updates real ArcCollection vertex data and bounds through append then truncate', () => {
    const arcs = new mapshaper.internal.ArcCollection(
      new Int32Array([2]),
      new Float64Array([0, 1]),
      new Float64Array([0, 1]),
    );
    const adapter = getDefaultMapshaperAdapter();

    adapter.appendArcs(arcs, [
      { xx: new Float64Array([2, 3]), yy: new Float64Array([2, 3]) },
      { xx: new Float64Array([4]), yy: new Float64Array([4]) },
    ]);

    const appended = arcs.getVertexData();
    expect(arcs.size()).toBe(3);
    expect(Array.from(appended.xx)).toEqual([0, 1, 2, 3, 4]);
    expect(Array.from(appended.yy)).toEqual([0, 1, 2, 3, 4]);

    adapter.truncateArcs(arcs, 1);

    const truncated = arcs.getVertexData();
    expect(arcs.size()).toBe(1);
    expect(Array.from(truncated.xx)).toEqual([0, 1]);
    expect(Array.from(truncated.yy)).toEqual([0, 1]);
  });
});

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
        geometry: {
          type: 'LineString',
          coordinates: [
            [1000, 1005],
            [1010, 1005],
          ],
        },
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
        geometry: {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [10, 0],
          ],
        },
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
        geometry: {
          type: 'LineString',
          coordinates: [
            [1000, 1005],
            [1010, 1005],
          ],
        },
      },
    ]);
    const targetLayer = dataset.layers[0]!;
    const targetShape = targetLayer.shapes![0] as PathShape;

    adapter.addIntersectionCuts(dataset, { no_snap: true, rebuild_topology: true });
    const before = adapter.exportPathData(targetShape, dataset.arcs!, 'polygon').pathData[0]!
      .points;
    const partitionBefore = targetShape.map((part) => [...part]);
    const arcCountBefore = dataset.arcs!.size();
    dataset.layers.splice(1, 1);
    adapter.cleanArcReferences(dataset);

    expect(dataset.arcs!.size()).toBeLessThan(arcCountBefore);
    expect(targetShape).toEqual(partitionBefore);
    expect(
      adapter.exportPathData(targetShape, dataset.arcs!, 'polygon').pathData[0]!.points,
    ).toEqual(before);
  });
});
