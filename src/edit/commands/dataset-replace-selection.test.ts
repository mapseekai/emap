import { describe, expect, it, vi } from 'vitest';
import type { TopologySource } from '../../source/source';
import type { MapshaperDataset } from '../../types/mapshaper-types';
import { Selection } from '../../map/selection';
import { DatasetReplaceSelectionCommand } from './dataset-replace-selection';

const before = { layers: [{ name: 'before', shapes: [] }] } as unknown as MapshaperDataset;
const after = { layers: [{ name: 'after', shapes: [] }] } as unknown as MapshaperDataset;

function makeSource() {
  const source = {
    setDataset: vi.fn(),
    fire: vi.fn(),
  };
  return source as typeof source & TopologySource;
}

describe('DatasetReplaceSelectionCommand', () => {
  it('undo and redo restore dataset and selection together', () => {
    const source = makeSource();
    const selection = new Selection();
    selection.apply([{ source: 's', layer: 'roads', id: 2 }], 'replace');
    const originalSelection = selection.getAll();
    const beforeSelection = selection.snapshot();
    const afterSelection = [
      { source: 's', layer: 'roads', id: 0 },
      { source: 's', layer: 'roads', id: 1 },
    ];
    const publishSelection = vi.fn();
    const command = new DatasetReplaceSelectionCommand({
      source,
      before,
      after,
      label: 'Split 1 feature',
      selection,
      beforeSelection,
      afterSelection,
      publishSelection,
    });

    command.do();
    expect(source.setDataset).toHaveBeenLastCalledWith(after, false);
    expect(selection.getAll()).toEqual(afterSelection);

    command.undo();
    expect(source.setDataset).toHaveBeenLastCalledWith(before, false);
    expect(selection.getAll()).toEqual(originalSelection);

    command.publish();
    expect(source.fire).toHaveBeenCalledWith('data', { reason: 'replace' });
    expect(publishSelection).toHaveBeenCalledTimes(1);
  });

  it('does not publish selectionchange when the last transition has no diff', () => {
    const selection = new Selection();
    const publishSelection = vi.fn();
    const command = new DatasetReplaceSelectionCommand({
      source: makeSource(),
      before,
      after,
      label: 'Split 1 feature',
      selection,
      beforeSelection: selection.snapshot(),
      afterSelection: [],
      publishSelection,
    });

    command.do();
    command.publish();

    expect(publishSelection).not.toHaveBeenCalled();
  });
});
