import { describe, expect, it, vi } from 'vitest';
import { DatasetReplaceCommand } from './dataset-replace';
import type { TopologySource } from '../../source/source';
import type { MapshaperDataset } from '../../../shared/types/mapshaper-types';

function makeSource() {
  return {
    setDataset: vi.fn(),
    fire: vi.fn(),
  } as unknown as TopologySource & { setDataset: ReturnType<typeof vi.fn> };
}

const before = { layers: [{ name: 'before', shapes: [] }] } as unknown as MapshaperDataset;
const after = { layers: [{ name: 'after', shapes: [] }] } as unknown as MapshaperDataset;

describe('DatasetReplaceCommand', () => {
  it('do() activates the after dataset', () => {
    const source = makeSource();
    const cmd = new DatasetReplaceCommand({ source, before, after, label: 'Clip x' });
    cmd.do();
    expect(source.setDataset).toHaveBeenCalledWith(after, false);
  });

  it('undo() activates the before dataset', () => {
    const source = makeSource();
    const cmd = new DatasetReplaceCommand({ source, before, after, label: 'Clip x' });
    cmd.undo();
    expect(source.setDataset).toHaveBeenCalledWith(before, false);
  });

  it('round-trip do() then undo() ends on `before`', () => {
    const source = makeSource();
    const cmd = new DatasetReplaceCommand({ source, before, after, label: 'Clip x' });
    cmd.do();
    cmd.undo();
    expect(source.setDataset).toHaveBeenNthCalledWith(1, after, false);
    expect(source.setDataset).toHaveBeenNthCalledWith(2, before, false);
  });

  it('exposes the label for historychange', () => {
    const cmd = new DatasetReplaceCommand({
      source: makeSource(),
      before,
      after,
      label: 'Erase parks',
    });
    expect(cmd.label).toBe('Erase parks');
  });
});
