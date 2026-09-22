import { PerspectiveTransform } from '../../src/domain/geo/perspective-transform';
import { describe, expect, it, vi } from 'vitest';
import { PointLodRenderCache } from '../../packages/examples/src/luma-benchmark/point-lod-cache';
import { AffineTransform } from '../../src/domain/geo/transform';
import { pointsFromShapes } from '../../src/engine/rendering/luma/geometry';
import type { PointLodPacket } from '../../src/engine/rendering/luma/point-lod-source';
import type {
  ChunkGeometryAccess,
  SpatialChunk,
} from '../../src/engine/rendering/luma/spatial-chunks';
import type { GpuRenderer } from '../../src/integrations/luma/gpu-renderer';
const dataset = {
  layers: [{ geometry_type: 'point' as const, shapes: [[[2, 3] as [number, number]]] }],
};
const chunk: SpatialChunk = {
  id: 0,
  layer: 0,
  kind: 'point',
  ids: new Uint32Array([0]),
  bounds: [2, 3, 2, 3],
  rawVertices: 1,
};
const dims = [800, 600, 1],
  view = new AffineTransform(1, -1, 0, 0),
  signal = () => new AbortController().signal;
function packet(key = 'a'): PointLodPacket[] {
  return [
    {
      layer: 0,
      key,
      count: 1,
      sourcePoints: 1,
      featureIds: new Uint32Array([0]),
      componentIds: new Uint32Array([0]),
      geometry: pointsFromShapes(dataset.layers[0].shapes),
    },
  ];
}
function setup(query = vi.fn(async () => packet())) {
  const gpu = { createMesh: vi.fn(() => ({ bytes: 16 })), destroyMesh: vi.fn() },
    invalidate = vi.fn(),
    report = vi.fn();
  const source = { chunks: [chunk], queryPointLod: query } as unknown as ChunkGeometryAccess;
  return {
    gpu,
    query,
    invalidate,
    report,
    cache: new PointLodRenderCache(
      source,
      dataset,
      gpu as unknown as GpuRenderer,
      invalidate,
      report,
    ),
  };
}
describe('point LOD view/upload lifecycle', () => {
  it('defaults to 3 CSS px and reuses GPU geometry on pan and DPR changes', async () => {
    const f = setup();
    await f.cache.warm(view, dims, [chunk], signal());
    await f.cache.warm(new AffineTransform(1, -1, 40, 20), [800, 600, 2], [chunk], signal());
    expect(f.cache.cellSize).toBe(3);
    expect(f.query).toHaveBeenCalledOnce();
    expect(f.gpu.createMesh).toHaveBeenCalledOnce();
    expect(f.cache.view(view, dims, [chunk]).get(0)!.display.shapes).toEqual(
      dataset.layers[0].shapes,
    );
    f.cache.clear();
    expect(f.gpu.destroyMesh).toHaveBeenCalledOnce();
    expect(f.cache.stats.cacheBytes).toBe(0);
  });
  it('drops an in-flight response after disabling LOD and never uploads stale buffers', async () => {
    let complete!: (p: PointLodPacket[]) => void;
    const f = setup(
      vi.fn(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      ),
    );
    const task = f.cache.warm(view, dims, [chunk], signal());
    const assertion = expect(task).rejects.toThrow('Stale');
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    f.cache.configure(false, 3);
    complete(packet());
    await assertion;
    expect(f.gpu.createMesh).not.toHaveBeenCalled();
    expect(f.cache.view(view, dims, [chunk]).size).toBe(0);
  });
  it('coalesces an interaction burst to the newest scale instead of queuing all intermediate views', async () => {
    const replies: ((p: PointLodPacket[]) => void)[] = [];
    const f = setup(
      vi.fn(
        () =>
          new Promise((resolve) => {
            replies.push(resolve);
          }),
      ),
    );
    f.cache.request(view, dims, [chunk]);
    await vi.waitFor(() => expect(replies).toHaveLength(1));
    for (const scale of [0.5, 0.25, 0.125])
      f.cache.request(new AffineTransform(scale, -scale, 0, 0), dims, [chunk]);
    replies[0](packet('old'));
    await vi.waitFor(() => expect(replies).toHaveLength(2));
    expect(f.query.mock.calls[1][0].transform.mx).toBe(0.125);
    replies[1](packet('latest'));
    await vi.waitFor(() => expect(f.invalidate).toHaveBeenCalledOnce());
    expect(f.cache.stats.pending).toBe(0);
    expect(f.report).not.toHaveBeenCalled();
    f.cache.clear();
  });
  it('off/cell changes release buffers, validate before changing state, and permit rebuilding', async () => {
    const f = setup();
    await f.cache.warm(view, dims, [chunk], signal());
    expect(() => f.cache.configure(true, 0)).toThrow();
    expect(f.cache.stats.cacheEntries).toBe(1);
    f.cache.configure(false, 3);
    expect(f.gpu.destroyMesh).toHaveBeenCalledOnce();
    await f.cache.warm(view, dims, [chunk], signal());
    expect(f.query).toHaveBeenCalledOnce();
    f.cache.configure(true, 6);
    await f.cache.warm(view, dims, [chunk], signal());
    expect(f.query).toHaveBeenCalledTimes(2);
    f.cache.clear();
  });
});

it('uses perspective ground resolution without discarding existing original-point LOD', async () => {
  const f = setup(),
    camera = new PerspectiveTransform(view, 800, 600, { pitch: 60, bearing: 40 });
  await f.cache.warm(camera, dims, [chunk], signal());
  const request = f.query.mock.calls[0][0] as unknown as { transform: { mx: number; my: number } };
  expect(Math.abs(request.transform.mx)).toBeCloseTo(1 / camera.groundResolution(), 8);
  expect(Math.abs(request.transform.mx)).toBeGreaterThan(Math.abs(view.mx));
  camera.pan(12, -8);
  await f.cache.warm(camera, dims, [chunk], signal());
  expect(f.query).toHaveBeenCalledOnce();
  expect(f.gpu.createMesh).toHaveBeenCalledOnce();
  f.cache.clear();
});
