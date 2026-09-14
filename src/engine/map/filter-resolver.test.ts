import { describe, expect, it, vi } from 'vitest';
import { applyMaskToCandidates, FilterResolver } from './filter-resolver';

function makeLayer(records: Array<Record<string, unknown>>) {
  return {
    shapes: records.map(() => [[0]]),
    data: { getRecords: () => records },
  } as any;
}

const dataset = () => ({ editVersion: 0, attributeVersion: 0 }) as any;

describe('FilterResolver', () => {
  it('returns null when filter is undefined', () => {
    const r = new FilterResolver();
    expect(
      r.mask({ layerId: 'l', filter: undefined, dataset: dataset(), layer: makeLayer([{ a: 1 }]) }),
    ).toBeNull();
  });

  it('builds a boolean mask from records', () => {
    const r = new FilterResolver();
    const layer = makeLayer([{ pop: 50 }, { pop: 500 }, { pop: 150 }]);
    const mask = r.mask({
      layerId: 'l',
      filter: ['>', ['get', 'pop'], 100],
      dataset: dataset(),
      layer,
    });
    expect(mask).toEqual(Uint8Array.from([0, 1, 1]));
  });

  it('non-boolean string result deactivates the filter and reports once', () => {
    const onError = vi.fn();
    const r = new FilterResolver({ onError });
    const layer = makeLayer([{ enabled: 'false' }]);
    const mask = r.mask({ layerId: 'l', filter: ['get', 'enabled'], dataset: dataset(), layer });
    expect(mask).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].layerId).toBe('l');
  });

  it('non-boolean numeric result deactivates the filter', () => {
    const onError = vi.fn();
    const r = new FilterResolver({ onError });
    const layer = makeLayer([{ enabled: 1 }]);
    expect(
      r.mask({ layerId: 'l', filter: ['get', 'enabled'], dataset: dataset(), layer }),
    ).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('caches by version keys and rebuilds on attributeVersion bump', () => {
    const r = new FilterResolver();
    const records = [{ pop: 50 }];
    const layer = makeLayer(records);
    const filter: any = ['>', ['get', 'pop'], 100];
    const ds = dataset();
    expect(r.mask({ layerId: 'l', filter, dataset: ds, layer })).toEqual(Uint8Array.from([0]));
    // 同键：记录原地改了也命中缓存（不重算）
    records[0].pop = 500;
    expect(r.mask({ layerId: 'l', filter, dataset: ds, layer })).toEqual(Uint8Array.from([0]));
    // attributeVersion bump → 重算
    expect(
      r.mask({
        layerId: 'l',
        filter,
        dataset: { editVersion: 0, attributeVersion: 1 } as any,
        layer,
      }),
    ).toEqual(Uint8Array.from([1]));
  });

  it('clear(layerId) drops the entry', () => {
    const r = new FilterResolver();
    const records = [{ pop: 50 }];
    const layer = makeLayer(records);
    const filter: any = ['>', ['get', 'pop'], 100];
    r.mask({ layerId: 'l', filter, dataset: dataset(), layer });
    r.clear('l');
    records[0].pop = 500;
    expect(r.mask({ layerId: 'l', filter, dataset: dataset(), layer })).toEqual(
      Uint8Array.from([1]),
    );
  });
});

describe('applyMaskToCandidates', () => {
  it('intersects existing candidates', () => {
    expect(applyMaskToCandidates(Uint32Array.from([0, 1, 2]), Uint8Array.from([1, 0, 1]))).toEqual(
      Uint32Array.from([0, 2]),
    );
  });

  it('synthesizes matching ids when candidates is null', () => {
    expect(applyMaskToCandidates(null, Uint8Array.from([0, 1, 1]))).toEqual(
      Uint32Array.from([1, 2]),
    );
  });
});
