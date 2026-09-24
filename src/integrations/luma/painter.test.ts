// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LumaPainter } from './painter';
import { GpuRenderer } from './gpu-renderer';
import { Viewport } from '../../domain/geo/viewport';
import { Bounds } from '../../domain/geo/bounds';
import type { ArcCollection } from '../../shared/types/mapshaper-types';
vi.mock('./gpu-renderer', () => ({ GpuRenderer: { create: vi.fn() } }));
vi.mock('./colors', () => ({
  GpuColors: class {
    reset() {}
    resolve() {
      return [1, 0, 0, 1];
    }
    dispose() {}
  },
}));
afterEach(() => vi.clearAllMocks());
async function fixture() {
  const gpu = {
    resize: vi.fn(),
    begin: vi.fn(() => true),
    end: vi.fn(),
    dispose: vi.fn(),
    createMesh: vi.fn((g) => ({ kind: g.kind, count: g.count, bytes: g.vertices.byteLength })),
    destroyMesh: vi.fn(),
    drawMesh: vi.fn(),
    stats: {},
    forgetImage: vi.fn(),
  };
  vi.mocked(GpuRenderer.create).mockResolvedValue(gpu as unknown as GpuRenderer);
  const painter = await LumaPainter.create(document.createElement('canvas'), 'webgl2', {
    invalidate: vi.fn(),
    report: vi.fn(),
  });
  const view = new Viewport();
  view.updateSize(800, 600);
  view.setExtent(new Bounds(0, 0, 100, 100));
  const arcs = {
    size: () => 3,
    getRetainedInterval: () => 0,
    arcIsSmaller: vi.fn(() => false),
    arcIntersectsBBox: vi.fn(() => true),
    getArcIter: vi.fn((id: number) => {
      let i = 0;
      const n = id < 0 ? ~id : id;
      return {
        x: 0,
        y: 0,
        hasNext() {
          if (i === 2) return false;
          this.x = n * 10 + i++;
          this.y = n * 10;
          return true;
        },
      };
    }),
  } as unknown as ArcCollection;
  painter.resize(800, 600);
  const frame = (draw: () => void, revision = 0, sourceId = 's') => {
    painter.setTransform(view.transform);
    painter.clear();
    painter.setLayerContext({ id: 'line', sourceId, revision });
    draw();
    painter.finishFrame();
  };
  return { painter, gpu, view, arcs, frame };
}
describe('formal GPU prepared path selection', () => {
  it('does not rescan viewport arc predicates on warm frames or paint-only changes', async () => {
    const f = await fixture(),
      ids = new Uint32Array([0, 1, 2]);
    f.frame(() => f.painter.drawArcs(f.arcs, { width: 1 }, f.view.getArcFilter(f.arcs), ids));
    f.frame(() =>
      f.painter.drawArcs(
        f.arcs,
        { width: 2, color: '#00ff00', dash: [2, 3] },
        f.view.getArcFilter(f.arcs),
        ids,
      ),
    );
    expect(f.arcs.arcIsSmaller).toHaveBeenCalledTimes(3);
    expect(f.gpu.createMesh).toHaveBeenCalledOnce();
    expect(f.gpu.drawMesh).toHaveBeenCalledTimes(2);
    f.painter.dispose();
  });
  it('rechecks a changed viewport but reuses geometry when the resulting ordered selection is identical', async () => {
    const f = await fixture();
    const draw = () => f.painter.drawArcs(f.arcs, { width: 1 }, f.view.getArcFilter(f.arcs));
    f.frame(draw);
    f.view.pan(1, 0);
    f.frame(draw);
    f.frame(draw);
    expect(f.arcs.arcIsSmaller).toHaveBeenCalledTimes(6);
    expect(f.gpu.createMesh).toHaveBeenCalledOnce();
    f.painter.dispose();
  });
  it('tracks mutable selector contents, geometry versions, scoped clear and signed path IDs', async () => {
    const f = await fixture(),
      ids = new Int32Array([0, ~1]);
    const draw = () => f.painter.drawArcs(f.arcs, { width: 1 }, f.view.getArcFilter(f.arcs), ids);
    f.frame(draw);
    ids[1] = ~2;
    f.frame(draw);
    f.frame(draw, 1);
    f.painter.clearGeometryCache({ sourceId: 's' });
    f.frame(draw, 1);
    expect(f.gpu.createMesh).toHaveBeenCalledTimes(4);
    expect(f.arcs.getArcIter).toHaveBeenCalledWith(~2);
    f.painter.dispose();
    expect(f.gpu.destroyMesh).toHaveBeenCalledTimes(4);
  });
  it('never memoizes arbitrary stateful caller predicates just because the function identity is unchanged', async () => {
    const f = await fixture();
    let visible = 0;
    const filter = vi.fn((id: number) => id === visible);
    f.frame(() => f.painter.drawArcs(f.arcs, { width: 1 }, filter));
    visible = 1;
    f.frame(() => f.painter.drawArcs(f.arcs, { width: 1 }, filter));
    expect(filter).toHaveBeenCalledTimes(6);
    expect(f.gpu.createMesh).toHaveBeenCalledTimes(2);
    f.painter.dispose();
  });
  it('memoizes ordered shape/bucket arc preparation and invalidates in-place bucket changes', async () => {
    const f = await fixture(),
      shapes = [[[0]], [[1]], [[~2]]],
      ids = new Uint32Array([0, 2]);
    const draw = () =>
      f.painter.drawPaths(shapes, { width: 1 }, f.arcs, f.view.getArcFilter(f.arcs), ids, 0);
    f.frame(draw);
    f.frame(draw);
    expect(f.arcs.arcIsSmaller).toHaveBeenCalledTimes(2);
    ids[1] = 1;
    f.frame(draw);
    expect(f.gpu.createMesh).toHaveBeenCalledTimes(2);
    f.painter.dispose();
  });
  it('invalidates a warm shape path when switching between ordinary dash and directional arrows', async () => {
    const f = await fixture(),
      shapes = [[[0, 1]]],
      ids = new Uint32Array([0]);
    f.frame(() =>
      f.painter.drawPaths(shapes, { width: 1 }, f.arcs, f.view.getArcFilter(f.arcs), ids, 0),
    );
    f.frame(() =>
      f.painter.drawPaths(
        shapes,
        { width: 1, dashType: 'arrow-dot' },
        f.arcs,
        f.view.getArcFilter(f.arcs),
        ids,
        0,
      ),
    );
    expect(f.gpu.createMesh.mock.calls.map(([geometry]) => geometry.kind)).toEqual([
      'path',
      'line',
    ]);
    f.painter.dispose();
  });
  it('invalidates retained-interval changes, revisions and changed visibility without changing original inputs', async () => {
    const f = await fixture(),
      ids = new Uint32Array([0, 1, 2]);
    let interval = 0,
      visible = 0;
    f.arcs.getRetainedInterval = () => interval;
    vi.mocked(f.arcs.arcIntersectsBBox!).mockImplementation((id) => id === visible);
    const draw = () => f.painter.drawArcs(f.arcs, { width: 1 }, f.view.getArcFilter(f.arcs), ids);
    f.frame(draw);
    interval = 2;
    f.frame(draw);
    visible = 1;
    f.frame(draw, 1);
    expect(f.gpu.createMesh).toHaveBeenCalledTimes(3);
    expect([...ids]).toEqual([0, 1, 2]);
    f.painter.dispose();
  });
  it('keeps legacy forward outline orientation and skips repeated candidate flattening', async () => {
    const f = await fixture();
    let reads = 0;
    const data = [[[~2, 1]], [[2, 0]]],
      shapes = new Proxy(data, {
        get(target, key, receiver) {
          if (key === '0' || key === '1') reads++;
          return Reflect.get(target, key, receiver);
        },
      });
    const ids = new Uint32Array([0, 1]);
    const draw = () =>
      f.painter.drawOutlinePaths(
        shapes,
        { width: 1, dash: [2, 3] },
        f.arcs,
        f.view.getArcFilter(f.arcs),
        ids,
        0,
      );
    f.frame(draw);
    const warmReads = reads;
    f.frame(draw);
    expect(reads).toBe(warmReads);
    expect(f.arcs.getArcIter).toHaveBeenCalledWith(2);
    expect(f.arcs.getArcIter).not.toHaveBeenCalledWith(~2);
    expect(f.gpu.createMesh).toHaveBeenCalledOnce();
    f.painter.dispose();
  });
  it('honors explicit shape geometry revisions even when the surrounding layer revision is unchanged', async () => {
    const f = await fixture(),
      shapes = [[[0]]],
      ids = new Uint32Array([0]);
    f.frame(() =>
      f.painter.drawPaths(shapes, { width: 1 }, f.arcs, f.view.getArcFilter(f.arcs), ids, 0),
    );
    f.frame(() =>
      f.painter.drawPaths(shapes, { width: 1 }, f.arcs, f.view.getArcFilter(f.arcs), ids, 1),
    );
    expect(f.gpu.createMesh).toHaveBeenCalledTimes(2);
    f.painter.dispose();
  });
});

it('invalidates the retained image after a failed GPU submission', async () => {
  const f = await fixture();
  const draw = () => f.painter.drawArcs(f.arcs, { width: 1 });
  f.frame(draw);
  expect(f.painter.frameComplete).toBe(true);
  f.gpu.drawMesh.mockImplementationOnce(() => {
    throw new Error('device submission failed');
  });
  expect(() => f.frame(draw)).toThrow('device submission failed');
  expect(f.painter.frameComplete).toBe(false);
  expect(f.painter.frameRetained).toBe(false);
  expect(Reflect.get(f.painter, 'paintedContent')).toBeNull();
  f.painter.dispose();
});
