import { describe, expect, it } from 'vitest';
import { deleteSelectedFeatures } from './delete-selected';
import type { MutableTopologySource } from '../../domain/source/source';
import type { MapshaperLayer } from '../../shared/types/mapshaper-types';

function source(layer: MapshaperLayer): MutableTopologySource {
  const dataset = { layers: [layer] };
  return {
    getLayers: () => [layer],
    getDataset: () => dataset,
  } as unknown as MutableTopologySource;
}

describe('selected deletion repaint bounds', () => {
  it('captures deleted point bounds before compaction and preserves undo', () => {
    const layer: MapshaperLayer = {
      name: 'points',
      geometry_type: 'point',
      shapes: [
        [[1.25, 2.75]],
        [[40, 50]],
        [
          [-3, 9],
          [5, -2],
        ],
      ],
    };
    const sources = new Map([['data', source(layer)]]);
    const result = deleteSelectedFeatures(
      [
        { source: 'data', layer: 'points', id: 0 },
        { source: 'data', layer: 'points', id: 2 },
      ],
      sources,
    )!;
    expect(result.dirtyBounds).toEqual([-3, -2, 5, 9]);
    expect(layer.shapes).toEqual([[[40, 50]]]);
    result.command.undo();
    expect(layer.shapes).toHaveLength(3);
    expect(layer.shapes?.[0]).toEqual([[1.25, 2.75]]);
  });

  it('requires a full redraw if any deleted shape cannot be bounded', () => {
    const layer: MapshaperLayer = { name: 'paths', geometry_type: 'polygon', shapes: [[[0]]] };
    const result = deleteSelectedFeatures(
      [{ source: 'data', layer: 'paths', id: 0 }],
      new Map([['data', source(layer)]]),
    )!;
    expect(result.dirtyBounds).toBeNull();
  });
});
