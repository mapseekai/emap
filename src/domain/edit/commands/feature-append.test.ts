import { describe, expect, it, vi } from 'vitest';
import { FeatureAppendCommand } from './feature-append';
import type { TopologySource } from '../../source/source';

// Same minimal stub style as feature-create.test.ts: markSourceChanged only
// touches optional methods (markDisplayArcsDirty?. / getDataset?.()).
function makeSource(): TopologySource {
  return { fire: vi.fn() } as unknown as TopologySource;
}

describe('FeatureAppendCommand', () => {
  it('do appends shape + record; undo pops both; redo re-pushes the same references', () => {
    const records: Record<string, unknown>[] = [{ name: 'host' }];
    const layer = {
      shapes: [[[0]]] as any[][],
      data: { getRecords: () => records },
    };
    const source = makeSource();
    const appendedShape = [[~2, ~1]];
    const cmd = new FeatureAppendCommand({
      layer: layer as any,
      source,
      appendedShape,
      appendedRecord: {},
      label: 'Fill ring',
    });
    expect(cmd.label).toBe('Fill ring');

    cmd.do();
    expect(layer.shapes).toHaveLength(2);
    expect(layer.shapes[1]).toBe(appendedShape); // same reference
    expect(records).toEqual([{ name: 'host' }, {}]);

    cmd.undo();
    expect(layer.shapes).toEqual([[[0]]]);
    expect(records).toEqual([{ name: 'host' }]);

    cmd.do();
    expect(layer.shapes[1]).toBe(appendedShape);
    expect(records).toHaveLength(2);
  });

  it('never touches an arc collection (options carry no arcs at all)', () => {
    const layer = { shapes: [] as any[][] };
    const cmd = new FeatureAppendCommand({
      layer: layer as any,
      source: makeSource(),
      appendedShape: [[3]],
      appendedRecord: null, // layer without data table
    });
    cmd.do();
    cmd.undo();
    expect(layer.shapes).toEqual([]);
  });

  it('publish fires source data with reason edit', () => {
    const source = makeSource();
    const cmd = new FeatureAppendCommand({
      layer: { shapes: [] as any[][] } as any,
      source,
      appendedShape: [[3]],
      appendedRecord: null,
    });
    cmd.publish();
    expect(source.fire).toHaveBeenCalledWith('data', { reason: 'edit' });
  });
});
