import { describe, expect, it } from 'vitest';
import { LayerRegistry, resolveLayerInList } from './layer-registry';
import type { MapshaperLayer } from '../../shared/types/mapshaper-types';
import type { TopologySource } from '../../domain/source/source';

// Layer resolution is the single most-called helper in the engine —
// every op, hover, and selection write goes through it. These tests
// pin the matching rules (canonical id → name alias → id alias)
// and the null-on-miss contract.

function makeLayer(props: Partial<MapshaperLayer>): MapshaperLayer {
  return {
    geometry_type: 'polygon',
    shapes: null,
    ...props,
  } as MapshaperLayer;
}

function makeSource(layers: MapshaperLayer[]): TopologySource {
  return { getLayers: () => layers } as TopologySource;
}

describe('resolveLayerInList', () => {
  it('matches by layer.name', () => {
    const a = makeLayer({ name: 'parks' });
    const b = makeLayer({ name: 'roads' });
    expect(resolveLayerInList([a, b], 'parks')).toBe(a);
    expect(resolveLayerInList([a, b], 'roads')).toBe(b);
  });

  it('matches by layer.id', () => {
    const a = makeLayer({ name: 'first', id: 'A' });
    const b = makeLayer({ name: 'second', id: 'B' });
    expect(resolveLayerInList([a, b], 'A')).toBe(a);
    expect(resolveLayerInList([a, b], 'B')).toBe(b);
  });

  it('matches by positional getLayerId fallback for unnamed layers', () => {
    const a = makeLayer({});
    const b = makeLayer({});
    // Unnamed layers fall back to 'layer-0', 'layer-1' etc.
    expect(resolveLayerInList([a, b], 'layer-0')).toBe(a);
    expect(resolveLayerInList([a, b], 'layer-1')).toBe(b);
  });

  it('prefers an explicit name over a positional fallback', () => {
    const a = makeLayer({ name: 'layer-1' }); // ambiguous: name === 'layer-1'
    const b = makeLayer({}); // anonymous, getLayerId(b, 1) === 'layer-1'
    // The explicit name is also this layer's canonical id.
    expect(resolveLayerInList([a, b], 'layer-1')).toBe(a);
  });

  it('checks every canonical id before falling back to an earlier layer id alias', () => {
    const alias = makeLayer({ name: 'first', id: 'target' });
    const canonical = makeLayer({ name: 'target', id: 'second' });

    expect(resolveLayerInList([alias, canonical], 'target')).toBe(canonical);
  });

  it('returns null for unknown layerId', () => {
    const a = makeLayer({ name: 'parks' });
    expect(resolveLayerInList([a], 'nonexistent')).toBeNull();
  });

  it('returns null for an empty layer list', () => {
    expect(resolveLayerInList([], 'anything')).toBeNull();
  });

  it('skips null entries safely', () => {
    const a = makeLayer({ name: 'parks' });
    const layers = [null as unknown as MapshaperLayer, a];
    expect(resolveLayerInList(layers, 'parks')).toBe(a);
  });
});

describe('LayerRegistry.resolve', () => {
  it('resolves through the source registry', () => {
    const a = makeLayer({ name: 'parks' });
    const sources = new globalThis.Map<string, TopologySource>([['src1', makeSource([a])]]);
    const reg = new LayerRegistry(sources);
    expect(reg.resolve('src1', 'parks')).toBe(a);
  });

  it('returns null for an unknown sourceId', () => {
    const reg = new LayerRegistry(new globalThis.Map());
    expect(reg.resolve('nope', 'parks')).toBeNull();
  });

  it('returns null when sourceId resolves but layerId does not', () => {
    const sources = new globalThis.Map<string, TopologySource>([
      ['src1', makeSource([makeLayer({ name: 'parks' })])],
    ]);
    const reg = new LayerRegistry(sources);
    expect(reg.resolve('src1', 'roads')).toBeNull();
  });

  it('reads sources lazily — additions show up without rebuilding the registry', () => {
    const sources = new globalThis.Map<string, TopologySource>();
    const reg = new LayerRegistry(sources);
    expect(reg.resolve('src1', 'parks')).toBeNull();
    sources.set('src1', makeSource([makeLayer({ name: 'parks' })]));
    expect(reg.resolve('src1', 'parks')).not.toBeNull();
  });
});

it('resolves explicit ordinals for mixed-geometry layers sharing a filename', () => {
  const a = makeLayer({ name: 'shared', geometry_type: 'point' });
  const b = makeLayer({ name: 'shared', geometry_type: 'polyline' });
  expect(resolveLayerInList([a, b], 0)).toBe(a);
  expect(resolveLayerInList([a, b], 1)).toBe(b);
  expect(resolveLayerInList([a, b], 'shared')).toBe(a);
  for (const id of [-1, 0.5, NaN, 2]) expect(resolveLayerInList([a, b], id)).toBeNull();
});
