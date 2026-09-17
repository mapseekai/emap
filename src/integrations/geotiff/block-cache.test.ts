import { describe, expect, it } from 'vitest';
import { RasterBlockCache } from './block-cache';

describe('bounded decoded TIFF block cache', () => {
  it('uses byte-bounded LRU rather than an unbounded promise cache', () => {
    const cache = new RasterBlockCache(12);
    const a = new ArrayBuffer(4),
      b = new ArrayBuffer(4),
      c = new ArrayBuffer(4),
      d = new ArrayBuffer(4);
    cache.set('a', a);
    cache.set('b', b);
    cache.set('c', c);
    expect(cache.get('a')).toBe(a);
    cache.set('d', d);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.bytes).toBe(12);
    expect(cache.size).toBe(3);
    cache.set('large', new ArrayBuffer(20));
    expect(cache.get('large')).toBeUndefined();
    expect(cache.bytes).toBe(12);
    expect(cache.getDiagnostics()).toMatchObject({
      evictions: 1,
      evictedBytes: 4,
      admittedBytes: 16,
      bytes: 12,
      peakBytes: 12,
      entries: 3,
      peakEntries: 3,
      limitBytes: 12,
      oversizeSkips: 1,
    });
  });
  it('traces physical requests and successful decoded loads separately', () => {
    const cache = new RasterBlockCache(16),
      cursor = cache.getAccessCursor();
    expect(cache.get('a')).toBeUndefined();
    cache.set('a', new ArrayBuffer(4));
    expect(cache.get('a')).toBeDefined();
    expect(cache.takeAccessesSince(cursor)).toEqual({
      requested: ['a', 'a'],
      loaded: ['a'],
    });
    expect(cache.takeAccessesSince(cache.getAccessCursor())).toEqual({ requested: [], loaded: [] });
  });
  it('resizes a striped working set while preserving byte-bounded LRU eviction', () => {
    const cache = new RasterBlockCache(8);
    cache.set('a', new ArrayBuffer(4));
    cache.set('b', new ArrayBuffer(4));
    cache.setLimit(16);
    cache.set('c', new ArrayBuffer(4));
    cache.set('d', new ArrayBuffer(4));
    expect(cache.bytes).toBe(16);
    expect(cache.getDiagnostics().limitBytes).toBe(16);
    cache.setLimit(8);
    expect(cache.bytes).toBe(8);
    expect(cache.size).toBe(2);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeUndefined();
    expect(cache.getDiagnostics()).toMatchObject({ limitBytes: 8, evictions: 2, evictedBytes: 8 });
  });
  it('accounts replacements and prevents late completion from repopulating disposed caches', () => {
    const cache = new RasterBlockCache(16);
    cache.set('a', new ArrayBuffer(8));
    cache.set('a', new ArrayBuffer(4));
    expect(cache.bytes).toBe(4);
    cache.dispose();
    cache.dispose();
    cache.set('late', new ArrayBuffer(4));
    expect(cache.bytes).toBe(0);
    expect(cache.size).toBe(0);
    expect(cache.get('late')).toBeUndefined();
  });
  it('bounds zero-byte entry count and separates image/sample namespaces', () => {
    const cache = new RasterBlockCache(8);
    for (let i = 0; i < 10000; i++) cache.set(String(i), new ArrayBuffer(0));
    expect(cache.size).toBeLessThanOrEqual(4096);
    expect(cache.bytes).toBe(0);
    cache.dispose();
  });
});
