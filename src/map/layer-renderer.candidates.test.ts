// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createCanvasPainterHarness } from '../../test/utils/canvas-painter';
import { getDefaultMapshaperAdapter } from '../adapter/mapshaper-adapter';
import { Bounds } from '../geo/bounds';
import { Viewport } from '../geo/viewport';
import type { MutableTopologySource } from '../source/source';
import type { MapshaperDataset, MapshaperLayer, PathShape } from '../types/mapshaper-types';
import { FeatureQuery } from './feature-query';
import type { LayerSpecification } from './layer';
import { renderLayers, type LayerRendererContext } from './layer-renderer';
import { StyleResolver } from './style-resolver';

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
