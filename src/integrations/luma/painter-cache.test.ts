import { describe, expect, it, vi } from 'vitest';
import { PainterGeometryCache } from './painter-cache';
import type { GpuRenderer } from './gpu-renderer';
const geometry = () => ({
  kind: 'point' as const,
  vertices: new Float32Array([1, 2, 0, 0]),
  count: 1,
});
function fixture(limit?: number) {
  const gpu = {
    createMesh: vi.fn((g) => ({ kind: g.kind, count: g.count, bytes: g.vertices.byteLength })),
    destroyMesh: vi.fn(),
  };
  return { gpu, cache: new PainterGeometryCache(gpu as unknown as GpuRenderer, limit) };
}
describe('formal painter geometry cache', () => {
  it('reuses coordinates across frames and selector copies, but not changed selections or revisions', () => {
    const { cache, gpu } = fixture();
    const shapes = [];
    const build = vi.fn(geometry);
    for (let i = 0; i < 2; i++) {
      cache.begin();
      cache.contextFor({ id: 'p', sourceId: 's', revision: 0 });
      cache.get(
        { references: [shapes], values: ['point'], selections: [new Uint32Array([0])] },
        build,
      );
      cache.finish();
    }
    expect(build).toHaveBeenCalledOnce();
    expect(gpu.createMesh).toHaveBeenCalledOnce();
    cache.begin();
    cache.contextFor({ id: 'p', sourceId: 's', revision: 1 });
    cache.get(
      { references: [shapes], values: ['point'], selections: [new Uint32Array([0])] },
      build,
    );
    cache.finish();
    expect(build).toHaveBeenCalledTimes(2);
    expect(gpu.destroyMesh).toHaveBeenCalledOnce();
    cache.begin();
    cache.contextFor({ id: 'p', sourceId: 's', revision: 1 });
    cache.get(
      { references: [shapes], values: ['point'], selections: [new Uint32Array([1])] },
      build,
    );
    cache.finish();
    expect(build).toHaveBeenCalledTimes(3);
  });
  it('releases hidden owners, scoped sources and ephemeral highlights', () => {
    const { cache, gpu } = fixture();
    cache.begin();
    for (const id of ['a', 'b']) {
      cache.contextFor({ id, sourceId: id, revision: 0 });
      cache.get({ references: [], values: ['point'] }, geometry);
    }
    cache.finish();
    cache.clear({ sourceId: 'a' });
    expect(cache.stats.entries).toBe(1);
    cache.begin();
    cache.contextFor(null);
    cache.get({ references: [], values: ['highlight'] }, geometry);
    cache.finish();
    expect(cache.stats).toEqual({ entries: 0, bytes: 0 });
    expect(gpu.destroyMesh).toHaveBeenCalledTimes(3);
  });
  it('only applies the budget after submission and does not cache failed allocations', () => {
    const { cache, gpu } = fixture(1);
    cache.begin();
    cache.contextFor({ id: 'a', sourceId: 's', revision: 0 });
    cache.get({ references: [], values: ['point'] }, geometry);
    expect(cache.stats.bytes).toBeGreaterThan(1);
    expect(gpu.destroyMesh).not.toHaveBeenCalled();
    cache.finish();
    expect(cache.stats.bytes).toBe(0);
    cache.begin();
    gpu.createMesh.mockImplementationOnce(() => {
      throw new Error('allocation');
    });
    expect(() => cache.get({ references: [], values: ['point'] }, geometry)).toThrow('allocation');
    expect(cache.stats.entries).toBe(0);
  });
});

describe('two-stage prepared geometry caching', () => {
  it('skips preparation on equal snapshots, including selector copies, and retains geometry across different views', () => {
    const { cache, gpu } = fixture();
    const ids = new Uint32Array([1, 2]);
    const prepare = vi.fn(() => ({
      key: { references: [], values: ['path'], selections: [ids] },
      build: geometry,
    }));
    const frame = (view: number, selection = ids) => {
      cache.begin();
      cache.contextFor({ id: 'p', sourceId: 's', revision: 0 });
      cache.getPrepared({ references: [], values: [view], selections: [selection] }, prepare);
      cache.finish();
    };
    frame(1);
    frame(1, ids.slice());
    expect(prepare).toHaveBeenCalledOnce();
    frame(2);
    frame(2);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(gpu.createMesh).toHaveBeenCalledOnce();
    ids[1] = 3;
    frame(2);
    expect(gpu.createMesh).toHaveBeenCalledTimes(2);
    expect(cache.stats.bytes).toBe(geometry().vertices.byteLength + ids.byteLength * 2);
    cache.clear();
    expect(cache.stats).toEqual({ entries: 0, bytes: 0 });
  });
  it('accounts for changed preparation snapshots, with deferred budget eviction and no dangling owner references', () => {
    const { cache, gpu } = fixture(24),
      prepare = () => ({ key: { references: [], values: ['path'] }, build: geometry });
    cache.begin();
    cache.contextFor({ id: 'p', sourceId: 's', revision: 0 });
    cache.getPrepared({ references: [], values: [0], selections: [new Uint32Array([1])] }, prepare);
    cache.finish();
    expect(cache.stats.bytes).toBe(20);
    cache.begin();
    cache.contextFor({ id: 'p', sourceId: 's', revision: 0 });
    cache.getPrepared(
      { references: [], values: [1], selections: [new Uint32Array([1, 2, 3])] },
      prepare,
    );
    expect(cache.stats.bytes).toBe(28);
    expect(gpu.destroyMesh).not.toHaveBeenCalled();
    cache.finish();
    expect(cache.stats).toEqual({ entries: 0, bytes: 0 });
    expect(gpu.destroyMesh).toHaveBeenCalledOnce();
  });
  it('does not publish failed preparation keys or replace the old mesh on a failed allocation', () => {
    const { cache, gpu } = fixture();
    const draw = (view: number, prepare: () => any) => {
      cache.begin();
      cache.contextFor({ id: 'p', sourceId: 's', revision: 0 });
      return cache.getPrepared({ references: [], values: [view] }, prepare);
    };
    const good = () => ({ key: { references: [], values: [0] }, build: geometry });
    draw(1, good);
    cache.finish();
    expect(() =>
      draw(2, () => {
        throw new Error('selection');
      }),
    ).toThrow('selection');
    gpu.createMesh.mockImplementationOnce(() => {
      throw new Error('allocation');
    });
    expect(() =>
      draw(2, () => ({ key: { references: [], values: [1] }, build: geometry })),
    ).toThrow('allocation');
    expect(cache.stats.entries).toBe(1);
    expect(gpu.destroyMesh).not.toHaveBeenCalled();
    const retry = vi.fn(good);
    draw(2, retry);
    cache.finish();
    expect(retry).toHaveBeenCalledOnce();
    cache.clear({ sourceId: 's' });
    expect(cache.stats.bytes).toBe(0);
  });
});

it('retains a displayed replay frame above the soft limit but rejects new allocations above the hard limit', () => {
  const gpu = {
      createMesh: vi.fn((g) => ({ kind: g.kind, count: g.count, bytes: g.vertices.byteLength })),
      destroyMesh: vi.fn(),
    },
    reserve = vi.fn();
  const cache = new PainterGeometryCache(gpu as unknown as GpuRenderer, 10, true, reserve);
  cache.begin();
  cache.contextFor({ id: 'p', sourceId: 's', revision: 0 });
  cache.get({ references: [], values: ['point'] }, geometry);
  cache.finish();
  expect(cache.stats.bytes).toBe(16);
  expect(gpu.destroyMesh).not.toHaveBeenCalled();
  expect(reserve).toHaveBeenCalledWith(16);
  cache.begin();
  cache.contextFor({ id: 'p', sourceId: 's', revision: 0 });
  cache.get({ references: [], values: ['point'] }, geometry);
  cache.contextFor({ id: 'q', sourceId: 's', revision: 0 });
  expect(() => cache.get({ references: [], values: ['point'] }, geometry)).toThrow('bounded');
  expect(gpu.createMesh).toHaveBeenCalledOnce();
  cache.clear();
  expect(cache.stats.bytes).toBe(0);
});

it('clears every immediate mesh and reference when one GPU destruction fails', () => {
  let releases = 0;
  const gpu: any = {
    createMesh: (g: any) => ({ bytes: g.vertices.byteLength }),
    destroyMesh: () => {
      if (++releases === 1) throw new Error('destroy failed');
    },
  };
  const cache = new PainterGeometryCache(gpu);
  cache.begin();
  cache.contextFor({ id: 'layer', sourceId: 'source', revision: 0 });
  for (let i = 0; i < 2; i++)
    cache.get({ references: [], values: [i] }, () => ({
      kind: 'point',
      count: 1,
      vertices: new Float32Array(4),
    }));
  expect(() => cache.clear()).toThrow();
  expect(releases).toBe(2);
  expect(cache.stats).toEqual({ entries: 0, bytes: 0 });
});
