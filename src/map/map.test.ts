import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import mapshaper from 'mapshaper';
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

    it('maps polygon geometry to a line (outline-only) layer by default', () => {
      // Default polygon rendering is outline-only — Canvas 2D fill is much
      // more expensive than stroke for many-polygon datasets, and matches
      // mapshaper GUI's behaviour. Callers opt into fills via addLayer().
      const layers = [
        { name: 'countries', geometry_type: 'polygon', shapes: [[[1]]] },
      ];
      const source = createMockSource(layers);
      map.addSource('src1', source as any);

      const effective = callPrivate(map, '_getEffectiveLayers') as LayerSpecification[];
      expect(effective[0].type).toBe('line');
      expect((effective[0].paint as any)['line-color']).toBe('#333');
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

describe('Emap deleteSelected', () => {
  let map: Emap;
  let layer: { shapes: any[]; data?: { getRecords: () => Record<string, unknown>[] } };
  let records: Record<string, unknown>[];

  beforeEach(() => {
    map = createBareMap();
    setPrivate(map, '_history', new EditHistory());
    records = [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }];
    layer = {
      shapes: [['s0'], ['s1'], ['s2'], ['s3']],
      data: { getRecords: () => records },
    };
    const source = {
      id: 'src1',
      type: 'topology',
      getLayers: () => [layer],
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);
  });

  function selectIds(ids: number[]): void {
    map.select(ids.map((id) => ({ source: 'src1', layer: 'layer-0', id })));
  }

  it('returns false on empty selection without firing events', () => {
    const historyListener = vi.fn();
    const selectionListener = vi.fn();
    map.on('historychange', historyListener);
    map.on('selectionchange', selectionListener);
    expect(map.deleteSelected()).toBe(false);
    expect(historyListener).not.toHaveBeenCalled();
    expect(selectionListener).not.toHaveBeenCalled();
  });

  it('deletes a single selected feature', () => {
    selectIds([1]);
    const ok = map.deleteSelected();
    expect(ok).toBe(true);
    expect(layer.shapes).toEqual([['s0'], ['s2'], ['s3']]);
    expect(records).toEqual([{ name: 'a' }, { name: 'c' }, { name: 'd' }]);
  });

  it('collapses multiple deletions into one history entry', () => {
    selectIds([0, 2, 3]);
    const historyListener = vi.fn();
    map.on('historychange', historyListener);
    map.deleteSelected();
    expect(historyListener).toHaveBeenCalledTimes(1);
    expect(map.canUndo()).toBe(true);
  });

  it('clears the selection on success and fires selectionchange with the deleted refs', () => {
    selectIds([1, 2]);
    const selectionListener = vi.fn();
    map.on('selectionchange', selectionListener);
    map.deleteSelected();
    expect(map.getSelection()).toEqual([]);
    expect(selectionListener).toHaveBeenCalledTimes(1);
    const ev = selectionListener.mock.calls[0][0];
    expect(ev.removed).toHaveLength(2);
    expect(ev.selected).toEqual([]);
  });

  it('descending-id deletion preserves intra-layer integrity', () => {
    selectIds([1, 2]);
    map.deleteSelected();
    // Initially [s0,s1,s2,s3]; delete ids 2 then 1 → [s0,s3]
    expect(layer.shapes).toEqual([['s0'], ['s3']]);
    expect(records).toEqual([{ name: 'a' }, { name: 'd' }]);
  });

  it('a single undo restores all deleted features at original indices', () => {
    selectIds([0, 2, 3]);
    map.deleteSelected();
    expect(layer.shapes).toEqual([['s1']]);
    map.undo();
    expect(layer.shapes).toEqual([['s0'], ['s1'], ['s2'], ['s3']]);
    expect(records).toEqual([{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }]);
  });
});

describe('Emap clipLayer / eraseLayer', () => {
  let map: Emap;
  let source: any;
  let beforeDataset: any;
  let afterDataset: any;
  let copyDatasetSpy: ReturnType<typeof vi.fn>;
  let runParsedCommandsSpy: ReturnType<typeof vi.fn>;
  let parseCommandsSpy: ReturnType<typeof vi.fn>;

  // Capture mapshaper internals so we can drive the runner deterministically
  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');

  beforeEach(() => {
    map = createBareMap();
    setPrivate(map, '_history', new EditHistory());

    beforeDataset = {
      layers: [
        { name: 'roads', geometry_type: 'polyline', shapes: [['orig']] },
        { name: 'park', geometry_type: 'polygon', shapes: [[[0]]] },
      ],
    };
    afterDataset = {
      layers: [
        { name: 'roads', geometry_type: 'polyline', shapes: [['clipped']] },
        { name: 'park', geometry_type: 'polygon', shapes: [[[0]]] },
      ],
    };

    source = {
      id: 'src1',
      type: 'topology',
      getDataset: () => beforeDataset,
      getLayers: () => beforeDataset.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    };
    (map as any)._sources.set('src1', source);

    copyDatasetSpy = vi.fn(() => ({ ...beforeDataset, _isCopy: true })) as ReturnType<typeof vi.fn>;
    parseCommandsSpy = vi.fn((cmd: string) => [{ name: 'parsed', options: { _cmd: cmd } }]) as ReturnType<typeof vi.fn>;
    runParsedCommandsSpy = vi.fn((_cmds: any, _job: any, cb: any) => {
      // Simulate mapshaper mutating the input dataset by returning the
      // afterDataset reference from the catalog.
      cb(null, {
        catalog: {
          getDefaultTargets: () => [{ dataset: afterDataset }],
        },
      });
    }) as ReturnType<typeof vi.fn>;

    Reflect.set(mapshaper.internal as object, 'copyDataset', copyDatasetSpy);
    Reflect.set(mapshaper.internal as object, 'parseCommands', parseCommandsSpy);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', runParsedCommandsSpy);
  });

  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });

  it('clipLayer returns false when the source does not exist', async () => {
    const ok = await map.clipLayer({ source: 'nope', target: 'roads', mask: 'park' });
    expect(ok).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });

  it('clipLayer returns false when the target layer is missing', async () => {
    const ok = await map.clipLayer({ source: 'src1', target: 'missing', mask: 'park' });
    expect(ok).toBe(false);
    expect(copyDatasetSpy).not.toHaveBeenCalled();
  });

  it('clipLayer returns false when the mask layer is missing', async () => {
    const ok = await map.clipLayer({ source: 'src1', target: 'roads', mask: 'nope' });
    expect(ok).toBe(false);
  });

  it('clipLayer constructs a quoted mapshaper command and swaps the dataset', async () => {
    const ok = await map.clipLayer({ source: 'src1', target: 'roads', mask: 'park' });
    expect(ok).toBe(true);
    expect(parseCommandsSpy).toHaveBeenCalledTimes(1);
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "roads" -clip source="park"');
    expect(source.setDataset).toHaveBeenCalledWith(afterDataset);
  });

  it('eraseLayer constructs a -erase command', async () => {
    await map.eraseLayer({ source: 'src1', target: 'roads', mask: 'park' });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "roads" -erase source="park"');
  });

  it('clipLayer pushes exactly one DatasetReplaceCommand and labels it', async () => {
    const historyListener = vi.fn();
    map.on('historychange', historyListener);
    await map.clipLayer({ source: 'src1', target: 'roads', mask: 'park' });
    expect(map.canUndo()).toBe(true);
    expect(historyListener).toHaveBeenCalledTimes(1);
    expect(historyListener.mock.calls[0][0].label).toBe('Clip roads');
  });

  it('clipLayer clears any prior history (history barrier)', async () => {
    // Push a fake earlier command so the history is non-empty
    map.pushCommand({ do: () => {}, undo: () => {} });
    expect(map.canUndo()).toBe(true);

    await map.clipLayer({ source: 'src1', target: 'roads', mask: 'park' });
    // After clip, only the dataset-replace command should remain on the stack
    map.undo();
    expect(source.setDataset).toHaveBeenCalledTimes(2);
    // First call: do() applied afterDataset; second call: undo() applies the
    // copyDataset snapshot (the value returned by copyDatasetSpy).
    const restoredArg = source.setDataset.mock.calls[1][0];
    expect(restoredArg._isCopy).toBe(true);
    // No further undo is available — prior history was cleared
    expect(map.canUndo()).toBe(false);
  });

  it('clipLayer clears the selection and fires selectionchange', async () => {
    map.select([{ source: 'src1', layer: 'roads', id: 0 }]);
    const selectionListener = vi.fn();
    map.on('selectionchange', selectionListener);
    await map.clipLayer({ source: 'src1', target: 'roads', mask: 'park' });
    expect(map.getSelection()).toEqual([]);
    expect(selectionListener).toHaveBeenCalled();
  });

  it('clipLayer surfaces mapshaper errors via the error event without throwing', async () => {
    runParsedCommandsSpy.mockImplementation((_cmds: any, _job: any, cb: any) => {
      cb(new Error('mapshaper boom'));
    });
    const errorListener = vi.fn();
    map.on('error', errorListener);
    const ok = await map.clipLayer({ source: 'src1', target: 'roads', mask: 'park' });
    expect(ok).toBe(false);
    expect(errorListener).toHaveBeenCalledTimes(1);
    expect(errorListener.mock.calls[0][0].error.message).toBe('mapshaper boom');
    // No history change on failure
    expect(map.canUndo()).toBe(false);
  });

  it('quotes layer names containing embedded quotes', async () => {
    beforeDataset.layers.push({ name: 'weird"name', geometry_type: 'polygon', shapes: [] });
    afterDataset.layers.push({ name: 'weird"name', geometry_type: 'polygon', shapes: [] });
    await map.clipLayer({ source: 'src1', target: 'roads', mask: 'weird"name' });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "roads" -clip source="weird\\"name"');
  });

  it('cleanLayer constructs a -clean command and pushes a single history entry', async () => {
    const ok = await map.cleanLayer({ source: 'src1', target: 'roads' });
    expect(ok).toBe(true);
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "roads" -clean');
    expect(map.canUndo()).toBe(true);
  });

  it('cleanLayer returns false when source / target is missing', async () => {
    expect(await map.cleanLayer({ source: 'nope', target: 'roads' })).toBe(false);
    expect(await map.cleanLayer({ source: 'src1', target: 'missing' })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });
});

describe('Emap dissolveLayer', () => {
  let map: Emap;
  let source: any;
  let beforeDataset: any;
  let afterDataset: any;
  let copyDatasetSpy: ReturnType<typeof vi.fn>;
  let parseCommandsSpy: ReturnType<typeof vi.fn>;
  let runParsedCommandsSpy: ReturnType<typeof vi.fn>;

  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');

  beforeEach(() => {
    map = createBareMap();
    setPrivate(map, '_history', new EditHistory());

    beforeDataset = {
      layers: [
        { name: 'states', geometry_type: 'polygon', shapes: [['s0'], ['s1'], ['s2']] },
      ],
    };
    afterDataset = {
      layers: [
        { name: 'states', geometry_type: 'polygon', shapes: [['merged']] },
      ],
    };

    source = {
      id: 'src1',
      type: 'topology',
      getDataset: () => beforeDataset,
      getLayers: () => beforeDataset.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    };
    (map as any)._sources.set('src1', source);

    copyDatasetSpy = vi.fn(() => ({ ...beforeDataset, _isCopy: true })) as ReturnType<typeof vi.fn>;
    parseCommandsSpy = vi.fn((cmd: string) => [{ name: 'parsed', options: { _cmd: cmd } }]) as ReturnType<typeof vi.fn>;
    runParsedCommandsSpy = vi.fn((_cmds: any, _job: any, cb: any) => {
      cb(null, {
        catalog: {
          getDefaultTargets: () => [{ dataset: afterDataset }],
        },
      });
    }) as ReturnType<typeof vi.fn>;

    Reflect.set(mapshaper.internal as object, 'copyDataset', copyDatasetSpy);
    Reflect.set(mapshaper.internal as object, 'parseCommands', parseCommandsSpy);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', runParsedCommandsSpy);
  });

  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });

  it('whole-layer dissolve omits the field argument', async () => {
    const ok = await map.dissolveLayer({ source: 'src1', target: 'states' });
    expect(ok).toBe(true);
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "states" -dissolve');
    expect(source.setDataset).toHaveBeenCalledWith(afterDataset);
  });

  it('field-based dissolve emits the field as a quoted positional', async () => {
    await map.dissolveLayer({ source: 'src1', target: 'states', field: 'region' });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "states" -dissolve "region"');
  });

  it('returns false when the source does not exist', async () => {
    const ok = await map.dissolveLayer({ source: 'nope', target: 'states' });
    expect(ok).toBe(false);
    expect(runParsedCommandsSpy).not.toHaveBeenCalled();
  });

  it('returns false when the target layer is missing', async () => {
    const ok = await map.dissolveLayer({ source: 'src1', target: 'missing' });
    expect(ok).toBe(false);
    expect(copyDatasetSpy).not.toHaveBeenCalled();
  });

  it('pushes one history entry labelled "Dissolve <target>"', async () => {
    const historyListener = vi.fn();
    map.on('historychange', historyListener);
    await map.dissolveLayer({ source: 'src1', target: 'states' });
    expect(historyListener).toHaveBeenCalledTimes(1);
    expect(historyListener.mock.calls[0][0].label).toBe('Dissolve states');
  });

  it('clears the selection on success', async () => {
    map.select([{ source: 'src1', layer: 'states', id: 0 }]);
    const selectionListener = vi.fn();
    map.on('selectionchange', selectionListener);
    await map.dissolveLayer({ source: 'src1', target: 'states' });
    expect(map.getSelection()).toEqual([]);
    expect(selectionListener).toHaveBeenCalled();
  });

  it('clears prior history (history barrier inherited from runner)', async () => {
    map.pushCommand({ do: () => {}, undo: () => {} });
    expect(map.canUndo()).toBe(true);
    await map.dissolveLayer({ source: 'src1', target: 'states' });
    map.undo();
    // Only the dataset-replace step should be reachable; prior fake command is gone
    expect(map.canUndo()).toBe(false);
  });

  it('quotes field names containing special characters', async () => {
    await map.dissolveLayer({ source: 'src1', target: 'states', field: 'state name' });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "states" -dissolve "state name"');
  });
});

describe('Emap attribute editing', () => {
  let map: Emap;
  let records: Record<string, unknown>[];
  let layer: { name: string; shapes: any[]; data: { getRecords: () => Record<string, unknown>[] } };

  beforeEach(() => {
    map = createBareMap();
    setPrivate(map, '_history', new EditHistory());
    records = [
      { name: 'A', pop: 100 },
      { name: 'B', pop: 200 },
      { name: 'C', pop: 300 },
    ];
    layer = {
      name: 'cities',
      shapes: [['s0'], ['s1'], ['s2']],
      data: { getRecords: () => records },
    };
    const source = {
      id: 'src1',
      type: 'topology',
      getLayers: () => [layer],
    } as any;
    (map as any)._sources.set('src1', source);
  });

  describe('setFeatureProperty / setFeatureProperties', () => {
    it('overwrites a key and pushes one history entry', () => {
      const ok = map.setFeatureProperty(
        { source: 'src1', layer: 'cities', id: 1 },
        'name',
        'B-renamed',
      );
      expect(ok).toBe(true);
      expect(records[1]).toEqual({ name: 'B-renamed', pop: 200 });
      expect(map.canUndo()).toBe(true);
    });

    it('returns false for a no-op (value already matches)', () => {
      const ok = map.setFeatureProperty(
        { source: 'src1', layer: 'cities', id: 0 },
        'name',
        'A',
      );
      expect(ok).toBe(false);
      expect(map.canUndo()).toBe(false);
    });

    it('setting undefined deletes the key', () => {
      const ok = map.setFeatureProperty(
        { source: 'src1', layer: 'cities', id: 0 },
        'pop',
        undefined,
      );
      expect(ok).toBe(true);
      expect('pop' in records[0]).toBe(false);
      map.undo();
      expect(records[0]).toEqual({ name: 'A', pop: 100 });
    });

    it('multi-key patch is one history entry and one historychange event', () => {
      const listener = vi.fn();
      map.on('historychange', listener);
      map.setFeatureProperties(
        { source: 'src1', layer: 'cities', id: 0 },
        { name: 'A2', pop: 999 },
      );
      expect(records[0]).toEqual({ name: 'A2', pop: 999 });
      expect(listener).toHaveBeenCalledTimes(1);
      map.undo();
      expect(records[0]).toEqual({ name: 'A', pop: 100 });
    });

    it('returns false when the ref does not resolve to a record', () => {
      const ok = map.setFeatureProperty(
        { source: 'src1', layer: 'cities', id: 999 },
        'name',
        'X',
      );
      expect(ok).toBe(false);
    });
  });

  describe('addField / removeField / renameField', () => {
    it('addField sets default on records that did not have the key', () => {
      records.push({ name: 'D' }); // no pop
      map.addField({ source: 'src1', target: 'cities', field: 'pop', defaultValue: 0 });
      expect(records[3]).toEqual({ name: 'D', pop: 0 });
      // Pre-existing records keep their original pop
      expect(records[0]).toEqual({ name: 'A', pop: 100 });
      map.undo();
      expect('pop' in records[3]).toBe(false);
    });

    it('removeField round-trips exact values', () => {
      const before = JSON.parse(JSON.stringify(records));
      map.removeField({ source: 'src1', target: 'cities', field: 'pop' });
      expect(records.every((r) => !('pop' in r))).toBe(true);
      map.undo();
      expect(records).toEqual(before);
    });

    it('renameField refuses on collision', () => {
      records[0]['pop_v2'] = 'x'; // record 0 now has both pop and pop_v2
      const ok = map.renameField({ source: 'src1', target: 'cities', from: 'pop', to: 'pop_v2' });
      expect(ok).toBe(false);
      // Records were not mutated
      expect(records[0]).toEqual({ name: 'A', pop: 100, pop_v2: 'x' });
      expect(map.canUndo()).toBe(false);
    });

    it('renameField round-trips when no collision', () => {
      map.renameField({ source: 'src1', target: 'cities', from: 'pop', to: 'population' });
      expect(records[0]).toEqual({ name: 'A', population: 100 });
      map.undo();
      expect(records[0]).toEqual({ name: 'A', pop: 100 });
    });

    it('addField returns false when the layer has no data table', () => {
      const noDataLayer = { name: 'no_data', shapes: [], data: undefined } as any;
      const source = { id: 'src1', type: 'topology', getLayers: () => [noDataLayer] };
      (map as any)._sources.set('src1', source);
      const ok = map.addField({ source: 'src1', target: 'no_data', field: 'x' });
      expect(ok).toBe(false);
    });
  });

  describe('history composition', () => {
    it('attribute and dataset commands interleave in one timeline', () => {
      // Attribute write
      map.setFeatureProperty({ source: 'src1', layer: 'cities', id: 0 }, 'name', 'A2');
      // Manual fake "geometry" command
      const geomUndo = vi.fn();
      map.pushCommand({ do: () => {}, undo: geomUndo, label: 'fake geom' });

      // Two undos should reverse in reverse order: geom first, then attribute.
      map.undo();
      expect(geomUndo).toHaveBeenCalledTimes(1);
      map.undo();
      expect(records[0]).toEqual({ name: 'A', pop: 100 });
    });
  });
});

describe('Emap mergeSelected', () => {
  let map: Emap;
  let source: any;
  let beforeDataset: any;
  let afterDataset: any;
  let copyDatasetSpy: ReturnType<typeof vi.fn>;
  let parseCommandsSpy: ReturnType<typeof vi.fn>;
  let runParsedCommandsSpy: ReturnType<typeof vi.fn>;

  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');

  beforeEach(() => {
    map = createBareMap();
    setPrivate(map, '_history', new EditHistory());

    const layer = {
      name: 'parcels',
      geometry_type: 'polygon',
      shapes: [['s0'], ['s1'], ['s2'], ['s3']],
      data: {
        getFields: () => ['name', 'area'],
        getRecords: () => [
          { name: 'A', area: 1 },
          { name: 'B', area: 2 },
          { name: 'C', area: 3 },
          { name: 'D', area: 4 },
        ],
      },
    };
    const otherLayer = {
      name: 'roads',
      geometry_type: 'polyline',
      shapes: [],
    };
    beforeDataset = { layers: [layer, otherLayer] };
    afterDataset = { layers: [{ name: 'parcels', shapes: [['merged']] }, otherLayer] };

    source = {
      id: 'src1',
      type: 'topology',
      getDataset: () => beforeDataset,
      getLayers: () => beforeDataset.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    };
    (map as any)._sources.set('src1', source);

    copyDatasetSpy = vi.fn(() => ({ ...beforeDataset, _isCopy: true })) as ReturnType<typeof vi.fn>;
    parseCommandsSpy = vi.fn((cmd: string) => [{ name: 'parsed', options: { _cmd: cmd } }]) as ReturnType<typeof vi.fn>;
    runParsedCommandsSpy = vi.fn((_cmds: any, _job: any, cb: any) => {
      cb(null, {
        catalog: { getDefaultTargets: () => [{ dataset: afterDataset }] },
      });
    }) as ReturnType<typeof vi.fn>;

    Reflect.set(mapshaper.internal as object, 'copyDataset', copyDatasetSpy);
    Reflect.set(mapshaper.internal as object, 'parseCommands', parseCommandsSpy);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', runParsedCommandsSpy);
  });

  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });

  it('returns false on empty selection without firing', async () => {
    const ok = await map.mergeSelected();
    expect(ok).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('returns false on cross-layer selection', async () => {
    map.select([
      { source: 'src1', layer: 'parcels', id: 0 },
      { source: 'src1', layer: 'roads', id: 0 },
    ], { mode: 'add' });
    const ok = await map.mergeSelected();
    expect(ok).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('returns false on cross-source selection', async () => {
    (map as any)._sources.set('src2', { ...source, id: 'src2' });
    map.select([
      { source: 'src1', layer: 'parcels', id: 0 },
      { source: 'src2', layer: 'parcels', id: 0 },
    ], { mode: 'add' });
    const ok = await map.mergeSelected();
    expect(ok).toBe(false);
  });

  it('builds the dissolve recipe with sorted ids and copy-fields=', async () => {
    map.select([
      { source: 'src1', layer: 'parcels', id: 2 },
      { source: 'src1', layer: 'parcels', id: 0 },
      { source: 'src1', layer: 'parcels', id: 3 },
    ], { mode: 'add' });
    const ok = await map.mergeSelected();
    expect(ok).toBe(true);
    const cmd = parseCommandsSpy.mock.calls[0][0] as string;
    expect(cmd).toContain('-target "parcels"');
    expect(cmd).toContain('[0,2,3]'); // sorted ascending
    expect(cmd).toContain('this.id');
    expect(cmd).toContain('this.__emap_merge');
    expect(cmd).toContain('-dissolve "__emap_merge"');
    expect(cmd).toContain('copy-fields=name,area');
    expect(cmd).toContain('delete this.__emap_merge');
  });

  it('omits copy-fields= when the layer has no data table', async () => {
    beforeDataset.layers[0].data = undefined;
    map.select([
      { source: 'src1', layer: 'parcels', id: 0 },
      { source: 'src1', layer: 'parcels', id: 1 },
    ], { mode: 'add' });
    await map.mergeSelected();
    const cmd = parseCommandsSpy.mock.calls[0][0] as string;
    expect(cmd).not.toContain('copy-fields=');
  });

  it('pushes one history entry labelled "Merge N features" and clears selection', async () => {
    map.select([
      { source: 'src1', layer: 'parcels', id: 0 },
      { source: 'src1', layer: 'parcels', id: 1 },
    ], { mode: 'add' });
    const historyListener = vi.fn();
    const selectionListener = vi.fn();
    map.on('historychange', historyListener);
    map.on('selectionchange', selectionListener);
    await map.mergeSelected();
    expect(historyListener).toHaveBeenCalledTimes(1);
    expect(historyListener.mock.calls[0][0].label).toBe('Merge 2 features');
    expect(map.getSelection()).toEqual([]);
    expect(selectionListener).toHaveBeenCalled();
  });

  it('clears prior history (history barrier)', async () => {
    map.pushCommand({ do: () => {}, undo: () => {} });
    map.select([{ source: 'src1', layer: 'parcels', id: 0 }]);
    await map.mergeSelected();
    map.undo();
    expect(map.canUndo()).toBe(false);
  });

  it('drops fields whose names contain a comma (mapshaper copy-fields= is comma-delimited)', async () => {
    beforeDataset.layers[0].data = {
      getFields: () => ['safe', 'has,comma'],
      getRecords: () => [],
    };
    map.select([
      { source: 'src1', layer: 'parcels', id: 0 },
      { source: 'src1', layer: 'parcels', id: 1 },
    ], { mode: 'add' });
    await map.mergeSelected();
    const cmd = parseCommandsSpy.mock.calls[0][0] as string;
    expect(cmd).toContain('copy-fields=safe');
    expect(cmd).not.toContain('has,comma');
  });
});

describe('Emap translateSelected', () => {
  let map: Emap;
  let polyLayer: any;
  let pointLayer: any;
  let arcs: any;
  let xx: Float64Array;
  let yy: Float64Array;
  let updateArcBoundsSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    map = createBareMap();
    setPrivate(map, '_history', new EditHistory());

    // Two arcs of 2 vertices each at distinct locations
    xx = new Float64Array([0, 1, 10, 11]);
    yy = new Float64Array([0, 1, 10, 11]);
    updateArcBoundsSpy = vi.fn();
    arcs = {
      getVertexData: () => ({
        xx, yy,
        nn: new Int32Array([2, 2]),
        ii: new Int32Array([0, 2]),
        zz: null,
      }),
      updateArcBounds: updateArcBoundsSpy,
    };
    polyLayer = {
      name: 'parcels',
      geometry_type: 'polygon',
      // shape 0 references arc 0; shape 1 references arc 1
      shapes: [[[0]], [[1]]],
    };
    pointLayer = {
      name: 'cities',
      geometry_type: 'point',
      shapes: [[[100, 200]]],
    };
    const source = {
      id: 'src1',
      type: 'topology',
      getLayers: () => [polyLayer, pointLayer],
      getArcs: () => arcs,
      refreshDisplayArcs: vi.fn(),
    };
    (map as any)._sources.set('src1', source);
  });

  it('returns false on empty selection', () => {
    expect(map.translateSelected(10, 5)).toBe(false);
  });

  it('returns false on zero offset', () => {
    map.select([{ source: 'src1', layer: 'parcels', id: 0 }]);
    expect(map.translateSelected(0, 0)).toBe(false);
    expect(map.canUndo()).toBe(false);
  });

  it('translates one polygon by collecting its arc id', () => {
    map.select([{ source: 'src1', layer: 'parcels', id: 0 }]);
    const ok = map.translateSelected(100, 200);
    expect(ok).toBe(true);
    // Arc 0's verts shifted by (100, 200); arc 1 untouched
    expect(xx[0]).toBe(100); expect(xx[1]).toBe(101);
    expect(xx[2]).toBe(10); expect(xx[3]).toBe(11);
    expect(yy[0]).toBe(200); expect(yy[1]).toBe(201);
    expect(updateArcBoundsSpy).toHaveBeenCalledWith(0);
    expect(updateArcBoundsSpy).not.toHaveBeenCalledWith(1);
  });

  it('handles negative arc-ids in shapes (~ encoding)', () => {
    polyLayer.shapes[0] = [[~0]]; // negative form of arc 0
    map.select([{ source: 'src1', layer: 'parcels', id: 0 }]);
    map.translateSelected(1, 1);
    expect(xx[0]).toBe(1); expect(xx[1]).toBe(2);
  });

  it('deduplicates arc ids across multiple selected features', () => {
    // Both shapes reference arc 0 (artificial setup)
    polyLayer.shapes = [[[0]], [[0]]];
    map.select([
      { source: 'src1', layer: 'parcels', id: 0 },
      { source: 'src1', layer: 'parcels', id: 1 },
    ], { mode: 'add' });
    map.translateSelected(1, 0);
    // Arc 0 should be moved exactly once (xx[0] = 1, not 2)
    expect(xx[0]).toBe(1);
    expect(updateArcBoundsSpy).toHaveBeenCalledTimes(1);
  });

  it('translates point shapes in place', () => {
    map.select([{ source: 'src1', layer: 'cities', id: 0 }]);
    map.translateSelected(5, -5);
    expect(pointLayer.shapes[0]).toEqual([[105, 195]]);
  });

  it('selection survives translation and no selectionchange fires', () => {
    map.select([{ source: 'src1', layer: 'parcels', id: 0 }]);
    const listener = vi.fn();
    map.on('selectionchange', listener);
    map.translateSelected(1, 1);
    expect(map.getSelection()).toHaveLength(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it('fires exactly one historychange per call', () => {
    map.select([{ source: 'src1', layer: 'parcels', id: 0 }]);
    const listener = vi.fn();
    map.on('historychange', listener);
    map.translateSelected(1, 1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('one undo reverses the entire translation', () => {
    map.select([
      { source: 'src1', layer: 'parcels', id: 0 },
      { source: 'src1', layer: 'cities', id: 0 },
    ], { mode: 'add' });
    const xxBefore = Array.from(xx);
    const yyBefore = Array.from(yy);
    const pointBefore = JSON.parse(JSON.stringify(pointLayer.shapes[0]));
    map.translateSelected(7, 11);
    map.undo();
    expect(Array.from(xx)).toEqual(xxBefore);
    expect(Array.from(yy)).toEqual(yyBefore);
    expect(pointLayer.shapes[0]).toEqual(pointBefore);
  });

  it('multi-source selection wraps per-source commands in a CompositeCommand', () => {
    // Add a second source with its own arcs
    const xx2 = new Float64Array([50, 51]);
    const yy2 = new Float64Array([60, 61]);
    const arcs2 = {
      getVertexData: () => ({
        xx: xx2, yy: yy2,
        nn: new Int32Array([2]), ii: new Int32Array([0]), zz: null,
      }),
      updateArcBounds: vi.fn(),
    };
    const layer2 = { name: 'parcels', geometry_type: 'polygon', shapes: [[[0]]] };
    const src2 = {
      id: 'src2', type: 'topology',
      getLayers: () => [layer2],
      getArcs: () => arcs2,
      refreshDisplayArcs: vi.fn(),
    };
    (map as any)._sources.set('src2', src2);

    map.select([
      { source: 'src1', layer: 'parcels', id: 0 },
      { source: 'src2', layer: 'parcels', id: 0 },
    ], { mode: 'add' });
    map.translateSelected(1, 0);
    // Both sources got translated
    expect(xx[0]).toBe(1);
    expect(xx2[0]).toBe(51);
    // One undo restores both
    map.undo();
    expect(xx[0]).toBe(0);
    expect(xx2[0]).toBe(50);
  });

  it('composes with vertex / draw / attribute commands (no history barrier)', () => {
    map.select([{ source: 'src1', layer: 'parcels', id: 0 }]);
    const fakeUndo = vi.fn();
    map.pushCommand({ do: () => {}, undo: fakeUndo, label: 'fake' });
    map.translateSelected(1, 1);
    // Two undos, in reverse order: translate first, then fake
    map.undo();
    expect(xx[0]).toBe(0); // translate reversed
    map.undo();
    expect(fakeUndo).toHaveBeenCalledTimes(1);
  });
});

describe('Emap bufferLayer', () => {
  let map: Emap;
  let beforeDataset: any;
  let afterDataset: any;
  let parseCommandsSpy: ReturnType<typeof vi.fn>;
  let runParsedCommandsSpy: ReturnType<typeof vi.fn>;

  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');

  beforeEach(() => {
    map = createBareMap();
    setPrivate(map, '_history', new EditHistory());
    beforeDataset = { layers: [{ name: 'roads', geometry_type: 'polyline', shapes: [] }] };
    afterDataset = { layers: [{ name: 'roads', geometry_type: 'polygon', shapes: [['buf']] }] };
    const source = {
      id: 'src1',
      type: 'topology',
      getDataset: () => beforeDataset,
      getLayers: () => beforeDataset.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);

    parseCommandsSpy = vi.fn((cmd: string) => [{ name: 'parsed', options: { _cmd: cmd } }]) as ReturnType<typeof vi.fn>;
    runParsedCommandsSpy = vi.fn((_cmds: any, _job: any, cb: any) => {
      cb(null, { catalog: { getDefaultTargets: () => [{ dataset: afterDataset }] } });
    }) as ReturnType<typeof vi.fn>;
    Reflect.set(mapshaper.internal as object, 'copyDataset', vi.fn(() => beforeDataset));
    Reflect.set(mapshaper.internal as object, 'parseCommands', parseCommandsSpy);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', runParsedCommandsSpy);
  });

  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });

  it('emits a numeric radius bare', async () => {
    const ok = await map.bufferLayer({ source: 'src1', target: 'roads', radius: 5 });
    expect(ok).toBe(true);
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "roads" -buffer 5');
  });

  it('quotes a string radius (mapshaper expression)', async () => {
    await map.bufferLayer({ source: 'src1', target: 'roads', radius: 'pop / 1000' });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "roads" -buffer "pop / 1000"');
  });

  it('appends cap-style= when capStyle is set', async () => {
    await map.bufferLayer({ source: 'src1', target: 'roads', radius: 5, capStyle: 'flat' });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "roads" -buffer 5 cap-style=flat');
  });

  it('returns false when source / target is missing', async () => {
    expect(await map.bufferLayer({ source: 'nope', target: 'roads', radius: 5 })).toBe(false);
    expect(await map.bufferLayer({ source: 'src1', target: 'nope', radius: 5 })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('pushes one history entry labelled "Buffer <target>"', async () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    await map.bufferLayer({ source: 'src1', target: 'roads', radius: 5 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].label).toBe('Buffer roads');
    expect(map.canUndo()).toBe(true);
  });
});
