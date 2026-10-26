import { describe, expect, it, vi } from 'vitest';
import { Selection } from '../../../engine/map/selection';
import type {
  DataTable,
  MapshaperDataset,
  MapshaperLayer,
} from '../../../shared/types/mapshaper-types';
import { asMutableTopologySource } from '../../source/source';
import { TopologySource } from '../../source/topology-source';
import {
  BulkFeatureDeleteCommand,
  FeatureDeleteCommand,
  FeatureDeleteWithSelectionCommand,
} from './feature-delete';

function makeSource(dataset: MapshaperDataset = { layers: [] }) {
  const source = asMutableTopologySource(new TopologySource('s'));
  source.setDataset(dataset, false);
  return source;
}

describe('FeatureDeleteCommand', () => {
  it('do() splices out the shape and data record', () => {
    const records: Record<string, unknown>[] = [{ a: 0 }, { a: 1 }, { a: 2 }];
    const layer = {
      shapes: [[[0]], [[1]], [[2]]],
      data: { getRecords: () => records },
    };
    const cmd = new FeatureDeleteCommand({
      layer: layer,
      featureId: 1,
      shape: layer.shapes[1],
      record: records[1],
      source: makeSource(),
    });
    cmd.do();
    expect(layer.shapes).toEqual([[[0]], [[2]]]);
    expect(records).toEqual([{ a: 0 }, { a: 2 }]);
  });

  it('round-trip do() then undo() yields the original arrays', () => {
    const records: Record<string, unknown>[] = [{ a: 0 }, { a: 1 }, { a: 2 }];
    const layer = {
      shapes: [[[0]], [[1]], [[2]]],
      data: { getRecords: () => records },
    };
    const cmd = new FeatureDeleteCommand({
      layer: layer,
      featureId: 1,
      shape: layer.shapes[1],
      record: records[1],
      source: makeSource(),
    });
    cmd.do();
    cmd.undo();
    expect(layer.shapes).toEqual([[[0]], [[1]], [[2]]]);
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
      layer: layer,
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
      shapes: [[[0]], [[1]]],
      data: undefined,
    };
    const cmd = new FeatureDeleteCommand({
      layer: layer,
      featureId: 0,
      shape: layer.shapes[0],
      record: null,
      source: makeSource(),
    });
    expect(() => cmd.do()).not.toThrow();
    expect(layer.shapes).toEqual([[[1]]]);
    expect(() => cmd.undo()).not.toThrow();
    expect(layer.shapes).toEqual([[[0]], [[1]]]);
  });
});

describe('BulkFeatureDeleteCommand', () => {
  function makeLayer(n: number) {
    const shapes = Array.from({ length: n }, (_, i) => [[i]]);
    const records: Record<string, unknown>[] = Array.from({ length: n }, (_, i) => ({ a: i }));
    return {
      layer: { shapes, data: { getRecords: () => records } },
      records,
    };
  }

  it('do() removes all snapshotted ids in one pass', () => {
    const { layer, records } = makeLayer(5);
    const cmd = new BulkFeatureDeleteCommand({
      layer: layer,
      snapshots: [
        { id: 1, shape: layer.shapes[1], record: records[1] },
        { id: 3, shape: layer.shapes[3], record: records[3] },
      ],
      source: makeSource(),
    });
    cmd.do();
    expect(layer.shapes).toEqual([[[0]], [[2]], [[4]]]);
    expect(records).toEqual([{ a: 0 }, { a: 2 }, { a: 4 }]);
  });

  it('do() accepts ids in any order, with duplicates deduped by Set', () => {
    const { layer, records } = makeLayer(5);
    const cmd = new BulkFeatureDeleteCommand({
      layer: layer,
      snapshots: [
        { id: 4, shape: layer.shapes[4], record: records[4] },
        { id: 0, shape: layer.shapes[0], record: records[0] },
        { id: 2, shape: layer.shapes[2], record: records[2] },
      ],
      source: makeSource(),
    });
    cmd.do();
    expect(layer.shapes).toEqual([[[1]], [[3]]]);
    expect(records).toEqual([{ a: 1 }, { a: 3 }]);
  });

  it('records array reference is preserved (in-place compaction)', () => {
    const { layer, records } = makeLayer(4);
    const beforeRef = records;
    const cmd = new BulkFeatureDeleteCommand({
      layer: layer,
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
      layer: layer,
      snapshots: snap,
      source: makeSource(),
    });
    cmd.do();
    expect(layer.shapes).toEqual([[[1]], [[3]]]);
    cmd.undo();
    expect(layer.shapes).toEqual([[[0]], [[1]], [[2]], [[3]], [[4]]]);
    expect(records).toEqual([{ a: 0 }, { a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }]);
  });

  it('layers without a data table are handled', () => {
    const layer = {
      shapes: [[[0]], [[1]], [[2]]],
      data: undefined,
    };
    const cmd = new BulkFeatureDeleteCommand({
      layer: layer,
      snapshots: [
        { id: 0, shape: layer.shapes[0], record: null },
        { id: 2, shape: layer.shapes[2], record: null },
      ],
      source: makeSource(),
    });
    expect(() => cmd.do()).not.toThrow();
    expect(layer.shapes).toEqual([[[1]]]);
    expect(() => cmd.undo()).not.toThrow();
    expect(layer.shapes).toEqual([[[0]], [[1]], [[2]]]);
  });

  it('label reflects the snapshot count', () => {
    const single = new BulkFeatureDeleteCommand({
      layer: { shapes: [[[9]]] },
      snapshots: [{ id: 0, shape: [[9]], record: null }],
      source: makeSource(),
    });
    expect(single.label).toBe('Delete 1 feature');
    const many = new BulkFeatureDeleteCommand({
      layer: { shapes: [[[0]], [[1]], [[2]]] },
      snapshots: [
        { id: 0, shape: [[0]], record: null },
        { id: 1, shape: [[1]], record: null },
        { id: 2, shape: [[2]], record: null },
      ],
      source: makeSource(),
    });
    expect(many.label).toBe('Delete 3 features');
  });

  it('empty snapshot list is a safe no-op', () => {
    const { layer } = makeLayer(3);
    const before = [...layer.shapes];
    const cmd = new BulkFeatureDeleteCommand({
      layer: layer,
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
    const data: DataTable = {
      // @ts-expect-error Exercise legacy nullable rows beyond the declared table contract.
      getRecords: () => records,
    };
    const layer = {
      shapes: originalShapes.slice(),
      data,
    } satisfies MapshaperLayer;
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
    const records = [{ name: 'a' }, { name: 'b' }];
    const layer = {
      name: 'l',
      geometry_type: 'polygon',
      shapes: [[[0]], [[1]]],
      data: { getRecords: () => records },
    } satisfies MapshaperLayer;
    const dataset = { layers: [layer], editVersion: 0, attributeVersion: 0 };
    const source = makeSource(dataset);
    const onData = vi.fn();
    source.on('data', onData);
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
    return { layer, records, source, dataset, onData, selection, publishSelection, command };
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
    const { dataset, command } = makeSetup();
    command.do();
    expect(dataset.editVersion).toBe(1);
    expect(dataset.attributeVersion).toBe(1);
    command.undo();
    expect(dataset.editVersion).toBe(2);
    expect(dataset.attributeVersion).toBe(2);
  });

  it('publish fires data(edit) and the selection diff once', () => {
    const { onData, publishSelection, command } = makeSetup();
    command.do();
    command.publish();
    expect(onData).toHaveBeenCalledWith(expect.objectContaining({ reason: 'edit' }));
    expect(publishSelection).toHaveBeenCalledTimes(1);
    expect(publishSelection.mock.calls[0]![0]).toMatchObject({
      added: [],
      removed: [{ source: 's', layer: 'l', id: 1 }],
    });
  });
});
