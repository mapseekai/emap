import { describe, expect, it, vi, type Mock } from 'vitest';
import { renderLayers } from './layer-renderer';
import { StyleResolver } from './style-resolver';
import type { MapshaperDataset, MapshaperLayer } from '../types/mapshaper-types';

// 与 layer-renderer.test.ts 相同的内联夹具风格：stub source/viewport/painter。
function makeStyleCtx(opts: {
  layers: unknown[];
  ml?: Partial<MapshaperLayer>;
  dataset?: Partial<MapshaperDataset>;
  painter: { drawPolygonFill: Mock };
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

describe('renderLayers style integration', () => {
  it('fill layer with expression renders via styleBuckets', () => {
    const dataset = { editVersion: 0, attributeVersion: 0 };
    const ml = {
      geometry_type: 'polygon',
      shapes: [[[0]], [[1]]],
      data: { getRecords: () => [{ t: 'a' }, { t: 'b' }] },
    };
    const painter = { drawPolygonFill: vi.fn(), drawArcs: vi.fn(), drawPoints: vi.fn() };
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
    const painter = { drawPolygonFill: vi.fn(), drawArcs: vi.fn(), drawPoints: vi.fn() };
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
    const painter = { drawPolygonFill: vi.fn(), drawArcs: vi.fn(), drawPoints: vi.fn() };
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
});
