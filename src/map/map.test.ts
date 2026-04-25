import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Emap } from './map';
import type { FeatureRef } from './map';
import type { LayerSpecification } from './layer';
import { Selection } from './selection';
import { EditHistory } from '../edit/edit-history';

function setPrivate(target: object, key: string, value: unknown): void {
  Reflect.set(target, key, value);
}

function getPrivate(target: object, key: string): unknown {
  return Reflect.get(target, key);
}

function callPrivate(target: object, key: string, ...args: unknown[]): unknown {
  const fn = Reflect.get(target, key);
  if (typeof fn !== 'function') {
    throw new Error(`Expected ${key} to be a function`);
  }
  return (fn as (...input: unknown[]) => unknown).apply(target, args);
}

function createMockSource(layers?: unknown[]) {
  return {
    id: 'test',
    type: 'topology' as const,
    on: vi.fn(),
    off: vi.fn(),
    fire: vi.fn(),
    getExtent: vi.fn(() => ({ xmin: 0, ymin: 0, xmax: 1, ymax: 1 })),
    getArcs: vi.fn(() => undefined),
    getLayers: vi.fn(() => layers || []),
    getDataset: vi.fn(() => undefined),
    getDisplayArcs: vi.fn(() => null),
    getCRS: vi.fn(() => 'EPSG:4326'),
  };
}

/**
 * Create a bare Emap instance with private state injected, bypassing the DOM-dependent constructor.
 */
function createBareMap(): Emap {
  // Use Object.create to get an instance without calling the constructor
  const map = Object.create(Emap.prototype);
  // Initialize essential private state that the layer management methods depend on
  setPrivate(map, '_sources', new globalThis.Map());
  setPrivate(map, '_sourceListeners', new globalThis.Map());
  setPrivate(map, '_layers', []);
  setPrivate(map, '_pendingRender', 0);
  setPrivate(map, '_rafId', 0);
  setPrivate(map, '_highlightManager', { clearHighlightedFeatures: vi.fn() });
  // EventDispatcher field initializer does not run when bypassing constructor
  setPrivate(map, '_listeners', {});
  // Initialize selection so select / deselect / clearSelection have somewhere to write
  setPrivate(map, '_selection', new Selection());
  // Stub _scheduleRender so it doesn't try to use requestAnimationFrame
  setPrivate(map, '_scheduleRender', vi.fn());
  return map as Emap;
}

describe('Emap layer management', () => {
  let map: Emap;

  beforeEach(() => {
    vi.restoreAllMocks();
    map = createBareMap();
  });

  describe('addLayer', () => {
    it('adds a layer and retrieves it', () => {
      const source = createMockSource();
      map.addSource('src1', source as any);

      const spec: LayerSpecification = {
        id: 'my-layer',
        type: 'line',
        source: 'src1',
        paint: { 'line-color': '#f00', 'line-width': 2 },
      };
      map.addLayer(spec);

      expect(map.getLayer('my-layer')).toEqual(spec);
      expect(map.getLayers()).toHaveLength(1);
    });

    it('throws if source does not exist', () => {
      expect(() =>
        map.addLayer({ id: 'l1', type: 'line', source: 'nonexistent' }),
      ).toThrow('Source "nonexistent" not found');
    });

    it('throws if layer id is duplicate', () => {
      const source = createMockSource();
      map.addSource('src1', source as any);

      map.addLayer({ id: 'l1', type: 'line', source: 'src1' });
      expect(() =>
        map.addLayer({ id: 'l1', type: 'line', source: 'src1' }),
      ).toThrow('Layer "l1" already exists');
    });

    it('inserts before specified layer', () => {
      const source = createMockSource();
      map.addSource('src1', source as any);

      map.addLayer({ id: 'a', type: 'line', source: 'src1' });
      map.addLayer({ id: 'c', type: 'line', source: 'src1' });
      map.addLayer({ id: 'b', type: 'line', source: 'src1' }, 'c');

      const ids = map.getLayers().map((l) => l.id);
      expect(ids).toEqual(['a', 'b', 'c']);
    });

    it('throws if before layer does not exist', () => {
      const source = createMockSource();
      map.addSource('src1', source as any);

      expect(() =>
        map.addLayer({ id: 'l1', type: 'line', source: 'src1' }, 'nonexistent'),
      ).toThrow('Layer "nonexistent" not found');
    });
  });

  describe('removeLayer', () => {
    it('removes a layer by id', () => {
      const source = createMockSource();
      map.addSource('src1', source as any);

      map.addLayer({ id: 'l1', type: 'line', source: 'src1' });
      map.addLayer({ id: 'l2', type: 'line', source: 'src1' });
      map.removeLayer('l1');

      expect(map.getLayers()).toHaveLength(1);
      expect(map.getLayer('l1')).toBeUndefined();
    });

    it('does nothing if layer does not exist', () => {
      map.removeLayer('nonexistent');
      expect(map.getLayers()).toHaveLength(0);
    });
  });

  describe('setLayerVisibility', () => {
    it('sets visibility to none', () => {
      const source = createMockSource();
      map.addSource('src1', source as any);
      map.addLayer({ id: 'l1', type: 'line', source: 'src1' });

      map.setLayerVisibility('l1', 'none');
      expect(map.getLayer('l1')?.layout?.visibility).toBe('none');
    });

    it('sets visibility to visible', () => {
      const source = createMockSource();
      map.addSource('src1', source as any);
      map.addLayer({
        id: 'l1',
        type: 'line',
        source: 'src1',
        layout: { visibility: 'none' },
      });

      map.setLayerVisibility('l1', 'visible');
      expect(map.getLayer('l1')?.layout?.visibility).toBe('visible');
    });
  });

  describe('setPaintProperty', () => {
    it('updates a paint property', () => {
      const source = createMockSource();
      map.addSource('src1', source as any);
      map.addLayer({
        id: 'l1',
        type: 'line',
        source: 'src1',
        paint: { 'line-color': '#333' },
      });

      map.setPaintProperty('l1', 'line-color', '#ff0');
      const layer = map.getLayer('l1');
      expect((layer?.paint as any)?.['line-color']).toBe('#ff0');
    });

    it('creates paint object if not present', () => {
      const source = createMockSource();
      map.addSource('src1', source as any);
      map.addLayer({ id: 'l1', type: 'line', source: 'src1' });

      map.setPaintProperty('l1', 'line-width', 5);
      const layer = map.getLayer('l1');
      expect((layer?.paint as any)?.['line-width']).toBe(5);
    });
  });

  describe('moveLayer', () => {
    it('moves a layer to the end', () => {
      const source = createMockSource();
      map.addSource('src1', source as any);
      map.addLayer({ id: 'a', type: 'line', source: 'src1' });
      map.addLayer({ id: 'b', type: 'line', source: 'src1' });
      map.addLayer({ id: 'c', type: 'line', source: 'src1' });

      map.moveLayer('a');
      expect(map.getLayers().map((l) => l.id)).toEqual(['b', 'c', 'a']);
    });

    it('moves a layer before another', () => {
      const source = createMockSource();
      map.addSource('src1', source as any);
      map.addLayer({ id: 'a', type: 'line', source: 'src1' });
      map.addLayer({ id: 'b', type: 'line', source: 'src1' });
      map.addLayer({ id: 'c', type: 'line', source: 'src1' });

      map.moveLayer('c', 'a');
      expect(map.getLayers().map((l) => l.id)).toEqual(['c', 'a', 'b']);
    });
  });

  describe('_getEffectiveLayers', () => {
    it('returns explicit layers when present', () => {
      const source = createMockSource();
      map.addSource('src1', source as any);
      map.addLayer({ id: 'l1', type: 'line', source: 'src1' });

      const effective = callPrivate(map, '_getEffectiveLayers') as LayerSpecification[];
      expect(effective).toHaveLength(1);
      expect(effective[0].id).toBe('l1');
    });

    it('auto-generates defaults from sources when no layers added', () => {
      const layers = [
        { name: 'roads', geometry_type: 'polyline', shapes: [[1]] },
        { name: 'cities', geometry_type: 'point', shapes: [[0, 0]] },
      ];
      const source = createMockSource(layers);
      map.addSource('src1', source as any);

      const effective = callPrivate(map, '_getEffectiveLayers') as LayerSpecification[];
      expect(effective).toHaveLength(2);
      expect(effective[0].id).toBe('src1:roads');
      expect(effective[0].type).toBe('line');
      expect(effective[1].id).toBe('src1:cities');
      expect(effective[1].type).toBe('circle');
    });

    it('creates a default line layer for source with no mapshaper layers', () => {
      const source = createMockSource([]);
      map.addSource('src1', source as any);

      const effective = callPrivate(map, '_getEffectiveLayers') as LayerSpecification[];
      expect(effective).toHaveLength(1);
      expect(effective[0].id).toBe('src1:default');
      expect(effective[0].type).toBe('line');
    });

    it('maps polygon geometry to fill layer type', () => {
      const layers = [
        { name: 'countries', geometry_type: 'polygon', shapes: [[[1]]] },
      ];
      const source = createMockSource(layers);
      map.addSource('src1', source as any);

      const effective = callPrivate(map, '_getEffectiveLayers') as LayerSpecification[];
      expect(effective[0].type).toBe('fill');
    });
  });

  describe('_resolveSourceLayer', () => {
    it('returns first layer when no source-layer specified', () => {
      const layers = [
        { name: 'roads', geometry_type: 'polyline', shapes: [] },
        { name: 'rivers', geometry_type: 'polyline', shapes: [] },
      ];
      const source = createMockSource(layers);

      const result = callPrivate(map, '_resolveSourceLayer', source, undefined);
      expect(result).toBe(layers[0]);
    });

    it('returns matching layer by name', () => {
      const layers = [
        { name: 'roads', geometry_type: 'polyline', shapes: [] },
        { name: 'rivers', geometry_type: 'polyline', shapes: [] },
      ];
      const source = createMockSource(layers);

      const result = callPrivate(map, '_resolveSourceLayer', source, 'rivers');
      expect(result).toBe(layers[1]);
    });

    it('returns null if source has no layers', () => {
      const source = createMockSource([]);
      const result = callPrivate(map, '_resolveSourceLayer', source, undefined);
      expect(result).toBeNull();
    });

    it('returns null if source-layer name does not match', () => {
      const layers = [{ name: 'roads', geometry_type: 'polyline', shapes: [] }];
      const source = createMockSource(layers);

      const result = callPrivate(map, '_resolveSourceLayer', source, 'nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('_getVisibleLayerKeys', () => {
    it('excludes layers with visibility none', () => {
      const layers = [
        { name: 'roads', geometry_type: 'polyline', shapes: [] },
      ];
      const source = createMockSource(layers);
      map.addSource('src1', source as any);
      map.addLayer({
        id: 'l1',
        type: 'line',
        source: 'src1',
        'source-layer': 'roads',
        layout: { visibility: 'none' },
      });

      const keys = callPrivate(map, '_getVisibleLayerKeys') as Set<string>;
      expect(keys.size).toBe(0);
    });

    it('includes visible layers', () => {
      const layers = [
        { name: 'roads', geometry_type: 'polyline', shapes: [] },
      ];
      const source = createMockSource(layers);
      map.addSource('src1', source as any);
      map.addLayer({
        id: 'l1',
        type: 'line',
        source: 'src1',
        'source-layer': 'roads',
      });

      const keys = callPrivate(map, '_getVisibleLayerKeys') as Set<string>;
      expect(keys.has('src1:roads')).toBe(true);
    });
  });
});

describe('Emap selection', () => {
  let map: Emap;

  const A: FeatureRef = { source: 's1', layer: 'l1', id: 1 };
  const B: FeatureRef = { source: 's1', layer: 'l1', id: 2 };

  beforeEach(() => {
    map = createBareMap();
  });

  it('starts empty', () => {
    expect(map.getSelection()).toEqual([]);
    expect(map.isSelected(A)).toBe(false);
  });

  it('fires selectionchange with the diff payload on add', () => {
    const listener = vi.fn();
    map.on('selectionchange', listener);
    map.select([A]);
    expect(listener).toHaveBeenCalledTimes(1);
    const ev = listener.mock.calls[0][0];
    expect(ev.added).toHaveLength(1);
    expect(ev.added[0]).toMatchObject(A);
    expect(ev.removed).toEqual([]);
    expect(ev.selected).toHaveLength(1);
  });

  it('does not fire when the call is a no-op', () => {
    map.select([A]);
    const listener = vi.fn();
    map.on('selectionchange', listener);
    // re-selecting the same feature in 'add' mode is a no-op
    map.select([A], { mode: 'add' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('replace mode reports both added and removed', () => {
    map.select([A]);
    const listener = vi.fn();
    map.on('selectionchange', listener);
    map.select([B]); // mode defaults to 'replace'
    expect(listener).toHaveBeenCalledTimes(1);
    const ev = listener.mock.calls[0][0];
    expect(ev.added).toHaveLength(1);
    expect(ev.added[0]).toMatchObject(B);
    expect(ev.removed).toHaveLength(1);
    expect(ev.removed[0]).toMatchObject(A);
  });

  it('toggle mode flips membership', () => {
    map.select([A]);
    map.select([A], { mode: 'toggle' });
    expect(map.isSelected(A)).toBe(false);
    map.select([A], { mode: 'toggle' });
    expect(map.isSelected(A)).toBe(true);
  });

  it('deselect removes only the named features', () => {
    map.select([A, B], { mode: 'add' });
    map.deselect([A]);
    expect(map.isSelected(A)).toBe(false);
    expect(map.isSelected(B)).toBe(true);
  });

  it('clearSelection empties the set and fires once', () => {
    map.select([A, B], { mode: 'add' });
    const listener = vi.fn();
    map.on('selectionchange', listener);
    map.clearSelection();
    expect(map.getSelection()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);
    const ev = listener.mock.calls[0][0];
    expect(ev.removed).toHaveLength(2);
    expect(ev.selected).toEqual([]);
  });

  it('clearSelection on an empty set does not fire', () => {
    const listener = vi.fn();
    map.on('selectionchange', listener);
    map.clearSelection();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('Emap edit history', () => {
  let map: Emap;

  beforeEach(() => {
    map = createBareMap();
    // createBareMap bypasses the constructor, so initialize the history field
    setPrivate(map, '_history', new EditHistory());
  });

  function makeCmd(label?: string) {
    return { do: vi.fn(), undo: vi.fn(), label };
  }

  it('pushCommand fires historychange with canUndo=true', () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    map.pushCommand(makeCmd('move'));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({
      canUndo: true,
      canRedo: false,
      label: 'move',
    });
  });

  it('undo invokes the command\'s undo() and updates flags', () => {
    const cmd = makeCmd();
    map.pushCommand(cmd);
    expect(map.undo()).toBe(true);
    expect(cmd.undo).toHaveBeenCalledTimes(1);
    expect(map.canUndo()).toBe(false);
    expect(map.canRedo()).toBe(true);
  });

  it('redo invokes do() and restores undo availability', () => {
    const cmd = makeCmd();
    map.pushCommand(cmd);
    map.undo();
    expect(map.redo()).toBe(true);
    expect(cmd.do).toHaveBeenCalledTimes(1);
    expect(map.canUndo()).toBe(true);
    expect(map.canRedo()).toBe(false);
  });

  it('undo on empty history is a no-op and does not fire', () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    expect(map.undo()).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('clearHistory empties stacks; fires once when non-empty', () => {
    map.pushCommand(makeCmd());
    const listener = vi.fn();
    map.on('historychange', listener);
    map.clearHistory();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(map.canUndo()).toBe(false);
    expect(map.canRedo()).toBe(false);
  });

  it('clearHistory on empty history is silent', () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    map.clearHistory();
    expect(listener).not.toHaveBeenCalled();
  });
});
