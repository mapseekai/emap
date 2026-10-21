import { describe, expect, it, vi } from 'vitest';
import { Emap } from '../../../src/engine/map/map';
import { TopologySource } from '../../../src/domain/source/topology-source';
import { getDefaultMapshaperAdapter } from '../../../src/integrations/mapshaper/adapter';
import { renderLayers } from '../../../src/engine/map/layer-renderer';
import type { CorePainter } from '../../../src/engine/rendering/painter';
import { Bounds } from '../../../src/domain/geo/bounds';

describe('geometry LOD public configuration', () => {
  it('keeps screen filtering independent at creation and through runtime changes', async () => {
    const map = await Emap.create({
      preset: 'headless',
      geometryLod: false,
      screenPathFiltering: false,
    });
    try {
      const viewport = map.ctx.view._viewport;
      expect(viewport.screenPathFiltering).toBe(false);
      map.setScreenPathFiltering(true);
      expect(viewport.screenPathFiltering).toBe(true);
      expect(viewport.geometryLodTolerance).toBe(0);
      map.setGeometryLod({ pixelTolerance: 2 });
      map.setScreenPathFiltering(false);
      expect(viewport.geometryLodTolerance).toBe(2);
      expect(viewport.screenPathFiltering).toBe(false);
      map.setScreenPathFiltering();
      expect(viewport.screenPathFiltering).toBe(true);
    } finally {
      await map.dispose();
    }
  });

  it('shares creation/runtime settings between line drawing and feature picking without removing source vertices', async () => {
    const map = await Emap.create({ preset: 'headless', geometryLod: false });
    try {
      const source = new TopologySource('s');
      const arcs = getDefaultMapshaperAdapter().createArcCollection([
        {
          xx: new Float64Array([0, 10, 20, 30]),
          yy: new Float64Array([0, 20, 0, 0]),
        },
      ]);
      arcs.setThresholds!(new Float64Array([Infinity, 0.4, 2, Infinity]));
      source.setDataset(
        {
          arcs,
          info: { crs_string: 'EPSG:4326' },
          layers: [{ name: 'road', geometry_type: 'polyline', shapes: [[[0]]] }],
        },
        false,
      );
      await map.addSource('s', source);
      map.addLayer({ id: 'road', source: 's', type: 'line' });
      const viewport = map.ctx.view._viewport;
      viewport.updateSize(200, 200);
      map.setExtent(new Bounds(0, 0, 30, 30));
      viewport.applyCameraState([15, 10], 1);
      const painter = { drawArcs: vi.fn() } as unknown as CorePainter;
      const draw = () =>
        renderLayers(
          {
            sources: map.ctx.document._sources,
            layers: map.getRenderedLayers(),
            viewport,
            painter,
            resolveSourceLayer: (id, layer) => map.ctx.document.layers.resolve(id, layer),
            getLayerArcIds: () => new Uint32Array([0]),
          },
          1 / Math.abs(map.getTransform().mx),
          1,
        );
      draw();
      expect(arcs.getRetainedInterval!()).toBe(0);
      expect(map.queryFeatures(map.project(10, 20)).map((feature) => feature.id)).toEqual([0]);
      map.setGeometryLod({ pixelTolerance: 2 });
      draw();
      expect(arcs.getRetainedInterval!()).toBe(2);
      expect(map.queryFeatures(map.project(10, 20))).toEqual([]);
      map.setGeometryLod(false);
      draw();
      expect(map.queryFeatures(map.project(10, 20)).map((feature) => feature.id)).toEqual([0]);
      expect(Array.from(arcs.getVertexData!().xx)).toEqual([0, 10, 20, 30]);
      expect(Array.from(arcs.getVertexData!().yy)).toEqual([0, 20, 0, 0]);
      expect(source.getLayers()[0].shapes).toHaveLength(1);
    } finally {
      await map.dispose();
    }
  });
  it('rejects invalid creation settings', async () => {
    await expect(
      Emap.create({ preset: 'headless', geometryLod: { pixelTolerance: NaN } }),
    ).rejects.toThrow(/geometryLod/);
  });
});
