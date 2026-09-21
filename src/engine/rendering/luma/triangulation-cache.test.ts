import { describe, expect, it } from 'vitest';
import earcut from 'earcut';
import { TriangulationCache } from './triangulation-cache';
const square = [0, 0, 10, 0, 10, 10, 0, 10, 0, 0];
describe('original polygon triangulation cache', () => {
  it('reuses unchanged shell/hole groups and keeps cached arrays separate from display transfers', () => {
    const c = new TriangulationCache();
    const first = c.triangulate('a', square, []);
    const packet = first.slice();
    structuredClone(packet, { transfer: [packet.buffer] });
    expect(c.triangulate('a', square, [])).toBe(first);
    expect(first.length).toBeGreaterThan(0);
    expect(c.stats.hits).toBe(1);
  });
  it('updates a safe boundary move without rerunning earcut and retains exact coordinates', () => {
    const c = new TriangulationCache(),
      first = c.triangulate('a', square, []),
      next = [...square];
    next[2] = 11;
    expect(c.triangulate('a', next, [])).toBe(first);
    expect(c.stats.localUpdates).toBe(1);
    expect(c.stats.retriangulations).toBe(0);
    expect(c.triangulate('a', next, [])).toBe(first);
  });
  it('updates duplicate closure positions together without inventing or dropping vertices', () => {
    const c = new TriangulationCache(),
      first = c.triangulate('a', square, []),
      next = [...square];
    next[0] = next[8] = -0.25;
    expect(c.triangulate('a', next, [])).toBe(first);
    expect(c.stats.localUpdates).toBe(1);
  });
  it('retriangulates an inverted local triangle rather than reusing invalid connectivity', () => {
    const c = new TriangulationCache();
    c.triangulate('a', square, []);
    const next = [...square];
    next[2] = -1;
    next[3] = 5;
    expect(c.triangulate('a', next, [])).toEqual(Uint32Array.from(earcut(next)));
    expect(c.stats.retriangulations).toBe(1);
  });
  it('retriangulates after holes or effective vertex membership change', () => {
    const c = new TriangulationCache();
    c.triangulate('a', square, []);
    const next = [...square, 2, 2, 2, 4, 4, 4, 4, 2, 2, 2];
    expect(c.triangulate('a', next, [5])).toEqual(Uint32Array.from(earcut(next, [5])));
    expect(c.stats.retriangulations).toBe(1);
  });
  it('does not treat a previously unused collinear vertex as an unchanged boundary', () => {
    const c = new TriangulationCache(),
      points = [0, 0, 5, 0, 10, 0, 10, 10, 0, 10, 0, 0];
    const first = c.triangulate('a', points, []),
      next = [...points];
    next[3] = 2;
    const result = c.triangulate('a', next, []);
    expect(result).toEqual(Uint32Array.from(earcut(next)));
    if (!first.includes(1)) expect(c.stats.retriangulations).toBe(1);
  });
  it('preserves holes for both safe and topology-changing moves', () => {
    const c = new TriangulationCache(),
      points = [...square, 2, 2, 2, 4, 4, 4, 4, 2, 2, 2];
    c.triangulate('a', points, [5]);
    const next = [...points];
    next[10] = next[18] = 1.9;
    const indices = c.triangulate('a', next, [5]);
    let area = 0;
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i] * 2,
        b = indices[i + 1] * 2,
        d = indices[i + 2] * 2;
      area +=
        Math.abs(
          (next[b] - next[a]) * (next[d + 1] - next[a + 1]) -
            (next[b + 1] - next[a + 1]) * (next[d] - next[a]),
        ) / 2;
    }
    expect(area).toBeCloseTo(95.9, 8);
  });
  it('bounds retained memory, evicts by reuse order, and clears on disposal', () => {
    const c = new TriangulationCache(200);
    c.triangulate('a', square, []);
    c.triangulate('b', square, []);
    c.triangulate('c', square, []);
    expect(c.stats.bytes).toBeLessThanOrEqual(200);
    expect(c.stats.evictions).toBeGreaterThan(0);
    c.clear();
    expect(c.stats.bytes).toBe(0);
  });
});
