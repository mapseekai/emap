import { describe, expect, it } from 'vitest';
import { getDefaultMapshaperAdapter } from '../../../integrations/mapshaper/adapter';
import { AffineTransform } from '../../../domain/geo/transform';
import { FullGeometrySource, packDisplayChunk, unpackDisplayChunk } from './spatial-chunks';
import type { MapshaperDataset } from '../../../shared/types/mapshaper-types';

// Small structural fixtures verify contracts, not throughput or claimed performance.
describe('full-precision spatial chunk contracts', () => {
  it('retains source coordinates and every original point across viewport changes', async () => {
    const dataset: MapshaperDataset = {
      layers: [
        {
          geometry_type: 'point',
          shapes: [[[0, 0]], [[0.01, 0.01]], [[100, 100]], [[100.01, 100.01]]],
        },
      ],
    };
    const before = JSON.stringify(dataset),
      index = new FullGeometrySource(dataset, [0, 0, 101, 101]);
    await index.initialize(new AbortController().signal);
    const view = new AffineTransform(10, -10, 0, 100);
    expect(index.visible(view, 50, 100).length).toBeLessThan(index.chunks.length);
    for (const chunk of index.chunks) {
      const a = index.build(chunk, 0),
        b = index.build(chunk, 0);
      expect(a.geometry.vertices).toEqual(b.geometry.vertices);
      for (const shape of a.shapes)
        for (const p of shape as number[][])
          expect([
            [0, 0],
            [0.01, 0.01],
            [100, 100],
            [100.01, 100.01],
          ]).toContainEqual(p);
    }
    expect(JSON.stringify(dataset)).toBe(before);
  });
  it('preserves a closed polygon and its hole, and keeps original arc storage untouched', async () => {
    const importer = getDefaultMapshaperAdapter().createPathImporter();
    importer.startShape({ id: 1 });
    importer.importRing([
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
      [0, 0],
    ]);
    importer.importRing(
      [
        [20, 20],
        [20, 40],
        [40, 40],
        [40, 20],
        [20, 20],
      ],
      true,
    );
    const dataset = importer.done(),
      raw = dataset.arcs!.getVertexData!();
    const x = raw.xx.slice(),
      y = raw.yy.slice(),
      shapes = JSON.stringify(dataset.layers[0].shapes);
    const index = new FullGeometrySource(dataset, [0, 0, 100, 100]);
    await index.initialize(new AbortController().signal);
    const fill = index.chunks.find((c) => c.kind === 'fill')!;
    const near = index.build(fill, -8),
      far = index.build(fill, 3);
    expect(near.geometry.count).toBeGreaterThan(0);
    expect(far.geometry.count).toBeGreaterThan(0);
    expect(near.shapes[0]).toHaveLength(2);
    const packet = packDisplayChunk(near),
      restored = unpackDisplayChunk(fill, packet);
    const iter = restored.arcs!.getShapeIter!((restored.shapes[0] as number[][])[0]);
    let count = 0;
    while (iter.hasNext()) count++;
    expect(count).toBe(5);
    expect(restored.geometry.vertices).toEqual(near.geometry.vertices);
    expect(raw.xx).toEqual(x);
    expect(raw.yy).toEqual(y);
    expect(JSON.stringify(dataset.layers[0].shapes)).toBe(shapes);
    // A viewport completely inside the shell still includes its fill chunk.
    expect(index.visible(new AffineTransform(10, -10, -500, 700), 100, 100)).toContain(fill);
  });
  it('never changes point count or path detail with scale or legacy level arguments', async () => {
    const points: MapshaperDataset = {
      layers: [
        { geometry_type: 'point', shapes: [[[0, 0]], [[0.00001, 0.00001]], [[0.00002, 0.00002]]] },
      ],
    };
    const p = new FullGeometrySource(points, [0, 0, 1, 1]);
    await p.initialize(new AbortController().signal);
    expect(p.chunks.reduce((n, c) => n + p.build(c, 100).geometry.count, 0)).toBe(3);
    for (const c of p.chunks)
      expect(p.build(c, -100).geometry.vertices).toEqual(p.build(c, 100).geometry.vertices);
    const importer = getDefaultMapshaperAdapter().createPathImporter();
    importer.startShape();
    importer.importLine([
      [0, 0],
      [1e-9, 1e-9],
      [2e-9, 0],
    ]);
    const lines = new FullGeometrySource(importer.done(), [0, 0, 1, 1]);
    await lines.initialize(new AbortController().signal);
    const line = lines.chunks.find((c) => c.kind === 'line')!;
    const near = lines.build(line, -100),
      far = lines.build(line, 100);
    expect(near.geometry.kind).toBe('path');
    expect(far.geometry.segmentCount).toBe(2);
    expect(far.geometry.vertices).toEqual(near.geometry.vertices);
    expect(far.omitted).toBe(0);
    expect(lines.level(new AffineTransform(1e-12, -1e-12, 0, 0))).toBe(0);
    p.dispose();
    lines.dispose();
  });
  it('cancels initialization without mutating the source', async () => {
    const dataset: MapshaperDataset = { layers: [{ geometry_type: 'point', shapes: [[[1, 2]]] }] };
    const signal = AbortSignal.abort(new Error('cancelled'));
    await expect(new FullGeometrySource(dataset, [0, 0, 3, 3]).initialize(signal)).rejects.toThrow(
      'cancelled',
    );
    expect(dataset.layers[0].shapes).toEqual([[[1, 2]]]);
  });
});

it('keeps outside point centers whose larger symbols overlap the viewport', async () => {
  const source = new FullGeometrySource(
    { layers: [{ geometry_type: 'point', shapes: [[[-40, 50]], [[50, 50]]] }] },
    [-50, 0, 100, 100],
  );
  await source.initialize(new AbortController().signal);
  const transform = new AffineTransform(1, -1, 0, 100);
  const narrow = source.visible(transform, 100, 100, 8);
  const wide = source.visible(transform, 100, 100, 65);
  expect(wide.length).toBeGreaterThan(narrow.length);
  expect(wide.some((c) => c.bounds[0] === -40)).toBe(true);
  source.dispose();
});
