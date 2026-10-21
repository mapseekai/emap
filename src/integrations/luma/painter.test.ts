// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LumaPainter } from './painter';
import { GpuRenderer } from './gpu-renderer';
import { Viewport } from '../../domain/geo/viewport';
import { Bounds } from '../../domain/geo/bounds';
import { AffineTransform } from '../../domain/geo/transform';
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
    pathMode: 'auto',
    pathRendering: { samples: 4 },
    strokeBatchingEnabled: true,
    resize: vi.fn(),
    begin: vi.fn(() => true),
    end: vi.fn(),
    dispose: vi.fn(),
    createMesh: vi.fn((g) => ({ kind: g.kind, count: g.count, bytes: g.vertices.byteLength })),
    destroyMesh: vi.fn(),
    drawMesh: vi.fn(),
    stats: {},
    forgetImage: vi.fn(),
    waitForIdle: vi.fn(async () => {}),
    probeCompletion: vi.fn(() => ({
      poll: () => 'complete' as 'pending' | 'complete' | 'unavailable',
      dispose: vi.fn(),
    })),
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
  it.each([
    { name: 'raw opaque MSAA', expected: true },
    { name: 'translucent', alpha: 0.5, expected: false },
    { name: 'dashed', dash: [2, 3], expected: false },
    { name: 'arrows', arrow: true, expected: false },
    { name: 'legacy', mode: 'legacy', expected: false },
    { name: 'single sample', samples: 1, expected: false },
    { name: 'batching disabled', batching: false, expected: false },
    { name: 'screen filtered', screen: true, expected: false },
    { name: 'unowned overlay', sourceSelection: false, expected: false },
  ])('gates spatial preparation for $name strokes', async (c) => {
    const f = await fixture();
    Reflect.set(f.arcs, 'getPointCount', () => 100_000);
    f.gpu.pathMode = c.mode ?? 'auto';
    f.gpu.pathRendering.samples = c.samples ?? 4;
    f.gpu.strokeBatchingEnabled = c.batching ?? true;
    f.painter.setScreenPathFiltering(c.screen ?? false);
    vi.spyOn(Reflect.get(f.painter, 'colors'), 'resolve').mockReturnValue([1, 0, 0, c.alpha ?? 1]);
    const request = vi.spyOn(Reflect.get(f.painter, 'chunks'), 'request');
    f.frame(() => {
      f.painter.setLayerContext({
        id: 'line',
        sourceId: 's',
        revision: 0,
        sourceSelection: c.sourceSelection ?? true,
      });
      f.painter.drawPaths(
        [[[2, 1, 0]]],
        { width: 1, dash: c.dash, ...(c.arrow ? { dashType: 'arrow-dot' as const } : {}) },
        f.arcs,
      );
    });
    expect(request.mock.calls).toHaveLength(1);
    expect(request.mock.calls[0][0]).toMatchObject({ spatialOrder: c.expected });
    f.painter.dispose();
  });
  it('retains one whole-layer request when panning large source-owned strokes', async () => {
    const f = await fixture();
    Reflect.set(f.arcs, 'getPointCount', () => 100_000);
    Reflect.set(f.gpu, 'compactStrokesEnabled', false);
    const cache = Reflect.get(f.painter, 'chunks');
    const request = vi.spyOn(cache, 'request');
    const draw = () => {
      f.painter.setLayerContext({ id: 'line', sourceId: 's', revision: 0, sourceSelection: true });
      f.painter.drawArcs(f.arcs, { width: 1 }, f.view.getArcFilter(f.arcs));
    };
    f.frame(draw);
    f.view.pan(100, 0);
    f.frame(draw);
    expect(request.mock.results[1].value).toBe(request.mock.results[0].value);
    expect(request.mock.calls[0][0]).toMatchObject({ wholeLayer: true, viewBounds: undefined });
    expect(f.arcs.arcIntersectsBBox).not.toHaveBeenCalled();
    f.painter.dispose();
  });
  it.each([
    1, 2,
  ])('filters small paths independently of geometry LOD, invalidates toggles and reuses a panned screen mesh at DPR %s', async (pixelRatio) => {
    const f = await fixture();
    const points = [
      [0.1, 0.1],
      [0.11, 0.11],
      [1.1, 0.1],
    ];
    f.arcs.getArcIter = () => {
      let i = -1;
      return {
        x: 0,
        y: 0,
        hasNext() {
          if (++i >= points.length) return false;
          [this.x, this.y] = points[i];
          return true;
        },
      };
    };
    const view = new AffineTransform(1, -1, 3.35, 4.25);
    f.painter.setPixelRatio(pixelRatio);
    const draw = () => {
      f.painter.setTransform(view);
      f.painter.clear();
      f.painter.setLayerContext({
        id: 'line',
        sourceId: 's',
        revision: 0,
        bounds: [-5, -5, 5, 5],
        geometryLod: false,
      });
      f.painter.drawArcs(f.arcs, { width: 2 }, undefined, new Int32Array([0]));
      f.painter.finishFrame();
    };
    draw();
    expect(f.gpu.createMesh.mock.calls.at(-1)![0].segmentCount).toBe(1);
    expect(f.gpu.drawMesh.mock.calls.at(-1)![1]).toMatchObject({
      screenSpace: true,
      screenView: [1, -1, -0, 0],
    });
    view.translate(0.17, -0.23);
    draw();
    expect(f.gpu.createMesh).toHaveBeenCalledOnce();
    f.painter.setScreenPathFiltering(false);
    draw();
    expect(f.gpu.createMesh.mock.calls.at(-1)![0].segmentCount).toBe(2);
    expect(f.gpu.drawMesh.mock.calls.at(-1)![1].screenSpace).not.toBe(true);
    f.painter.setScreenPathFiltering(true);
    draw();
    expect(f.gpu.createMesh.mock.calls.at(-1)![0].segmentCount).toBe(1);
    expect(f.gpu.createMesh).toHaveBeenCalledTimes(3);
    f.painter.dispose();
  });

  it('does not rescan viewport arc predicates on warm frames or paint-only changes', async () => {
    const f = await fixture(),
      ids = new Uint32Array([0, 1, 2]);
    f.frame(() => f.painter.drawArcs(f.arcs, { width: 1 }, f.view.getArcFilter(f.arcs), ids));
    f.frame(() =>
      f.painter.drawArcs(f.arcs, { width: 2, color: '#00ff00' }, f.view.getArcFilter(f.arcs), ids),
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

describe('navigation timing samples', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does not mistake late observation of a completed fence for GPU execution time', async () => {
    const f = await fixture();
    let time = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => time);
    // The GPU finished while JS could not run. No timer callback is needed to observe it.
    f.frame(() => f.painter.drawArcs(f.arcs, { width: 1 }));
    time = 150;
    expect(f.painter.navigationFrameMs).toBeLessThan(33.3);
    expect(f.painter.stats.navigationTiming.completionMs).toBe(150);
    expect(f.painter.stats.navigationTiming.gpuMs).toBeNull();
    f.painter.dispose();
  });

  it('backs off while the GPU queue really remains pending, then expires the slow sample', async () => {
    const f = await fixture();
    let time = 0;
    let ready = false;
    vi.spyOn(performance, 'now').mockImplementation(() => time);
    const dispose = vi.fn();
    f.gpu.probeCompletion.mockReturnValue({
      poll: () => (ready ? 'complete' : 'pending'),
      dispose,
    });
    f.frame(() => f.painter.drawArcs(f.arcs, { width: 1 }));
    time = 60;
    expect(f.painter.navigationFrameMs).toBeGreaterThan(33.3);
    time = 80;
    ready = true;
    expect(f.painter.navigationFrameMs).toBeGreaterThan(33.3);
    expect(dispose).toHaveBeenCalledOnce();
    time = 1500;
    // Unknown/expired cost requires a bounded recovery draw, not an assertion of zero GPU time.
    expect(f.painter.navigationFrameMs).toBe(Infinity);
    f.frame(() => f.painter.drawArcs(f.arcs, { width: 1 }));
    expect(f.painter.navigationFrameMs).toBeLessThan(33.3);
    f.painter.dispose();
  });

  it('replaces old-scene samples when hidden layers change the next full frame', async () => {
    const f = await fixture();
    let time = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => time);
    const old = { poll: () => 'pending' as const, dispose: vi.fn() };
    f.gpu.probeCompletion.mockReturnValueOnce(old);
    f.frame(() => f.painter.drawArcs(f.arcs, { width: 1 }));
    time = 100;
    expect(f.painter.navigationFrameMs).toBeGreaterThan(33.3);
    f.frame(() => f.painter.drawPoints([[[1, 1]]], { radius: 4 }));
    expect(old.dispose).toHaveBeenCalledOnce();
    expect(f.painter.navigationFrameMs).toBeLessThan(33.3);
    f.painter.dispose();
  });

  it('bounds camera-only sampling and measures replay CPU work separately', async () => {
    const f = await fixture();
    let time = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => time);
    f.frame(() => f.painter.drawArcs(f.arcs, { width: 1 }));
    expect(f.painter.navigationFrameMs).toBeLessThan(33.3);
    for (let i = 1; i <= 10; i++) {
      time = i * 16;
      f.painter.renderNavigation(f.view.transform);
    }
    expect(f.gpu.probeCompletion).toHaveBeenCalledOnce();
    time = 300;
    f.gpu.drawMesh.mockImplementation(() => {
      time += 40;
    });
    f.painter.renderNavigation(f.view.transform);
    expect(f.gpu.probeCompletion).toHaveBeenCalledTimes(2);
    expect(f.painter.navigationFrameMs).toBeGreaterThan(33.3);
    expect(f.painter.stats.navigationTiming.cpuMs).toBe(40);
    f.painter.dispose();
  });

  it.each([
    'setInteracting',
    'dispose',
    'clearGeometryCache',
  ] as const)('releases outstanding probes on %s and cannot receive a stale completion', async (action) => {
    const f = await fixture();
    const probe = { poll: () => 'pending' as const, dispose: vi.fn() };
    f.gpu.probeCompletion.mockReturnValue(probe);
    f.frame(() => f.painter.drawArcs(f.arcs, { width: 1 }));
    if (action === 'setInteracting') f.painter.setInteracting(false);
    else f.painter[action]();
    expect(probe.dispose).toHaveBeenCalledOnce();
    f.painter.dispose();
    expect(probe.dispose).toHaveBeenCalledOnce();
  });

  it('keeps unavailable completion measurement conservative rather than treating it as zero', async () => {
    const f = await fixture();
    f.gpu.probeCompletion.mockReturnValue({ poll: () => 'unavailable', dispose: vi.fn() });
    f.frame(() => f.painter.drawArcs(f.arcs, { width: 1 }));
    expect(f.painter.navigationFrameMs).toBe(Infinity);
    expect(f.painter.stats.navigationTiming.gpuMs).toBeNull();
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

it('disposal discards a pending frame and always cleans independent owners', async () => {
  const f = await fixture();
  f.painter.clear();
  f.painter.setLayerContext({ id: 'line', sourceId: 's', revision: 0 });
  f.painter.drawArcs(f.arcs, { width: 1 });
  f.gpu.drawMesh.mockImplementation(() => {
    throw new Error('must not render during disposal');
  });
  f.painter.dispose();
  expect(f.gpu.drawMesh).not.toHaveBeenCalled();
  expect(f.gpu.dispose).toHaveBeenCalledOnce();
  expect(f.gpu.destroyMesh).toHaveBeenCalledOnce();
  expect(Reflect.get(f.painter, 'disposed')).toBe(true);
  f.painter.dispose();
  expect(f.gpu.dispose).toHaveBeenCalledOnce();
});
