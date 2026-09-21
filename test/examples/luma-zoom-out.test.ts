import { describe, expect, it, vi } from 'vitest';
import { BenchmarkRenderers } from '../../packages/examples/src/luma-benchmark/renderers';
import { AffineTransform } from '../../src/domain/geo/transform';
import { emptyScreenPathStats } from '../../src/engine/rendering/luma/screen-paths';
const view = new AffineTransform(2, -2, 10, 20);
const line = { id: 1, kind: 'line', layer: 0, rawVertices: 10 };
const fill = { id: 2, kind: 'fill', layer: 0, rawVertices: 10 };
const packet = {
  fallback: false,
  geometry: { count: 2, segmentCount: 1 },
  stats: emptyScreenPathStats(),
};
function fixture(chunks: any[] = [line]) {
  const source = { visible: () => chunks, build: vi.fn() },
    screen = new Map([[line.id, { packet, mesh: { kind: 'path' } }]]);
  const gpu = {
    begin: vi.fn(() => true),
    end: vi.fn(),
    drawMesh: vi.fn(),
    stats: { drawCalls: 0 },
    destroyMesh: vi.fn(),
  };
  const r: any = Object.assign(Object.create(BenchmarkRenderers.prototype), {
    source,
    scene: { dataset: { editVersion: 0, layers: [{ geometry_type: 'polyline' }] }, tiles: [] },
    cache: new Map(),
    geometryMetadata: new Map(),
    dimensions: [100, 100, 1],
    selected: [],
    screenPaths: { request: vi.fn(), get: () => screen, failed: () => false },
    smallArcFilterEnabled: true,
    halfPixelFilterEnabled: true,
    initialScale: 2,
    passMode: 'all',
    pointPaint: { radius: 3, color: [0, 0, 1, 1] },
    signature: '',
    generation: 1,
    interacting: false,
    disposed: false,
    clock: 0,
    cacheBytes: 0,
    building: new Map(),
    gpu,
    lodStats: { builds: 0, evictions: 0 },
    refillStats: { lineBuilds: 0, fillBuilds: 0, pointBuilds: 0 },
    navigation: { preview: vi.fn(() => true), reset: vi.fn(), hold: vi.fn(() => false) },
    report: vi.fn(),
    invalidate: vi.fn(),
  });
  return { r: r as BenchmarkRenderers, source, screen, gpu };
}
describe('near-to-far render dependency regression', () => {
  it('submits prepared screen paths even after their raw GPU chunks are evicted', () => {
    const { r, gpu, screen } = fixture();
    r.draw('luma', view, undefined, screen as any);
    expect(gpu.drawMesh).toHaveBeenCalledOnce();
    expect(r.lodStats.missingChunks).toBe(0);
    expect(r.lodStats.submittedSegments).toBe(1);
  });
  it('does not schedule raw path rebuilds before usable screen commands', async () => {
    const { r, source } = fixture();
    const ensure = vi.fn();
    Reflect.set(r, 'ensure', ensure);
    r.requestView(view);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ensure).not.toHaveBeenCalled();
    expect(source.build).not.toHaveBeenCalled();
  });
  it('an empty filtered packet is ready, not a missing raw chunk', () => {
    const { r, screen, gpu } = fixture();
    screen.set(line.id, {
      packet: { ...packet, geometry: { count: 0, segmentCount: 0 } },
      mesh: null,
    } as any);
    r.draw('luma', view, undefined, screen as any);
    expect(r.lodStats.missingChunks).toBe(0);
    expect(gpu.drawMesh).not.toHaveBeenCalled();
  });
  it('re-evaluates eviction when visible chunks change even with zero raw dependencies', () => {
    const { r } = fixture();
    const trim = vi.fn();
    Reflect.set(r, 'trim', trim);
    r.requestView(view);
    Reflect.set(r, 'source', { visible: () => [] });
    r.requestView(view);
    expect(trim).toHaveBeenCalledTimes(2);
  });
  it('still requests raw geometry when screen filtering explicitly falls back', async () => {
    const { r, screen } = fixture();
    screen.set(line.id, { packet: { ...packet, fallback: true }, mesh: null } as any);
    const ensure = vi.fn(async () => {});
    Reflect.set(r, 'ensure', ensure);
    r.requestView(view);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ensure).toHaveBeenCalledOnce();
  });
  it('tracks the newest preview view instead of restarting the previous near view at release', () => {
    const { r } = fixture();
    r.drawInteractive('luma', view);
    expect(Reflect.get(r, 'pendingTransform')).toEqual(view);
  });
  it('retains expensive fill triangulations before evictable raw path caches within the same budget', () => {
    const { r, gpu } = fixture([]);
    const cache = new Map([
      [1, { display: { chunk: line, bytes: 220 * 1024 ** 2 }, mesh: {}, used: 99 }],
      [2, { display: { chunk: fill, bytes: 120 * 1024 ** 2 }, mesh: {}, used: 1 }],
    ]);
    Reflect.set(r, 'cache', cache);
    Reflect.set(r, 'cacheBytes', 340 * 1024 ** 2);
    Reflect.set(r, 'pinned', null);
    Reflect.get(r, 'trim').call(r);
    expect(cache.has(2)).toBe(true);
    expect(cache.has(1)).toBe(false);
    expect(gpu.destroyMesh).toHaveBeenCalledOnce();
  });
  it('keeps the byte budget when retained fills alone exceed it', () => {
    const { r } = fixture([]);
    const cache = new Map([
      [1, { display: { chunk: { ...fill, id: 1 }, bytes: 200 * 1024 ** 2 }, mesh: {}, used: 1 }],
      [2, { display: { chunk: fill, bytes: 120 * 1024 ** 2 }, mesh: {}, used: 2 }],
    ]);
    Reflect.set(r, 'cache', cache);
    Reflect.set(r, 'cacheBytes', 320 * 1024 ** 2);
    Reflect.set(r, 'pinned', null);
    Reflect.get(r, 'trim').call(r);
    expect(Reflect.get(r, 'cacheBytes')).toBeLessThanOrEqual(256 * 1024 ** 2);
    expect(cache.size).toBe(1);
  });
  it('does not change layer or fill/stroke submission order when raw paths are absent', () => {
    const { r, gpu, screen } = fixture([fill, line]);
    Reflect.set(
      r,
      'cache',
      new Map([
        [
          fill.id,
          {
            display: { chunk: fill, geometry: { count: 3 }, points: 3 },
            mesh: { kind: 'fill' },
            used: 0,
          },
        ],
      ]),
    );
    r.draw('luma', view, undefined, screen as any);
    expect(gpu.drawMesh.mock.calls.map((c) => c[0].kind)).toEqual(['fill', 'path']);
  });
});
