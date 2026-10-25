import { describe, expect, it } from 'vitest';
import { Float64, Table, makeData, makeVector, tableFromArrays } from 'apache-arrow';
import type { MapshaperDataset } from '../../shared/types/mapshaper-types';
import { cacheArrowTable, getCachedArrowTable } from './table-cache';

describe('Arrow retention', () => {
  it('evicts the least recently used layer while retaining name/index aliases of the same layer', () => {
    const dataset: MapshaperDataset = {
      layers: [
        { name: 'a', shapes: [] },
        { name: 'b', shapes: [] },
        { name: 'c', shapes: [] },
      ],
    };
    const table = tableFromArrays({ value: [1] });
    cacheArrowTable(dataset, dataset.layers[0], 'wkb', table);
    cacheArrowTable(dataset, dataset.layers[1], 'wkb', table);
    expect(getCachedArrowTable(dataset, dataset.layers[0], 'wkb')).toBe(table);
    cacheArrowTable(dataset, dataset.layers[2], 'wkb', table);
    expect(getCachedArrowTable(dataset, dataset.layers[1], 'wkb')).toBeUndefined();
    expect(getCachedArrowTable(dataset, dataset.layers[0], 'wkb')).toBe(table);
    expect(getCachedArrowTable(dataset, dataset.layers[2], 'wkb')).toBe(table);
  });

  it('counts the entire backing allocation of a sliced Arrow buffer before retaining it', () => {
    const dataset: MapshaperDataset = { layers: [{ name: 'a', shapes: [] }] };
    const buffer = new ArrayBuffer(65 * 1024 * 1024);
    const table = new Table({
      value: makeVector(
        makeData({ type: new Float64(), data: new Float64Array(buffer, 0, 1), length: 1 }),
      ),
    });
    cacheArrowTable(dataset, dataset.layers[0], 'large', table);
    expect(getCachedArrowTable(dataset, dataset.layers[0], 'large')).toBeUndefined();
    const small = tableFromArrays({ value: [1] });
    cacheArrowTable(dataset, dataset.layers[0], 'small', small);
    expect(getCachedArrowTable(dataset, dataset.layers[0], 'small')).toBe(small);
  });
});
