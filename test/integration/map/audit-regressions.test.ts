import { createTestMap } from '../../utils/plugin-test-map';
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Emap } from '../../../src/engine/map/map';
import { Projection } from '../../../src/domain/geo/projection';
import { Viewport } from '../../../src/domain/geo/viewport';
import { Selection } from '../../../src/engine/map/selection';
import { EditHistory } from '../../../src/domain/edit/edit-history';
import { DatasetReplaceCommand } from '../../../src/domain/edit/commands/dataset-replace';
import { TopologySource } from '../../../src/domain/source/topology-source';
import { AttributeOps } from '../../../src/engine/map/attribute-ops';
import { HistoryControl } from '../../../src/ui/history-control';
import type { EmapHostInternal } from '../../../src/engine/map/emap-host';
import type { MapshaperDataset, MapshaperLayer } from '../../../src/shared/types/mapshaper-types';
afterEach(() => vi.restoreAllMocks());
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function dataset(value = 1): MapshaperDataset {
  const records = [{ value }];
  return {
    layers: [
      {
        name: 'points',
        geometry_type: 'point',
        shapes: [[[10, 20]]],
        data: { getRecords: () => records } as MapshaperLayer['data'],
      },
    ],
    info: { crs_string: 'EPSG:4326' },
  };
}
async function bareMap() {
  const map = (await createTestMap()) as Emap;
  const history = new EditHistory();
  const highlights = { removeSource: vi.fn(), clear: vi.fn() };
  const state: Record<string, unknown> = {
    _sources: new Map(),
    _sourceListeners: new Map(),
    _pendingSourceCommits: new Map(),
    _projection: new Projection(),
    _viewport: new Viewport(),
    _crsEstablished: false,
    _layers: [],
    _effectiveLayersCache: [],
    _defaultLayersDirty: false,
    _layerArcIdsCache: new Map(),
    _selection: new Selection(),
    _history: history,
    _featureQuery: { clear: vi.fn(), prebuildForRendering: vi.fn() },
    _highlightManager: highlights,
    _scheduleRender: vi.fn(),
    _listeners: Object.create(null),
    _removed: false,
    _rafId: 0,
    _wheelSettleTimer: null,
    _controls: [],
    _controlContainers: new Map(),
    _activeTransaction: null,
  };
  for (const [key, value] of Object.entries(state)) Reflect.set(map, key, value);
  Reflect.set(map, '_attributes', new AttributeOps(map as unknown as EmapHostInternal));
  return { map, history, highlights };
}
async function registered() {
  const context = await bareMap();
  const source = new TopologySource('s');
  source.setDataset(dataset(), false);
  await context.map.addSource('s', source);
  return { ...context, source };
}
function pushCounter(map: Emap) {
  let value = 1;
  map.pushCommand({
    label: 'Counter',
    do() {
      value = 1;
    },
    undo() {
      value = 0;
    },
  });
  return () => value;
}
describe('active transactions isolate committed history', () => {
  it('blocks undo, redo and clearHistory until rollback', async () => {
    const { map } = await bareMap();
    const value = pushCounter(map);
    const tx = map.beginTransaction();
    expect(map.canUndo()).toBe(false);
    expect(map.undo()).toBe(false);
    expect(() => map.clearHistory()).toThrow(/transaction|capture/i);
    tx.rollback();
    expect(value()).toBe(1);
    expect(map.undo()).toBe(true);
    const redoTx = map.beginTransaction();
    expect(map.canRedo()).toBe(false);
    expect(map.redo()).toBe(false);
    redoTx.rollback();
    expect(map.redo()).toBe(true);
    expect(value()).toBe(1);
  });
  it('disables history controls and keyboard navigation, including an empty commit', async () => {
    const { map } = await bareMap();
    const value = pushCounter(map);
    const control = new HistoryControl();
    const element = control.onAdd(map);
    const button = element.querySelector('button')!;
    const target = document.createElement('div');
    const unbind = map.bindHistoryShortcuts(target);
    expect(button.disabled).toBe(false);
    const tx = map.beginTransaction();
    expect(button.disabled).toBe(true);
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
    expect(value()).toBe(1);
    await tx.commit('Empty');
    expect(button.disabled).toBe(false);
    unbind();
    control.onRemove();
  });
});
describe('external replacement is distinct from history replay', () => {
  it('clears old history and only the replaced source selection/highlight', async () => {
    const { map, source, highlights } = await registered();
    const before = source.getDataset() as MapshaperDataset;
    const middle = dataset(2);
    const cmd = new DatasetReplaceCommand({ source, before, after: middle, label: 'A to B' });
    cmd.do();
    map.pushCommand(cmd);
    cmd.publish();
    expect(map.canUndo()).toBe(true);
    map.select([
      { source: 's', layer: 'points', id: 0 },
      { source: 'other', layer: 'points', id: 0 },
    ]);
    const latest = dataset(3);
    await source.replaceDataset(latest);
    expect(map.canUndo()).toBe(false);
    expect(map.canRedo()).toBe(false);
    expect(map.undo()).toBe(false);
    expect(source.getDataset()).toBe(latest);
    expect(map.getSelection()).toEqual([{ source: 'other', layer: 'points', id: 0 }]);
    expect(highlights.removeSource).toHaveBeenCalledWith('s');
  });
  it('preserves normal dataset command undo/redo', async () => {
    const { map, source } = await registered();
    const before = source.getDataset() as MapshaperDataset;
    const after = dataset(2);
    const cmd = new DatasetReplaceCommand({ source, before, after, label: 'Edit' });
    cmd.do();
    map.pushCommand(cmd);
    cmd.publish();
    expect(map.undo()).toBe(true);
    expect(source.getDataset()).toBe(before);
    expect(map.redo()).toBe(true);
    expect(source.getDataset()).toBe(after);
  });
  it('rejects external replacement in an active transaction', async () => {
    const { map, source } = await registered();
    const before = source.getDataset();
    const tx = map.beginTransaction();
    await expect(source.replaceDataset(dataset(4))).rejects.toThrow(/transaction/i);
    expect(source.getDataset()).toBe(before);
    tx.rollback();
  });
});
describe('async source commits reject stale data', () => {
  it.each([
    'editVersion',
    'attributeVersion',
  ] as const)('replaceDataset detects %s changes', async (version) => {
    const source = new TopologySource('s');
    const before = dataset();
    source.setDataset(before, false);
    const gate = deferred<MapshaperDataset>();
    source.setDatasetNormalizer(() => gate.promise);
    const pending = source.replaceDataset(dataset(2));
    const assertion = expect(pending).rejects.toThrow(/changed/);
    before[version] = 1;
    gate.resolve(dataset(2));
    await assertion;
    expect(source.getDataset()).toBe(before);
  });
  it.each([
    'geometry',
    'attributes',
    'dataset',
  ] as const)('detached reprojection detects %s changes', async (change) => {
    const source = new TopologySource('s');
    const before = dataset();
    source.setDataset(before, false);
    const gate = deferred<MapshaperDataset>();
    vi.spyOn(source, 'prepareReproject').mockReturnValue(gate.promise);
    const pending = source.reproject('EPSG:3857');
    const assertion = expect(pending).rejects.toThrow(/changed/);
    if (change === 'geometry') before.editVersion = 1;
    else if (change === 'attributes') before.attributeVersion = 1;
    else source.setDataset(dataset(3), false);
    const current = source.getDataset();
    gate.resolve(dataset(2));
    await assertion;
    expect(source.getDataset()).toBe(current);
  });
  it('whole-map reprojection rejects concurrent attribute editing', async () => {
    const { map, source } = await registered();
    const before = source.getDataset();
    const started = deferred<void>();
    const gate = deferred<MapshaperDataset>();
    vi.spyOn(source, 'prepareReproject').mockImplementation(() => {
      started.resolve();
      return gate.promise;
    });
    const pending = map.reproject('EPSG:3857');
    const assertion = expect(pending).rejects.toThrow(/changed/);
    await started.promise;
    expect(
      map.attributes.setFeatureProperty({ source: 's', layer: 'points', id: 0 }, 'value', 9).ok,
    ).toBe(true);
    gate.resolve({ ...dataset(1), info: { crs_string: 'EPSG:3857' } });
    await assertion;
    expect(source.getDataset()).toBe(before);
    expect(source.getDataset()?.layers[0].data?.getRecords()[0].value).toBe(9);
    expect(map.getCRS()).toBe('EPSG:4326');
  });
  it('whole-map reprojection rejects a transaction opened during preparation', async () => {
    const { map, source } = await registered();
    const before = source.getDataset();
    const started = deferred<void>();
    const gate = deferred<MapshaperDataset>();
    vi.spyOn(source, 'prepareReproject').mockImplementation(() => {
      started.resolve();
      return gate.promise;
    });
    const pending = map.reproject('EPSG:3857');
    const assertion = expect(pending).rejects.toThrow(/transaction/i);
    await started.promise;
    const tx = map.beginTransaction();
    gate.resolve({ ...dataset(), info: { crs_string: 'EPSG:3857' } });
    await assertion;
    expect(source.getDataset()).toBe(before);
    tx.rollback();
  });
});
