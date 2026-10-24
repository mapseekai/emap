// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LumaPainter } from './painter';
import { GpuRenderer } from './gpu-renderer';
import type { PointIcon } from '../../engine/rendering/icons/images';
import { buildGeometryPacket } from '../../engine/rendering/luma/geometry-packet';
import type { GeometryEntry, GeometryRequest } from './geometry-cache';
import { Viewport } from '../../domain/geo/viewport';
import { Bounds } from '../../domain/geo/bounds';
import { PerspectiveTransform } from '../../domain/geo/perspective-transform';
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
async function fixture(renderer: 'webgl2' | 'webgpu' = 'webgl2', screenPathFiltering?: boolean) {
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
    drawMesh: vi.fn<(...args: unknown[]) => void>(() => {
      gpu.stats.drawCalls++;
    }),
    stats: { drawCalls: 0 },
    forgetImage: vi.fn(),
    drawImage: vi.fn(() => {
      gpu.stats.drawCalls++;
    }),
    drawPointIcons: vi.fn(() => {
      gpu.stats.drawCalls++;
    }),
    drawLabels: vi.fn(),
    clearLabels: vi.fn(),
    waitForIdle: vi.fn(async () => {}),
    probeCompletion: vi.fn(() => ({
      poll: () => 'complete' as 'pending' | 'complete' | 'unavailable',
      dispose: vi.fn(),
    })),
  };
  vi.mocked(GpuRenderer.create).mockResolvedValue(gpu as unknown as GpuRenderer);
  const painter = await LumaPainter.create(document.createElement('canvas'), renderer, {
    screenPathFiltering,
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
it.each([
  ['webgl2', undefined],
  ['webgl2', false],
  ['webgl2', true],
  ['webgpu', undefined],
  ['webgpu', false],
  ['webgpu', true],
] as const)('honors screen filtering opt-in on %s (%s)', async (renderer, enabled) => {
  const f = await fixture(renderer, enabled);
  try {
    f.frame(() => f.painter.drawArcs(f.arcs, { width: 1 }));
    expect(
      (f.gpu.drawMesh.mock.calls.at(-1)![1] as { screenSpace?: boolean }).screenSpace === true,
    ).toBe(enabled === true);
  } finally {
    f.painter.dispose();
  }
});

describe('deferred retained intervals', () => {
  type Draw = 'arcs' | 'predicate' | 'paths' | 'outline' | 'arrows' | 'fill';
  async function intervalFixture(kind: Draw) {
    const f = await fixture();
    let interval = 5;
    const points =
      kind === 'fill'
        ? [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
            [0, 0],
          ]
        : [
            [0, 0],
            [5, 10],
            [10, 0],
          ];
    const original = structuredClone(points);
    const coarse =
      kind === 'fill' ? [points[0], points[1], points[2], points[4]] : [points[0], points[2]];
    const reads: number[] = [];
    const arcs: ArcCollection = {
      size: () => 1,
      getRetainedInterval: () => interval,
      setRetainedInterval(value: number) {
        interval = value;
        return arcs;
      },
      getArcIter: vi.fn(() => {
        reads.push(interval);
        const selected = interval === 0 ? points : coarse;
        let i = 0;
        return {
          x: 0,
          y: 0,
          hasNext() {
            if (i === selected.length) return false;
            [this.x, this.y] = selected[i++];
            return true;
          },
        };
      }),
    } as unknown as ArcCollection;
    const shapes = [[[0]]];
    const predicate = vi.fn(() => true);
    const draw = () => {
      if (kind === 'fill') f.painter.drawPolygonFill(shapes, arcs, 'red');
      else if (kind === 'paths') f.painter.drawPaths(shapes, { width: 1 }, arcs);
      else if (kind === 'outline') f.painter.drawOutlinePaths(shapes, { width: 1 }, arcs);
      else
        f.painter.drawArcs(
          arcs,
          { width: 1, ...(kind === 'arrows' ? { dashType: 'arrow-dot' as const } : {}) },
          kind === 'predicate' ? predicate : undefined,
        );
    };
    f.painter.setScreenPathFiltering(false);
    return { ...f, arcs, points, original, reads, draw, predicate };
  }

  it.each<Draw>([
    'arcs',
    'predicate',
    'paths',
    'outline',
    'arrows',
    'fill',
  ])('preserves separate %s intervals and repeated cache hits without changing source data', async (kind) => {
    const f = await intervalFixture(kind);
    const frame = () =>
      f.frame(() => {
        f.arcs.setRetainedInterval!(0);
        f.draw();
        f.arcs.setRetainedInterval!(5);
        f.draw();
      });
    try {
      frame();
      expect(
        f.gpu.createMesh.mock.calls.map(([geometry]) => geometry.segmentCount ?? geometry.count),
      ).toEqual(kind === 'fill' ? [6, 3] : [2, 1]);
      expect(f.reads).toEqual([0, 5]);
      const meshes = f.gpu.createMesh.mock.results.map((result) => result.value);
      expect(f.gpu.drawMesh.mock.calls.map(([mesh]) => mesh)).toEqual(meshes);
      frame();
      expect(f.gpu.createMesh).toHaveBeenCalledTimes(2);
      expect(f.reads).toEqual([0, 5]);
      if (kind === 'predicate') expect(f.predicate).toHaveBeenCalledTimes(4);
      expect(f.painter.renderNavigation(f.view.transform)).toBe(true);
      expect(f.gpu.drawMesh.mock.calls.slice(-2).map(([mesh]) => mesh)).toEqual(meshes);
      expect(f.arcs.getRetainedInterval!()).toBe(5);
      expect(f.points).toEqual(f.original);
    } finally {
      f.painter.dispose();
    }
  });

  it.each<Draw>([
    'arcs',
    'predicate',
    'fill',
  ])('restores the execution-time interval after a throwing %s builder', async (kind) => {
    const f = await intervalFixture(kind);
    const error = new Error('iterator failed');
    let attempted: number | undefined;
    vi.mocked(f.arcs.getArcIter).mockImplementationOnce(() => {
      attempted = f.arcs.getRetainedInterval!();
      throw error;
    });
    try {
      expect(() =>
        f.frame(() => {
          f.arcs.setRetainedInterval!(0);
          f.draw();
          f.arcs.setRetainedInterval!(5);
        }),
      ).toThrow(error);
      expect(attempted).toBe(0);
      expect(f.arcs.getRetainedInterval!()).toBe(5);
      expect(f.points).toEqual(f.original);
      expect(f.painter.framePresented).toBe(false);
    } finally {
      f.painter.dispose();
    }
  });
});
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
    expect(request.mock.calls[0][0]).toMatchObject({
      compactStroke:
        (c.alpha ?? 1) === 1 && !c.dash && !c.arrow && c.mode !== 'legacy' && (c.samples ?? 4) > 1,
    });
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
    ['webgl2', 1],
    ['webgl2', 2],
    ['webgpu', 1],
    ['webgpu', 2],
  ] as const)('defaults to raw small paths and supports toggles and panned reuse on %s at DPR %s', async (renderer, pixelRatio) => {
    const f = await fixture(renderer);
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
    expect(f.gpu.createMesh.mock.calls.at(-1)![0].segmentCount).toBe(2);
    expect(f.gpu.drawMesh.mock.calls.at(-1)![1]).not.toHaveProperty('screenSpace', true);
    f.painter.setScreenPathFiltering(true);
    draw();
    expect(f.gpu.createMesh.mock.calls.at(-1)![0].segmentCount).toBe(1);
    expect(f.gpu.drawMesh.mock.calls.at(-1)![1]).toMatchObject({
      screenSpace: true,
      screenView: [1, -1, -0, 0],
    });
    view.translate(0.17, -0.23);
    draw();
    expect(f.gpu.createMesh).toHaveBeenCalledTimes(2);
    f.painter.setScreenPathFiltering(false);
    draw();
    expect(f.gpu.createMesh.mock.calls.at(-1)![0].segmentCount).toBe(2);
    expect(f.gpu.drawMesh.mock.calls.at(-1)![1]).not.toHaveProperty('screenSpace', true);
    f.painter.setScreenPathFiltering(true);
    draw();
    expect(f.gpu.createMesh.mock.calls.at(-1)![0].segmentCount).toBe(1);
    expect(f.gpu.createMesh).toHaveBeenCalledTimes(4);
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
    // Unknown/expired cost requires a fresh settled frame, not an assertion of zero GPU time.
    expect(f.painter.navigationFrameMs).toBe(Infinity);
    f.frame(() => f.painter.drawArcs(f.arcs, { width: 1 }));
    expect(f.painter.navigationFrameMs).toBe(Infinity);
    f.frame(() => f.painter.drawArcs(f.arcs, { width: 2 }));
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
  f.view.pan(1, 0);
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
  expect(f.gpu.createMesh).not.toHaveBeenCalled();
  expect(f.gpu.destroyMesh).not.toHaveBeenCalled();
  expect(Reflect.get(f.painter, 'disposed')).toBe(true);
  f.painter.dispose();
  expect(f.gpu.dispose).toHaveBeenCalledOnce();
});

it('keeps the complete canvas through bounded retirement, resize and pending target frames', async () => {
  const f = await fixture();
  const draw = () => f.painter.drawArcs(f.arcs, { width: 1 });
  f.frame(draw);
  const chunks = Reflect.get(f.painter, 'chunks');
  const retain = Reflect.get(chunks, 'options').retainPresentation;
  expect(retain?.()).toBe(true);
  f.gpu.begin.mockClear();
  f.gpu.resize.mockClear();
  f.gpu.drawMesh.mockClear();
  const pending = { entries: null };
  f.painter.resize(900, 700);
  f.frame(() => {
    draw();
    Reflect.get(f.painter, 'requests').push(pending);
  });
  expect(f.painter.frameComplete).toBe(false);
  expect(f.painter.framePresented).toBe(false);
  expect(f.painter.frameRetained).toBe(true);
  expect(f.painter.renderNavigation(f.view.transform)).toBe(false);
  expect(f.gpu.begin).not.toHaveBeenCalled();
  expect(f.gpu.resize).not.toHaveBeenCalled();
  expect(f.gpu.drawMesh).not.toHaveBeenCalled();
  f.frame(draw);
  expect(f.painter.frameComplete).toBe(true);
  expect(f.painter.frameRetained).toBe(false);
  expect(f.gpu.begin).toHaveBeenCalledOnce();
  expect(f.gpu.drawMesh).toHaveBeenCalledOnce();
  expect(f.painter.renderNavigation(f.view.transform)).toBe(true);
  f.painter.dispose();
});

it('retains a proven complete frame before the first partial replacement can overwrite it', async () => {
  const f = await fixture();
  const draw = () => f.painter.drawArcs(f.arcs, { width: 1 });
  f.frame(draw);
  f.gpu.begin.mockClear();
  f.gpu.resize.mockClear();
  f.painter.setPixelRatio(2);
  f.painter.resize(900, 700);
  f.frame(() => {
    draw();
    Reflect.get(f.painter, 'requests').push({ entries: null });
  });
  expect(f.painter.frameRetained).toBe(true);
  expect(f.gpu.begin).not.toHaveBeenCalled();
  expect(f.gpu.resize).not.toHaveBeenCalled();
  // Superseding the pending view with an empty scene must publish the empty scene.
  f.frame(() => {});
  expect(f.painter.frameComplete).toBe(true);
  expect(f.painter.frameRetained).toBe(false);
  expect(f.gpu.begin).toHaveBeenCalledOnce();
  expect(f.gpu.resize).toHaveBeenLastCalledWith(900, 700, 2);
  f.painter.dispose();
});

it('retains a visible cold partial image only under pressure without declaring it complete', async () => {
  const f = await fixture();
  const draw = () => {
    f.painter.drawArcs(f.arcs, { width: 1 });
    Reflect.get(f.painter, 'requests').push({ entries: null });
  };
  f.frame(draw);
  f.frame(draw);
  expect(f.gpu.begin).toHaveBeenCalledTimes(1);
  const chunks = Reflect.get(f.painter, 'chunks');
  expect(Reflect.get(chunks, 'options').retainPresentation()).toBe(true);
  expect(f.painter.frameComplete).toBe(false);
  f.frame(draw);
  expect(f.painter.frameRetained).toBe(true);
  expect(f.painter.frameComplete).toBe(false);
  expect(f.gpu.begin).toHaveBeenCalledTimes(1);
  f.painter.dispose();
});

it('publishes available first data after a completed empty startup frame', async () => {
  const f = await fixture();
  f.frame(() => {});
  expect(f.painter.frameComplete).toBe(true);
  f.gpu.begin.mockClear();
  f.frame(() => {
    f.painter.drawArcs(f.arcs, { width: 1 });
    Reflect.get(f.painter, 'requests').push({ entries: null });
  });
  expect(f.painter.frameRetained).toBe(false);
  expect(f.painter.framePresented).toBe(true);
  expect(f.painter.frameComplete).toBe(false);
  expect(f.gpu.drawMesh).toHaveBeenCalledOnce();
  f.painter.dispose();
});

it('completes a fitting target after navigating from a cold partial image under pressure', async () => {
  const f = await fixture();
  f.frame(() => {
    f.painter.drawArcs(f.arcs, { width: 1 });
    Reflect.get(f.painter, 'requests').push({ entries: null });
  });
  expect(f.painter.frameComplete).toBe(false);
  const chunks = Reflect.get(f.painter, 'chunks');
  const owner = { id: 'layer', sourceId: 'source', revision: 0 };
  const entry = (id: string, bytes: number, ready: boolean): GeometryEntry => ({
    id,
    family: id,
    partition: 'partition',
    owner,
    job: { chunk: 0, members: Int32Array.of(0) },
    bytes,
    state: ready ? 'ready' : 'queued',
    meshes: ready ? [{ kind: 'point', count: 1, bytes: bytes - 4 } as never] : [],
    ranges: [],
    fillRanges: [],
    screenSpace: false,
    used: 0,
  });
  const old = entry('old', 100, true);
  const targets = [
    entry('target-ready', 80, true),
    ...Array.from({ length: 5 }, (_, i) => entry('target-' + i, 4, false)),
  ];
  const request = {
    input: {
      kind: 'point',
      shapes: [[[1, 1]]],
      wholeLayer: true,
      interval: 1,
      bounds: [0, 0, 16, 16],
    },
    owner,
    controller: new AbortController(),
    key: 'new',
    entries: targets,
    fallback: [old],
    frame: Reflect.get(chunks, 'frame'),
    cursor: 0,
    plan: {
      key: 'partition',
      count: 1,
      boundsBytes: 0,
      sourceId: 'source',
      revision: 0,
      used: 0,
      ready: true,
      controller: new AbortController(),
      promise: Promise.resolve({ chunks: 1, membership: new Uint32Array(1) }),
    },
  } as GeometryRequest;
  Reflect.set(chunks, 'entries', new Map([old, ...targets].map((e) => [e.id, e])));
  Reflect.set(chunks, 'requests', new Map([['request', request]]));
  Reflect.set(chunks, 'wantedCache', null);
  Reflect.set(chunks, 'bytes', 200);
  Reflect.set(chunks, 'limit', 104);
  const report = vi.fn();
  Object.assign(Reflect.get(chunks, 'options'), {
    externalBytes: () => 0,
    report,
    invalidate: () => chunks.finish(),
  });
  Reflect.set(chunks, 'worker', {
    stats: {},
    dispose() {},
    build: async () => ({
      geometries: [{ kind: 'point', vertices: new Float32Array(4), count: 1 }],
      screenSpace: false,
    }),
  });
  chunks.pin([old]);
  try {
    chunks.finish();
    await vi.waitFor(() => expect(chunks.complete(request)).toBe(true));
    expect(chunks.stats.bytes).toBe(180);
    expect(chunks.stats.peakBytes).toBeLessThanOrEqual(208);
    expect(chunks.isResident(old)).toBe(false);
    expect(report).not.toHaveBeenCalled();
    expect(f.painter.frameComplete).toBe(false);
    expect(f.painter.renderNavigation(f.view.transform)).toBe(false);
    f.gpu.drawMesh.mockClear();
    f.frame(() => {
      request.frame = Reflect.get(chunks, 'frame');
      Reflect.get(f.painter, 'requests').push(request);
      Reflect.get(f.painter, 'commands').push(() => {
        for (const target of targets) {
          Reflect.get(f.painter, 'selected').push({
            kind: 'mesh',
            draws: target.meshes.map((mesh) => ({ mesh })),
            paint: { color: [1, 0, 0, 1] },
          });
          Reflect.get(f.painter, 'drawnEntries').add(target);
        }
      });
    });
    expect(f.painter.frameComplete).toBe(true);
    expect(f.painter.frameRetained).toBe(false);
    expect(f.gpu.drawMesh).toHaveBeenCalledTimes(6);
  } finally {
    f.painter.dispose();
  }
});

it('updates visible-image provenance when camera replay culls every previous mesh', async () => {
  const f = await fixture();
  f.painter.setScreenPathFiltering(false);
  f.gpu.drawMesh.mockImplementation((...args) => {
    const ranges = args[2] as ArrayLike<unknown> | undefined;
    if (!ranges || ranges.length) f.gpu.stats.drawCalls++;
  });
  f.frame(() => f.painter.drawArcs(f.arcs, { width: 1 }));
  const before = f.gpu.stats.drawCalls;
  expect(before).toBeGreaterThan(0);
  expect(f.painter.renderNavigation(new AffineTransform(1, -1, 1e6, 1e6))).toBe(true);
  expect(f.gpu.stats.drawCalls).toBe(before);
  f.gpu.drawMesh.mockClear();
  f.frame(() => {
    f.painter.drawArcs(f.arcs, { width: 1 });
    Reflect.get(f.painter, 'requests').push({ entries: null });
  });
  expect(f.painter.frameRetained).toBe(false);
  expect(f.gpu.drawMesh).toHaveBeenCalledOnce();
  f.painter.dispose();
});

it('allows pressure retirement when camera replay makes a cold image visible', async () => {
  const f = await fixture();
  let ready = false;
  f.frame(() => {
    Reflect.get(f.painter, 'requests').push({ entries: null });
    Reflect.get(f.painter, 'commands').push(() => {
      if (ready)
        Reflect.get(f.painter, 'selected').push({
          kind: 'mesh',
          draws: [{ mesh: { kind: 'point', count: 1 } }],
          paint: { color: [1, 0, 0, 1] },
        });
    });
  });
  expect(f.gpu.stats.drawCalls).toBe(0);
  ready = true;
  expect(f.painter.renderNavigation(f.view.transform)).toBe(true);
  expect(f.gpu.stats.drawCalls).toBe(1);
  const chunks = Reflect.get(f.painter, 'chunks');
  expect(Reflect.get(chunks, 'options').retainPresentation()).toBe(true);
  expect(f.painter.frameComplete).toBe(false);
  f.painter.dispose();
});

describe('unchanged GPU presentations', () => {
  it('skips identical cold partial scenes while maintaining pins, final readiness and navigation', async () => {
    const f = await fixture();
    const shapes = [[[1, 1]]];
    const chunks = Reflect.get(f.painter, 'chunks');
    const pin = vi.spyOn(chunks, 'pin');
    const finish = vi.spyOn(chunks, 'finish');
    const didPresent = vi.spyOn(chunks, 'didPresent');
    let pending = true;
    const draw = () => {
      f.painter.drawPoints(shapes, { radius: 4 });
      if (pending) Reflect.get(f.painter, 'requests').push({ entries: null });
    };
    f.frame(draw);
    f.frame(draw);
    expect(f.gpu.begin).toHaveBeenCalledOnce();
    expect(f.gpu.drawMesh).toHaveBeenCalledOnce();
    expect(pin).toHaveBeenCalledTimes(2);
    expect(finish).toHaveBeenCalledTimes(2);
    expect(didPresent).toHaveBeenCalledOnce();
    expect(f.painter.framePresented).toBe(true);
    expect(f.painter.frameComplete).toBe(false);
    expect(f.painter.frameRetained).toBe(false);
    pending = false;
    f.frame(draw);
    expect(f.painter.frameComplete).toBe(true);
    expect(f.gpu.begin).toHaveBeenCalledOnce();
    expect(f.painter.stats.presentation.presented).toBe(1);
    const cache = Reflect.get(f.painter, 'cache');
    const get = vi.spyOn(cache, 'get');
    expect(f.painter.renderNavigation(f.view.transform)).toBe(true);
    expect(get).not.toHaveBeenCalled();
    expect(f.gpu.drawMesh).toHaveBeenCalledTimes(2);
    f.painter.dispose();
  });

  it('clears an emptied scene exactly once including repeated empty preparation notifications', async () => {
    const f = await fixture();
    f.frame(() => f.painter.drawPoints([[[1, 1]]], { radius: 4 }));
    f.frame(() => {});
    f.frame(() => Reflect.get(f.painter, 'requests').push({ entries: null }));
    expect(f.gpu.begin).toHaveBeenCalledTimes(2);
    expect(f.painter.frameComplete).toBe(false);
    expect(f.painter.framePresented).toBe(false);
    f.frame(() => {});
    expect(f.gpu.begin).toHaveBeenCalledTimes(2);
    expect(f.painter.frameComplete).toBe(true);
    f.painter.dispose();
  });

  it('prepares immediate geometry after collection and before any chunk selection, preserving owner and selector values', async () => {
    const f = await fixture();
    const cache = Reflect.get(f.painter, 'cache');
    const get = vi.spyOn(cache, 'get');
    const ids = new Uint32Array([0]);
    const shapes = [[[1, 1]], [[2, 2]]];
    f.painter.clear();
    f.painter.setLayerContext({ id: 'points', sourceId: 's', revision: 7 });
    f.painter.drawPoints(shapes, { radius: 4 }, ids);
    expect(get).not.toHaveBeenCalled();
    ids[0] = 1;
    f.painter.setLayerContext(null);
    f.painter.finishFrame();
    expect(get).toHaveBeenCalledOnce();
    expect(get.mock.invocationCallOrder[0]).toBeLessThan(f.gpu.begin.mock.invocationCallOrder[0]);
    const entry = [...Reflect.get(cache, 'entries').values()][0] as {
      layerId: string;
      sourceId: string;
      key: { selections: Uint32Array[]; values: unknown[] };
    };
    expect(entry.layerId).toBe('points');
    expect(entry.sourceId).toBe('s');
    expect(entry.key.selections[0]).toEqual(new Uint32Array([0]));
    expect(entry.key.values.at(-1)).toBe(7);
    f.painter.dispose();
  });
});

describe('presentation invalidation', () => {
  it.each([
    'translation',
    'scale',
    'bearing',
    'pitch',
    'width',
    'height',
    'DPR',
  ])('presents a changed %s even with stable point geometry', async (change) => {
    const f = await fixture();
    const shapes = [[[1, 1]]];
    const draw = () => f.painter.drawPoints(shapes, { radius: 4 });
    f.frame(draw);
    f.frame(draw);
    expect(f.gpu.begin).toHaveBeenCalledOnce();
    if (change === 'translation') f.view.pan(1, 0);
    if (change === 'scale') f.view.transform.mx *= 2;
    if (change === 'width') f.painter.resize(801, 600);
    if (change === 'height') f.painter.resize(800, 601);
    if (change === 'DPR') f.painter.setPixelRatio(2);
    if (change === 'bearing' || change === 'pitch') {
      f.painter.setTransform(
        new PerspectiveTransform(f.view.transform, 800, 600, { [change]: 30 }),
      );
      f.painter.clear();
      f.painter.setLayerContext({ id: 'line', sourceId: 's', revision: 0 });
      draw();
      f.painter.finishFrame();
    } else f.frame(draw);
    expect(f.gpu.begin).toHaveBeenCalledTimes(2);
    expect(f.gpu.createMesh).toHaveBeenCalledOnce();
    f.painter.dispose();
  });

  it('compares immutable raster values while mutable rasters and labels always submit', async () => {
    const f = await fixture();
    const image = document.createElement('canvas');
    const bounds: [number, number, number, number] = [0, 0, 10, 10];
    const clip: [number, number, number, number] = [1, 1, 9, 9];
    const draw = () => f.painter.drawRasterImage(image, bounds, 0.5, true, clip, true);
    f.frame(draw);
    f.frame(draw);
    expect(f.gpu.begin).toHaveBeenCalledOnce();
    bounds[2] = 11;
    f.frame(draw);
    clip[2] = 8;
    f.frame(draw);
    expect(f.gpu.begin).toHaveBeenCalledTimes(3);
    f.painter.forgetImage(image);
    f.frame(draw);
    expect(f.gpu.begin).toHaveBeenCalledTimes(4);
    const mutable = () => f.painter.drawRasterImage(image, bounds);
    f.frame(mutable);
    f.frame(mutable);
    expect(f.gpu.begin).toHaveBeenCalledTimes(6);
    const labels = () => f.painter.drawLabels({ key: 'same', labels: [] });
    f.frame(labels);
    f.frame(labels);
    expect(f.gpu.begin).toHaveBeenCalledTimes(8);
    f.painter.dispose();
  });

  it('invalidates comparisons after failed begin, thrown submission and geometry clear', async () => {
    const f = await fixture();
    const shapes = [[[1, 1]]];
    let radius = 4;
    const draw = () => f.painter.drawPoints(shapes, { radius });
    f.frame(draw);
    f.frame(draw);
    expect(f.gpu.begin).toHaveBeenCalledOnce();
    radius = 5;
    f.gpu.begin.mockReturnValueOnce(false);
    f.frame(draw);
    expect(f.painter.renderNavigation(f.view.transform)).toBe(false);
    radius = 4;
    f.frame(draw);
    expect(f.gpu.begin).toHaveBeenCalledTimes(3);
    radius = 6;
    f.gpu.drawMesh.mockImplementationOnce(() => {
      throw new Error('submission failed');
    });
    expect(() => f.frame(draw)).toThrow('submission failed');
    radius = 4;
    f.frame(draw);
    expect(f.gpu.begin).toHaveBeenCalledTimes(5);
    f.painter.clearGeometryCache({ sourceId: 's' });
    f.frame(draw);
    expect(f.gpu.begin).toHaveBeenCalledTimes(6);
    f.painter.dispose();
  });
});

it('registers later unchanged chunk owners before immediate pressure retires only the disappearing owner', async () => {
  const f = await fixture();
  const chunks = Reflect.get(f.painter, 'chunks');
  const build = vi.fn(async (packet) => buildGeometryPacket(packet));
  Reflect.set(chunks, 'worker', { build, dispose() {}, stats: {} });
  const input = {
    kind: 'point',
    shapes: [[[1, 1]], [[6, 6]], [[12, 12]]],
    interval: 0,
    bounds: [0, 0, 16, 16],
  };
  const owner = (id: string) => ({ id, sourceId: 's', revision: 0 });
  let original: GeometryRequest[] = [];
  try {
    f.frame(() => {
      f.painter.drawPoints([[[1, 1]]], { radius: 4 });
      original = ['a', 'b', 'c'].map((id) => chunks.request(input, owner(id)));
      Reflect.get(f.painter, 'requests').push(...original);
    });
    await vi.waitFor(() => expect(original.every((r) => chunks.complete(r))).toBe(true));
    chunks.pin(original.flatMap((r) => r.entries!));
    const cache = Reflect.get(f.painter, 'cache');
    const hard = chunks.stats.bytes + cache.byteSize + 4;
    Reflect.set(chunks, 'limit', hard / 2);
    const before = build.mock.calls.length;
    const oldB = [...original[1].entries!];
    const oldC = [...original[2].entries!];
    const get = vi.spyOn(cache, 'get');
    const request = vi.spyOn(chunks, 'request');
    f.frame(() => {
      const a = chunks.request(input, owner('a'));
      f.painter.setLayerContext(owner('immediate'));
      f.painter.drawPoints([[[2, 2]]], { radius: 4 });
      const b = chunks.request(input, owner('b'));
      Reflect.get(f.painter, 'requests').push(a, b);
      expect(b.entries).toEqual(oldB);
    });
    expect(get.mock.invocationCallOrder[0]).toBeGreaterThan(request.mock.invocationCallOrder[1]);
    expect(oldB.every((e) => chunks.isResident(e))).toBe(true);
    expect(oldC.some((e) => chunks.isResident(e))).toBe(false);
    expect(chunks.stats.bytes + cache.byteSize).toBeLessThanOrEqual(hard);
    expect(build.mock.calls.length).toBe(before);
  } finally {
    f.painter.dispose();
  }
});

it.each([
  'webgl2',
  'webgpu',
] as const)('publishes the complete polygon layer together on %s and reuses rehydrated meshes', async (renderer) => {
  const f = await fixture(renderer);
  Reflect.set(f.arcs, 'getPointCount', () => 100_000);
  f.painter.setScreenPathFiltering(false);
  const shapes = [[[0]], [[1]]];
  const owner = { id: 'line', sourceId: 's', revision: 0 };
  const entry = (
    id: string,
    kind: 'fill' | 'path',
    chunk: number,
    members: number[],
    state: GeometryEntry['state'],
  ): GeometryEntry => ({
    id,
    family: id,
    partition: kind,
    owner,
    job: { chunk, members: Int32Array.from(members) },
    state,
    meshes: [{ kind, count: kind === 'path' ? 2 : 3, bytes: 32 } as never],
    ranges: [],
    fillRanges: [],
    memberRanges: kind === 'path' ? [Uint32Array.of(0, 0, 1, 1, 1, 1)] : [],
    screenSpace: false,
    bytes: 32,
    used: 0,
  });
  const a = entry('a', 'fill', 0, [0], 'building');
  const b = entry('b', 'fill', 1, [1], 'building');
  const stroke = entry('stroke', 'path', 0, [0, 1], 'building');
  const request = (kind: 'fill' | 'path', entries: GeometryEntry[]): GeometryRequest => ({
    input: { kind, shapes, arcs: f.arcs, interval: 0, bounds: [0, 0, 100, 100] },
    owner,
    key: kind,
    frame: 0,
    cursor: 0,
    plan: {
      key: kind,
      sourceId: 's',
      revision: 0,
      count: 2,
      boundsBytes: 0,
      used: 0,
      ready: true,
      controller: new AbortController(),
      promise: Promise.resolve({
        membership: Uint32Array.from(kind === 'fill' ? [0, 1] : [0, 0]),
        chunks: kind === 'fill' ? 2 : 1,
      }),
    },
    entries,
    controller: new AbortController(),
    slot: 0,
  });
  const fill = request('fill', [a, b]),
    path = request('path', [stroke]);
  const chunks = Reflect.get(f.painter, 'chunks');
  vi.spyOn(chunks, 'request').mockImplementation((input: unknown) =>
    (input as { kind: string }).kind === 'fill' ? fill : path,
  );
  vi.spyOn(chunks, 'complete').mockImplementation((r: unknown) =>
    (r as GeometryRequest).entries!.every((e) => e.state === 'ready'),
  );
  vi.spyOn(chunks, 'isResident').mockImplementation(
    (e: unknown) => (e as GeometryEntry).state === 'ready',
  );
  const draw = () =>
    f.painter.drawPolygon(shapes, f.arcs, { fill: { color: 'red' }, stroke: { width: 1 } });
  f.frame(draw);
  const polygon = [...Reflect.get(f.painter, 'polygons').values()][0] as {
    presentation: { planning: boolean };
  };
  await vi.waitFor(() => expect(polygon.presentation.planning).toBe(false));
  stroke.state = 'ready';
  f.frame(draw);
  expect(f.gpu.begin).toHaveBeenCalledOnce();
  expect(f.gpu.drawMesh).not.toHaveBeenCalled();
  a.state = 'ready';
  f.frame(draw);
  expect(f.gpu.drawMesh).not.toHaveBeenCalled();
  expect(f.painter.frameComplete).toBe(false);
  f.frame(draw);
  expect(f.gpu.begin).toHaveBeenCalledOnce();
  stroke.meshes = [{ kind: 'path', count: 2, bytes: 32 } as never];
  f.frame(draw);
  expect(f.gpu.drawMesh).not.toHaveBeenCalled();
  b.state = 'ready';
  f.gpu.drawMesh.mockClear();
  f.frame(draw);
  expect(f.gpu.drawMesh.mock.calls.map((c) => c[0])).toEqual([
    a.meshes[0],
    b.meshes[0],
    stroke.meshes[0],
  ]);
  expect(f.gpu.drawMesh.mock.calls[2][2]).toBeUndefined();
  expect(f.painter.frameComplete).toBe(true);
  f.frame(draw);
  expect(f.gpu.begin).toHaveBeenCalledTimes(2);
  stroke.meshes = [{ kind: 'path', count: 2, bytes: 32 } as never];
  f.frame(draw);
  expect(f.gpu.begin).toHaveBeenCalledTimes(3);
  f.painter.dispose();
});

it('keeps no-label render-service maintenance comparable without inventing GPU timing samples', async () => {
  const f = await fixture();
  const shapes = [[[1, 1]]];
  const draw = () => {
    f.painter.drawPoints(shapes, { radius: 4 });
    f.painter.clearLabels();
  };
  f.frame(draw);
  const probe = f.gpu.probeCompletion.mock.results[0].value;
  f.frame(draw);
  expect(f.gpu.begin).toHaveBeenCalledOnce();
  expect(f.gpu.probeCompletion).toHaveBeenCalledOnce();
  expect(probe.dispose).not.toHaveBeenCalled();
  f.painter.dispose();
});

it('compares fresh member selections by value and notices changed ranges on the same resident mesh', async () => {
  const f = await fixture();
  Reflect.set(f.arcs, 'getPointCount', () => 100_000);
  f.painter.setScreenPathFiltering(false);
  const entry = {
    id: 'shared',
    job: { members: Int32Array.of(0, 1) },
    meshes: [{ kind: 'path', count: 2 }],
    ranges: [],
    fillRanges: [],
    memberRanges: [Uint32Array.of(0, 0, 1, 1, 1, 1)],
    screenSpace: false,
  } as unknown as GeometryEntry;
  const request = {
    entries: [entry],
    input: { kind: 'path' },
    owner: { content: '' },
    slot: 0,
  } as GeometryRequest;
  const chunks = Reflect.get(f.painter, 'chunks');
  vi.spyOn(chunks, 'request').mockReturnValue(request);
  vi.spyOn(chunks, 'complete').mockReturnValue(false);
  let member = 0;
  const draw = () => {
    const scope: {
      channels: Array<{
        draw: (entries: GeometryEntry[], members: Map<GeometryEntry, Set<number>>) => void;
      }>;
      order: number;
    } = { channels: [], order: 0 };
    Reflect.set(f.painter, 'polygonScope', scope);
    f.painter.drawArcs(f.arcs, { width: 1 });
    Reflect.set(f.painter, 'polygonScope', null);
    Reflect.set(f.painter, 'commands', [
      () => scope.channels[0].draw([entry], new Map([[entry, new Set([member])]])),
    ]);
  };
  f.frame(draw);
  f.frame(draw);
  expect(f.gpu.begin).toHaveBeenCalledOnce();
  member = 1;
  f.frame(draw);
  f.frame(draw);
  expect(f.gpu.begin).toHaveBeenCalledTimes(2);
  expect(f.gpu.drawMesh.mock.calls.at(-1)![2]).toEqual([{ firstInstance: 1, count: 1 }]);
  Reflect.set(entry.meshes[0], 'buffer', {});
  f.frame(draw);
  expect(f.gpu.begin).toHaveBeenCalledTimes(3);
  f.painter.dispose();
});

it('preserves translucent owner order and snapshots paint values instead of object identity', async () => {
  const f = await fixture();
  const shapes = [[[1, 1]]];
  const color: [number, number, number, number] = [1, 0, 0, 0.5];
  vi.spyOn(Reflect.get(f.painter, 'colors'), 'resolve').mockReturnValue(color);
  let reverse = false,
    radius = 4,
    fill = true;
  let shape: 'circle' | 'square' = 'circle';
  const draw = () => {
    for (const id of reverse ? ['b', 'a'] : ['a', 'b']) {
      f.painter.setLayerContext({ id, sourceId: 's', revision: 0 });
      f.painter.drawPoints(shapes, { radius, fill, shape });
    }
  };
  f.frame(draw);
  f.frame(draw);
  expect(f.gpu.begin).toHaveBeenCalledOnce();
  const original = f.gpu.drawMesh.mock.calls.map((c) => c[0]);
  reverse = true;
  f.frame(draw);
  expect(f.gpu.drawMesh.mock.calls.slice(-2).map((c) => c[0])).toEqual([...original].reverse());
  radius = 5;
  f.frame(draw);
  fill = false;
  f.frame(draw);
  shape = 'square';
  f.frame(draw);
  color[3] = 0.25;
  f.frame(draw);
  expect(f.gpu.begin).toHaveBeenCalledTimes(6);
  expect(f.gpu.createMesh).toHaveBeenCalledTimes(2);
  expect((f.gpu.drawMesh.mock.calls[0][1] as { color: number[] }).color[3]).toBe(0.5);
  f.frame(draw);
  expect(f.gpu.begin).toHaveBeenCalledTimes(6);
  f.painter.dispose();
});

it('compares immutable icons by placement and paint, and forces main-painter decorations', async () => {
  const f = await fixture();
  const image = document.createElement('canvas');
  const shapes = [[[1, 1]]];
  const icon: PointIcon = {
    asset: { image, width: 10, height: 10, bytes: 400, close() {} },
    color: [1, 1, 1, 1],
    rect: [0, 0, 10, 10],
    size: [10, 10],
    anchor: [0.5, 0.5],
    offset: [0, 0],
    angle: 0,
    bounds: [-5, -5, 5, 5],
    radius: 6,
  };
  const draw = () => f.painter.drawPointIcons(shapes, icon);
  f.frame(draw);
  f.frame(draw);
  expect(f.gpu.begin).toHaveBeenCalledOnce();
  icon.angle = 1;
  f.frame(draw);
  icon.size = [12, 10];
  f.frame(draw);
  icon.anchor = [0, 0];
  f.frame(draw);
  icon.offset = [2, 0];
  f.frame(draw);
  icon.tint = 'red';
  f.frame(draw);
  icon.color[3] = 0.5;
  f.frame(draw);
  expect(f.gpu.begin).toHaveBeenCalledTimes(7);
  expect(f.gpu.createMesh).toHaveBeenCalledOnce();
  const decorate = vi
    .spyOn(f.painter as unknown as { decorateNow: () => void }, 'decorateNow')
    .mockImplementation(() => {});
  const overlay = () => f.painter.drawVertexBand({ x0: 0, y0: 0, x1: 10, y1: 10 });
  f.frame(overlay);
  f.frame(overlay);
  expect(decorate).toHaveBeenCalledTimes(2);
  expect(f.gpu.begin).toHaveBeenCalledTimes(9);
  f.painter.dispose();
});

it('compares width, dash and arrow paint while reusing prepared path geometry', async () => {
  const f = await fixture();
  f.painter.setScreenPathFiltering(false);
  const dash = [2, 3];
  let width = 1,
    spacing = 32;
  const paths = () => f.painter.drawArcs(f.arcs, { width, dash });
  f.frame(paths);
  f.frame(paths);
  expect(f.gpu.begin).toHaveBeenCalledOnce();
  dash[0] = 4;
  f.frame(paths);
  width = 2;
  f.frame(paths);
  expect(f.gpu.begin).toHaveBeenCalledTimes(3);
  expect(f.gpu.createMesh).toHaveBeenCalledOnce();
  const arrows = () =>
    f.painter.drawArcs(f.arcs, { width, dashType: 'arrow-dot', arrowSpacing: spacing });
  f.frame(arrows);
  f.frame(arrows);
  expect(f.gpu.begin).toHaveBeenCalledTimes(4);
  spacing = 40;
  f.frame(arrows);
  expect(f.gpu.begin).toHaveBeenCalledTimes(5);
  expect(f.gpu.createMesh).toHaveBeenCalledTimes(2);
  f.painter.dispose();
});
