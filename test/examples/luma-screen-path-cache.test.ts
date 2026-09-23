import { describe, expect, it, vi } from 'vitest';
import { ScreenPathCache } from '../../packages/examples/src/luma-benchmark/screen-path-cache';
import {
  emptyScreenPathStats,
  type ScreenPathRequest,
  type ScreenPathPacket,
} from '../../src/engine/rendering/luma/screen-paths';
const req = (x = 0): ScreenPathRequest => ({
  view: [1, 1, x, 0],
  width: 100,
  height: 100,
  pixelRatio: 1,
  initialScale: 1,
  smallArcs: true,
  halfPixel: true,
  cull: true,
  padding: 8,
  revision: 0,
});
const chunks = [{ id: 0, kind: 'line', layer: 0 }] as any;
const packet = (): ScreenPathPacket => ({
  geometry: { kind: 'path', vertices: new Float32Array(28), count: 1, segmentCount: 1 },
  coordinates: new Float64Array(4),
  offsets: new Uint32Array([0, 2]),
  arcIds: new Uint32Array([0]),
  stats: emptyScreenPathStats(),
  fallback: false,
});
function fixture(build = vi.fn(async () => packet())) {
  const source = { buildScreenPaths: build } as any,
    gpu = { createMesh: vi.fn(() => ({})), destroyMesh: vi.fn() } as any;
  const invalid = vi.fn(),
    report = vi.fn(),
    cache = new ScreenPathCache(source, gpu, invalid, report);
  return { cache, gpu, build, invalid, report };
}
describe('view-keyed screen path cache', () => {
  it('reuses identical views and invalidates DPR/translation/revision, keeping one resident view', async () => {
    const { cache, gpu, build } = fixture();
    const signal = new AbortController().signal;
    await cache.warm(req(), chunks, signal);
    await cache.warm(req(), chunks, signal);
    expect(build).toHaveBeenCalledTimes(1);
    expect(cache.get(req(1), chunks)).toBeNull();
    await cache.warm(req(1), chunks, signal);
    expect(gpu.destroyMesh).toHaveBeenCalledTimes(1);
    await cache.warm({ ...req(1), pixelRatio: 2 }, chunks, signal);
    await cache.warm({ ...req(1), revision: 1 }, chunks, signal);
    expect(build).toHaveBeenCalledTimes(4);
    cache.dispose();
    expect(gpu.destroyMesh).toHaveBeenCalledTimes(4);
  });
  it('does not upload a superseded worker response, and coalesces requests to the latest view', async () => {
    let finish!: (p: ScreenPathPacket) => void;
    const build = vi
      .fn()
      .mockImplementationOnce(() => new Promise((r) => (finish = r)))
      .mockImplementation(async () => packet());
    const { cache, gpu } = fixture(build);
    cache.request(req(), chunks);
    cache.request(req(1), chunks);
    cache.request(req(2), chunks);
    finish(packet());
    await cache.warm(req(2), chunks, new AbortController().signal);
    expect(build).toHaveBeenCalledTimes(2);
    expect(gpu.createMesh).toHaveBeenCalledTimes(1);
    expect(cache.get(req(2), chunks)).not.toBeNull();
    cache.dispose();
  });
  it('does not upload during a gesture or after disposal/edit invalidation', async () => {
    let finish!: (p: ScreenPathPacket) => void;
    const { cache, gpu } = fixture(vi.fn(() => new Promise((r) => (finish = r))) as any);
    cache.request(req(), chunks);
    cache.pause(true);
    finish(packet());
    await Promise.resolve();
    await Promise.resolve();
    expect(gpu.createMesh).not.toHaveBeenCalled();
    cache.pause(false);
    cache.dispose();
    cache.request(req(1), chunks);
    expect(gpu.createMesh).not.toHaveBeenCalled();
  });
  it('reports worker errors once per exact key and preserves usable original-path fallback', async () => {
    const { cache, gpu, report, build } = fixture(
      vi.fn(async () => {
        throw Error('failed');
      }) as any,
    );
    await cache.warm(req(), chunks, new AbortController().signal);
    await cache.warm(req(), chunks, new AbortController().signal);
    expect(cache.failed(req(), chunks)).toBe(true);
    expect(report).toHaveBeenCalledOnce();
    expect(build).toHaveBeenCalledOnce();
    expect(gpu.createMesh).not.toHaveBeenCalled();
    cache.dispose();
  });
});

it('refreshes only affected packets and retains the old complete revision until replacement is ready', async () => {
  const { cache, build, gpu } = fixture();
  const two = [
    { id: 0, kind: 'line', layer: 0 },
    { id: 1, kind: 'line', layer: 0 },
  ] as any;
  const signal = new AbortController().signal;
  await cache.warm(req(), two, signal);
  const old = cache.get(req(), two)!,
    untouched = old.get(1);
  let finish!: (p: ScreenPathPacket) => void;
  build.mockImplementationOnce(() => new Promise((r) => (finish = r)));
  const update = cache.warmChanged({ ...req(), revision: 1 }, two, new Set([0]), signal);
  expect(cache.get(req(), two)).toBe(old);
  expect(gpu.destroyMesh).not.toHaveBeenCalled();
  finish(packet());
  await update;
  expect(build).toHaveBeenCalledTimes(3);
  expect(cache.get({ ...req(), revision: 1 }, two)!.get(1)).toBe(untouched);
  expect(gpu.destroyMesh).toHaveBeenCalledTimes(1);
  cache.dispose();
  expect(gpu.destroyMesh).toHaveBeenCalledTimes(3);
});
