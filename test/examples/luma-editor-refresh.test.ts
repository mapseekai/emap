import { describe, expect, it, vi } from 'vitest';
import { BenchmarkRenderers } from '../../packages/examples/src/luma-benchmark/renderers';
import { AffineTransform } from '../../src/domain/geo/transform';
const chunks = [
  { id: 0, kind: 'fill', layer: 0, bounds: [0, 0, 10, 10] },
  { id: 1, kind: 'line', layer: 0, bounds: [0, 0, 10, 10] },
];
function fixture() {
  const gpu = { createMesh: vi.fn(() => ({})), destroyMesh: vi.fn(), stats: { drawCalls: 0 } };
  const source = { visible: () => chunks, patch: vi.fn(async () => chunks), build: vi.fn() };
  const old = chunks.map((c) => ({
    display: { chunk: c, points: 3, bytes: 64, geometry: { count: 3 } },
    mesh: { old: c.id },
    used: 0,
  }));
  const r: any = Object.assign(Object.create(BenchmarkRenderers.prototype), {
    source,
    scene: { dataset: { editVersion: 1, layers: [] } },
    generation: 0,
    renderRevision: 0,
    preparing: false,
    editing: false,
    disposed: false,
    interacting: true,
    dimensions: [100, 100, 1],
    initialScale: 1,
    smallArcFilterEnabled: false,
    halfPixelFilterEnabled: false,
    pathCullingEnabled: true,
    pointPaint: { radius: 3 },
    passMode: 'all',
    cache: new Map(old.map((e, i) => [i, e])),
    cacheBytes: 128,
    geometryMetadata: new Map(),
    building: new Map(),
    clock: 0,
    lodStats: { builds: 0, evictions: 0 },
    refillStats: { lineBuilds: 0, fillBuilds: 0, pointBuilds: 0 },
    editStats: {},
    gpu,
    navigation: { invalidateFrame: vi.fn() },
    invalidate: vi.fn(),
    report: vi.fn(),
    uploadSubmitMs: 0,
  });
  return { r: r as BenchmarkRenderers, source, gpu, old };
}
function display(c: any) {
  return {
    chunk: c,
    geometry: {
      kind: c.kind === 'fill' ? 'fill' : 'path',
      count: 3,
      vertices: new Float32Array(12),
    },
    bytes: 48,
    points: 3,
  };
}
describe('editor atomic cache handover', () => {
  it('keeps every old mesh drawable while changed chunks are building, then swaps the revision once', async () => {
    const { r, source, gpu, old } = fixture();
    let finish!: (d: any) => void;
    source.build
      .mockImplementationOnce(async () => display(chunks[0]))
      .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const update = r.applyEdit(
      { revision: 1, vertices: [], points: [] },
      new AffineTransform(),
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(source.build).toHaveBeenCalledTimes(2));
    expect([...Reflect.get(r, 'cache').values()]).toEqual(old);
    expect(gpu.destroyMesh).not.toHaveBeenCalled();
    expect(r.displayRevision).toBe(0);
    finish(display(chunks[1]));
    await update;
    expect(gpu.destroyMesh).toHaveBeenCalledTimes(2);
    expect(r.displayRevision).toBe(1);
    expect(r.editStats.pending).toBe(false);
  });
  it('does not erase the last valid scene when a replacement build fails', async () => {
    const { r, source, gpu, old } = fixture();
    source.build
      .mockImplementationOnce(async () => display(chunks[0]))
      .mockRejectedValueOnce(new Error('failed'));
    await expect(
      r.applyEdit(
        { revision: 1, vertices: [], points: [] },
        new AffineTransform(),
        new AbortController().signal,
      ),
    ).rejects.toThrow('failed');
    expect([...Reflect.get(r, 'cache').values()]).toEqual(old);
    expect(r.displayRevision).toBe(0);
    expect(gpu.destroyMesh).toHaveBeenCalledTimes(1);
  });
  it('does not draw an incomplete first scene during preparation', () => {
    const { r } = fixture();
    Reflect.set(r, 'preparing', true);
    expect(r.draw('luma', new AffineTransform())).toBe(0);
    expect(r.drawInteractive('luma', new AffineTransform())).toBe(0);
  });
});
