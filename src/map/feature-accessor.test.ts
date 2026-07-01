import { describe, expect, it } from 'vitest';
import { FeatureAccessor } from './feature-accessor';
import type { EmapHostInternal } from './emap-host';
import type { MapshaperLayer } from '../types/mapshaper-types';

function makeHost(layers: globalThis.Map<string, MapshaperLayer | null>): EmapHostInternal {
  // Tiny fake host with just enough surface for the accessor to call
  // through. The accessor only reads `_host.layers.resolve(...)` so
  // every other field can be a no-op.
  const host: any = {
    _removed: false,
    _sources: new globalThis.Map(),
    _history: null,
    _selection: null,
    _activeTransaction: null,
    _workerPool: null,
    _workerMode: false,
    _workerThreshold: 1e9,
    layers: {
      resolve: (sourceId: string, layerId: string) => {
        return layers.get(`${sourceId}/${layerId}`) ?? null;
      },
    },
    _resolveLayer: () => null,
    _scheduleRender: () => undefined,
    _fireHistoryChange: () => undefined,
    _fireSelectionChange: () => undefined,
    _invalidateShapeCachesForSources: () => undefined,
    _clearSpatialIndexesForSources: () => undefined,
    _allowExpressionEvaluation: () => true,
    fire: () => undefined,
  };
  return host as EmapHostInternal;
}

function makeLayer(
  name: string,
  shapes: unknown[],
  records?: Array<Record<string, unknown>>,
): MapshaperLayer {
  return {
    name,
    geometry_type: 'polygon',
    shapes: shapes as any,
    data: records
      ? ({ getRecords: () => records, getFields: () => Object.keys(records[0] ?? {}) } as any)
      : null,
  } as MapshaperLayer;
}

describe('FeatureAccessor.get', () => {
  it('returns a Feature for a valid ref', () => {
    const layer = makeLayer(
      'states',
      [[[0, 1, 2]], [[3, 4]]],
      [
        { name: 'A', pop: 1 },
        { name: 'B', pop: 2 },
      ],
    );
    const layers = new globalThis.Map<string, MapshaperLayer>([['us/states', layer]]);
    const acc = new FeatureAccessor(makeHost(layers));

    const f = acc.get({ source: 'us', layer: 'states', id: 1 });
    expect(f).not.toBeNull();
    expect(f!.ref).toEqual({ source: 'us', layer: 'states', id: 1 });
    expect(f!.geometry).toEqual([[3, 4]]);
    expect(f!.properties).toEqual({ name: 'B', pop: 2 });
  });

  it('returns null for an unknown source/layer', () => {
    const acc = new FeatureAccessor(makeHost(new globalThis.Map()));
    expect(acc.get({ source: 'nope', layer: 'x', id: 0 })).toBeNull();
  });

  it('returns null for an out-of-range id', () => {
    const layer = makeLayer('l', [[[0]], [[1]]]);
    const layers = new globalThis.Map<string, MapshaperLayer>([['s/l', layer]]);
    const acc = new FeatureAccessor(makeHost(layers));
    expect(acc.get({ source: 's', layer: 'l', id: 99 })).toBeNull();
    expect(acc.get({ source: 's', layer: 'l', id: -1 })).toBeNull();
    expect(acc.get({ source: 's', layer: 'l', id: 1.5 })).toBeNull();
  });

  it('returns null when shapes is null (data-only layer)', () => {
    const layer = makeLayer('l', [] as any);
    layer.shapes = null;
    const layers = new globalThis.Map<string, MapshaperLayer>([['s/l', layer]]);
    const acc = new FeatureAccessor(makeHost(layers));
    expect(acc.get({ source: 's', layer: 'l', id: 0 })).toBeNull();
  });

  it('properties are frozen — caller mutation does not affect the source record', () => {
    const records = [{ name: 'A' }] as Array<Record<string, unknown>>;
    const layer = makeLayer('l', [[[0]]], records);
    const layers = new globalThis.Map<string, MapshaperLayer>([['s/l', layer]]);
    const acc = new FeatureAccessor(makeHost(layers));

    const f = acc.get({ source: 's', layer: 'l', id: 0 })!;
    expect(Object.isFrozen(f.properties)).toBe(true);
    expect(() => {
      (f.properties as Record<string, unknown>).name = 'B';
    }).toThrow();
    // Underlying record untouched.
    expect(records[0].name).toBe('A');
  });

  it('properties is an empty frozen object when the layer has no data table', () => {
    const layer = makeLayer('l', [[[0]]]);
    const layers = new globalThis.Map<string, MapshaperLayer>([['s/l', layer]]);
    const acc = new FeatureAccessor(makeHost(layers));

    const f = acc.get({ source: 's', layer: 'l', id: 0 })!;
    expect(f.properties).toEqual({});
    expect(Object.isFrozen(f.properties)).toBe(true);
  });

  it('geometry is null when the row exists but has no shape entry', () => {
    const layer = makeLayer('l', [null]);
    const layers = new globalThis.Map<string, MapshaperLayer>([['s/l', layer]]);
    const acc = new FeatureAccessor(makeHost(layers));

    const f = acc.get({ source: 's', layer: 'l', id: 0 })!;
    expect(f.geometry).toBeNull();
  });
});

describe('FeatureAccessor.iter', () => {
  it('yields every feature in source order', () => {
    const layer = makeLayer('l', [[[0]], [[1]], [[2]]], [{ i: 0 }, { i: 1 }, { i: 2 }]);
    const layers = new globalThis.Map<string, MapshaperLayer>([['s/l', layer]]);
    const acc = new FeatureAccessor(makeHost(layers));

    const out = Array.from(acc.iter('s', 'l'));
    expect(out).toHaveLength(3);
    expect(out.map((f) => f.properties.i)).toEqual([0, 1, 2]);
  });

  it('yields nothing for an unknown layer', () => {
    const acc = new FeatureAccessor(makeHost(new globalThis.Map()));
    expect(Array.from(acc.iter('nope', 'x'))).toEqual([]);
  });

  it('yields nothing when shapes is null', () => {
    const layer = makeLayer('l', []);
    layer.shapes = null;
    const layers = new globalThis.Map<string, MapshaperLayer>([['s/l', layer]]);
    const acc = new FeatureAccessor(makeHost(layers));
    expect(Array.from(acc.iter('s', 'l'))).toEqual([]);
  });
});

describe('FeatureAccessor.count', () => {
  it('returns the shape count for a real layer', () => {
    const layer = makeLayer('l', [[[0]], [[1]], [[2]]]);
    const layers = new globalThis.Map<string, MapshaperLayer>([['s/l', layer]]);
    const acc = new FeatureAccessor(makeHost(layers));
    expect(acc.count('s', 'l')).toBe(3);
  });

  it('returns 0 for a missing layer or null shapes', () => {
    const acc = new FeatureAccessor(makeHost(new globalThis.Map()));
    expect(acc.count('nope', 'x')).toBe(0);
  });
});
