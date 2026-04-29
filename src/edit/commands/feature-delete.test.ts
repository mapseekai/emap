import { describe, expect, it } from 'vitest';
import { FeatureDeleteCommand, BulkFeatureDeleteCommand } from './feature-delete';

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
    });
    cmd.undo();
    expect(layer.shapes[1]).toBe(originalShape);
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
    });
    cmd.do();
    cmd.undo();
    expect(layer.shapes).toEqual([['s0'], ['s1'], ['s2']]);
    expect(records).toEqual([{ a: 0 }, { a: 1 }, { a: 2 }]);
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
    const cmd = new BulkFeatureDeleteCommand({ layer: layer as any, snapshots: snap });
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
    });
    expect(single.label).toBe('Delete 1 feature');
    const many = new BulkFeatureDeleteCommand({
      layer: { shapes: [['a'], ['b'], ['c']] } as any,
      snapshots: [
        { id: 0, shape: ['a'], record: null },
        { id: 1, shape: ['b'], record: null },
        { id: 2, shape: ['c'], record: null },
      ],
    });
    expect(many.label).toBe('Delete 3 features');
  });

  it('empty snapshot list is a safe no-op', () => {
    const { layer } = makeLayer(3);
    const before = [...layer.shapes];
    const cmd = new BulkFeatureDeleteCommand({ layer: layer as any, snapshots: [] });
    cmd.do();
    expect(layer.shapes).toEqual(before);
  });
});
