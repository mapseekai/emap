// @vitest-environment jsdom
import { describe, expect, it, vi, type Mock } from 'vitest';
import { renderLayers, type LayerRendererContext } from './layer-renderer';
import { createCanvasPainterHarness } from '../../../test/utils/canvas-painter';
import { getDefaultMapshaperAdapter } from '../../integrations/mapshaper/adapter';
import { Bounds } from '../../domain/geo/bounds';
import { Viewport } from '../../domain/geo/viewport';
import type { MutableTopologySource } from '../../domain/source/source';
import type {
  MapshaperDataset,
  MapshaperLayer,
  PathShape,
} from '../../shared/types/mapshaper-types';
import { FeatureQuery } from './feature-query';
import type { LayerSpecification } from './layer';
import { StyleResolver } from './style-resolver';
import { FilterResolver } from './filter-resolver';

describe('renderLayers fill rendering', () => {
  it('skips outline arc-id work when fill layer line width is zero', () => {
    const arcs = { size: () => 0 };
    const layer = {
      id: 'filled',
      type: 'fill' as const,
      source: 'src-a',
      paint: {
        'fill-color': '#71c783',
        'line-width': 0,
      },
    };
    const mapshaperLayer = {
      name: 'polygons',
      geometry_type: 'polygon',
      shapes: [[[0]]],
    };
    const source = {
      getDisplayArcs: () => null,
      getArcs: () => arcs,
      getDataset: () => ({ editVersion: 7 }),
    };
    const painter = {
      drawPolygonFill: vi.fn(),
      drawArcs: vi.fn(),
    };
    const getLayerArcIds = vi.fn();

    renderLayers(
      {
        layers: [layer],
        sources: new Map([['src-a', source as any]]),
        viewport: {
          getArcFilter: vi.fn(() => undefined),
          getViewBounds: vi.fn(() => [0, 0, 10, 10]),
          getMapScale: vi.fn(() => 2),
        } as any,
        painter: painter as any,
        resolveSourceLayer: vi.fn(() => mapshaperLayer as any),
        getLayerArcIds,
      },
      1,
      1,
    );

    expect(painter.drawPolygonFill).toHaveBeenCalledTimes(1);
    expect(painter.drawPolygonFill).toHaveBeenCalledWith(
      mapshaperLayer.shapes,
      arcs,
      '#71c783',
      undefined,
      undefined,
      { viewBBox: [0, 0, 10, 10] },
    );
    expect(getLayerArcIds).not.toHaveBeenCalled();
    expect(painter.drawArcs).not.toHaveBeenCalled();
  });

  it('skips per-part viewport culling near full extent (scale <= 1.1)', () => {
    const arcs = { size: () => 0 };
    const layer = {
      id: 'filled',
      type: 'fill' as const,
      source: 'src-a',
      paint: { 'fill-color': '#71c783', 'line-width': 0 },
    };
    const mapshaperLayer = {
      name: 'polygons',
      geometry_type: 'polygon',
      shapes: [[[0]]],
    };
    const source = {
      getDisplayArcs: () => null,
      getArcs: () => arcs,
    };
    const painter = {
      drawPolygonFill: vi.fn(),
      drawArcs: vi.fn(),
    };

    renderLayers(
      {
        layers: [layer],
        sources: new Map([['src-a', source as any]]),
        viewport: {
          getArcFilter: vi.fn(() => () => true),
          getViewBounds: vi.fn(() => [0, 0, 10, 10]),
          getMapScale: vi.fn(() => 1),
        } as any,
        painter: painter as any,
        resolveSourceLayer: vi.fn(() => mapshaperLayer as any),
        getLayerArcIds: vi.fn(),
      },
      1,
      1,
    );

    expect(painter.drawPolygonFill).toHaveBeenCalledWith(
      mapshaperLayer.shapes,
      arcs,
      '#71c783',
      undefined,
      undefined,
      { viewBBox: null },
    );
  });

  it('forwards signed line shapes for arrow-dot rendering', () => {
    const arcs = { size: () => 2 };
    const layer = {
      id: 'arrows',
      type: 'line' as const,
      source: 'src-a',
      paint: { 'line-dashstyle': 'arrow-dot', 'line-arrow-spacing': 18, 'line-arrow-size': 12 },
    };
    const mapshaperLayer = {
      name: 'roads',
      geometry_type: 'polyline',
      shapes: [[[1, -2]], [[-2]]],
    };
    const source = {
      getDisplayArcs: () => null,
      getArcs: () => arcs,
      getDataset: () => ({ editVersion: 7 }),
    };
    const painter = {
      drawArcs: vi.fn(),
    };
    const getLayerArcIds = vi.fn(() => Uint32Array.from([1, 2]));

    renderLayers(
      {
        layers: [layer],
        sources: new Map([['src-a', source as any]]),
        viewport: {
          getArcFilter: vi.fn(() => () => true),
          getViewBounds: vi.fn(() => [0, 0, 10, 10]),
          getMapScale: vi.fn(() => 2),
        } as any,
        painter: painter as any,
        resolveSourceLayer: vi.fn(() => mapshaperLayer as any),
        getLayerArcIds,
      },
      1,
      1,
    );

    expect(painter.drawArcs).toHaveBeenCalledTimes(1);
    expect(painter.drawArcs).toHaveBeenCalledWith(
      arcs,
      expect.objectContaining({ dashType: 'arrow-dot', arrowSpacing: 18, arrowSize: 12 }),
      expect.any(Function),
      undefined,
      expect.objectContaining({
        shapes: mapshaperLayer.shapes,
        cacheKey: 'src-a:default:arrows',
        geometryRevision: 7,
      }),
    );
    expect(getLayerArcIds).not.toHaveBeenCalled();
  });

  it('forwards polygon rings for arrow-dot fill outlines', () => {
    const arcs = { size: () => 2 };
    const layer = {
      id: 'flow-areas',
      type: 'fill' as const,
      source: 'src-a',
      paint: {
        'fill-color': '#ddd',
        'line-dashstyle': 'arrow-dot',
        'line-arrow-spacing': 20,
      },
    };
    const mapshaperLayer = {
      name: 'areas',
      geometry_type: 'polygon',
      shapes: [[[0], [-2]]],
    };
    const source = {
      getDisplayArcs: () => null,
      getArcs: () => arcs,
      getDataset: () => ({ editVersion: 3 }),
    };
    const painter = { drawPolygonFill: vi.fn(), drawArcs: vi.fn() };
    const getLayerArcIds = vi.fn();

    renderLayers(
      {
        layers: [layer],
        sources: new Map([['src-a', source as any]]),
        viewport: {
          getArcFilter: vi.fn(() => () => true),
          getViewBounds: vi.fn(() => [0, 0, 10, 10]),
          getMapScale: vi.fn(() => 2),
        } as any,
        painter: painter as any,
        resolveSourceLayer: vi.fn(() => mapshaperLayer as any),
        getLayerArcIds,
      },
      1,
      1,
    );

    expect(painter.drawArcs).toHaveBeenCalledWith(
      arcs,
      expect.objectContaining({ dashType: 'arrow-dot' }),
      expect.any(Function),
      undefined,
      expect.objectContaining({
        shapes: mapshaperLayer.shapes,
        cacheKey: 'src-a:default:flow-areas',
        geometryRevision: 3,
      }),
    );
    expect(getLayerArcIds).not.toHaveBeenCalled();
  });
});

function fixture(type: 'circle' | 'line' | 'fill', classified: boolean) {
  const adapter = getDefaultMapshaperAdapter();
  const count = 10_000;
  const rings = Array.from({ length: count }, (_, i) => {
    const x = (i % 100) * 10,
      y = Math.floor(i / 100) * 10;
    return {
      xx: new Float64Array([x, x + 8, x + 8, x, x]),
      yy: new Float64Array([y, y, y + 8, y + 8, y]),
    };
  });
  rings.push({
    xx: new Float64Array([150, 350, 350, 150, 150]),
    yy: new Float64Array([150, 150, 350, 350, 150]),
  });
  rings.push({
    xx: new Float64Array([220, 280, 280, 220, 220]),
    yy: new Float64Array([220, 220, 280, 280, 220]),
  });
  const arcs = type === 'circle' ? undefined : adapter.createArcCollection(rings);
  const shapes = Array.from({ length: count }, (_, i) =>
    type === 'circle' ? [[(i % 100) * 10, Math.floor(i / 100) * 10]] : [[i]],
  );
  if (type === 'circle')
    shapes[0] = [
      [198, 250],
      [900, 900],
    ]; // Symbol overlaps the viewport; multipoint bbox is conservative.
  else {
    shapes[0] = [[count], [count + 1]];
    shapes[1] = [[~2020]];
  }
  const ml: MapshaperLayer = {
    name: 'data',
    geometry_type: type === 'circle' ? 'point' : type === 'line' ? 'polyline' : 'polygon',
    shapes,
    data: adapter.createDataTable(
      shapes.map((_, i) => ({
        fill: i % 2 ? '#cc331180' : '#1133cc80',
        stroke: i % 2 ? '#cc331180' : '#1133cc80',
      })),
    ),
  };
  const dataset: MapshaperDataset = { layers: [ml], arcs, editVersion: 0 };
  const source = {
    type: 'topology',
    getLayers: () => dataset.layers,
    getArcs: () => dataset.arcs,
    getDisplayArcs: () => null,
    getDataset: () => dataset,
  } as unknown as MutableTopologySource;
  const sources = new Map([['s', source]]);
  const viewport = new Viewport();
  viewport.updateSize(100, 100);
  viewport.setExtent(new Bounds(0, 0, 1000, 1000));
  viewport.setExtent(new Bounds(200, 200, 300, 300));
  const query = new FeatureQuery(
    sources,
    () => viewport.transform,
    () => ({ width: 100, height: 100 }),
    () => viewport.initialMX,
  );
  const events: unknown[][] = [];
  const context = {
    set fillStyle(value: string) {
      events.push(['fillStyle', value]);
    },
    set strokeStyle(value: string) {
      events.push(['strokeStyle', value]);
    },
    globalAlpha: 1,
    beginPath() {
      events.push(['begin']);
    },
    moveTo(x: number, y: number) {
      events.push(['move', x, y]);
    },
    lineTo(x: number, y: number) {
      events.push(['line', x, y]);
    },
    arc(...args: number[]) {
      events.push(['arc', ...args]);
    },
    stroke() {
      events.push(['stroke']);
    },
    fill(rule?: string) {
      events.push(['fill', rule]);
    },
    setLineDash(dash: number[]) {
      events.push(['dash', ...dash]);
    },
  };
  const { painter } = createCanvasPainterHarness(context);
  painter.setTransform(viewport.transform);
  const layer: LayerSpecification = {
    ...(type === 'circle' ? { pointLod: false as const } : {}),
    id: 'style',
    source: 's',
    type,
    ...(classified ? { styleSource: 'mapshaper' as const } : {}),
    paint:
      type === 'circle'
        ? { 'circle-radius': 4, ...(classified ? {} : { 'circle-color': '#1133cc80' }) }
        : {
            'line-width': 1,
            'line-dasharray': [3, 2],
            ...(classified ? {} : { 'fill-color': '#1133cc80', 'line-color': '#1133cc80' }),
          },
  };
  const ctx: LayerRendererContext = {
    layers: [layer],
    sources,
    viewport,
    painter,
    styleResolver: new StyleResolver(),
    resolveSourceLayer: () => ml,
    getLayerArcIds: (_sourceId, layer) =>
      Uint32Array.from(
        new Set(
          (layer.shapes as PathShape[]).flatMap((shape) =>
            shape.flat().map((id) => (id >= 0 ? id : ~id)),
          ),
        ),
      ),
  };
  return { ctx, events, query, ml, dataset };
}

describe('render candidate integration', () => {
  for (const classified of [false, true]) {
    it(`keeps same-view arrow-dot commands cached, classified=${classified}`, () => {
      const { ctx, query } = fixture('line', classified);
      const layer = ctx.layers[0];
      if (layer.type !== 'line') throw new Error('Expected line fixture');
      layer.paint = { ...layer.paint, 'line-dashstyle': 'arrow-dot' };
      ctx.getRenderCandidates = (sourceId, ml, bounds) =>
        query.getRenderCandidates(sourceId, ml, bounds);
      const painter = ctx.painter as unknown as {
        buildArrowDotCommands: (...args: unknown[]) => Float64Array;
      };
      const build = vi.spyOn(painter, 'buildArrowDotCommands');
      renderLayers(ctx, 1, 1);
      const builds = build.mock.calls.length;
      expect(builds).toBeGreaterThan(0);
      renderLayers(ctx, 1, 1);
      expect(build).toHaveBeenCalledTimes(builds);
      ctx.viewport.pan(2, 1);
      ctx.painter.setTransform(ctx.viewport.transform);
      renderLayers(ctx, 1, 1);
      expect(build.mock.calls.length).toBeGreaterThan(builds);
    });
  }
  for (const type of ['circle', 'line', 'fill'] as const) {
    for (const classified of [false, true]) {
      it(`${type}, classified=${classified}: preserves drawing commands, order, holes, alpha and direction`, () => {
        const { ctx, events, query } = fixture(type, classified);
        renderLayers(ctx, 1, 1);
        const expected = events.slice();
        events.length = 0;
        ctx.getRenderCandidates = (sourceId, layer, bounds) =>
          query.getRenderCandidates(sourceId, layer, bounds);
        renderLayers(ctx, 1, 1);
        expect(events).toEqual(expected);
        events.length = 0;
        ctx.viewport.pan(2, 1);
        ctx.painter.setTransform(ctx.viewport.transform);
        renderLayers(ctx, 1, 1);
        const moved = events.slice();
        events.length = 0;
        ctx.getRenderCandidates = undefined;
        renderLayers(ctx, 1, 1);
        expect(events).toEqual(moved);
      });
    }
  }
});

function makeStyleCtx(opts: {
  layers: unknown[];
  ml?: Partial<MapshaperLayer>;
  dataset?: Partial<MapshaperDataset>;
  painter: { drawPolygonFill: Mock; drawArcs: Mock; drawPaths: Mock; drawPoints: Mock };
}) {
  const arcs = { size: () => 0 };
  const source = {
    getDisplayArcs: () => null,
    getArcs: () => arcs,
    getDataset: () => opts.dataset,
  };
  return {
    layers: opts.layers,
    sources: new Map([['s', source]]),
    viewport: {
      getArcFilter: vi.fn(() => undefined),
      getViewBounds: vi.fn(() => [0, 0, 10, 10]),
      getMapScale: vi.fn(() => 2),
    },
    painter: opts.painter,
    resolveSourceLayer: vi.fn(() => opts.ml ?? null),
    getLayerArcIds: vi.fn(),
    styleResolver: new StyleResolver(),
  };
}

function makePainter() {
  return {
    drawPolygonFill: vi.fn(),
    drawArcs: vi.fn(),
    drawPaths: vi.fn(),
    drawPoints: vi.fn(),
  };
}

describe('renderLayers style integration', () => {
  it('fill layer with expression renders via styleBuckets', () => {
    const dataset = { editVersion: 0, attributeVersion: 0 };
    const ml = {
      geometry_type: 'polygon',
      shapes: [[[0]], [[1]]],
      data: { getRecords: () => [{ t: 'a' }, { t: 'b' }] },
    };
    const painter = makePainter();
    const ctx = makeStyleCtx({
      layers: [
        {
          id: 'L',
          type: 'fill',
          source: 's',
          paint: { 'fill-color': ['match', ['get', 't'], 'a', '#111111', '#999999'] },
        },
      ],
      ml: ml as Partial<MapshaperLayer>,
      dataset,
      painter,
    });
    renderLayers(ctx as never, 1, 1);
    const call = painter.drawPolygonFill.mock.calls[0] as unknown[];
    const options = call[5] as {
      styleBuckets: { buckets: Uint32Array[]; colors: string[] };
    };
    expect(options.styleBuckets.colors).toEqual(['#111111', '#999999']);
    expect([...options.styleBuckets.buckets[0]]).toEqual([0]);
    expect([...options.styleBuckets.buckets[1]]).toEqual([1]);
  });

  it('static fill layer does not touch resolver output', () => {
    const painter = makePainter();
    const ctx = makeStyleCtx({
      layers: [{ id: 'L', type: 'fill', source: 's', paint: { 'fill-color': '#abcdef' } }],
      ml: { geometry_type: 'polygon', shapes: [[[0]]] } as Partial<MapshaperLayer>,
      dataset: { editVersion: 0 },
      painter,
    });
    renderLayers(ctx as never, 1, 1);
    const call = painter.drawPolygonFill.mock.calls[0] as unknown[];
    expect((call[5] as { styleBuckets?: unknown }).styleBuckets).toBeUndefined();
  });

  it('styleSource opt-in renders baked fill field via buckets', () => {
    const dataset = { editVersion: 0, attributeVersion: 0 };
    const ml = {
      geometry_type: 'polygon',
      shapes: [[[0]], [[1]]],
      data: { getRecords: () => [{ fill: '#123456' }, {}] },
    };
    const painter = makePainter();
    const ctx = makeStyleCtx({
      layers: [{ id: 'L', type: 'fill', source: 's', styleSource: 'mapshaper' }],
      ml: ml as Partial<MapshaperLayer>,
      dataset,
      painter,
    });
    renderLayers(ctx as never, 1, 1);
    const call = painter.drawPolygonFill.mock.calls[0] as unknown[];
    const options = call[5] as {
      styleBuckets: { buckets: Uint32Array[]; colors: string[] };
    };
    expect(options.styleBuckets.colors[0]).toBe('#123456');
    expect(options.styleBuckets.colors).toHaveLength(2); // 含 null 桶（主题色）
    expect([...options.styleBuckets.buckets[0]]).toEqual([0]);
    expect([...options.styleBuckets.buckets[1]]).toEqual([1]);
  });

  it('line layer with expression renders feature buckets with per-bucket colors', () => {
    const dataset = { editVersion: 0, attributeVersion: 0 };
    const ml = {
      geometry_type: 'polyline',
      shapes: [[[0]], [[1]]],
      data: { getRecords: () => [{ cls: 'a' }, { cls: 'b' }] },
    };
    const painter = makePainter();
    const ctx = makeStyleCtx({
      layers: [
        {
          id: 'L',
          type: 'line',
          source: 's',
          paint: { 'line-color': ['match', ['get', 'cls'], 'a', '#111111', '#999999'] },
        },
      ],
      ml: ml as Partial<MapshaperLayer>,
      dataset,
      painter,
    });

    renderLayers(ctx as never, 1, 1);

    expect(painter.drawPaths).toHaveBeenCalledTimes(2);
    expect(painter.drawPaths.mock.calls[0]?.[1]).toMatchObject({ color: '#111111' });
    expect(painter.drawPaths.mock.calls[1]?.[1]).toMatchObject({ color: '#999999' });
    expect(painter.drawPaths.mock.calls[0]?.[0]).toBe(ml.shapes);
    expect([...painter.drawPaths.mock.calls[0]?.[4]]).toEqual([0]);
    expect([...painter.drawPaths.mock.calls[1]?.[4]]).toEqual([1]);
  });

  it('styleSource opt-in reads baked stroke field for line layers', () => {
    const dataset = { editVersion: 0, attributeVersion: 0 };
    const ml = {
      geometry_type: 'polyline',
      shapes: [[[0]], [[1]]],
      data: { getRecords: () => [{ stroke: '#123456' }, { stroke: '#abcdef' }] },
    };
    const painter = makePainter();
    const ctx = makeStyleCtx({
      layers: [{ id: 'L', type: 'line', source: 's', styleSource: 'mapshaper' }],
      ml: ml as Partial<MapshaperLayer>,
      dataset,
      painter,
    });

    renderLayers(ctx as never, 1, 1);

    expect(painter.drawPaths.mock.calls.map((call) => call[1]?.color)).toEqual([
      '#123456',
      '#abcdef',
    ]);
  });

  it('circle layer with expression renders point buckets with per-bucket colors', () => {
    const dataset = { editVersion: 0, attributeVersion: 0 };
    const ml = {
      geometry_type: 'point',
      shapes: [[[1, 1]], [[2, 2]]],
      data: { getRecords: () => [{ cls: 'a' }, { cls: 'b' }] },
    };
    const painter = makePainter();
    const ctx = makeStyleCtx({
      layers: [
        {
          id: 'L',
          type: 'circle',
          source: 's',
          paint: { 'circle-color': ['match', ['get', 'cls'], 'a', '#111111', '#999999'] },
        },
      ],
      ml: ml as Partial<MapshaperLayer>,
      dataset,
      painter,
    });

    renderLayers(ctx as never, 1, 1);

    expect(painter.drawPoints).toHaveBeenCalledTimes(2);
    expect(painter.drawPoints.mock.calls[0]?.[1]).toMatchObject({ color: '#111111' });
    expect(painter.drawPoints.mock.calls[1]?.[1]).toMatchObject({ color: '#999999' });
    expect(painter.drawPoints.mock.calls[0]?.[0]).toBe(ml.shapes);
    expect([...painter.drawPoints.mock.calls[0]?.[2]]).toEqual([0]);
    expect([...painter.drawPoints.mock.calls[1]?.[2]]).toEqual([1]);
  });

  it('styleSource opt-in reads baked fill field for circle layers', () => {
    const dataset = { editVersion: 0, attributeVersion: 0 };
    const ml = {
      geometry_type: 'point',
      shapes: [[[1, 1]], [[2, 2]]],
      data: { getRecords: () => [{ fill: '#123456' }, { fill: '#abcdef' }] },
    };
    const painter = makePainter();
    const ctx = makeStyleCtx({
      layers: [{ id: 'L', type: 'circle', source: 's', styleSource: 'mapshaper' }],
      ml: ml as Partial<MapshaperLayer>,
      dataset,
      painter,
    });

    renderLayers(ctx as never, 1, 1);

    expect(painter.drawPoints.mock.calls.map((call) => call[1]?.color)).toEqual([
      '#123456',
      '#abcdef',
    ]);
  });
  it('line layer with dashstyle expression renders per-bucket dashType with resolved dash arrays', () => {
    const dataset = { editVersion: 0, attributeVersion: 0 };
    const ml = {
      geometry_type: 'polyline',
      shapes: [[[0]], [[1]], [[2]]],
      data: { getRecords: () => [{ k: 'a' }, { k: 'b' }, { k: 'c' }] },
    };
    const painter = makePainter();
    const ctx = makeStyleCtx({
      layers: [
        {
          id: 'L',
          type: 'line',
          source: 's',
          paint: {
            'line-color': '#123456',
            'line-dasharray': [3, 2],
            'line-dashstyle': ['match', ['get', 'k'], 'a', 'dash', 'b', 'dot', 'solid'],
          },
        },
      ],
      ml: ml as Partial<MapshaperLayer>,
      dataset,
      painter,
    });

    renderLayers(ctx as never, 1, 1);

    expect(painter.drawPaths).toHaveBeenCalledTimes(3);
    // 具名模式的 dash 数组按 lineScale=1 重解，不得沿用图层级 [3, 2]。
    expect(painter.drawPaths.mock.calls[0]?.[1]).toMatchObject({
      color: '#123456',
      dashType: 'dash',
      dash: [8, 6],
    });
    expect(painter.drawPaths.mock.calls[1]?.[1]).toMatchObject({
      color: '#123456',
      dashType: 'dot',
      dash: [1.5, 5],
    });
    // solid 桶必须丢弃图层静态 dasharray。
    expect(painter.drawPaths.mock.calls[2]?.[1]).toMatchObject({
      color: '#123456',
      dashType: 'solid',
    });
    expect(painter.drawPaths.mock.calls[2]?.[1].dash).toBeUndefined();
    expect([...painter.drawPaths.mock.calls[0]?.[4]]).toEqual([0]);
    expect([...painter.drawPaths.mock.calls[1]?.[4]]).toEqual([1]);
    expect([...painter.drawPaths.mock.calls[2]?.[4]]).toEqual([2]);
  });

  it('circle layer with shape expression renders per-bucket shape', () => {
    const dataset = { editVersion: 0, attributeVersion: 0 };
    const ml = {
      geometry_type: 'point',
      shapes: [[[1, 1]], [[2, 2]]],
      data: { getRecords: () => [{ k: 'a' }, { k: 'b' }] },
    };
    const painter = makePainter();
    const ctx = makeStyleCtx({
      layers: [
        {
          id: 'L',
          type: 'circle',
          source: 's',
          paint: {
            'circle-color': '#123456',
            'circle-shape': ['match', ['get', 'k'], 'a', 'star', 'square'],
          },
        },
      ],
      ml: ml as Partial<MapshaperLayer>,
      dataset,
      painter,
    });

    renderLayers(ctx as never, 1, 1);

    expect(painter.drawPoints).toHaveBeenCalledTimes(2);
    expect(painter.drawPoints.mock.calls[0]?.[1]).toMatchObject({
      color: '#123456',
      shape: 'star',
    });
    expect(painter.drawPoints.mock.calls[1]?.[1]).toMatchObject({
      color: '#123456',
      shape: 'square',
    });
  });
});

describe('renderLayers display filter', () => {
  it('circle layer with filter draws only matching features', () => {
    const ml = {
      geometry_type: 'point',
      shapes: [[[1, 1]], [[2, 2]], [[3, 3]]],
      data: { getRecords: () => [{ v: 1 }, { v: 2 }, { v: 3 }] },
    };
    const painter = makePainter();
    const ctx = makeStyleCtx({
      layers: [
        {
          id: 'L',
          type: 'circle',
          source: 's',
          filter: ['>', ['get', 'v'], 1],
        },
      ],
      ml: ml as Partial<MapshaperLayer>,
      dataset: { editVersion: 0, attributeVersion: 0 },
      painter,
    });
    ctx.filterResolver = new FilterResolver();

    renderLayers(ctx as never, 1, 1);

    expect([...painter.drawPoints.mock.calls[0]?.[2]]).toEqual([1, 2]);
  });

  it('line layer with filter limits drawPaths to matching features', () => {
    const ml = {
      geometry_type: 'polyline',
      shapes: [[[0]], [[1]], [[2]]],
      data: { getRecords: () => [{ v: 1 }, { v: 2 }, { v: 3 }] },
    };
    const painter = makePainter();
    const ctx = makeStyleCtx({
      layers: [
        {
          id: 'L',
          type: 'line',
          source: 's',
          filter: ['>', ['get', 'v'], 1],
          paint: { 'line-color': ['match', ['get', 'v'], 2, '#111111', '#222222'] },
        },
      ],
      ml: ml as Partial<MapshaperLayer>,
      dataset: { editVersion: 0, attributeVersion: 0 },
      painter,
    });
    ctx.filterResolver = new FilterResolver();

    renderLayers(ctx as never, 1, 1);

    expect(painter.drawPaths.mock.calls.flatMap((call) => [...call[4]]).sort()).toEqual([1, 2]);
  });

  it('filter matching nothing skips the layer entirely', () => {
    const ml = {
      geometry_type: 'point',
      shapes: [[[1, 1]], [[2, 2]], [[3, 3]]],
      data: { getRecords: () => [{ v: 1 }, { v: 2 }, { v: 3 }] },
    };
    const painter = makePainter();
    const ctx = makeStyleCtx({
      layers: [
        {
          id: 'L',
          type: 'circle',
          source: 's',
          filter: ['>', ['get', 'v'], 99],
        },
      ],
      ml: ml as Partial<MapshaperLayer>,
      dataset: { editVersion: 0, attributeVersion: 0 },
      painter,
    });
    ctx.filterResolver = new FilterResolver();

    renderLayers(ctx as never, 1, 1);

    expect(painter.drawPoints).not.toHaveBeenCalled();
    expect(painter.drawPaths).not.toHaveBeenCalled();
    expect(painter.drawArcs).not.toHaveBeenCalled();
    expect(painter.drawPolygonFill).not.toHaveBeenCalled();
  });
});

describe('automatic point LOD', () => {
  it('reduces dense points without modifying original shapes', () => {
    const { ctx, ml, events } = fixture('circle', false);
    if (ctx.layers[0].type === 'circle') ctx.layers[0].pointLod = undefined;
    ml.shapes = Array.from({ length: 10_000 }, (_, i) => [
      [250 + (i % 100) / 100, 250 + Math.floor(i / 100) / 100],
    ]);
    const original = JSON.stringify(ml.shapes);
    renderLayers(ctx, 1, 1);
    expect(events.filter((event) => event[0] === 'arc').length).toBeLessThan(100);
    expect(JSON.stringify(ml.shapes)).toBe(original);
  });
});

describe('point LOD drawing contracts', () => {
  it('keeps original MultiPoint components and attribute buckets at DPR 1 and 2', () => {
    for (const ratio of [1, 2]) {
      const { ctx, ml, events, dataset } = fixture('circle', true);
      if (ctx.layers[0].type === 'circle') ctx.layers[0].pointLod = undefined;
      ml.shapes = Array.from({ length: 20_000 }, () => [
        [250, 250],
        [250.1, 250.1],
      ]);
      ml.shapes[1] = [
        [258, 250],
        [266, 250],
      ];
      ml.data = getDefaultMapshaperAdapter().createDataTable(
        ml.shapes.map((_, id) => ({ fill: id % 2 ? '#ff0000' : '#0000ff' })),
      );
      dataset.attributeVersion = 1;
      ctx.painter.setPixelRatio(ratio);
      const spy = vi.spyOn(ctx.painter, 'drawPoints');
      renderLayers(ctx, 1, 1);
      expect(spy.mock.calls).toHaveLength(2);
      const calls = spy.mock.calls.map((call) => ({
        color: call[1].color,
        ids: [...call[2]!],
        components: [...call[3]!],
      }));
      expect(calls).toEqual([
        { color: '#0000ff', ids: [0], components: [0] },
        { color: '#ff0000', ids: [1, 1], components: [0, 1] },
      ]);
      const first = events.find((event) => event[0] === 'arc')!;
      expect(first.slice(1, 4)).toEqual([50 * ratio, 50 * ratio, 4 * ratio]);
    }
  });

  it('warm filtered pans do not consult original candidates or hidden point coordinates', () => {
    const { ctx, ml, dataset } = fixture('circle', false);
    if (ctx.layers[0].type === 'circle') {
      ctx.layers[0].pointLod = undefined;
      ctx.layers[0].filter = ['>', ['get', 'id'], 0];
    }
    ml.shapes = Array.from({ length: 20_000 }, () => [[250, 250]]);
    ml.data = getDefaultMapshaperAdapter().createDataTable(ml.shapes.map((_, id) => ({ id })));
    dataset.attributeVersion = 1;
    ctx.filterResolver = new FilterResolver();
    const candidates = vi.fn(() => {
      throw new Error('original spatial candidates');
    });
    ctx.getRenderCandidates = candidates;
    renderLayers(ctx, 1, 1);
    for (let id = 2; id < ml.shapes.length; id++) {
      Object.defineProperty(ml.shapes[id]!, '0', {
        get() {
          throw new Error('hidden coordinate rescan');
        },
      });
    }
    ctx.viewport.pan(1, 0);
    expect(() => renderLayers(ctx, 1, 1)).not.toThrow();
    expect(candidates).not.toHaveBeenCalled();
  });
});
