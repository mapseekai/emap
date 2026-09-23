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
