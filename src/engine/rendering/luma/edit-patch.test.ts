import { describe, expect, it } from 'vitest';
import { applyCoordinatePatch } from './edit-patch';
import { FullGeometrySource } from './spatial-chunks';
import { AffineTransform } from '../../../domain/geo/transform';
import { getDefaultMapshaperAdapter } from '../../../integrations/mapshaper/adapter';
it('rejects an invalid patch atomically and rejects stale revisions', () => {
  const d = {
    layers: [{ geometry_type: 'point' as const, shapes: [[[1, 2]] as [number, number][]] }],
  };
  expect(() =>
    applyCoordinatePatch(d, {
      revision: 1,
      vertices: [],
      points: [
        { layer: 0, feature: 0, component: 0, x: 10, y: 20 },
        { layer: 0, feature: 8, component: 0, x: 3, y: 4 },
      ],
    }),
  ).toThrow();
  expect(d.layers[0].shapes[0]).toEqual([[1, 2]]);
  expect(() => applyCoordinatePatch(d, { revision: 2, vertices: [], points: [] })).toThrow(
    'revision',
  );
});
describe('coordinate-patch full-precision invalidation', () => {
  it('moves a point outside its former chunk bounds and preserves other chunks', async () => {
    const d = {
      layers: [
        {
          geometry_type: 'point' as const,
          shapes: [[[1, 2]], [[100, 100]]] as [number, number][][],
        },
      ],
    };
    const source = new FullGeometrySource(d, [0, 0, 110, 110]);
    await source.initialize(new AbortController().signal);
    const changed = await source.patch(
      {
        revision: 1,
        vertices: [],
        points: [{ layer: 0, feature: 0, component: 0, x: 500, y: 500 }],
      },
      new AbortController().signal,
    );
    expect(changed).toHaveLength(1);
    expect(changed[0].bounds).toEqual([500, 500, 500, 500]);
    expect(source.visible(new AffineTransform(1, -1, -480, 520), 40, 40)).toContain(changed[0]);
    const g = source.build(changed[0], -10).geometry.vertices;
    expect(g[0] + g[2]).toBe(500);
    source.dispose();
  });
  it('refreshes shared-arc bounds and both neighboring fill chunks after an edit', async () => {
    const a = getDefaultMapshaperAdapter(),
      i = a.createPathImporter();
    i.startShape();
    i.importRing([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ]);
    i.startShape();
    i.importRing([
      [10, 0],
      [20, 0],
      [20, 10],
      [10, 10],
      [10, 0],
    ]);
    const d = i.done();
    a.buildTopology(d);
    const source = new FullGeometrySource(d, [0, 0, 20, 10]);
    await source.initialize(new AbortController().signal);
    const ids = a.findNearestVertices([10, 0], d.layers[0].shapes![0] as number[][], d.arcs!);
    const changed = await source.patch(
      { revision: 1, vertices: ids.map((id) => ({ id, x: 11, y: -2 })), points: [] },
      new AbortController().signal,
    );
    expect(changed.some((c) => c.kind === 'line')).toBe(true);
    expect(changed.filter((c) => c.kind === 'fill')).toHaveLength(2);
    for (const c of changed.filter((c) => c.kind === 'fill'))
      expect(
        source.build(c, -20).paths.some((p) => p.some((v) => v[0] === 11 && v[1] === -2)),
      ).toBe(true);
    source.dispose();
  });
});
