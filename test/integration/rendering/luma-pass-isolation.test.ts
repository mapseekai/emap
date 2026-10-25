// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { LumaPainter } from '../../../src/integrations/luma/painter';
import { GpuRenderer } from '../../../src/integrations/luma/gpu-renderer';
import { CanvasRenderService } from '../../../src/engine/providers/workspace/render';
import { AffineTransform } from '../../../src/domain/geo/transform';
import type { RenderPass } from '../../../src/runtime/services/contracts/render-pass';
import type { RenderPassStage } from '../../../src/engine/rendering/source-order';
import type { ArcCollection } from '../../../src/shared/types/mapshaper-types';
import type { GeometryChunkCache } from '../../../src/integrations/luma/geometry-cache';
import type { GeometryBuffer } from '../../../src/integrations/luma/types';

vi.mock('../../../src/integrations/luma/gpu-renderer', () => ({
  GpuRenderer: { create: vi.fn() },
}));
vi.mock('../../../src/integrations/luma/colors', () => ({
  GpuColors: class {
    reset() {}
    resolve() {
      return [1, 0, 0, 1];
    }
    dispose() {}
  },
}));
// Keep real source-block dispatch; normal layer style/data preparation is unrelated to pass isolation.
vi.mock('../../../src/engine/map/layer-renderer', () => ({
  renderLayers: (context: { painter: LumaPainter }) =>
    context.painter.drawPoints([[[2, 2]]], { radius: 4 }),
}));
afterEach(() => vi.restoreAllMocks());

async function fixture() {
  const gpu = {
    pathMode: 'auto',
    pathRendering: { samples: 4 },
    strokeBatchingEnabled: true,
    resize: vi.fn(),
    begin: vi.fn(() => true),
    end: vi.fn(),
    dispose: vi.fn(),
    createMesh: vi.fn((g: GeometryBuffer) => ({
      kind: g.kind,
      count: g.count,
      bytes: g.vertices.byteLength,
      x: g.vertices[0],
    })),
    destroyMesh: vi.fn(),
    drawMesh: vi.fn<(...args: unknown[]) => void>(() => {
      gpu.stats.drawCalls++;
    }),
    drawImage: vi.fn<(...args: unknown[]) => void>(() => {
      gpu.stats.drawCalls++;
    }),
    drawLabels: vi.fn(),
    stats: { drawCalls: 0 },
    forgetImage: vi.fn(),
    probeCompletion: vi.fn(() => ({ poll: () => 'complete', dispose: vi.fn() })),
  };
  vi.mocked(GpuRenderer.create).mockResolvedValue(gpu as unknown as GpuRenderer);
  const painter = await LumaPainter.create(document.createElement('canvas'), 'webgl2', {
    invalidate: vi.fn(),
    report: vi.fn(),
  });
  const fire = vi.fn();
  const service = new CanvasRenderService({
    view: {
      _viewport: {
        transform: new AffineTransform(),
        width: 800,
        height: 600,
        getLineScale: () => 1,
      },
    },
    layers: { _getEffectiveLayers: () => [{ id: 'normal', source: 'normal' }] },
    document: { _sources: new Map() },
    cache: {},
    events: { fire },
  } as never);
  service._painter = painter;
  for (const name of [
    '_prepareIcons',
    '_renderBoundLabels',
    '_renderHighlight',
    '_renderEditOverlay',
  ])
    vi.spyOn(service as unknown as Record<string, () => void>, name).mockImplementation(() => {});
  const passes = Reflect.get(service, '_passes') as Map<RenderPass, RenderPassStage>;
  return { service, painter, gpu, fire, passes };
}

it.each<RenderPassStage>([
  'before-layers',
  'after-layers',
  { sourceId: 'custom' },
])('isolates deferred allocation failures in %j passes and keeps healthy siblings', async (stage) => {
  const f = await fixture();
  const error = new RangeError('bounded immediate allocation failed');
  const create = f.gpu.createMesh.getMockImplementation()!;
  f.gpu.createMesh.mockImplementation((g) => {
    if (g.vertices[0] === 1) throw error;
    return create(g);
  });
  f.passes.set(({ painter }) => {
    painter.drawPoints([[[1, 1]]], { radius: 4 });
    painter.drawPoints([[[3, 3]]], { radius: 4 });
  }, stage);
  f.passes.set(({ painter }) => painter.drawPoints([[[4, 4]]], { radius: 4 }), stage);
  try {
    expect(() => f.service._renderImpl()).not.toThrow();
    expect(f.fire).toHaveBeenCalledExactlyOnceWith('error', { error });
    expect(f.gpu.createMesh.mock.calls.map(([g]) => g.vertices[0]).sort()).toEqual([1, 2, 4]);
    expect(f.gpu.drawMesh).toHaveBeenCalledTimes(2);
    expect(f.painter.frameComplete).toBe(true);
    expect(f.painter.renderNavigation(new AffineTransform())).toBe(true);
    expect(f.gpu.drawMesh).toHaveBeenCalledTimes(4);
  } finally {
    f.painter.dispose();
  }
});

it.each<RenderPassStage>([
  'before-layers',
  'after-layers',
  { sourceId: 'custom' },
])('resets the error scope after a synchronous %j pass exception', async (stage) => {
  const f = await fixture();
  const synchronous = new Error('pass callback failed');
  f.passes.set(() => {
    throw synchronous;
  }, stage);
  f.passes.set(({ painter }) => painter.drawPoints([[[4, 4]]], { radius: 4 }), stage);
  try {
    expect(() => f.service._renderImpl()).not.toThrow();
    expect(f.fire).toHaveBeenCalledExactlyOnceWith('error', { error: synchronous });
    expect(f.gpu.drawMesh).toHaveBeenCalledTimes(2);
    f.fire.mockClear();
    f.passes.clear();
    const fatal = new Error('normal layer allocation failed');
    f.gpu.createMesh.mockImplementationOnce(() => {
      throw fatal;
    });
    expect(() => f.service._renderImpl()).toThrow(fatal);
    expect(f.fire).not.toHaveBeenCalled();
  } finally {
    f.painter.dispose();
  }
});

it('does not isolate a GPU submission failure even when its draw originated in a registered pass', async () => {
  const f = await fixture();
  f.passes.set(({ painter }) => painter.drawPoints([[[1, 1]]], { radius: 4 }), 'before-layers');
  const fatal = new Error('GPU submission failed');
  f.gpu.drawMesh.mockImplementationOnce(() => {
    throw fatal;
  });
  try {
    expect(() => f.service._renderImpl()).toThrow(fatal);
    expect(f.fire).not.toHaveBeenCalled();
    expect(f.painter.framePresented).toBe(false);
    expect(f.painter.renderNavigation(new AffineTransform())).toBe(false);
  } finally {
    f.painter.dispose();
  }
});

it.each(
  (['before-layers', 'after-layers', { sourceId: 'custom' }] as RenderPassStage[]).flatMap(
    (stage) => ['points', 'polygon', 'stroke'].map((kind) => ({ stage, kind })),
  ),
)('omits failed $stage pass suffix images and $kind requests while retaining its successful prefix', async ({
  stage,
  kind,
}) => {
  const f = await fixture();
  const prefix = document.createElement('canvas');
  const suffix = document.createElement('canvas');
  const chunks = Reflect.get(f.painter, 'chunks') as GeometryChunkCache;
  const requests = vi.spyOn(chunks, 'request');
  const error = new RangeError('optional allocation failed');
  const create = f.gpu.createMesh.getMockImplementation()!;
  try {
    f.service._renderImpl();
    f.gpu.drawMesh.mockClear();
    f.gpu.createMesh.mockImplementation((g) => {
      if (g.vertices[0] === 1) throw error;
      return create(g);
    });
    f.passes.set(({ painter }) => {
      painter.drawPoints([[[0, 0]]], { radius: 4 });
      painter.drawRasterImage(prefix, [0, 0, 5, 5]);
      painter.drawPoints([[[1, 1]]], { radius: 4 });
      painter.drawRasterImage(suffix, [0, 0, 10, 10]);
      painter.drawLabels?.({ key: 'suffix', labels: [] });
      painter.setLayerContext?.({
        id: 'suffix',
        sourceId: 'custom',
        revision: 0,
        sourceSelection: true,
      });
      const arcs = { size: () => 1, getPointCount: () => 100_000 } as ArcCollection;
      if (kind === 'points') painter.drawPoints([[[3, 3]]], { radius: 4 }, new Uint32Array(50_000));
      else if (kind === 'polygon')
        painter.drawPolygon!([[[0]]], arcs, { fill: { color: 'red' }, stroke: { width: 1 } });
      else painter.drawPaths([[[0]]], { width: 1 }, arcs);
      painter.setLayerContext?.(null);
    }, stage);
    f.passes.set(({ painter }) => painter.drawPoints([[[4, 4]]], { radius: 4 }), stage);
    expect(() => f.service._renderImpl()).not.toThrow();
    expect(f.fire).toHaveBeenCalledExactlyOnceWith('error', { error });
    expect(f.gpu.drawImage.mock.calls.map(([image]) => image)).toEqual([prefix]);
    expect(f.gpu.drawLabels).not.toHaveBeenCalled();
    expect(f.gpu.drawMesh.mock.calls.map(([mesh]) => (mesh as { x: number }).x)).toEqual(
      stage === 'after-layers' ? [2, 0, 4] : [0, 4, 2],
    );
    expect(requests).toHaveBeenCalledTimes(kind === 'polygon' ? 2 : 1);
    expect(requests.mock.results.every((result) => result.value.controller.signal.aborted)).toBe(
      true,
    );
    expect(chunks.stats.pending).toBe(0);
    expect(f.painter.frameRetained).toBe(false);
    expect(f.painter.frameComplete).toBe(true);
    expect(f.painter.renderNavigation(new AffineTransform())).toBe(true);
    expect(f.gpu.drawImage.mock.calls.map(([image]) => image)).toEqual([prefix, prefix]);
    expect(f.gpu.drawLabels).not.toHaveBeenCalled();
  } finally {
    f.painter.dispose();
  }
});
