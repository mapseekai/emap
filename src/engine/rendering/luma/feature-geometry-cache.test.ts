import { describe, expect, it, vi } from 'vitest';
import { FeatureGeometryCache } from './feature-geometry-cache';
import { buildGeometryPacket } from './geometry-packet';
import type { GeometryPacket } from './geometry-jobs';
import { collectTransferables } from '../../worker/transferables';
const geometry = () => ({
  kind: 'fill' as const,
  vertices: Float32Array.from([0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0]),
  indices: Uint32Array.from([0, 1, 2]),
  count: 3,
});
describe('Worker per-feature triangulation reuse', () => {
  it('reuses exact features across changing batches, while coordinates/ring offsets and source identity invalidate independently', () => {
    const cache = new FeatureGeometryCache(),
      build = vi.fn(geometry),
      xy = Float64Array.from([0, 0, 1, 0, 0, 1]),
      offsets = Uint32Array.from([0, 3]);
    const first = cache.get('s', 'geometry', 7, xy, offsets, build);
    expect(cache.get('s', 'geometry', 7, xy.slice(), offsets.slice(), build)).toBe(first);
    expect(build).toHaveBeenCalledOnce();
    xy[0] = 0.1;
    cache.get('s', 'geometry', 7, xy, offsets, build);
    cache.get('s', 'geometry', 7, xy, Uint32Array.from([0, 1, 3]), build);
    cache.get('other', 'geometry', 7, xy, offsets, build);
    expect(build).toHaveBeenCalledTimes(4);
    cache.retain(new Set(['other']));
    expect(cache.stats.entries).toBe(1);
    cache.clear();
    expect(cache.stats.bytes).toBe(0);
  });
  it('does not detach cached feature buffers when GPU packets are transferred', () => {
    const cache = new FeatureGeometryCache();
    const packet: GeometryPacket = {
      kind: 'fill',
      sourceId: 's',
      cacheKey: 'original',
      featureIds: Int32Array.from([5]),
      coordinates: Float64Array.from([0, 0, 3, 0, 3, 3, 0, 3, 0, 0]),
      offsets: Uint32Array.from([0, 5]),
      features: Uint32Array.from([0, 1]),
    };
    const first = buildGeometryPacket(packet, cache);
    const transferred = structuredClone(first, { transfer: collectTransferables(first) });
    expect(transferred.geometries[0].count).toBe(6);
    expect(buildGeometryPacket(packet, cache).geometries[0].count).toBe(6);
    expect(cache.stats.hits).toBe(1);
    packet.coordinates[0] = 0.2;
    buildGeometryPacket(packet, cache);
    expect(cache.stats.misses).toBe(2);
  });
  it('bounds cached payloads and evicts least-recently-used entries', () => {
    const cache = new FeatureGeometryCache(2048, 2),
      xy = Float64Array.from([0, 0]),
      offsets = Uint32Array.from([0, 1]);
    for (let i = 0; i < 10; i++) cache.get('s', 'n', i, xy, offsets, geometry);
    expect(cache.stats.bytes).toBeLessThanOrEqual(2048);
    expect(cache.stats.entries).toBe(2);
    expect(cache.stats.evictions).toBe(8);
    cache.retain(new Set());
    expect(cache.stats.bytes).toBe(0);
  });
});

it('does not retain empty display triangulations at the expense of non-empty cached features', () => {
  const cache = new FeatureGeometryCache(1024, 1),
    xy = Float64Array.from([0, 0]),
    offsets = Uint32Array.from([0, 1]);
  cache.get('s', 'n', 1, xy, offsets, geometry);
  cache.get('s', 'n', 2, xy, offsets, () => ({
    kind: 'fill',
    vertices: new Float32Array(),
    indices: new Uint32Array(),
    count: 0,
  }));
  expect(cache.stats.entries).toBe(1);
  expect(cache.stats.evictions).toBe(0);
  cache.get('s', 'n', 1, xy, offsets, geometry);
  expect(cache.stats.hits).toBe(1);
  cache.clear();
});

it('keeps source/namespace identities isolated and updates LRU without reinserting the key', () => {
  const cache = new FeatureGeometryCache(16384, 3);
  const xy = Float64Array.from([0, 0]),
    offsets = Uint32Array.from([0, 1]);
  const first = cache.get('a', 'b:c', 1, xy, offsets, geometry);
  cache.get('a:b', 'c', 1, xy, offsets, geometry);
  cache.get('other', 'c', 1, xy, offsets, geometry);
  for (let i = 0; i < 1000; i++)
    expect(cache.get('a', 'b:c', 1, xy, offsets, geometry)).toBe(first);
  cache.get('last', 'c', 1, xy, offsets, geometry);
  expect(cache.stats.evictions).toBe(1);
  expect(cache.get('a', 'b:c', 1, xy, offsets, geometry)).toBe(first);
  cache.retain(new Set(['last']));
  expect(cache.stats.entries).toBe(1);
  cache.retain(new Set());
  expect(cache.stats.bytes).toBe(0);
  cache.get('last', 'c', 1, xy, offsets, geometry);
  expect(cache.stats.entries).toBe(1);
  cache.clear();
});
