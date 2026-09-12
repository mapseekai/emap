import { describe, expect, it, vi } from 'vitest';
import { Selection } from '../../map/selection';
import type { MapshaperLayer } from '../../types/mapshaper-types';
import type { TopologySource } from '../../source/source';
import {
  BulkFeatureDeleteCommand,
  FeatureDeleteCommand,
  FeatureDeleteWithSelectionCommand,
} from './feature-delete';

function makeSource(): TopologySource {
  const dataset = { layers: [] };
  const source = {
    getDataset: () => dataset,
    markDisplayArcsDirty: () => {},
  };
  // The command only consumes this tested TopologySource surface.
  return source as unknown as TopologySource;
}

describe('FeatureDeleteCommand', () => {
  it('do() splices out the shape and data record', () => {
    const records: Record<string, unknown>[] = [{ a: 0 }, { a: 1 }, { a: 2 }];
    const layer = {
      shapes: [['s0'], ['s1'], ['s2']] as any[],
      data: { getRecords: () => records },
    };
    const cmd = new FeatureDeleteCommand({
      layer: layer as any,
      featureId: 1,
      shape: layer.shapes[1],
      record: records[1],
      source: makeSource(),
    });
    cmd.do();
    expect(layer.shapes).toEqual([['s0'], ['s2']]);
    expect(records).toEqual([{ a: 0 }, { a: 2 }]);
  });

  it('undo() restores the feature at the original index', () => {
    const records: Record<string, unknown>[] = [{ a: 0 }, { a: 2 }];
    const originalShape = ['s1'];
    const originalRecord = { a: 1 };
    const layer = {
      shapes: [['s0'], ['s2']] as any[],
      data: { getRecords: () => records },
    };
    const cmd = new FeatureDeleteCommand({
      layer: layer as any,
      featureId: 1,
      shape: originalShape,
      record: originalRecord,
      source: makeSource(),
    });
    cmd.undo();
    expect(layer.shapes[1]).toEqual(originalShape);
    expect(records[1]).toEqual({ a: 1 });
  });

  it('round-trip do() then undo() yields the original arrays', () => {
    const records: Record<string, unknown>[] = [{ a: 0 }, { a: 1 }, { a: 2 }];
    const layer = {
      shapes: [['s0'], ['s1'], ['s2']] as any[],
      data: { getRecords: () => records },
    };
    const cmd = new FeatureDeleteCommand({
      layer: layer as any,
      featureId: 1,
      shape: layer.shapes[1],
      record: records[1],
      source: makeSource(),
    });
    cmd.do();
    cmd.undo();
    expect(layer.shapes).toEqual([['s0'], ['s1'], ['s2']]);
    expect(records).toEqual([{ a: 0 }, { a: 1 }, { a: 2 }]);
  });

  it('owns shape and record snapshots when callers mutate them after construction', () => {
    const originalShape: [number, number][] = [[0, 1]];
    const originalRecord: Record<string, unknown> = { a: 1 };
    const records = [originalRecord];
    const layer = {
      shapes: [originalShape],
      data: { getRecords: () => records },
    };
    const cmd = new FeatureDeleteCommand({
      layer: layer as unknown as MapshaperLayer,
      featureId: 0,
      shape: originalShape,
      record: originalRecord,
      source: makeSource(),
    });
    originalShape[0]![0] = 999;
    originalRecord.a = 999;

    cmd.do();
    cmd.undo();

    expect(layer.shapes).toEqual([[[0, 1]]]);
    expect(records).toEqual([{ a: 1 }]);
  });

  it('layers without a data table are handled', () => {
    const layer = {
      shapes: [['s0'], ['s1']] as any[],
      data: undefined,
    };
    const cmd = new FeatureDeleteCommand({
      layer: layer as any,
      featureId: 0,
      shape: layer.shapes[0],
      record: null,
      source: makeSource(),
    });
    expect(() => cmd.do()).not.toThrow();
    expect(layer.shapes).toEqual([['s1']]);
    expect(() => cmd.undo()).not.toThrow();
    expect(layer.shapes).toEqual([['s0'], ['s1']]);
  });
});

describe('BulkFeatureDeleteCommand', () => {
  function makeLayer(n: number) {
    const shapes = Array.from({ length: n }, (_, i) => [`s${i}`]);
    const records: Record<string, unknown>[] = Array.from({ length: n }, (_, i) => ({ a: i }));
    return {
      layer: { shapes, data: { getRecords: () => records } },
      records,
    };
  }

  it('do() removes all snapshotted ids in one pass', () => {
    const { layer, records } = makeLayer(5);
    const cmd = new BulkFeatureDeleteCommand({
      layer: layer as any,
      snapshots: [
        { id: 1, shape: layer.shapes[1], record: records[1] },
        { id: 3, shape: layer.shapes[3], record: records[3] },
      ],
      source: makeSource(),
    });
    cmd.do();
    expect(layer.shapes).toEqual([['s0'], ['s2'], ['s4']]);
    expect(records).toEqual([{ a: 0 }, { a: 2 }, { a: 4 }]);
  });

  it('do() accepts ids in any order, with duplicates deduped by Set', () => {
    const { layer, records } = makeLayer(5);
    const cmd = new BulkFeatureDeleteCommand({
      layer: layer as any,
      snapshots: [
        { id: 4, shape: layer.shapes[4], record: records[4] },
        { id: 0, shape: layer.shapes[0], record: records[0] },
        { id: 2, shape: layer.shapes[2], record: records[2] },
      ],
      source: makeSource(),
    });
    cmd.do();
    expect(layer.shapes).toEqual([['s1'], ['s3']]);
    expect(records).toEqual([{ a: 1 }, { a: 3 }]);
  });

  it('records array reference is preserved (in-place compaction)', () => {
    const { layer, records } = makeLayer(4);
    const beforeRef = records;
    const cmd = new BulkFeatureDeleteCommand({
      layer: layer as any,
      snapshots: [{ id: 0, shape: layer.shapes[0], record: records[0] }],
      source: makeSource(),
    });
    cmd.do();
    expect(layer.data.getRecords()).toBe(beforeRef);
    expect(records).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
  });

  it('round-trip do() + undo() restores original arrays', () => {
    const { layer, records } = makeLayer(5);
    const snap = [
      { id: 0, shape: layer.shapes[0], record: { ...records[0] } },
      { id: 2, shape: layer.shapes[2], record: { ...records[2] } },
      { id: 4, shape: layer.shapes[4], record: { ...records[4] } },
    ];
    const cmd = new BulkFeatureDeleteCommand({
      layer: layer as any,
      snapshots: snap,
      source: makeSource(),
    });
    cmd.do();
    expect(layer.shapes).toEqual([['s1'], ['s3']]);
    cmd.undo();
    expect(layer.shapes).toEqual([['s0'], ['s1'], ['s2'], ['s3'], ['s4']]);
    expect(records).toEqual([{ a: 0 }, { a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }]);
  });

  it('layers without a data table are handled', () => {
    const layer = {
      shapes: [['s0'], ['s1'], ['s2']] as any[],
      data: undefined,
    };
    const cmd = new BulkFeatureDeleteCommand({
      layer: layer as any,
      snapshots: [
        { id: 0, shape: layer.shapes[0], record: null },
        { id: 2, shape: layer.shapes[2], record: null },
      ],
      source: makeSource(),
    });
    expect(() => cmd.do()).not.toThrow();
    expect(layer.shapes).toEqual([['s1']]);
    expect(() => cmd.undo()).not.toThrow();
    expect(layer.shapes).toEqual([['s0'], ['s1'], ['s2']]);
  });

  it('label reflects the snapshot count', () => {
    const single = new BulkFeatureDeleteCommand({
      layer: { shapes: [['x']] } as any,
      snapshots: [{ id: 0, shape: ['x'], record: null }],
      source: makeSource(),
    });
    expect(single.label).toBe('Delete 1 feature');
    const many = new BulkFeatureDeleteCommand({
      layer: { shapes: [['a'], ['b'], ['c']] } as any,
      snapshots: [
        { id: 0, shape: ['a'], record: null },
        { id: 1, shape: ['b'], record: null },
        { id: 2, shape: ['c'], record: null },
      ],
      source: makeSource(),
    });
    expect(many.label).toBe('Delete 3 features');
  });

  it('empty snapshot list is a safe no-op', () => {
    const { layer } = makeLayer(3);
    const before = [...layer.shapes];
    const cmd = new BulkFeatureDeleteCommand({
      layer: layer as any,
      snapshots: [],
      source: makeSource(),
    });
    cmd.do();
    expect(layer.shapes).toEqual(before);
  });
});

describe('nullable feature records', () => {
  it.each([
    ['single', [0]],
    ['bulk', [0, 2]],
    ['bulk', [0, 1, 2]],
  ] as const)('preserves null rows through %s deletion and repeated undo/redo (%j)', (kind, ids) => {
    const records: Array<Record<string, unknown> | null> = [null, { a: 1 }, null];
    const originalRecords = records.slice();
    const originalShapes = [[[0, 0]], [[1, 1]], [[2, 2]]];
    const layer = {
      shapes: originalShapes.slice(),
      data: { getRecords: () => records },
    } as unknown as MapshaperLayer;
    const source = makeSource();
    const command =
      kind === 'single'
        ? new FeatureDeleteCommand({
            layer,
            featureId: 0,
            shape: originalShapes[0],
            record: records[0],
            source,
          })
        : new BulkFeatureDeleteCommand({
            layer,
            snapshots: ids.map((id) => ({
              id,
              shape: originalShapes[id],
              record: records[id],
            })),
            source,
          });
    const deletedIds = new Set<number>(ids);

    for (let round = 0; round < 2; round++) {
      command.do();
      expect(layer.shapes).toEqual(originalShapes.filter((_, id) => !deletedIds.has(id)));
      expect(records).toEqual(originalRecords.filter((_, id) => !deletedIds.has(id)));
      expect(records).toHaveLength(layer.shapes!.length);

      command.undo();
      expect(layer.shapes).toEqual(originalShapes);
      expect(records).toEqual(originalRecords);
      expect(layer.data!.getRecords!()).toBe(records);
      expect(records).toHaveLength(layer.shapes!.length);
    }
  });

  it.each([
    'single',
    'bulk',
  ] as const)('keeps a layer without a table table-free through %s undo/redo', (kind) => {
    const layer: MapshaperLayer = { shapes: [[[0, 0]]] };
    const source = makeSource();
    const command =
      kind === 'single'
        ? new FeatureDeleteCommand({ layer, featureId: 0, shape: [[0, 0]], record: null, source })
        : new BulkFeatureDeleteCommand({
            layer,
            snapshots: [{ id: 0, shape: [[0, 0]], record: null }],
            source,
          });

    for (let round = 0; round < 2; round++) {
      command.do();
      expect(layer.shapes).toEqual([]);
      expect(layer.data).toBeUndefined();
      command.undo();
      expect(layer.shapes).toEqual([[[0, 0]]]);
      expect(layer.data).toBeUndefined();
    }
  });
});

describe('FeatureDeleteWithSelectionCommand', () => {
  function makeSetup() {
    const layer = {
      name: 'l',
      geometry_type: 'polygon',
      shapes: [[[0]], [[1]]],
      data: { getRecords: () => records },
    } as any;
    const records = [{ name: 'a' }, { name: 'b' }];
    const dataset = { layers: [layer], arcs: null, editVersion: 0, attributeVersion: 0 };
    const source = {
      getArcs: () => null,
      getDataset: () => dataset,
      markDisplayArcsDirty: vi.fn(),
      fire: vi.fn(),
    } as any;
    const selection = new Selection();
    selection.apply(
      [
        { source: 's', layer: 'l', id: 1 }, // the feature about to be deleted
        { source: 's', layer: 'l', id: 0 },
      ],
      'add',
    );
    const publishSelection = vi.fn();
    const command = new FeatureDeleteWithSelectionCommand({
      layer,
      featureId: 1,
      shape: layer.shapes[1],
      record: records[1]!,
      source,
      selection,
      beforeSelection: selection.snapshot(),
      afterSelection: [{ source: 's', layer: 'l', id: 0 }],
      publishSelection,
      label: 'Delete part',
    });
    return { layer, records, source, selection, publishSelection, command };
  }

  it('do splices the feature row + record and applies the remapped selection', () => {
    const { layer, records, selection, command } = makeSetup();
    command.do();
    expect(layer.shapes).toEqual([[[0]]]);
    expect(records).toEqual([{ name: 'a' }]);
    expect(selection.getAll()).toEqual([{ source: 's', layer: 'l', id: 0 }]);
  });

  it('undo restores the feature row + record + selection exactly', () => {
    const { layer, records, selection, command } = makeSetup();
    command.do();
    command.undo();
    expect(layer.shapes).toEqual([[[0]], [[1]]]);
    expect(records).toEqual([{ name: 'a' }, { name: 'b' }]);
    expect(selection.getAll()).toHaveLength(2);
  });

  it('bumps both revisions once per do and undo', () => {
    const { source, command } = makeSetup();
    const dataset = source.getDataset();
    command.do();
    expect(dataset.editVersion).toBe(1);
    expect(dataset.attributeVersion).toBe(1);
    command.undo();
    expect(dataset.editVersion).toBe(2);
    expect(dataset.attributeVersion).toBe(2);
  });

  it('publish fires data(edit) and the selection diff once', () => {
    const { source, publishSelection, command } = makeSetup();
    command.do();
    command.publish();
    expect(source.fire).toHaveBeenCalledWith('data', { reason: 'edit' });
    expect(publishSelection).toHaveBeenCalledTimes(1);
    expect(publishSelection.mock.calls[0]![0]).toMatchObject({
      added: [],
      removed: [{ source: 's', layer: 'l', id: 1 }],
    });
  });
});
