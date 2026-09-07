import { describe, expect, it, vi } from 'vitest';
import { FeatureQuery } from './feature-query';
import { AffineTransform } from '../geo/transform';
import type { MutableTopologySource } from '../source/source';
import type { MapshaperLayer } from '../types/mapshaper-types';

function fixture() {
  const layer: MapshaperLayer = {
    geometry_type: 'point',
    shapes: Array.from({ length: 10_000 }, (_, i) => [[i % 100, Math.floor(i / 100)]]),
  };
  const dataset = { layers: [layer], editVersion: 0 };
  const source = {
    type: 'topology',
    getLayers: () => dataset.layers,
    getArcs: () => undefined,
    getDataset: () => dataset,
  } as unknown as MutableTopologySource;
  const query = new FeatureQuery(
    new Map([['s', source]]),
    () => new AffineTransform(),
    () => ({ width: 100, height: 100 }),
    () => 1,
  );
  return { layer, dataset, query };
}

describe('render candidates', () => {
  it('returns only intersecting IDs in original feature order and reuses geometry bounds', () => {
    const { layer, query } = fixture();
    expect(query.getRenderCandidates('s', layer, [10, 10, 11, 11])).toEqual(
      new Uint32Array([1010, 1011, 1110, 1111]),
    );
    const coordinate = layer.shapes![1010]![0];
    const getter = vi.fn(() => 10);
    Object.defineProperty(coordinate, '0', { get: getter, configurable: true });
    query.getRenderCandidates('s', layer, [10, 10, 11, 11]);
    expect(getter).not.toHaveBeenCalled();
  });

  it('uses the scan path for full coverage and high hit rates; distinguishes zero hits', () => {
    const { layer, query } = fixture();
    query.prebuildForRendering('s');
    const cache = Reflect.get(query, '_indexCache') as Map<
      string,
      Map<
        number,
        {
          value: { index: { search: (...bounds: number[]) => number[] } };
        }
      >
    >;
    const search = vi.spyOn(cache.get('s')!.get(0)!.value.index, 'search');
    expect(query.getRenderCandidates('s', layer, [-1, -1, 100, 100])).toBeNull();
    expect(query.getRenderCandidates('s', layer, [0, 0, 90, 90])).toBeNull();
    expect(search).not.toHaveBeenCalled();
    expect(query.getRenderCandidates('s', layer, [200, 200, 201, 201])).toEqual(new Uint32Array());
  });

  it('invalidates moved geometry, replacement shapes, and explicit clears', () => {
    const { layer, dataset, query } = fixture();
    expect(query.getRenderCandidates('s', layer, [10, 10, 10, 10])).toEqual(
      new Uint32Array([1010]),
    );
    layer.shapes![1010] = [[200, 200]];
    dataset.editVersion++;
    expect(query.getRenderCandidates('s', layer, [10, 10, 10, 10])).toEqual(new Uint32Array());
    layer.shapes = layer.shapes!.slice();
    layer.shapes[1010] = [[10, 10]];
    expect(query.getRenderCandidates('s', layer, [10, 10, 10, 10])).toEqual(
      new Uint32Array([1010]),
    );
    layer.shapes[1010] = [[200, 200]];
    query.clear('s');
    expect(query.getRenderCandidates('s', layer, [10, 10, 10, 10])).toEqual(new Uint32Array());
  });
});
