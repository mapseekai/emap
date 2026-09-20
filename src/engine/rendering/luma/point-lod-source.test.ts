import { describe, expect, it } from 'vitest';
import { PointLod } from '../point-lod';
import { AffineTransform } from '../../../domain/geo/transform';
import { FullGeometrySource } from './spatial-chunks';
import {
  DEFAULT_LUMA_POINT_LOD_CELL_SIZE,
  validatePointLodCellSize,
  type PointLodRequest,
} from './point-lod-source';
import type { MapshaperDataset } from '../../../shared/types/mapshaper-types';
const signal = () => new AbortController().signal;
function fixture(): MapshaperDataset {
  return {
    layers: [
      {
        geometry_type: 'point',
        shapes: Array.from({ length: 12000 }, (_, i) => [[i % 120, Math.floor(i / 120)]]),
      },
    ],
  };
}
function request(source: FullGeometrySource, scale = 0.1): PointLodRequest {
  return {
    transform: { mx: scale, my: -scale, bx: 100, by: 100 },
    width: 800,
    height: 600,
    cellSize: 3,
    visibleChunkIds: source.chunks.map((c) => c.id),
    knownKeys: [],
  };
}
describe('luma adapter reuses the existing PointLod', () => {
  it('defaults to 3 CSS pixels and validates the same 1..64 range', () => {
    expect(DEFAULT_LUMA_POINT_LOD_CELL_SIZE).toBe(3);
    for (const n of [0, 65, NaN, Infinity]) expect(() => validatePointLodCellSize(n)).toThrow();
    for (const n of [1, 3, 64]) expect(() => validatePointLodCellSize(n)).not.toThrow();
  });
  it('returns exactly the existing representative feature/component IDs without modifying data', async () => {
    const dataset = fixture(),
      before = JSON.stringify(dataset),
      source = new FullGeometrySource(dataset, [0, 0, 120, 100]);
    await source.initialize(signal());
    const q = request(source);
    const packet = source.queryPointLod(q)[0];
    const expected = new PointLod().query(
      { id: 'x', source: 's', type: 'circle', pointLod: { cellSize: 3 } },
      dataset.layers[0],
      dataset,
      null,
      new AffineTransform(0.1, -0.1, 100, 100),
      [-Infinity, -Infinity, Infinity, Infinity],
      { width: 800, height: 600 },
    );
    expect(packet.featureIds).toEqual(expected!.featureIds);
    expect(packet.componentIds).toEqual(expected!.componentIds);
    expect(packet.count).toBeLessThan(12000);
    expect(packet.geometry!.count).toBe(packet.count);
    expect(JSON.stringify(dataset)).toBe(before);
    source.dispose();
  });
  it('reuses world-anchored grids on pan and transfers copies without detaching cached IDs', async () => {
    const source = new FullGeometrySource(fixture(), [0, 0, 120, 100]);
    await source.initialize(signal());
    const q = request(source),
      first = source.queryPointLod(q)[0];
    structuredClone(first, {
      transfer: [
        first.featureIds!.buffer,
        first.componentIds!.buffer,
        first.geometry!.vertices.buffer,
      ],
    });
    const reused = source.queryPointLod({
      ...q,
      transform: { ...q.transform, bx: 150 },
      knownKeys: [first.key!],
    })[0];
    expect(reused.key).toBe(first.key);
    expect(reused.geometry).toBeUndefined();
    const again = source.queryPointLod(q)[0];
    expect(again.featureIds!.length).toBe(first.count);
    source.dispose();
  });
  it('keeps small point layers full and does not aggregate polygons or lines', async () => {
    const d: MapshaperDataset = {
      layers: [
        {
          geometry_type: 'point',
          shapes: [
            [[1, 2]],
            null,
            [
              [3, 4],
              [4, 5],
            ],
          ],
        },
      ],
    };
    const s = new FullGeometrySource(d, [0, 0, 10, 10]);
    await s.initialize(signal());
    expect(s.queryPointLod(request(s))[0].key).toBeNull();
    s.dispose();
    const empty = new FullGeometrySource({ layers: [] }, [0, 0, 10, 10]);
    await empty.initialize(signal());
    expect(empty.queryPointLod(request(empty))).toEqual([]);
    empty.dispose();
  });
  it('invalidates representatives after a raw coordinate edit, including a moved nonrepresentative', async () => {
    const d = fixture(),
      s = new FullGeometrySource(d, [0, 0, 120, 100]);
    await s.initialize(signal());
    const q = request(s);
    const old = s.queryPointLod(q)[0];
    const ids = new Set(old.featureIds);
    let id = 0;
    while (ids.has(id)) id++;
    await s.patch(
      {
        revision: 1,
        vertices: [],
        points: [{ layer: 0, feature: id, component: 0, x: 10000, y: 10000 }],
      },
      signal(),
    );
    const next = s.queryPointLod({ ...q, knownKeys: [old.key!] })[0];
    expect(next.key).not.toBe(old.key);
    expect([...next.featureIds!]).toContain(id);
    expect(d.layers[0].shapes![id]).toEqual([[10000, 10000]]);
    s.dispose();
  });
  it('handles MultiPoint component identity and null rows', async () => {
    const d = fixture();
    d.layers[0].shapes![0] = null;
    d.layers[0].shapes![1] = [
      [10000, 10000],
      [20000, 20000],
    ];
    const s = new FullGeometrySource(d, [0, 0, 20000, 20000]);
    await s.initialize(signal());
    const p = s.queryPointLod(request(s))[0];
    const indices = [...p.featureIds!].map((id, i) => (id === 1 ? i : -1)).filter((i) => i >= 0);
    expect(indices.map((i) => p.componentIds![i])).toEqual([0, 1]);
    s.dispose();
  });
});
