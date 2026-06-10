import { describe, expect, it, vi } from 'vitest';
import { renderLayers } from './layer-renderer';

describe('renderLayers fill rendering', () => {
  it('skips outline arc flag work when fill layer line width is zero', () => {
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
    };
    const painter = {
      drawPolygonFill: vi.fn(),
      drawArcs: vi.fn(),
    };
    const getLayerArcFlags = vi.fn();

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
        getLayerArcFlags,
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
    expect(getLayerArcFlags).not.toHaveBeenCalled();
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
        getLayerArcFlags: vi.fn(),
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
});
