import { describe, expect, it, vi } from 'vitest';
import { renderLayers } from './layer-renderer';

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
