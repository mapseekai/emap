import { describe, expect, it, vi } from 'vitest';
import { HighlightManager } from './highlight-manager';
import { AffineTransform } from '../geo/transform';
import type { CorePainter } from '../renderer/painter';
import type { TopologySource } from '../source/source';
import type { MapshaperLayer } from '../types/mapshaper-types';

// `HighlightManager` is the transient hover/selection render state —
// distinct from `Selection` (persistent state). These tests pin the
// state-mgmt API (set / clear / size / style merge) and the render
// dispatch path (filters by source/layer, points vs paths, visible-layer
// gate).

function makePainterStub() {
  return {
    drawPoints: vi.fn(),
    drawPaths: vi.fn(),
    setColor: vi.fn(),
    drawArcs: vi.fn(),
  } as unknown as CorePainter & { drawPoints: any; drawPaths: any };
}

function makeSource(layers: MapshaperLayer[]): TopologySource {
  return {
    getLayers: () => layers,
    getDisplayArcs: () => null,
    getArcs: () => ({} as any), // truthy stub — drawPaths only checks truthiness
  } as unknown as TopologySource;
}

describe('HighlightManager state', () => {
  it('starts empty', () => {
    const h = new HighlightManager();
    expect(h.size).toBe(0);
  });

  it('setHighlightedFeatures stores per-source/layer', () => {
    const h = new HighlightManager();
    h.setHighlightedFeatures([
      { source: 'src1', layer: 'parks', id: 1, geometryType: 'polygon', properties: {} },
      { source: 'src1', layer: 'parks', id: 2, geometryType: 'polygon', properties: {} },
      { source: 'src2', layer: 'roads', id: 5, geometryType: 'polyline', properties: {} },
    ]);
    expect(h.size).toBe(2); // two source keys
  });

  it('setHighlightedFeatures replaces prior state (not append)', () => {
    const h = new HighlightManager();
    h.setHighlightedFeatures([
      { source: 'src1', layer: 'parks', id: 1, geometryType: 'polygon', properties: {} },
    ]);
    h.setHighlightedFeatures([
      { source: 'src2', layer: 'roads', id: 5, geometryType: 'polyline', properties: {} },
    ]);
    expect(h.size).toBe(1); // only src2 — src1 was wiped
  });

  it('setHighlightedFeatures([]) clears state', () => {
    const h = new HighlightManager();
    h.setHighlightedFeatures([
      { source: 'src1', layer: 'parks', id: 1, geometryType: 'polygon', properties: {} },
    ]);
    h.setHighlightedFeatures([]);
    expect(h.size).toBe(0);
  });

  it('setHighlightedFeatures dedupes the same id within a layer', () => {
    const h = new HighlightManager();
    h.setHighlightedFeatures([
      { source: 's', layer: 'l', id: 1, geometryType: 'polygon', properties: {} },
      { source: 's', layer: 'l', id: 1, geometryType: 'polygon', properties: {} },
      { source: 's', layer: 'l', id: 1, geometryType: 'polygon', properties: {} },
    ]);
    // Internal storage uses a Set — only one render call per id.
    expect(h.size).toBe(1);
  });

  it('clearHighlightedFeatures returns true when there were features', () => {
    const h = new HighlightManager();
    h.setHighlightedFeatures([
      { source: 's', layer: 'l', id: 1, geometryType: 'polygon', properties: {} },
    ]);
    expect(h.clearHighlightedFeatures()).toBe(true);
    expect(h.size).toBe(0);
  });

  it('clearHighlightedFeatures returns false when already empty', () => {
    const h = new HighlightManager();
    expect(h.clearHighlightedFeatures()).toBe(false);
  });

  it('setHighlightStyle returns true iff highlights are active', () => {
    const h = new HighlightManager();
    expect(h.setHighlightStyle({ color: '#fff' })).toBe(false); // empty
    h.setHighlightedFeatures([
      { source: 's', layer: 'l', id: 1, geometryType: 'polygon', properties: {} },
    ]);
    expect(h.setHighlightStyle({ color: '#000' })).toBe(true);
  });
});

describe('HighlightManager.renderHighlights', () => {
  it('returns early when nothing is highlighted', () => {
    const h = new HighlightManager();
    const painter = makePainterStub();
    h.renderHighlights(painter, new globalThis.Map(), new AffineTransform(), 1);
    expect(painter.drawPaths).not.toHaveBeenCalled();
    expect(painter.drawPoints).not.toHaveBeenCalled();
  });

  it('renders polygon highlights via drawPaths', () => {
    const h = new HighlightManager();
    const layer: MapshaperLayer = {
      name: 'parks', geometry_type: 'polygon',
      shapes: [[[0]], [[1]], [[2]]],
    } as MapshaperLayer;
    const sources = new globalThis.Map<string, TopologySource>([
      ['src1', makeSource([layer])],
    ]);
    h.setHighlightedFeatures([
      { source: 'src1', layer: 'parks', id: 1, geometryType: 'polygon', properties: {} },
    ]);
    const painter = makePainterStub();
    h.renderHighlights(painter, sources, new AffineTransform(), 1);
    expect(painter.drawPaths).toHaveBeenCalledTimes(1);
    expect(painter.drawPoints).not.toHaveBeenCalled();
  });

  it('renders point highlights via drawPoints', () => {
    const h = new HighlightManager();
    const layer: MapshaperLayer = {
      name: 'cities', geometry_type: 'point',
      shapes: [[[0, 0]], [[1, 1]]],
    } as MapshaperLayer;
    const sources = new globalThis.Map<string, TopologySource>([
      ['src1', makeSource([layer])],
    ]);
    h.setHighlightedFeatures([
      { source: 'src1', layer: 'cities', id: 0, geometryType: 'point', properties: {} },
    ]);
    const painter = makePainterStub();
    h.renderHighlights(painter, sources, new AffineTransform(), 1);
    expect(painter.drawPoints).toHaveBeenCalledTimes(1);
    expect(painter.drawPaths).not.toHaveBeenCalled();
  });

  it('respects the visibleLayers filter', () => {
    const h = new HighlightManager();
    const layer: MapshaperLayer = {
      name: 'parks', geometry_type: 'polygon',
      shapes: [[[0]]],
    } as MapshaperLayer;
    const sources = new globalThis.Map<string, TopologySource>([
      ['src1', makeSource([layer])],
    ]);
    h.setHighlightedFeatures([
      { source: 'src1', layer: 'parks', id: 0, geometryType: 'polygon', properties: {} },
    ]);
    const painter = makePainterStub();
    // Filter excludes 'src1:parks' → no draw call.
    h.renderHighlights(painter, sources, new AffineTransform(), 1, new Set(['src1:other']));
    expect(painter.drawPaths).not.toHaveBeenCalled();
    // Filter includes 'src1:parks' → drawPaths fires.
    h.renderHighlights(painter, sources, new AffineTransform(), 1, new Set(['src1:parks']));
    expect(painter.drawPaths).toHaveBeenCalledTimes(1);
  });

  it('skips layers whose ids do not match', () => {
    const h = new HighlightManager();
    const parks: MapshaperLayer = {
      name: 'parks', geometry_type: 'polygon', shapes: [[[0]]],
    } as MapshaperLayer;
    const roads: MapshaperLayer = {
      name: 'roads', geometry_type: 'polyline', shapes: [[[0]]],
    } as MapshaperLayer;
    const sources = new globalThis.Map<string, TopologySource>([
      ['src1', makeSource([parks, roads])],
    ]);
    // Highlight only roads.
    h.setHighlightedFeatures([
      { source: 'src1', layer: 'roads', id: 0, geometryType: 'polyline', properties: {} },
    ]);
    const painter = makePainterStub();
    h.renderHighlights(painter, sources, new AffineTransform(), 1);
    // Exactly one draw call, for roads.
    expect(painter.drawPaths).toHaveBeenCalledTimes(1);
  });

  it('skips ids that no longer exist in layer.shapes (post-edit dangling refs)', () => {
    const h = new HighlightManager();
    const layer: MapshaperLayer = {
      name: 'parks', geometry_type: 'polygon',
      shapes: [[[0]]],
    } as MapshaperLayer;
    const sources = new globalThis.Map<string, TopologySource>([
      ['src1', makeSource([layer])],
    ]);
    // Highlight an out-of-range id.
    h.setHighlightedFeatures([
      { source: 'src1', layer: 'parks', id: 99, geometryType: 'polygon', properties: {} },
    ]);
    const painter = makePainterStub();
    h.renderHighlights(painter, sources, new AffineTransform(), 1);
    // shapes[99] is undefined → no draw call (early-skip).
    expect(painter.drawPaths).not.toHaveBeenCalled();
  });
});
