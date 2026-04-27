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
    // discriminator is assigned BARE (not via this.foo) so mapshaper
    // writes through to the record / DataTable schema
    expect(cmd).toContain('__emap_merge =');
    expect(cmd).not.toContain('this.__emap_merge');
    expect(cmd).toContain('-dissolve "__emap_merge"');
    expect(cmd).toContain('copy-fields=name,area');
    // cleanup uses -filter-fields invert (not -each delete) so the field
    // is dropped from the schema, not just from individual records
    expect(cmd).toContain('-filter-fields __emap_merge invert');
    expect(cmd).not.toContain('delete this.__emap_merge');
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

// End-to-end mergeSelected against the real mapshaper pipeline. Catches
// expression-context regressions like the early `this.__emap_merge = ...`
// bug where bare assignment vs this-assignment matters: mapshaper's
// -each writes through bare names but silently drops `this.foo = ...`.
describe('Emap mergeSelected end-to-end', () => {
  // Lightweight fixture: 4 polygons in a row, single source / single layer.
  const FAKE_GEOJSON = JSON.stringify({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { name: 'A', area: 1 }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } },
      { type: 'Feature', properties: { name: 'B', area: 2 }, geometry: { type: 'Polygon', coordinates: [[[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]]] } },
      { type: 'Feature', properties: { name: 'C', area: 3 }, geometry: { type: 'Polygon', coordinates: [[[2, 0], [3, 0], [3, 1], [2, 1], [2, 0]]] } },
      { type: 'Feature', properties: { name: 'D', area: 4 }, geometry: { type: 'Polygon', coordinates: [[[3, 0], [4, 0], [4, 1], [3, 1], [3, 0]]] } },
    ],
  });

  function importFixture(): Promise<any> {
    return new Promise((resolve, reject) => {
      const job = new mapshaper.internal.Job();
      const cmds = mapshaper.internal.parseCommands('-i poly.json');
      cmds[0].options.input = { 'poly.json': FAKE_GEOJSON };
      mapshaper.internal.runParsedCommands(cmds, job, (err: any) => {
        if (err) return reject(err);
        resolve(job.catalog.getDefaultTargets()[0].dataset);
      });
    });
  }

  it('actually merges 2 of 4 features through the real mapshaper pipeline', async () => {
    const map = createBareMap();
    setPrivate(map, '_history', new EditHistory());

    const initialDataset = await importFixture();
    let currentDataset = initialDataset;
    const source = {
      id: 'src1',
      type: 'topology',
      getDataset: () => currentDataset,
      getLayers: () => currentDataset.layers,
      getArcs: () => currentDataset.arcs,
      setDataset: (ds: any) => { currentDataset = ds; },
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);

    // Select features 0 (A) and 2 (C); merge should yield 3 records: AC + B + D
    const layerName = initialDataset.layers[0].name;
    map.select([
      { source: 'src1', layer: layerName, id: 0 },
      { source: 'src1', layer: layerName, id: 2 },
    ], { mode: 'add' });

    const ok = await map.mergeSelected();
    expect(ok).toBe(true);

    const records = currentDataset.layers[0].data!.getRecords();
    expect(records).toHaveLength(3);

    // Discriminator field must be removed from the schema after cleanup
    expect(currentDataset.layers[0].data!.getFields()).not.toContain('__emap_merge');
    expect(currentDataset.layers[0].data!.getFields().sort()).toEqual(['area', 'name']);

    // Selected (A + C) merged into one feature; mapshaper's copy-fields
    // semantics retain the FIRST selected record's attrs (= A)
    const names = records.map((r: any) => r.name).sort();
    expect(names).toEqual(['A', 'B', 'D']);
  });

  it('produces no error event when merging single-layer polygon data', async () => {
    const map = createBareMap();
    setPrivate(map, '_history', new EditHistory());

    let currentDataset = await importFixture();
    const source = {
      id: 'src1',
      type: 'topology',
      getDataset: () => currentDataset,
      getLayers: () => currentDataset.layers,
      getArcs: () => currentDataset.arcs,
      setDataset: (ds: any) => { currentDataset = ds; },
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);

    const errs: unknown[] = [];
    map.on('error', (e: any) => errs.push(e));

    const layerName = currentDataset.layers[0].name;
    map.select([
      { source: 'src1', layer: layerName, id: 0 },
      { source: 'src1', layer: layerName, id: 1 },
    ], { mode: 'add' });

    const ok = await map.mergeSelected();
    expect(ok).toBe(true);
    expect(errs).toEqual([]);
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

describe('Emap applyExpression', () => {
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
    beforeDataset = { layers: [{ name: 'cities', shapes: [], data: { getRecords: () => [] } }] };
    afterDataset = { layers: [{ name: 'cities', shapes: [], data: { getRecords: () => [] } }] };
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

  it('emits a quoted -each expression', async () => {
    const ok = await map.applyExpression({
      source: 'src1',
      target: 'cities',
      expression: 'this.density = this.pop / this.area',
    });
    expect(ok).toBe(true);
    expect(parseCommandsSpy.mock.calls[0][0]).toBe(
      '-target "cities" -each "this.density = this.pop / this.area"',
    );
  });

  it('appends a quoted where= when supplied', async () => {
    await map.applyExpression({
      source: 'src1',
      target: 'cities',
      expression: 'this.flag = true',
      where: 'this.pop > 100',
    });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe(
      '-target "cities" -each "this.flag = true" where="this.pop > 100"',
    );
  });

  it('returns false on missing source / target', async () => {
    expect(await map.applyExpression({ source: 'nope', target: 'cities', expression: 'x' })).toBe(false);
    expect(await map.applyExpression({ source: 'src1', target: 'nope', expression: 'x' })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('returns false on empty / whitespace-only expression', async () => {
    expect(await map.applyExpression({ source: 'src1', target: 'cities', expression: '' })).toBe(false);
    expect(await map.applyExpression({ source: 'src1', target: 'cities', expression: '   ' })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('omits where= when blank / whitespace-only', async () => {
    await map.applyExpression({
      source: 'src1',
      target: 'cities',
      expression: 'this.x = 1',
      where: '   ',
    });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "cities" -each "this.x = 1"');
  });

  it('pushes one history entry labelled "Update <target>"', async () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    await map.applyExpression({
      source: 'src1',
      target: 'cities',
      expression: 'this.foo = 1',
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].label).toBe('Update cities');
  });

  it('escapes embedded double quotes in expression', async () => {
    await map.applyExpression({
      source: 'src1',
      target: 'cities',
      expression: 'this.kind = "city"',
    });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe(
      '-target "cities" -each "this.kind = \\"city\\""',
    );
  });
});

describe('Emap explodeLayer', () => {
  let map: Emap;
  let parseCommandsSpy: ReturnType<typeof vi.fn>;

  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');

  beforeEach(() => {
    map = createBareMap();
    setPrivate(map, '_history', new EditHistory());
    const beforeDs = { layers: [{ name: 'parts', shapes: [] }] };
    const afterDs = { layers: [{ name: 'parts', shapes: [] }] };
    const source = {
      id: 'src1', type: 'topology',
      getDataset: () => beforeDs,
      getLayers: () => beforeDs.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);

    parseCommandsSpy = vi.fn((cmd: string) => [{ name: 'parsed', options: { _cmd: cmd } }]) as ReturnType<typeof vi.fn>;
    Reflect.set(mapshaper.internal as object, 'copyDataset', vi.fn(() => beforeDs));
    Reflect.set(mapshaper.internal as object, 'parseCommands', parseCommandsSpy);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', vi.fn((_c: any, _j: any, cb: any) => {
      cb(null, { catalog: { getDefaultTargets: () => [{ dataset: afterDs }] } });
    }));
  });

  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });

  it('emits the -explode command', async () => {
    const ok = await map.explodeLayer({ source: 'src1', target: 'parts' });
    expect(ok).toBe(true);
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "parts" -explode');
  });

  it('returns false on missing source / target', async () => {
    expect(await map.explodeLayer({ source: 'nope', target: 'parts' })).toBe(false);
    expect(await map.explodeLayer({ source: 'src1', target: 'nope' })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('pushes one history entry labelled "Explode <target>"', async () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    await map.explodeLayer({ source: 'src1', target: 'parts' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].label).toBe('Explode parts');
  });
});

describe('Emap innerlinesLayer', () => {
  let map: Emap;
  let parseCommandsSpy: ReturnType<typeof vi.fn>;

  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');

  beforeEach(() => {
    map = createBareMap();
    setPrivate(map, '_history', new EditHistory());
    const beforeDs = { layers: [{ name: 'states', shapes: [] }] };
    const afterDs = { layers: [{ name: 'states', shapes: [] }] };
    const source = {
      id: 'src1', type: 'topology',
      getDataset: () => beforeDs,
      getLayers: () => beforeDs.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);

    parseCommandsSpy = vi.fn((cmd: string) => [{ name: 'parsed', options: { _cmd: cmd } }]) as ReturnType<typeof vi.fn>;
    Reflect.set(mapshaper.internal as object, 'copyDataset', vi.fn(() => beforeDs));
    Reflect.set(mapshaper.internal as object, 'parseCommands', parseCommandsSpy);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', vi.fn((_c: any, _j: any, cb: any) => {
      cb(null, { catalog: { getDefaultTargets: () => [{ dataset: afterDs }] } });
    }));
  });

  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });

  it('emits the minimal -innerlines command', async () => {
    const ok = await map.innerlinesLayer({ source: 'src1', target: 'states' });
    expect(ok).toBe(true);
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "states" -innerlines');
  });

  it('appends a quoted where=', async () => {
    await map.innerlinesLayer({
      source: 'src1', target: 'states', where: 'A.STATE !== B.STATE',
    });
    expect(parseCommandsSpy.mock.calls[0][0])
      .toBe('-target "states" -innerlines where="A.STATE !== B.STATE"');
  });

  it('appends a quoted name=', async () => {
    await map.innerlinesLayer({
      source: 'src1', target: 'states', name: 'borders',
    });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "states" -innerlines name="borders"');
  });

  it('appends no-replace flag', async () => {
    await map.innerlinesLayer({
      source: 'src1', target: 'states', noReplace: true,
    });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "states" -innerlines no-replace');
  });

  it('combines all options in deterministic order', async () => {
    await map.innerlinesLayer({
      source: 'src1', target: 'states',
      where: 'A.x !== B.x', name: 'b', noReplace: true,
    });
    expect(parseCommandsSpy.mock.calls[0][0])
      .toBe('-target "states" -innerlines where="A.x !== B.x" name="b" no-replace');
  });

  it('returns false on missing source / target', async () => {
    expect(await map.innerlinesLayer({ source: 'nope', target: 'states' })).toBe(false);
    expect(await map.innerlinesLayer({ source: 'src1', target: 'nope' })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('pushes one history entry labelled "Innerlines <target>"', async () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    await map.innerlinesLayer({ source: 'src1', target: 'states' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].label).toBe('Innerlines states');
  });
});

describe('Emap filterFeatures', () => {
  let map: Emap;
  let parseCommandsSpy: ReturnType<typeof vi.fn>;

  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');

  beforeEach(() => {
    map = createBareMap();
    setPrivate(map, '_history', new EditHistory());
    const beforeDs = { layers: [{ name: 'cities', shapes: [] }] };
    const afterDs = { layers: [{ name: 'cities', shapes: [] }] };
    const source = {
      id: 'src1', type: 'topology',
      getDataset: () => beforeDs,
      getLayers: () => beforeDs.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);

    parseCommandsSpy = vi.fn((cmd: string) => [{ name: 'parsed', options: { _cmd: cmd } }]) as ReturnType<typeof vi.fn>;
    Reflect.set(mapshaper.internal as object, 'copyDataset', vi.fn(() => beforeDs));
    Reflect.set(mapshaper.internal as object, 'parseCommands', parseCommandsSpy);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', vi.fn((_c: any, _j: any, cb: any) => {
      cb(null, { catalog: { getDefaultTargets: () => [{ dataset: afterDs }] } });
    }));
  });

  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });

  it('emits a quoted expression', async () => {
    const ok = await map.filterFeatures({
      source: 'src1', target: 'cities', expression: 'this.pop > 100',
    });
    expect(ok).toBe(true);
    expect(parseCommandsSpy.mock.calls[0][0]).toBe(
      '-target "cities" -filter "this.pop > 100"',
    );
  });

  it('appends invert flag', async () => {
    await map.filterFeatures({
      source: 'src1', target: 'cities', expression: 'this.x', invert: true,
    });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe(
      '-target "cities" -filter "this.x" invert',
    );
  });

  it('appends remove-empty flag', async () => {
    await map.filterFeatures({
      source: 'src1', target: 'cities', expression: 'this.x', removeEmpty: true,
    });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe(
      '-target "cities" -filter "this.x" remove-empty',
    );
  });

  it('removeEmpty alone (no expression) emits bare -filter remove-empty', async () => {
    await map.filterFeatures({
      source: 'src1', target: 'cities', removeEmpty: true,
    });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "cities" -filter remove-empty');
  });

  it('returns false when neither expression nor removeEmpty is set', async () => {
    expect(await map.filterFeatures({ source: 'src1', target: 'cities' })).toBe(false);
    expect(await map.filterFeatures({ source: 'src1', target: 'cities', expression: '   ' })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('returns false on missing source / target', async () => {
    expect(await map.filterFeatures({ source: 'nope', target: 'cities', expression: 'x' })).toBe(false);
    expect(await map.filterFeatures({ source: 'src1', target: 'nope', expression: 'x' })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('pushes one history entry labelled "Filter <target>"', async () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    await map.filterFeatures({
      source: 'src1', target: 'cities', expression: 'this.x',
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].label).toBe('Filter cities');
  });
});

describe('Emap snapLayer', () => {
  let map: Emap;
  let parseCommandsSpy: ReturnType<typeof vi.fn>;

  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');

  beforeEach(() => {
    map = createBareMap();
    setPrivate(map, '_history', new EditHistory());
    const beforeDs = { layers: [{ name: 'roads', shapes: [] }] };
    const afterDs = { layers: [{ name: 'roads', shapes: [] }] };
    const source = {
      id: 'src1', type: 'topology',
      getDataset: () => beforeDs,
      getLayers: () => beforeDs.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);

    parseCommandsSpy = vi.fn((cmd: string) => [{ name: 'parsed', options: { _cmd: cmd } }]) as ReturnType<typeof vi.fn>;
    Reflect.set(mapshaper.internal as object, 'copyDataset', vi.fn(() => beforeDs));
    Reflect.set(mapshaper.internal as object, 'parseCommands', parseCommandsSpy);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', vi.fn((_c: any, _j: any, cb: any) => {
      cb(null, { catalog: { getDefaultTargets: () => [{ dataset: afterDs }] } });
    }));
  });

  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });

  it('emits the bare -snap command (mapshaper default interval)', async () => {
    const ok = await map.snapLayer({ source: 'src1', target: 'roads' });
    expect(ok).toBe(true);
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "roads" -snap');
  });

  it('appends a numeric interval positionally', async () => {
    await map.snapLayer({ source: 'src1', target: 'roads', interval: 0.0001 });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "roads" -snap 0.0001');
  });

  it('appends endpoints flag', async () => {
    await map.snapLayer({ source: 'src1', target: 'roads', endpoints: true });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "roads" -snap endpoints');
  });

  it('appends precision=', async () => {
    await map.snapLayer({ source: 'src1', target: 'roads', precision: 0.000001 });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "roads" -snap precision=0.000001');
  });

  it('combines all options in deterministic order', async () => {
    await map.snapLayer({
      source: 'src1', target: 'roads',
      interval: 0.001, endpoints: true, precision: 0.000001,
    });
    expect(parseCommandsSpy.mock.calls[0][0])
      .toBe('-target "roads" -snap 0.001 endpoints precision=0.000001');
  });

  it('returns false on missing source / target', async () => {
    expect(await map.snapLayer({ source: 'nope', target: 'roads' })).toBe(false);
    expect(await map.snapLayer({ source: 'src1', target: 'nope' })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('pushes one history entry labelled "Snap <target>"', async () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    await map.snapLayer({ source: 'src1', target: 'roads' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].label).toBe('Snap roads');
  });
});

describe('Emap rotateSelected / scaleSelected', () => {
  let map: Emap;
  let polyLayer: any;
  let pointLayer: any;
  let xx: Float64Array;
  let yy: Float64Array;
  let arcs: any;

  function close(a: number, b: number, eps = 1e-9): boolean {
    return Math.abs(a - b) < eps;
  }

  beforeEach(() => {
    map = createBareMap();
    setPrivate(map, '_history', new EditHistory());
    // arc 0: (0,0)-(2,0)-(2,2)-(0,2) bounding (0,0)-(2,2), centroid (1,1)
    xx = new Float64Array([0, 2, 2, 0]);
    yy = new Float64Array([0, 0, 2, 2]);
    arcs = {
      getVertexData: () => ({
        xx, yy,
        nn: new Int32Array([4]),
        ii: new Int32Array([0]),
        zz: null,
      }),
      updateArcBounds: vi.fn(),
    };
    polyLayer = {
      name: 'parcels', geometry_type: 'polygon',
      shapes: [[[0]]],
    };
    pointLayer = {
      name: 'cities', geometry_type: 'point',
      shapes: [[[10, 20]]],
    };
    const source = {
      id: 'src1', type: 'topology',
      getLayers: () => [polyLayer, pointLayer],
      getArcs: () => arcs,
      refreshDisplayArcs: vi.fn(),
    };
    (map as any)._sources.set('src1', source);
  });

  describe('rotateSelected', () => {
    it('returns false on empty selection', () => {
      expect(map.rotateSelected(45)).toBe(false);
    });

    it('returns false on zero angle', () => {
      map.select([{ source: 'src1', layer: 'parcels', id: 0 }]);
      expect(map.rotateSelected(0)).toBe(false);
      expect(map.canUndo()).toBe(false);
    });

    it('default origin is the bbox centroid (so rotating by 90 keeps the centre fixed)', () => {
      map.select([{ source: 'src1', layer: 'parcels', id: 0 }]);
      // Centroid of (0,0)-(2,2) is (1,1). Rotate by 90 around (1,1):
      // (0,0) -> (2,0); (2,0) -> (2,2); (2,2) -> (0,2); (0,2) -> (0,0)
      map.rotateSelected(90);
      expect(close(xx[0], 2)).toBe(true);
      expect(close(yy[0], 0)).toBe(true);
      expect(close(xx[1], 2)).toBe(true);
      expect(close(yy[1], 2)).toBe(true);
      expect(close(xx[2], 0)).toBe(true);
      expect(close(yy[2], 2)).toBe(true);
      expect(close(xx[3], 0)).toBe(true);
      expect(close(yy[3], 0)).toBe(true);
    });

    it('custom origin is honoured', () => {
      map.select([{ source: 'src1', layer: 'parcels', id: 0 }]);
      // Rotate by 90 around (0,0): (2,0) -> (0,2)
      map.rotateSelected(90, [0, 0]);
      expect(close(xx[1], 0)).toBe(true);
      expect(close(yy[1], 2)).toBe(true);
    });

    it('undo restores positions exactly', () => {
      map.select([{ source: 'src1', layer: 'parcels', id: 0 }]);
      const xxBefore = Array.from(xx);
      const yyBefore = Array.from(yy);
      map.rotateSelected(37, [3, -1]);
      map.undo();
      for (let i = 0; i < xxBefore.length; i++) {
        expect(close(xx[i], xxBefore[i])).toBe(true);
        expect(close(yy[i], yyBefore[i])).toBe(true);
      }
    });

    it('selection survives, single historychange', () => {
      map.select([{ source: 'src1', layer: 'parcels', id: 0 }]);
      const histListener = vi.fn();
      const selListener = vi.fn();
      map.on('historychange', histListener);
      map.on('selectionchange', selListener);
      map.rotateSelected(45);
      expect(map.getSelection()).toHaveLength(1);
      expect(histListener).toHaveBeenCalledTimes(1);
      expect(selListener).not.toHaveBeenCalled();
    });
  });

  describe('scaleSelected', () => {
    it('returns false on empty selection', () => {
      expect(map.scaleSelected(2)).toBe(false);
    });

    it('returns false on no-op scale (1) and (1, 1)', () => {
      map.select([{ source: 'src1', layer: 'parcels', id: 0 }]);
      expect(map.scaleSelected(1)).toBe(false);
      expect(map.scaleSelected(1, 1)).toBe(false);
      expect(map.canUndo()).toBe(false);
    });

    it('uniform scale by 2 around bbox centroid', () => {
      map.select([{ source: 'src1', layer: 'parcels', id: 0 }]);
      // Centroid (1,1). Scale 2x: (0,0) -> (-1,-1); (2,2) -> (3,3)
      map.scaleSelected(2);
      expect(close(xx[0], -1)).toBe(true);
      expect(close(yy[0], -1)).toBe(true);
      expect(close(xx[2], 3)).toBe(true);
      expect(close(yy[2], 3)).toBe(true);
    });

    it('non-uniform scale', () => {
      map.select([{ source: 'src1', layer: 'parcels', id: 0 }]);
      // Centroid (1,1). Scale (2, 0.5): (0,0) -> (-1, 0.5); (2,2) -> (3, 1.5)
      map.scaleSelected(2, 0.5);
      expect(close(xx[0], -1)).toBe(true);
      expect(close(yy[0], 0.5)).toBe(true);
      expect(close(xx[2], 3)).toBe(true);
      expect(close(yy[2], 1.5)).toBe(true);
    });

    it('one undo reverses the scale', () => {
      map.select([{ source: 'src1', layer: 'parcels', id: 0 }]);
      const xxBefore = Array.from(xx);
      map.scaleSelected(3.7);
      map.undo();
      for (let i = 0; i < xxBefore.length; i++) {
        expect(close(xx[i], xxBefore[i])).toBe(true);
      }
    });
  });

  describe('multi-source affine', () => {
    it('wraps per-source commands in a CompositeCommand', () => {
      // Add a second source with its own arcs
      const xx2 = new Float64Array([10, 11]);
      const yy2 = new Float64Array([20, 21]);
      const arcs2 = {
        getVertexData: () => ({
          xx: xx2, yy: yy2,
          nn: new Int32Array([2]), ii: new Int32Array([0]), zz: null,
        }),
        updateArcBounds: vi.fn(),
      };
      const layer2 = { name: 'parcels', geometry_type: 'polygon', shapes: [[[0]]] };
      (map as any)._sources.set('src2', {
        id: 'src2', type: 'topology',
        getLayers: () => [layer2],
        getArcs: () => arcs2,
        refreshDisplayArcs: vi.fn(),
      });

      map.select([
        { source: 'src1', layer: 'parcels', id: 0 },
        { source: 'src2', layer: 'parcels', id: 0 },
      ], { mode: 'add' });
      map.scaleSelected(2);
      // Both sources got scaled
      // Verify by re-running undo: a single undo should reverse both
      map.undo();
      expect(close(xx[0], 0)).toBe(true);
      expect(close(xx2[0], 10)).toBe(true);
    });
  });
});

describe('Emap mosaicLayer', () => {
  let map: Emap;
  let parseCommandsSpy: ReturnType<typeof vi.fn>;

  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');

  beforeEach(() => {
    map = createBareMap();
    setPrivate(map, '_history', new EditHistory());
    const beforeDs = { layers: [{ name: 'parts', shapes: [] }] };
    const afterDs = { layers: [{ name: 'parts', shapes: [] }] };
    const source = {
      id: 'src1', type: 'topology',
      getDataset: () => beforeDs,
      getLayers: () => beforeDs.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);

    parseCommandsSpy = vi.fn((cmd: string) => [{ name: 'parsed', options: { _cmd: cmd } }]) as ReturnType<typeof vi.fn>;
    Reflect.set(mapshaper.internal as object, 'copyDataset', vi.fn(() => beforeDs));
    Reflect.set(mapshaper.internal as object, 'parseCommands', parseCommandsSpy);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', vi.fn((_c: any, _j: any, cb: any) => {
      cb(null, { catalog: { getDefaultTargets: () => [{ dataset: afterDs }] } });
    }));
  });

  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });

  it('emits the bare -mosaic command', async () => {
    const ok = await map.mosaicLayer({ source: 'src1', target: 'parts' });
    expect(ok).toBe(true);
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "parts" -mosaic');
  });

  it('appends snap-interval=', async () => {
    await map.mosaicLayer({ source: 'src1', target: 'parts', snapInterval: 0.001 });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "parts" -mosaic snap-interval=0.001');
  });

  it('appends no-snap and no-replace flags', async () => {
    await map.mosaicLayer({ source: 'src1', target: 'parts', noSnap: true, noReplace: true });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "parts" -mosaic no-snap no-replace');
  });

  it('quotes name= when supplied', async () => {
    await map.mosaicLayer({ source: 'src1', target: 'parts', name: 'flat zones' });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "parts" -mosaic name="flat zones"');
  });

  it('returns false on missing source / target', async () => {
    expect(await map.mosaicLayer({ source: 'nope', target: 'parts' })).toBe(false);
    expect(await map.mosaicLayer({ source: 'src1', target: 'nope' })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('pushes one history entry labelled "Mosaic <target>"', async () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    await map.mosaicLayer({ source: 'src1', target: 'parts' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].label).toBe('Mosaic parts');
  });
});

describe('Emap unionLayers', () => {
  let map: Emap;
  let parseCommandsSpy: ReturnType<typeof vi.fn>;

  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');

  beforeEach(() => {
    map = createBareMap();
    setPrivate(map, '_history', new EditHistory());
    const beforeDs = {
      layers: [
        { name: 'parks', shapes: [], geometry_type: 'polygon' },
        { name: 'soils', shapes: [], geometry_type: 'polygon' },
        { name: 'roads', shapes: [], geometry_type: 'polyline' },
      ],
    };
    const afterDs = { layers: [{ name: 'union', shapes: [] }] };
    const source = {
      id: 'src1', type: 'topology',
      getDataset: () => beforeDs,
      getLayers: () => beforeDs.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);

    parseCommandsSpy = vi.fn((cmd: string) => [{ name: 'parsed', options: { _cmd: cmd } }]) as ReturnType<typeof vi.fn>;
    Reflect.set(mapshaper.internal as object, 'copyDataset', vi.fn(() => beforeDs));
    Reflect.set(mapshaper.internal as object, 'parseCommands', parseCommandsSpy);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', vi.fn((_c: any, _j: any, cb: any) => {
      cb(null, { catalog: { getDefaultTargets: () => [{ dataset: afterDs }] } });
    }));
  });

  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });

  it('joins targets with commas inside a single quoted -target arg', async () => {
    const ok = await map.unionLayers({ source: 'src1', targets: ['parks', 'soils'] });
    expect(ok).toBe(true);
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "parks,soils" -union');
  });

  it('preserves target order for three or more layers', async () => {
    await map.unionLayers({ source: 'src1', targets: ['soils', 'parks', 'roads'] });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "soils,parks,roads" -union');
  });

  it('appends fields=', async () => {
    await map.unionLayers({
      source: 'src1', targets: ['parks', 'soils'], fields: ['name', 'type'],
    });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "parks,soils" -union fields=name,type');
  });

  it('quotes name=', async () => {
    await map.unionLayers({
      source: 'src1', targets: ['parks', 'soils'], name: 'overlay output',
    });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "parks,soils" -union name="overlay output"');
  });

  it('appends no-replace', async () => {
    await map.unionLayers({
      source: 'src1', targets: ['parks', 'soils'], noReplace: true,
    });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "parks,soils" -union no-replace');
  });

  it('returns false for fewer than two targets', async () => {
    expect(await map.unionLayers({ source: 'src1', targets: ['parks'] })).toBe(false);
    expect(await map.unionLayers({ source: 'src1', targets: [] })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('returns false when any target is unresolved', async () => {
    expect(await map.unionLayers({
      source: 'src1', targets: ['parks', 'missing'],
    })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('returns false when source is missing', async () => {
    expect(await map.unionLayers({ source: 'nope', targets: ['parks', 'soils'] })).toBe(false);
  });

  it('history entry is labelled "Union <comma-joined>"', async () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    await map.unionLayers({ source: 'src1', targets: ['parks', 'soils'] });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].label).toBe('Union parks,soils');
  });
});

describe('Emap divideLayer', () => {
  let map: Emap;
  let parseCommandsSpy: ReturnType<typeof vi.fn>;

  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');

  beforeEach(() => {
    map = createBareMap();
    setPrivate(map, '_history', new EditHistory());
    const beforeDs = {
      layers: [
        { name: 'roads', shapes: [], geometry_type: 'polyline' },
        { name: 'tracts', shapes: [], geometry_type: 'polygon' },
        { name: 'cities', shapes: [], geometry_type: 'point' },
      ],
    };
    const afterDs = { layers: [{ name: 'roads', shapes: [] }] };
    const source = {
      id: 'src1', type: 'topology',
      getDataset: () => beforeDs,
      getLayers: () => beforeDs.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);

    parseCommandsSpy = vi.fn((cmd: string) => [{ name: 'parsed', options: { _cmd: cmd } }]) as ReturnType<typeof vi.fn>;
    Reflect.set(mapshaper.internal as object, 'copyDataset', vi.fn(() => beforeDs));
    Reflect.set(mapshaper.internal as object, 'parseCommands', parseCommandsSpy);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', vi.fn((_c: any, _j: any, cb: any) => {
      cb(null, { catalog: { getDefaultTargets: () => [{ dataset: afterDs }] } });
    }));
  });

  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });

  it('builds the minimal command shape', async () => {
    const ok = await map.divideLayer({ source: 'src1', target: 'roads', divider: 'tracts' });
    expect(ok).toBe(true);
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "roads" -divide source="tracts"');
  });

  it('appends fields=', async () => {
    await map.divideLayer({
      source: 'src1', target: 'roads', divider: 'tracts',
      fields: ['NAME', 'STATE'],
    });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "roads" -divide source="tracts" fields=NAME,STATE');
  });

  it('appends force', async () => {
    await map.divideLayer({
      source: 'src1', target: 'roads', divider: 'tracts', force: true,
    });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "roads" -divide source="tracts" force');
  });

  it('returns false when source is missing', async () => {
    expect(await map.divideLayer({ source: 'nope', target: 'roads', divider: 'tracts' })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('returns false when target is unresolved', async () => {
    expect(await map.divideLayer({ source: 'src1', target: 'highways', divider: 'tracts' })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('returns false when divider is unresolved', async () => {
    expect(await map.divideLayer({ source: 'src1', target: 'roads', divider: 'counties' })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('returns false when target is not a polyline', async () => {
    expect(await map.divideLayer({ source: 'src1', target: 'tracts', divider: 'tracts' })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('returns false when divider is not a polygon', async () => {
    expect(await map.divideLayer({ source: 'src1', target: 'roads', divider: 'cities' })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('history entry is labelled "Divide <target>"', async () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    await map.divideLayer({ source: 'src1', target: 'roads', divider: 'tracts' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].label).toBe('Divide roads');
  });
});

describe('Emap pointsLayer', () => {
  let map: Emap;
  let parseCommandsSpy: ReturnType<typeof vi.fn>;

  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');

  beforeEach(() => {
    map = createBareMap();
    setPrivate(map, '_history', new EditHistory());
    const beforeDs = {
      layers: [
        { name: 'parks', shapes: [], geometry_type: 'polygon' },
        { name: 'roads', shapes: [], geometry_type: 'polyline' },
        { name: 'cities', shapes: [], geometry_type: 'point' },
      ],
    };
    const afterDs = { layers: [{ name: 'parks', shapes: [] }] };
    const source = {
      id: 'src1', type: 'topology',
      getDataset: () => beforeDs,
      getLayers: () => beforeDs.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);

    parseCommandsSpy = vi.fn((cmd: string) => [{ name: 'parsed', options: { _cmd: cmd } }]) as ReturnType<typeof vi.fn>;
    Reflect.set(mapshaper.internal as object, 'copyDataset', vi.fn(() => beforeDs));
    Reflect.set(mapshaper.internal as object, 'parseCommands', parseCommandsSpy);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', vi.fn((_c: any, _j: any, cb: any) => {
      cb(null, { catalog: { getDefaultTargets: () => [{ dataset: afterDs }] } });
    }));
  });

  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });

  it('builds centroid command for polygon target', async () => {
    const ok = await map.pointsLayer({ source: 'src1', target: 'parks', type: 'centroid' });
    expect(ok).toBe(true);
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "parks" -points centroid');
  });

  it('builds inner command for polygon target', async () => {
    await map.pointsLayer({ source: 'src1', target: 'parks', type: 'inner' });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "parks" -points inner');
  });

  it('builds vertices command for polyline target', async () => {
    await map.pointsLayer({ source: 'src1', target: 'roads', type: 'vertices' });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "roads" -points vertices');
  });

  it('builds endpoints command for polygon target', async () => {
    await map.pointsLayer({ source: 'src1', target: 'parks', type: 'endpoints' });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "parks" -points endpoints');
  });

  it('builds midpoints command for polyline target', async () => {
    await map.pointsLayer({ source: 'src1', target: 'roads', type: 'midpoints' });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "roads" -points midpoints');
  });

  it('builds interpolated command with interval', async () => {
    await map.pointsLayer({ source: 'src1', target: 'roads', type: 'interpolated', interval: 1000 });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "roads" -points interpolated interval=1000');
  });

  it('appends quoted name and no-replace', async () => {
    await map.pointsLayer({
      source: 'src1', target: 'parks', type: 'centroid',
      name: 'park labels', noReplace: true,
    });
    expect(parseCommandsSpy.mock.calls[0][0])
      .toBe('-target "parks" -points centroid name="park labels" no-replace');
  });

  it('rejects centroid on non-polygon target', async () => {
    expect(await map.pointsLayer({ source: 'src1', target: 'roads', type: 'centroid' })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('rejects midpoints on non-polyline target', async () => {
    expect(await map.pointsLayer({ source: 'src1', target: 'parks', type: 'midpoints' })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('rejects vertices on a point target', async () => {
    expect(await map.pointsLayer({ source: 'src1', target: 'cities', type: 'vertices' })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('rejects interpolated without interval', async () => {
    expect(await map.pointsLayer({ source: 'src1', target: 'roads', type: 'interpolated' })).toBe(false);
    expect(await map.pointsLayer({ source: 'src1', target: 'roads', type: 'interpolated', interval: 0 })).toBe(false);
    expect(await map.pointsLayer({ source: 'src1', target: 'roads', type: 'interpolated', interval: -5 })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('returns false when source is missing', async () => {
    expect(await map.pointsLayer({ source: 'nope', target: 'parks', type: 'centroid' })).toBe(false);
  });

  it('returns false when target is unresolved', async () => {
    expect(await map.pointsLayer({ source: 'src1', target: 'forests', type: 'centroid' })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('history entry is labelled "Points <target>"', async () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    await map.pointsLayer({ source: 'src1', target: 'parks', type: 'centroid' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].label).toBe('Points parks');
  });
});

describe('Emap linesLayer', () => {
  let map: Emap;
  let parseCommandsSpy: ReturnType<typeof vi.fn>;

  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');

  beforeEach(() => {
    map = createBareMap();
    setPrivate(map, '_history', new EditHistory());
    const beforeDs = {
      layers: [
        { name: 'states', shapes: [], geometry_type: 'polygon' },
        { name: 'roads', shapes: [], geometry_type: 'polyline' },
      ],
    };
    const afterDs = { layers: [{ name: 'states', shapes: [] }] };
    const source = {
      id: 'src1', type: 'topology',
      getDataset: () => beforeDs,
      getLayers: () => beforeDs.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);

    parseCommandsSpy = vi.fn((cmd: string) => [{ name: 'parsed', options: { _cmd: cmd } }]) as ReturnType<typeof vi.fn>;
    Reflect.set(mapshaper.internal as object, 'copyDataset', vi.fn(() => beforeDs));
    Reflect.set(mapshaper.internal as object, 'parseCommands', parseCommandsSpy);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', vi.fn((_c: any, _j: any, cb: any) => {
      cb(null, { catalog: { getDefaultTargets: () => [{ dataset: afterDs }] } });
    }));
  });

  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });

  it('builds the minimal command shape', async () => {
    const ok = await map.linesLayer({ source: 'src1', target: 'states' });
    expect(ok).toBe(true);
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "states" -lines');
  });

  it('emits comma-joined fields as a bare positional argument', async () => {
    await map.linesLayer({
      source: 'src1', target: 'states', fields: ['STATE', 'COUNTY'],
    });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "states" -lines STATE,COUNTY');
  });

  it('appends quoted name', async () => {
    await map.linesLayer({ source: 'src1', target: 'states', name: 'borders' });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "states" -lines name="borders"');
  });

  it('appends no-replace', async () => {
    await map.linesLayer({ source: 'src1', target: 'states', noReplace: true });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "states" -lines no-replace');
  });

  it('returns false when source is missing', async () => {
    expect(await map.linesLayer({ source: 'nope', target: 'states' })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('returns false when target is unresolved', async () => {
    expect(await map.linesLayer({ source: 'src1', target: 'counties' })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('returns false when target is not a polygon', async () => {
    expect(await map.linesLayer({ source: 'src1', target: 'roads' })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('history entry is labelled "Lines <target>"', async () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    await map.linesLayer({ source: 'src1', target: 'states' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].label).toBe('Lines states');
  });
});

describe('Emap polygonsLayer', () => {
  let map: Emap;
  let parseCommandsSpy: ReturnType<typeof vi.fn>;

  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');

  beforeEach(() => {
    map = createBareMap();
    setPrivate(map, '_history', new EditHistory());
    const beforeDs = {
      layers: [
        { name: 'edges', shapes: [], geometry_type: 'polyline' },
        { name: 'parks', shapes: [], geometry_type: 'polygon' },
      ],
    };
    const afterDs = { layers: [{ name: 'edges', shapes: [] }] };
    const source = {
      id: 'src1', type: 'topology',
      getDataset: () => beforeDs,
      getLayers: () => beforeDs.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);

    parseCommandsSpy = vi.fn((cmd: string) => [{ name: 'parsed', options: { _cmd: cmd } }]) as ReturnType<typeof vi.fn>;
    Reflect.set(mapshaper.internal as object, 'copyDataset', vi.fn(() => beforeDs));
    Reflect.set(mapshaper.internal as object, 'parseCommands', parseCommandsSpy);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', vi.fn((_c: any, _j: any, cb: any) => {
      cb(null, { catalog: { getDefaultTargets: () => [{ dataset: afterDs }] } });
    }));
  });

  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });

  it('builds the minimal command shape', async () => {
    const ok = await map.polygonsLayer({ source: 'src1', target: 'edges' });
    expect(ok).toBe(true);
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "edges" -polygons');
  });

  it('forwards gap-tolerance when positive', async () => {
    await map.polygonsLayer({ source: 'src1', target: 'edges', gapTolerance: 0.001 });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "edges" -polygons gap-tolerance=0.001');
  });

  it('drops gap-tolerance when zero', async () => {
    await map.polygonsLayer({ source: 'src1', target: 'edges', gapTolerance: 0 });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "edges" -polygons');
  });

  it('drops gap-tolerance when negative', async () => {
    await map.polygonsLayer({ source: 'src1', target: 'edges', gapTolerance: -1 });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "edges" -polygons');
  });

  it('appends from-rings', async () => {
    await map.polygonsLayer({ source: 'src1', target: 'edges', fromRings: true });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "edges" -polygons from-rings');
  });

  it('returns false when source is missing', async () => {
    expect(await map.polygonsLayer({ source: 'nope', target: 'edges' })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('returns false when target is unresolved', async () => {
    expect(await map.polygonsLayer({ source: 'src1', target: 'rivers' })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('returns false when target is not a polyline', async () => {
    expect(await map.polygonsLayer({ source: 'src1', target: 'parks' })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('history entry is labelled "Polygons <target>"', async () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    await map.polygonsLayer({ source: 'src1', target: 'edges' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].label).toBe('Polygons edges');
  });
});

describe('Emap simplifyLayer', () => {
  let map: Emap;
  let parseCommandsSpy: ReturnType<typeof vi.fn>;

  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');

  beforeEach(() => {
    map = createBareMap();
    setPrivate(map, '_history', new EditHistory());
    const beforeDs = {
      layers: [
        { name: 'roads', shapes: [], geometry_type: 'polyline' },
        { name: 'parks', shapes: [], geometry_type: 'polygon' },
      ],
    };
    const afterDs = { layers: [{ name: 'roads', shapes: [] }] };
    const source = {
      id: 'src1', type: 'topology',
      getDataset: () => beforeDs,
      getLayers: () => beforeDs.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);

    parseCommandsSpy = vi.fn((cmd: string) => [{ name: 'parsed', options: { _cmd: cmd } }]) as ReturnType<typeof vi.fn>;
    Reflect.set(mapshaper.internal as object, 'copyDataset', vi.fn(() => beforeDs));
    Reflect.set(mapshaper.internal as object, 'parseCommands', parseCommandsSpy);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', vi.fn((_c: any, _j: any, cb: any) => {
      cb(null, { catalog: { getDefaultTargets: () => [{ dataset: afterDs }] } });
    }));
  });

  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });

  it('builds the percentage form', async () => {
    const ok = await map.simplifyLayer({ source: 'src1', percentage: 10 });
    expect(ok).toBe(true);
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-simplify 10%');
  });

  it('preserves decimal percentages', async () => {
    await map.simplifyLayer({ source: 'src1', percentage: 12.5 });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-simplify 12.5%');
  });

  it('builds the interval form', async () => {
    await map.simplifyLayer({ source: 'src1', interval: 250 });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-simplify interval=250');
  });

  it('builds the resolution form', async () => {
    await map.simplifyLayer({ source: 'src1', resolution: '1000x500' });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-simplify resolution=1000x500');
  });

  it('appends method dp / visvalingam / weighted', async () => {
    await map.simplifyLayer({ source: 'src1', percentage: 10, method: 'dp' });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-simplify 10% dp');
    parseCommandsSpy.mockClear();
    await map.simplifyLayer({ source: 'src1', percentage: 10, method: 'visvalingam' });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-simplify 10% visvalingam');
    parseCommandsSpy.mockClear();
    await map.simplifyLayer({ source: 'src1', percentage: 10, method: 'weighted' });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-simplify 10% weighted');
  });

  it('appends weighting=', async () => {
    await map.simplifyLayer({ source: 'src1', percentage: 10, method: 'weighted', weighting: 0.5 });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-simplify 10% weighted weighting=0.5');
  });

  it('appends every passthrough flag', async () => {
    await map.simplifyLayer({
      source: 'src1', percentage: 10,
      planar: true, keepShapes: true, lockBox: true, noRepair: true,
    });
    expect(parseCommandsSpy.mock.calls[0][0])
      .toBe('-simplify 10% planar keep-shapes lock-box no-repair');
  });

  it('scopes to a target when supplied', async () => {
    await map.simplifyLayer({ source: 'src1', target: 'roads', percentage: 10 });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "roads" -simplify 10%');
  });

  it('returns false when source is missing', async () => {
    expect(await map.simplifyLayer({ source: 'nope', percentage: 10 })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('returns false when target is unresolved', async () => {
    expect(await map.simplifyLayer({ source: 'src1', target: 'rivers', percentage: 10 })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('returns false when no threshold is supplied', async () => {
    expect(await map.simplifyLayer({ source: 'src1' })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('returns false when multiple thresholds are supplied', async () => {
    expect(await map.simplifyLayer({
      source: 'src1', percentage: 10, interval: 250,
    })).toBe(false);
    expect(await map.simplifyLayer({
      source: 'src1', percentage: 10, resolution: '1000x500',
    })).toBe(false);
    expect(await map.simplifyLayer({
      source: 'src1', interval: 250, resolution: '1000x500',
    })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('returns false for out-of-range percentage', async () => {
    expect(await map.simplifyLayer({ source: 'src1', percentage: -1 })).toBe(false);
    expect(await map.simplifyLayer({ source: 'src1', percentage: 101 })).toBe(false);
    expect(await map.simplifyLayer({ source: 'src1', percentage: NaN })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('returns false for non-positive interval', async () => {
    expect(await map.simplifyLayer({ source: 'src1', interval: 0 })).toBe(false);
    expect(await map.simplifyLayer({ source: 'src1', interval: -1 })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('returns false for malformed resolution', async () => {
    expect(await map.simplifyLayer({ source: 'src1', resolution: '1000' })).toBe(false);
    expect(await map.simplifyLayer({ source: 'src1', resolution: '1000x' })).toBe(false);
    expect(await map.simplifyLayer({ source: 'src1', resolution: 'abc' })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('history entry is labelled "Simplify <target>" when scoped', async () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    await map.simplifyLayer({ source: 'src1', target: 'roads', percentage: 10 });
    expect(listener.mock.calls[0][0].label).toBe('Simplify roads');
  });

  it('history entry is labelled "Simplify <source>" when dataset-wide', async () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    await map.simplifyLayer({ source: 'src1', percentage: 10 });
    expect(listener.mock.calls[0][0].label).toBe('Simplify src1');
  });
});

describe('Emap renameLayer', () => {
  let map: Emap;
  let parseCommandsSpy: ReturnType<typeof vi.fn>;

  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');

  beforeEach(() => {
    map = createBareMap();
    setPrivate(map, '_history', new EditHistory());
    const beforeDs = {
      layers: [
        { name: 'old', shapes: [], geometry_type: 'polygon' },
        { name: 'other', shapes: [], geometry_type: 'polyline' },
      ],
    };
    const afterDs = { layers: [{ name: 'new', shapes: [] }] };
    const source = {
      id: 'src1', type: 'topology',
      getDataset: () => beforeDs,
      getLayers: () => beforeDs.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);

    parseCommandsSpy = vi.fn((cmd: string) => [{ name: 'parsed', options: { _cmd: cmd } }]) as ReturnType<typeof vi.fn>;
    Reflect.set(mapshaper.internal as object, 'copyDataset', vi.fn(() => beforeDs));
    Reflect.set(mapshaper.internal as object, 'parseCommands', parseCommandsSpy);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', vi.fn((_c: any, _j: any, cb: any) => {
      cb(null, { catalog: { getDefaultTargets: () => [{ dataset: afterDs }] } });
    }));
  });

  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });

  it('builds the minimal command shape', async () => {
    const ok = await map.renameLayer({ source: 'src1', target: 'old', name: 'new' });
    expect(ok).toBe(true);
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "old" -rename-layers "new"');
  });

  it('quotes names with spaces', async () => {
    await map.renameLayer({ source: 'src1', target: 'old', name: 'My Layer' });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "old" -rename-layers "My Layer"');
  });

  it('returns false when source is missing', async () => {
    expect(await map.renameLayer({ source: 'nope', target: 'old', name: 'new' })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('returns false when target is unresolved', async () => {
    expect(await map.renameLayer({ source: 'src1', target: 'missing', name: 'new' })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('returns false on empty / whitespace name', async () => {
    expect(await map.renameLayer({ source: 'src1', target: 'old', name: '' })).toBe(false);
    expect(await map.renameLayer({ source: 'src1', target: 'old', name: '   ' })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('returns false on collision with another layer', async () => {
    expect(await map.renameLayer({ source: 'src1', target: 'old', name: 'other' })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('allows renaming to the same name (no collision against itself)', async () => {
    const ok = await map.renameLayer({ source: 'src1', target: 'old', name: 'old' });
    expect(ok).toBe(true);
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "old" -rename-layers "old"');
  });

  it('history entry is labelled "Rename <from> → <to>"', async () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    await map.renameLayer({ source: 'src1', target: 'old', name: 'new' });
    expect(listener.mock.calls[0][0].label).toBe('Rename old → new');
  });
});

describe('Emap mergeLayers', () => {
  let map: Emap;
  let parseCommandsSpy: ReturnType<typeof vi.fn>;

  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');

  beforeEach(() => {
    map = createBareMap();
    setPrivate(map, '_history', new EditHistory());
    const beforeDs = {
      layers: [
        { name: 'a', shapes: [], geometry_type: 'polygon' },
        { name: 'b', shapes: [], geometry_type: 'polygon' },
        { name: 'c', shapes: [], geometry_type: 'polygon' },
        { name: 'roads', shapes: [], geometry_type: 'polyline' },
      ],
    };
    const afterDs = { layers: [{ name: 'merged', shapes: [] }] };
    const source = {
      id: 'src1', type: 'topology',
      getDataset: () => beforeDs,
      getLayers: () => beforeDs.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);

    parseCommandsSpy = vi.fn((cmd: string) => [{ name: 'parsed', options: { _cmd: cmd } }]) as ReturnType<typeof vi.fn>;
    Reflect.set(mapshaper.internal as object, 'copyDataset', vi.fn(() => beforeDs));
    Reflect.set(mapshaper.internal as object, 'parseCommands', parseCommandsSpy);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', vi.fn((_c: any, _j: any, cb: any) => {
      cb(null, { catalog: { getDefaultTargets: () => [{ dataset: afterDs }] } });
    }));
  });

  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });

  it('joins targets with commas inside a single quoted -target arg', async () => {
    const ok = await map.mergeLayers({ source: 'src1', targets: ['a', 'b'] });
    expect(ok).toBe(true);
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "a,b" -merge-layers');
  });

  it('preserves target order for three or more layers', async () => {
    await map.mergeLayers({ source: 'src1', targets: ['c', 'a', 'b'] });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "c,a,b" -merge-layers');
  });

  it('appends quoted name', async () => {
    await map.mergeLayers({ source: 'src1', targets: ['a', 'b'], name: 'combined' });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "a,b" -merge-layers name="combined"');
  });

  it('appends force', async () => {
    await map.mergeLayers({ source: 'src1', targets: ['a', 'b'], force: true });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "a,b" -merge-layers force');
  });

  it('appends flatten', async () => {
    await map.mergeLayers({ source: 'src1', targets: ['a', 'b'], flatten: true });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "a,b" -merge-layers flatten');
  });

  it('returns false for fewer than two targets', async () => {
    expect(await map.mergeLayers({ source: 'src1', targets: ['a'] })).toBe(false);
    expect(await map.mergeLayers({ source: 'src1', targets: [] })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('returns false when any target is unresolved', async () => {
    expect(await map.mergeLayers({ source: 'src1', targets: ['a', 'missing'] })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('rejects mixed-geometry targets without force', async () => {
    expect(await map.mergeLayers({ source: 'src1', targets: ['a', 'roads'] })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('allows mixed-geometry targets with force=true', async () => {
    const ok = await map.mergeLayers({ source: 'src1', targets: ['a', 'roads'], force: true });
    expect(ok).toBe(true);
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "a,roads" -merge-layers force');
  });

  it('returns false when source is missing', async () => {
    expect(await map.mergeLayers({ source: 'nope', targets: ['a', 'b'] })).toBe(false);
  });

  it('history entry is labelled "Merge <comma-joined>"', async () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    await map.mergeLayers({ source: 'src1', targets: ['a', 'b'] });
    expect(listener.mock.calls[0][0].label).toBe('Merge a,b');
  });
});

describe('Emap splitLayer', () => {
  let map: Emap;
  let parseCommandsSpy: ReturnType<typeof vi.fn>;

  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalRunParsedCommands = Reflect.get(mapshaper.internal as object, 'runParsedCommands');
  const originalParseCommands = Reflect.get(mapshaper.internal as object, 'parseCommands');

  beforeEach(() => {
    map = createBareMap();
    setPrivate(map, '_history', new EditHistory());
    const beforeDs = {
      layers: [{ name: 'states', shapes: [], geometry_type: 'polygon' }],
    };
    const afterDs = { layers: [{ name: 'states-A', shapes: [] }] };
    const source = {
      id: 'src1', type: 'topology',
      getDataset: () => beforeDs,
      getLayers: () => beforeDs.layers,
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);

    parseCommandsSpy = vi.fn((cmd: string) => [{ name: 'parsed', options: { _cmd: cmd } }]) as ReturnType<typeof vi.fn>;
    Reflect.set(mapshaper.internal as object, 'copyDataset', vi.fn(() => beforeDs));
    Reflect.set(mapshaper.internal as object, 'parseCommands', parseCommandsSpy);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', vi.fn((_c: any, _j: any, cb: any) => {
      cb(null, { catalog: { getDefaultTargets: () => [{ dataset: afterDs }] } });
    }));
  });

  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'parseCommands', originalParseCommands);
    Reflect.set(mapshaper.internal as object, 'runParsedCommands', originalRunParsedCommands);
  });

  it('builds the field-name form', async () => {
    const ok = await map.splitLayer({ source: 'src1', target: 'states', expression: 'REGION' });
    expect(ok).toBe(true);
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "states" -split "REGION"');
  });

  it('forwards JS expressions verbatim, quoted', async () => {
    await map.splitLayer({
      source: 'src1', target: 'states',
      expression: 'this.pop > 1000000 ? "big" : "small"',
    });
    expect(parseCommandsSpy.mock.calls[0][0])
      .toBe('-target "states" -split "this.pop > 1000000 ? \\"big\\" : \\"small\\""');
  });

  it('appends no-replace', async () => {
    await map.splitLayer({
      source: 'src1', target: 'states', expression: 'REGION', noReplace: true,
    });
    expect(parseCommandsSpy.mock.calls[0][0]).toBe('-target "states" -split "REGION" no-replace');
  });

  it('returns false when source is missing', async () => {
    expect(await map.splitLayer({ source: 'nope', target: 'states', expression: 'REGION' })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('returns false when target is unresolved', async () => {
    expect(await map.splitLayer({ source: 'src1', target: 'missing', expression: 'REGION' })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('returns false on empty / whitespace expression', async () => {
    expect(await map.splitLayer({ source: 'src1', target: 'states', expression: '' })).toBe(false);
    expect(await map.splitLayer({ source: 'src1', target: 'states', expression: '   ' })).toBe(false);
    expect(parseCommandsSpy).not.toHaveBeenCalled();
  });

  it('history entry is labelled "Split <target>"', async () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    await map.splitLayer({ source: 'src1', target: 'states', expression: 'REGION' });
    expect(listener.mock.calls[0][0].label).toBe('Split states');
  });
});

describe('Emap rebuildTopology (mocked mapshaper)', () => {
  let map: Emap;
  let copyDatasetSpy: ReturnType<typeof vi.fn>;
  let addIntersectionCutsSpy: ReturnType<typeof vi.fn>;
  let setDatasetSpy: ReturnType<typeof vi.fn>;

  const originalCopyDataset = Reflect.get(mapshaper.internal as object, 'copyDataset');
  const originalAddCuts = Reflect.get(mapshaper.internal as object, 'addIntersectionCuts');

  beforeEach(() => {
    map = createBareMap();
    setPrivate(map, '_history', new EditHistory());

    setDatasetSpy = vi.fn() as ReturnType<typeof vi.fn>;
    const ds = {
      layers: [{ name: 'shapes', shapes: [], geometry_type: 'polygon' }],
      arcs: { /* sentinel — presence is what matters */ },
    };
    const source = {
      id: 'src1', type: 'topology' as const,
      getDataset: () => ds,
      getLayers: () => ds.layers,
      setDataset: setDatasetSpy,
      refreshDisplayArcs: vi.fn(),
      off: vi.fn(),
      on: vi.fn(),
    } as any;
    (map as any)._sources.set('src1', source);

    // copyDataset returns a fresh object each call so the test can inspect
    // which copy was passed to addIntersectionCuts vs which to DatasetReplace.
    let copyId = 0;
    copyDatasetSpy = vi.fn(() => ({ _copy: ++copyId, layers: ds.layers, arcs: ds.arcs })) as ReturnType<typeof vi.fn>;
    addIntersectionCutsSpy = vi.fn() as ReturnType<typeof vi.fn>;
    Reflect.set(mapshaper.internal as object, 'copyDataset', copyDatasetSpy);
    Reflect.set(mapshaper.internal as object, 'addIntersectionCuts', addIntersectionCutsSpy);
  });

  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'copyDataset', originalCopyDataset);
    Reflect.set(mapshaper.internal as object, 'addIntersectionCuts', originalAddCuts);
  });

  it('calls addIntersectionCuts on a deep copy of the source dataset', async () => {
    const ok = await map.rebuildTopology({ source: 'src1' });
    expect(ok).toBe(true);
    expect(copyDatasetSpy).toHaveBeenCalledTimes(2); // before snapshot + working copy
    expect(addIntersectionCutsSpy).toHaveBeenCalledTimes(1);
    const arg = addIntersectionCutsSpy.mock.calls[0][0] as any;
    expect(arg._copy).toBeDefined();
  });

  it('forwards options as snake_case', async () => {
    await map.rebuildTopology({
      source: 'src1', snapInterval: 0.001, noSnap: false, rebuildTopology: true,
    });
    const opts = addIntersectionCutsSpy.mock.calls[0][1] as any;
    expect(opts).toEqual({
      snap_interval: 0.001,
      no_snap: false,
      rebuild_topology: true,
    });
  });

  it('returns false when source is missing', async () => {
    expect(await map.rebuildTopology({ source: 'nope' })).toBe(false);
    expect(addIntersectionCutsSpy).not.toHaveBeenCalled();
  });

  it('returns false when source has no dataset', async () => {
    const noDsSource = {
      id: 's2', type: 'topology' as const,
      getDataset: () => undefined,
      setDataset: vi.fn(),
      off: vi.fn(), on: vi.fn(),
    } as any;
    (map as any)._sources.set('s2', noDsSource);
    expect(await map.rebuildTopology({ source: 's2' })).toBe(false);
    expect(addIntersectionCutsSpy).not.toHaveBeenCalled();
  });

  it('returns true (no-op) for arc-less point-only datasets', async () => {
    const pointSource = {
      id: 'pts', type: 'topology' as const,
      getDataset: () => ({ layers: [{ name: 'p', geometry_type: 'point', shapes: [] }] }),
      setDataset: vi.fn(),
      off: vi.fn(), on: vi.fn(),
    } as any;
    (map as any)._sources.set('pts', pointSource);
    expect(await map.rebuildTopology({ source: 'pts' })).toBe(true);
    expect(addIntersectionCutsSpy).not.toHaveBeenCalled();
    expect(map.canUndo()).toBe(false);
  });

  it('swaps the dataset via setDataset on success', async () => {
    await map.rebuildTopology({ source: 'src1' });
    expect(setDatasetSpy).toHaveBeenCalledTimes(1);
    const after = setDatasetSpy.mock.calls[0][0] as any;
    expect(after._copy).toBeDefined();
  });

  it('pushes one DatasetReplaceCommand labelled "Rebuild topology"', async () => {
    const listener = vi.fn();
    map.on('historychange', listener);
    await map.rebuildTopology({ source: 'src1' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].label).toBe('Rebuild topology');
    expect(map.canUndo()).toBe(true);
  });

  it('acts as a history barrier (clears prior history)', async () => {
    const history = (map as any)._history as EditHistory;
    history.push({ label: 'fake', do: vi.fn(), undo: vi.fn() } as any);
    expect(map.canUndo()).toBe(true);
    // After rebuild, prior 'fake' command is gone; only 'Rebuild topology' remains.
    await map.rebuildTopology({ source: 'src1' });
    const command = history.undo();
    expect(command?.label).toBe('Rebuild topology');
    expect(map.canUndo()).toBe(false);
  });

  it('clears the selection', async () => {
    const selection = (map as any)._selection as Selection;
    selection.apply([{ source: 'src1', layer: 'shapes', id: 1 }], 'add');
    expect(selection.getAll().length).toBe(1);
    await map.rebuildTopology({ source: 'src1' });
    expect(selection.getAll().length).toBe(0);
  });

  it('on addIntersectionCuts throw: fires error event and returns false', async () => {
    addIntersectionCutsSpy.mockImplementation(() => { throw new Error('boom'); });
    const errors: any[] = [];
    map.on('error', (e: any) => errors.push(e));
    expect(await map.rebuildTopology({ source: 'src1' })).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0].error.message).toBe('boom');
    expect(setDatasetSpy).not.toHaveBeenCalled();
    expect(map.canUndo()).toBe(false);
  });
});

describe('Emap rebuildTopology round-trip (real mapshaper)', () => {
  // Build a tiny in-memory dataset, run rebuildTopology, assert that the
  // arc collection is intact and the call didn't crash. A full
  // intersection-insertion check would require a more elaborate fixture
  // with overlapping polygons; this guards the basic plumbing.

  function buildSource(id: string, geojson: string): Promise<any> {
    return new Promise((resolve, reject) => {
      import('../source/topology-source').then(({ TopologySource }) => {
        const source = new TopologySource(id);
        source.on('data', () => resolve(source));
        source.on('error', (e: any) => reject(e?.error ?? e));
        source.setData({ filename: `${id}.geojson`, content: new TextEncoder().encode(geojson) });
      });
    });
  }

  it('runs without error on a simple polygon dataset and remains queryable', async () => {
    const geojson = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { id: 1 }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] } },
        { type: 'Feature', properties: { id: 2 }, geometry: { type: 'Polygon', coordinates: [[[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]]] } },
      ],
    });
    const source = await buildSource('rt', geojson);
    const map = createBareMap();
    setPrivate(map, '_history', new EditHistory());
    setPrivate(map, '_projection', { crs: 'EPSG:4326', setCRS: vi.fn() });
    setPrivate(map, '_viewport', { setCRS: vi.fn() });
    map.addSource('rt', source);

    const ok = await map.rebuildTopology({ source: 'rt' });
    expect(ok).toBe(true);
    const ds = map.getSource('rt')?.getDataset();
    expect(ds).toBeDefined();
    expect(ds!.layers[0].shapes.length).toBe(2);
    expect(ds!.arcs).toBeDefined();
  });
});

describe('Emap.exportSnapshot / loadSnapshot (mocked mapshaper)', () => {
  let map: Emap;
  let exportDatasetsToPackSpy: ReturnType<typeof vi.fn>;
  let packSpy: ReturnType<typeof vi.fn>;
  let unpackSessionDataSpy: ReturnType<typeof vi.fn>;
  let lastPacked: any;

  const originalExport = Reflect.get(mapshaper.internal as object, 'exportDatasetsToPack');
  const originalPack = Reflect.get(mapshaper.internal as object, 'pack');
  const originalUnpack = Reflect.get(mapshaper.internal as object, 'unpackSessionData');

  beforeEach(() => {
    map = createBareMap();
    setPrivate(map, '_history', new EditHistory());
    // addSource consults _projection / _viewport when registering the first
    // source (CRS auto-detect). createBareMap doesn't initialize these, so
    // stub them here.
    setPrivate(map, '_projection', { crs: 'EPSG:4326', setCRS: vi.fn() });
    setPrivate(map, '_viewport', { setCRS: vi.fn() });

    exportDatasetsToPackSpy = vi.fn(async (datasets: any[], opts: any) => ({
      version: 1,
      created: '2026-04-27T00:00:00Z',
      datasets: datasets.map((d) => ({ packed: true, layerCount: d.layers?.length ?? 0 })),
      _opts: opts,
    })) as ReturnType<typeof vi.fn>;
    packSpy = vi.fn((obj: any) => {
      lastPacked = obj;
      return new Uint8Array([1, 2, 3, 4]);
    }) as ReturnType<typeof vi.fn>;
    unpackSessionDataSpy = vi.fn(async () => ({
      version: 1,
      datasets: [
        { layers: [{ name: 'a-layer', geometry_type: 'polygon', shapes: [] }] },
        { layers: [{ name: 'b-layer', geometry_type: 'polyline', shapes: [] }] },
      ],
      emap: { version: 1, sources: [{ id: 'a' }, { id: 'b' }] },
    })) as ReturnType<typeof vi.fn>;

    Reflect.set(mapshaper.internal as object, 'exportDatasetsToPack', exportDatasetsToPackSpy);
    Reflect.set(mapshaper.internal as object, 'pack', packSpy);
    Reflect.set(mapshaper.internal as object, 'unpackSessionData', unpackSessionDataSpy);
  });

  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'exportDatasetsToPack', originalExport);
    Reflect.set(mapshaper.internal as object, 'pack', originalPack);
    Reflect.set(mapshaper.internal as object, 'unpackSessionData', originalUnpack);
  });

  function makeSource(id: string, ds: any) {
    return {
      id, type: 'topology' as const,
      getDataset: () => ds,
      getLayers: () => ds?.layers ?? [],
      setDataset: vi.fn(),
      refreshDisplayArcs: vi.fn(),
      // EventDispatcher surface used by Emap.removeSource
      off: vi.fn(),
      on: vi.fn(),
    } as any;
  }

  it('packs all topology sources in registration order', async () => {
    const ds1 = { layers: [{ name: 'L1' }] };
    const ds2 = { layers: [{ name: 'L2' }, { name: 'L3' }] };
    (map as any)._sources.set('s1', makeSource('s1', ds1));
    (map as any)._sources.set('s2', makeSource('s2', ds2));

    const blob = await map.exportSnapshot();
    expect(blob.type).toBe('application/octet-stream');

    expect(exportDatasetsToPackSpy).toHaveBeenCalledTimes(1);
    const args = exportDatasetsToPackSpy.mock.calls[0] as unknown[];
    expect(args[0]).toEqual([ds1, ds2]);
    expect(args[1]).toEqual({ compact: true });
  });

  it('injects emap.sources metadata in source order', async () => {
    (map as any)._sources.set('first', makeSource('first', { layers: [] }));
    (map as any)._sources.set('second', makeSource('second', { layers: [] }));
    await map.exportSnapshot();

    expect(lastPacked.emap).toEqual({
      version: 1,
      sources: [{ id: 'first' }, { id: 'second' }],
    });
  });

  it('skips sources without a dataset', async () => {
    (map as any)._sources.set('loaded', makeSource('loaded', { layers: [] }));
    (map as any)._sources.set('pending', makeSource('pending', undefined));
    await map.exportSnapshot();

    const args = exportDatasetsToPackSpy.mock.calls[0] as unknown[];
    expect((args[0] as unknown[])).toHaveLength(1);
    expect(lastPacked.emap.sources).toEqual([{ id: 'loaded' }]);
  });

  it('honours compact=false', async () => {
    (map as any)._sources.set('s', makeSource('s', { layers: [] }));
    await map.exportSnapshot({ compact: false });
    expect(exportDatasetsToPackSpy.mock.calls[0][1]).toEqual({ compact: false });
  });

  it('produces an empty-datasets snapshot for an empty map', async () => {
    const blob = await map.exportSnapshot();
    expect(blob.type).toBe('application/octet-stream');
    const args = exportDatasetsToPackSpy.mock.calls[0] as unknown[];
    expect(args[0]).toEqual([]);
    expect(lastPacked.emap.sources).toEqual([]);
  });

  it('loadSnapshot restores source IDs from emap metadata', async () => {
    const ids = await map.loadSnapshot(new Uint8Array([0]));
    expect(ids).toEqual(['a', 'b']);
    expect(map.getSource('a')).toBeDefined();
    expect(map.getSource('b')).toBeDefined();
    expect(unpackSessionDataSpy).toHaveBeenCalledTimes(1);
  });

  it('loadSnapshot accepts ArrayBuffer input', async () => {
    const buf = new Uint8Array([1, 2, 3]).buffer;
    const ids = await map.loadSnapshot(buf);
    expect(ids).toEqual(['a', 'b']);
  });

  it('loadSnapshot accepts Blob input', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])]);
    const ids = await map.loadSnapshot(blob);
    expect(ids).toEqual(['a', 'b']);
  });

  it('loadSnapshot prepends idPrefix to stored IDs', async () => {
    const ids = await map.loadSnapshot(new Uint8Array([0]), { idPrefix: 'restored-' });
    expect(ids).toEqual(['restored-a', 'restored-b']);
    expect(map.getSource('restored-a')).toBeDefined();
  });

  it('loadSnapshot falls back to defaultIds when emap metadata absent', async () => {
    unpackSessionDataSpy.mockResolvedValue({
      version: 1,
      datasets: [{ layers: [] }, { layers: [] }],
    });
    const ids = await map.loadSnapshot(new Uint8Array([0]), { defaultIds: ['x', 'y'] });
    expect(ids).toEqual(['x', 'y']);
  });

  it('loadSnapshot fallback uses snapshot-<i> when no metadata and no defaults', async () => {
    unpackSessionDataSpy.mockResolvedValue({
      version: 1,
      datasets: [{ layers: [] }, { layers: [] }],
    });
    const ids = await map.loadSnapshot(new Uint8Array([0]));
    expect(ids).toEqual(['snapshot-0', 'snapshot-1']);
  });

  it('loadSnapshot replaces existing sources by default', async () => {
    const existing = makeSource('a', { layers: [] });
    (map as any)._sources.set('a', existing);
    const sourceListenersBeforeAdd = (map as any)._sourceListeners as Map<string, unknown>;
    sourceListenersBeforeAdd.set('a', () => {}); // satisfy removeSource cleanup

    const ids = await map.loadSnapshot(new Uint8Array([0]));
    expect(ids).toEqual(['a', 'b']);
    // The source registered at 'a' is the new one, not the original
    expect(map.getSource('a')).not.toBe(existing);
  });

  it('loadSnapshot rejects with replace=false on ID collision', async () => {
    const existing = makeSource('a', { layers: [] });
    (map as any)._sources.set('a', existing);
    await expect(
      map.loadSnapshot(new Uint8Array([0]), { replace: false }),
    ).rejects.toThrow(/already exists/);
    // Map state untouched: 'a' is the original, 'b' was not added
    expect(map.getSource('a')).toBe(existing);
    expect(map.getSource('b')).toBeUndefined();
  });

  it('loadSnapshot clears edit history and selection', async () => {
    const history = (map as any)._history as EditHistory;
    history.push({
      label: 'fake', execute: vi.fn(), undo: vi.fn(),
    } as any);
    expect(map.canUndo()).toBe(true);

    const selection = (map as any)._selection as Selection;
    selection.apply([{ source: 's', layer: 'l', id: 1 }], 'add');
    expect(selection.getAll().length).toBeGreaterThan(0);

    await map.loadSnapshot(new Uint8Array([0]));
    expect(map.canUndo()).toBe(false);
    expect(map.canRedo()).toBe(false);
    expect(selection.getAll().length).toBe(0);
  });

  it('loadSnapshot rejects on invalid input type', async () => {
    await expect(
      map.loadSnapshot('not bytes' as unknown as Uint8Array),
    ).rejects.toThrow(/Blob, Uint8Array, or ArrayBuffer/);
  });
});

describe('Emap.exportSnapshot / loadSnapshot round-trip (real mapshaper)', () => {
  // A two-source round trip: pack two real datasets via Emap.exportSnapshot,
  // then re-load into a fresh map via loadSnapshot, and assert that source
  // IDs and per-layer summaries survive.

  function buildSourceFromGeoJSON(id: string, geojson: string): Promise<any> {
    return new Promise((resolve, reject) => {
      // Lazy-import the concrete TopologySource via the same path used in production code
      import('../source/topology-source').then(({ TopologySource }) => {
        const source = new TopologySource(id);
        source.on('data', () => resolve(source));
        source.on('error', (e: any) => reject(e?.error ?? e));
        source.setData({ filename: `${id}.geojson`, content: new TextEncoder().encode(geojson) });
      });
    });
  }

  function summarize(map: Emap, id: string) {
    const ds = map.getSource(id)?.getDataset();
    if (!ds) return null;
    return {
      layerNames: ds.layers.map((l: any) => l.name),
      geoms: ds.layers.map((l: any) => l.geometry_type),
      shapeCounts: ds.layers.map((l: any) => l.shapes?.length ?? 0),
    };
  }

  it('round-trips two sources with original IDs and layer summaries', async () => {
    const polysGeojson = JSON.stringify({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature', properties: { name: 'sq' },
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
      }],
    });
    const linesGeojson = JSON.stringify({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature', properties: { road: 'main' },
        geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
      }],
    });

    const sourceA = await buildSourceFromGeoJSON('alpha', polysGeojson);
    const sourceB = await buildSourceFromGeoJSON('beta', linesGeojson);

    function stubProjection(m: Emap) {
      setPrivate(m, '_projection', { crs: 'EPSG:4326', setCRS: vi.fn() });
      setPrivate(m, '_viewport', { setCRS: vi.fn() });
    }

    const mapA = createBareMap();
    setPrivate(mapA, '_history', new EditHistory());
    stubProjection(mapA);
    mapA.addSource('alpha', sourceA);
    mapA.addSource('beta', sourceB);

    const beforeA = summarize(mapA, 'alpha');
    const beforeB = summarize(mapA, 'beta');

    const blob = await mapA.exportSnapshot();
    const bytes = new Uint8Array(await blob.arrayBuffer());

    const mapB = createBareMap();
    setPrivate(mapB, '_history', new EditHistory());
    stubProjection(mapB);
    const restored = await mapB.loadSnapshot(bytes);
    expect(restored).toEqual(['alpha', 'beta']);
    expect(summarize(mapB, 'alpha')).toEqual(beforeA);
    expect(summarize(mapB, 'beta')).toEqual(beforeB);
  });
});
