import { describe, expect, it, vi } from 'vitest';
import { FeatureDeleteCommand } from './feature-delete';
import type { TopologySource } from '../../source/source';

function makeSource(): TopologySource & { refreshDisplayArcs: ReturnType<typeof vi.fn> } {
  return { refreshDisplayArcs: vi.fn() } as any;
}

describe('FeatureDeleteCommand', () => {
  it('do() splices out the shape and data record', () => {
    const records: Record<string, unknown>[] = [{ a: 0 }, { a: 1 }, { a: 2 }];
    const layer = {
      shapes: [['s0'], ['s1'], ['s2']] as any[],
      data: { getRecords: () => records },
    };
    const source = makeSource();
    const cmd = new FeatureDeleteCommand({
      layer: layer as any,
      featureId: 1,
      shape: layer.shapes[1],
      record: records[1],
      source,
    });
    cmd.do();
    expect(layer.shapes).toEqual([['s0'], ['s2']]);
    expect(records).toEqual([{ a: 0 }, { a: 2 }]);
    expect(source.refreshDisplayArcs).toHaveBeenCalledTimes(1);
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
      source: makeSource(),
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
      source: makeSource(),
    });
    expect(() => cmd.do()).not.toThrow();
    expect(layer.shapes).toEqual([['s1']]);
    expect(() => cmd.undo()).not.toThrow();
    expect(layer.shapes).toEqual([['s0'], ['s1']]);
  });
});
