import { describe, expect, it } from 'vitest';
import { AffineTransform } from '../../domain/geo/transform';
import type { CircleLayerSpecification } from '../map/layer';
import type { MapshaperDataset, MapshaperLayer } from '../../shared/types/mapshaper-types';
import { PointLod } from './point-lod';

function fixture() {
  const layer: MapshaperLayer = {
    geometry_type: 'point',
    shapes: Array.from({ length: 20_000 }, (_, id) => [
      [(id % 200) / 10 - 10, Math.floor(id / 200) / 10 - 5],
    ]),
  };
  const dataset: MapshaperDataset = { layers: [layer], editVersion: 0, attributeVersion: 0 };
  const spec: CircleLayerSpecification = { id: 'dots', source: 's', type: 'circle' };
  const cache = new PointLod();
  const bounds = [-100, -100, 100, 100];
  const query = (scale = 1, mask: Uint8Array | null = null) =>
    cache.query(spec, layer, dataset, mask, new AffineTransform(scale, -scale), bounds);
  return { layer, dataset, spec, cache, bounds, query };
}

describe('PointLod', () => {
  it('reduces dense data, restores detail and retains nested representatives in source order', () => {
    const { query, layer } = fixture();
    const original = JSON.stringify(layer.shapes);
    const coarse = query(1)!;
    const fine = query(2)!;
    expect(coarse.featureIds.length).toBeLessThan(30);
    expect(fine.featureIds.length).toBeGreaterThan(coarse.featureIds.length);
    for (const id of coarse.featureIds) expect(fine.featureIds).toContain(id);
    expect([...fine.featureIds]).toEqual([...fine.featureIds].sort((a, b) => a - b));
    expect(query(128)).toBeNull();
    expect(JSON.stringify(layer.shapes)).toBe(original);
  });

  it('warm pans and repeated queries never read original points', () => {
    const { query, cache, layer, dataset, spec, bounds } = fixture();
    const expected = query()!;
    for (const shape of layer.shapes!) {
      Object.defineProperty(shape!, '0', {
        get() {
          throw new Error('original point rescan');
        },
      });
    }
    expect(query()).toEqual(expected);
    const translated = new AffineTransform(1, -1, 350, 29);
    expect(cache.query(spec, layer, dataset, null, translated, bounds)).toEqual(expected);
    const partial = cache.query(spec, layer, dataset, null, translated, [-4, -4, 4, 4])!;
    expect(partial.featureIds.length).toBeLessThan(expected.featureIds.length);
    for (const id of partial.featureIds) expect(expected.featureIds).toContain(id);
  });

  it('filters before selecting representatives, including after attribute changes', () => {
    const { query, dataset } = fixture();
    const mask = new Uint8Array(20_000).fill(1);
    const first = query(1, mask)!.featureIds[0];
    mask[first] = 0;
    dataset.attributeVersion!++;
    const next = query(1, mask)!;
    expect(next.featureIds).not.toContain(first);
    expect(next.featureIds[0]).toBe(first + 1);
    expect(query(1, new Uint8Array(20_000))!.featureIds).toHaveLength(0);
  });

  it('retains precise original component IDs for MultiPoint and legacy points', () => {
    const { layer, query } = fixture();
    layer.shapes = [
      Array.from({ length: 20_000 }, (_, i) => [(i % 100) / 10, Math.floor(i / 100) / 10]),
    ];
    const result = query()!;
    expect(result.featureIds.length).toBeGreaterThan(1);
    expect([...result.featureIds].every((id) => id === 0)).toBe(true);
    expect(result.componentIds[0]).toBe(0);
    expect(new Set(result.componentIds).size).toBe(result.componentIds.length);
    layer.shapes = Array.from({ length: 20_000 }, () => [1, 1]);
    expect(query()!.featureIds).toEqual(new Uint32Array([0]));
    expect(query()!.componentIds).toEqual(new Uint32Array([0]));
  });

  it('handles empty, invalid, negative, and high precision projected coordinates', () => {
    const { layer, cache, dataset, spec } = fixture();
    layer.shapes = [null, [], [[NaN, 2]], [[1, Infinity]]];
    const query = () =>
      cache.query(spec, layer, dataset, null, new AffineTransform(1024, -1024), [
        -Infinity,
        -Infinity,
        Infinity,
        Infinity,
      ]);
    expect(query()!.featureIds).toHaveLength(0);
    const x = 1_000_000_000 + 0.125;
    layer.shapes = Array.from({ length: 20_000 }, (_, i) => [[x + (i % 2) * 0.015625, -x]]);
    expect(query()!.featureIds).toEqual(new Uint32Array([0, 1]));
    expect(
      cache.query(spec, layer, dataset, null, new AffineTransform(1024, -1024), [x, -x, x, -x])!
        .featureIds,
    ).toEqual(new Uint32Array([0]));
  });

  it('invalidates geometry, dataset, shapes identity, count, mask, CRS and configuration', () => {
    const { cache, spec, layer, dataset, query, bounds } = fixture();
    expect(query()!.featureIds).toContain(0);
    layer.shapes![0] = [[500, 500]];
    dataset.editVersion!++;
    expect(query()!.featureIds).not.toContain(0);
    layer.shapes = Array.from({ length: 20_000 }, () => [[2, 2]]);
    expect(query()!.featureIds).toEqual(new Uint32Array([0]));
    layer.shapes.unshift([[30, 30]]);
    expect(query()!.featureIds).toEqual(new Uint32Array([0, 1]));
    const replaced = { ...dataset };
    layer.shapes[0] = [[2, 2]];
    expect(
      cache.query(spec, layer, replaced, null, new AffineTransform(), bounds)!.featureIds,
    ).toEqual(new Uint32Array([0]));
    layer.shapes[0] = [[30, 30]];
    replaced.info = { crs: {} as never };
    expect(
      cache.query(spec, layer, replaced, null, new AffineTransform(), bounds)!.featureIds,
    ).toEqual(new Uint32Array([0, 1]));
    const mask = new Uint8Array(layer.shapes.length).fill(1);
    mask[0] = 0;
    expect(
      cache.query(spec, layer, replaced, mask, new AffineTransform(), bounds)!.featureIds,
    ).toEqual(new Uint32Array([1]));
    spec.pointLod = false;
    expect(query()).toBeNull();
  });

  it('isolates layer/source caches and releases them explicitly', () => {
    const { query, cache, spec, layer, dataset, bounds } = fixture();
    const first = query()!;
    const other = { ...spec, id: 'other', source: 'other-source', pointLod: { cellSize: 16 } };
    const second = cache.query(other, layer, dataset, null, new AffineTransform(), bounds)!;
    expect(second.featureIds.length).toBeLessThan(first.featureIds.length);
    layer.shapes![0] = [[99, 99]];
    cache.clear(spec.id);
    expect(query()!.featureIds).toContain(1);
    // The unrelated cache remains unchanged until that source is removed.
    expect(cache.query(other, layer, dataset, null, new AffineTransform(), bounds)).toEqual(second);
    cache.clearSource('other-source');
    expect(
      cache.query(other, layer, dataset, null, new AffineTransform(), bounds)!.featureIds,
    ).toContain(1);
    cache.clear();
    layer.shapes![1] = [[99, 99]];
    expect(query()!.featureIds).toContain(2);
  });

  it('keeps at most three scale indexes and remembers sparse finer levels', () => {
    const { query, layer } = fixture();
    query(1);
    query(2);
    query(4);
    query(8);
    for (const shape of layer.shapes!)
      Object.defineProperty(shape!, '0', {
        get() {
          throw new Error('rebuild');
        },
      });
    expect(() => query(2)).not.toThrow();
    expect(() => query(1)).toThrow('rebuild');
    const sparse = fixture();
    expect(sparse.query(128)).toBeNull();
    for (const shape of sparse.layer.shapes!)
      Object.defineProperty(shape!, '0', {
        get() {
          throw new Error('rescan sparse');
        },
      });
    expect(sparse.query(256)).toBeNull();
    expect(sparse.query(512)).toBeNull();
  });
});

describe('point LOD review regressions', () => {
  for (const [width, height] of [
    [1920, 1080],
    [3840, 2160],
  ]) {
    it(`keeps useful thinning across scale 2 → 2.001 at ${width}×${height}`, () => {
      let seed = 12345;
      const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 2 ** 32;
      };
      const layer: MapshaperLayer = {
        geometry_type: 'point',
        shapes: Array.from({ length: 1_000_000 }, () => [
          [(random() * width) / 2, (random() * height) / 2],
        ]),
      };
      const spec: CircleLayerSpecification = { id: 'dots', source: 's', type: 'circle' };
      const dataset = { layers: [layer] };
      const cache = new PointLod();
      const bounds = [0, 0, width / 2, height / 2];
      const first = cache.query(spec, layer, dataset, null, new AffineTransform(2, -2), bounds, {
        width,
        height,
      });
      const next = cache.query(
        spec,
        layer,
        dataset,
        null,
        new AffineTransform(2.001, -2.001),
        bounds,
        { width, height },
      );
      expect(first).not.toBeNull();
      expect(next).not.toBeNull();
      expect(next!.featureIds.length).toBeGreaterThanOrEqual(first!.featureIds.length);
      expect(next!.featureIds.length).toBeLessThanOrEqual(150_000);
      if (width === 1920) {
        expect(next!.featureIds.length).toBeGreaterThan(first!.featureIds.length);
      }
      const tiny = cache.query(
        spec,
        layer,
        dataset,
        null,
        new AffineTransform(2.001, -2.001),
        [10, 10, 11, 11],
        { width, height },
      );
      expect(tiny).not.toBeNull();
      for (const id of tiny!.featureIds) expect(next!.featureIds).toContain(id);
      expect(
        cache.query(spec, layer, dataset, null, new AffineTransform(2.001, -2.001), bounds, {
          width,
          height,
        }),
      ).toEqual(next);
    });
  }

  it('reuses full-extent arrays and identical partial query results', () => {
    const { cache, spec, layer, dataset, query } = fixture();
    const full = query()!;
    expect(query()).toBe(full);
    expect(
      cache.query(spec, layer, dataset, null, new AffineTransform(), [-200, -200, 200, 200]),
    ).toBe(full);
    const partial = cache.query(spec, layer, dataset, null, new AffineTransform(), [-4, -4, 4, 4]);
    expect(
      cache.query(spec, layer, dataset, null, new AffineTransform(1, -1, 50, 50), [-4, -4, 4, 4]),
    ).toBe(partial);
  });

  it('does not merge finite coordinates through overflowing or unsafe grid indices', () => {
    const { layer, cache, spec, dataset, bounds } = fixture();
    layer.shapes = Array.from({ length: 20_000 }, (_, i) => [[1e300 + (i % 2) * 1e290, 1e300]]);
    expect(
      cache.query(spec, layer, dataset, null, new AffineTransform(1e300, -1e300), bounds),
    ).toBeNull();
    expect(cache.query(spec, layer, dataset, null, new AffineTransform(1, -1), bounds)).toBeNull();
  });
});

describe('bounded LOD fallback and painted crops', () => {
  it('refines the visible candidates instead of stretching a budget-limited global grid', () => {
    const layer: MapshaperLayer = {
      geometry_type: 'point',
      shapes: Array.from({ length: 160_000 }, (_, id) => [[id % 400, Math.floor(id / 400)]]),
    };
    const dataset = { layers: [layer] };
    const spec: CircleLayerSpecification = { id: 'dots', source: 's', type: 'circle' };
    const cache = new PointLod();
    for (const scale of [0.5, 1, 2, 3]) {
      const bounds = [0, 0, 128 / scale, 128 / scale];
      const ids = Uint32Array.from(
        Array.from({ length: 160_000 }, (_, id) => id).filter(
          (id) => id % 400 <= bounds[2] && Math.floor(id / 400) <= bounds[3],
        ),
      );
      const selection = cache.query(
        spec,
        layer,
        dataset,
        null,
        new AffineTransform(scale, -scale, 0, 128),
        bounds,
        { width: 128, height: 128, getCandidates: () => ids, painting: true },
      );
      // Still dense at these scales: only show original representatives, at the
      // requested screen spacing, even once the local feature count is small.
      expect(selection).not.toBeNull();
      const row = [...selection!.featureIds].filter((id) => id < 400);
      expect((row[1] - row[0]) * scale).toBeLessThanOrEqual(8);
      expect(selection!.featureIds.length).toBeLessThanOrEqual(2048);
      expect(cache.queryPainted(spec, layer, dataset, null, bounds)).toEqual(selection);
    }
  });

  it('coarsens rather than disabling dense data when the viewport budget is exceeded', () => {
    const { query, cache, spec, layer, dataset } = fixture();
    expect(query()).not.toBeNull();
    const view = { width: 16, height: 16 };
    const coarse = cache.query(
      spec,
      layer,
      dataset,
      null,
      new AffineTransform(32, -32),
      [-100, -100, 100, 100],
      view,
    )!;
    expect(coarse).not.toBeNull();
    expect(coarse.featureIds.length).toBeLessThanOrEqual(32);
    for (const shape of layer.shapes!)
      Object.defineProperty(shape!, '0', {
        get() {
          throw new Error('budget rescan');
        },
      });
    expect(
      cache.query(
        spec,
        layer,
        dataset,
        null,
        new AffineTransform(64, -64),
        [-100, -100, 100, 100],
        view,
      ),
    ).toBe(coarse);
  });

  it('refines the full viewport when the candidate index declines a broad query', () => {
    const { cache, spec, layer, dataset } = fixture();
    const bounds = [0, 0, 0.5, 0.5];
    const view = { width: 16, height: 16, bounds, getCandidates: () => null };
    const transform = new AffineTransform(32, -32, 0, 16);
    const result = cache.query(spec, layer, dataset, null, transform, bounds, view)!;
    expect(result.featureIds.length).toBeGreaterThan(4);
    expect(result.featureIds.length).toBeLessThanOrEqual(32);
    // A pointer rectangle must use the same full-view representatives.
    const tiny = [0, 0, 0.1, 0.1];
    const picked = cache.query(spec, layer, dataset, null, transform, tiny, view)!;
    expect([...picked.featureIds]).toEqual(
      [...result.featureIds].filter((id) => {
        const p = layer.shapes![id]![0] as number[];
        return p[0] <= tiny[2] && p[1] <= tiny[3];
      }),
    );
    for (const shape of layer.shapes!)
      Object.defineProperty(shape!, '0', {
        get() {
          throw new Error('warm local rescan');
        },
      });
    expect(cache.query(spec, layer, dataset, null, transform, bounds, view)).toEqual(result);
    // Small pans inside the cached overscan must not scan hidden coordinates.
    expect(() =>
      cache.query(spec, layer, dataset, null, transform, [0.01, 0, 0.51, 0.5], {
        ...view,
        bounds: [0.01, 0, 0.51, 0.5],
      }),
    ).not.toThrow();
  });

  it('keeps local source order, filters and MultiPoint identity when candidate rows repeat', () => {
    const { cache, spec, layer, dataset } = fixture();
    const candidates = new Uint32Array([2, 1, 2, 0]);
    layer.shapes![0] = [
      [0, 0],
      [0.3, 0],
    ];
    layer.shapes![1] = [
      [0.1, 0],
      [0.4, 0],
    ];
    layer.shapes![2] = [
      [0.2, 0],
      [0.5, 0],
    ];
    const mask = new Uint8Array(layer.shapes!.length).fill(1);
    mask[0] = 0;
    const transform = new AffineTransform(32, -32);
    const bounds = [-100, -100, 100, 100];
    const view = { width: 16, height: 16, getCandidates: () => candidates };
    const query = () => cache.query(spec, layer, dataset, mask, transform, bounds, view)!;
    const result = query();
    expect([...result.featureIds]).toEqual([1, 1, 2]);
    expect([...result.componentIds]).toEqual([0, 1, 1]);
    expect([...candidates]).toEqual([2, 1, 2, 0]);
    expect(query()).toBe(result);
    mask[1] = 0;
    dataset.attributeVersion!++;
    // Both surviving components occupy separate cells, so full detail is safe.
    expect(query()).toBeNull();
  });

  it('does not reuse a local selection for different candidates on pan', () => {
    const { cache, spec, layer, dataset } = fixture();
    const transform = new AffineTransform(32, -32);
    const bounds = [-100, -100, 100, 100];
    const query = (ids: number[]) =>
      cache.query(spec, layer, dataset, null, transform, bounds, {
        width: 16,
        height: 16,
        getCandidates: () => Uint32Array.from(ids),
      })!;
    const first = query([0, 1, 2, 3]);
    expect(query([0, 1, 2, 3])).toBe(first);
    const next = query([100, 101, 102, 103]);
    expect(next).not.toBe(first);
    expect([...next.featureIds].every((id) => id >= 100)).toBe(true);
  });

  it('does not mistake a small feature candidate count for sparse MultiPoint data', () => {
    const { cache, spec, layer, dataset } = fixture();
    layer.shapes = [
      Array.from({ length: 20_000 }, (_, id) => [(id % 200) / 10, Math.floor(id / 200) / 10]),
    ];
    const result = cache.query(
      spec,
      layer,
      dataset,
      null,
      new AffineTransform(32, -32),
      [-100, -100, 100, 100],
      { width: 16, height: 16, getCandidates: () => new Uint32Array([0]) },
    );
    expect(result).not.toBeNull();
    expect(result!.featureIds.length).toBeLessThanOrEqual(32);
  });

  it('never picks an unpainted offscreen representative after a CSS snapshot pan', () => {
    const { cache, spec, layer, dataset } = fixture();
    cache.query(spec, layer, dataset, null, new AffineTransform(), [-4, -4, 4, 4], {
      width: 100,
      height: 100,
      painting: true,
    });
    expect(cache.queryPainted(spec, layer, dataset, null, [8, -5, 10, 5])!.featureIds).toHaveLength(
      0,
    );
  });
});
