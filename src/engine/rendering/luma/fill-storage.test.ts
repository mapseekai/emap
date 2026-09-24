import { describe, expect, it } from 'vitest';
import { compactFillStorage, fillStorageBounds } from './fill-storage';
import { buildFillRanges } from './fill-ranges';
import type { GeometryBuffer } from '../../../integrations/luma/types';

describe('bounded viewport fill uploads', () => {
  it('uses stable expanded coverage and keeps a whole-source cache when possible', () => {
    const source = [-10, -10, 10, 10] as const;
    expect(fillStorageBounds([0.2, 0.2, 1.2, 1.2], source)).toEqual(
      fillStorageBounds([0.201, 0.201, 1.201, 1.201], source),
    );
    const covered = fillStorageBounds([0.2, 0.2, 1.2, 1.2], source)!;
    expect(covered[0]).toBeLessThanOrEqual(0.2);
    expect(covered[2]).toBeGreaterThanOrEqual(1.2);
    expect(covered[2] - covered[0]).toBeLessThan(1.07);
    expect(fillStorageBounds([-11, -11, 11, 11], source)).toBeUndefined();
    expect(() => fillStorageBounds([0, 0, Infinity, 1], source)).toThrow('bounds');
  });
  it('compacts only offscreen complete triangles and retains triangles covering the viewport', () => {
    const positions = [0, 0, 1, 0, 0, 1, 100, 100, 101, 100, 100, 101, -10, -10, 10, -10, 0, 10];
    const vertices = new Float32Array(positions.length * 2);
    for (let i = 0; i < positions.length / 2; i++)
      vertices.set([positions[i * 2], positions[i * 2 + 1], 0, 0], i * 4);
    const g: GeometryBuffer = {
      kind: 'fill',
      vertices,
      indices: Uint32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8]),
      count: 9,
    };
    g.fillRanges = buildFillRanges(g, 3);
    const before = vertices.slice(),
      indexBefore = g.indices!.slice();
    const out = compactFillStorage(g, [-1, -1, 2, 2])!;
    expect(out.count).toBe(6);
    expect([...out.indices!]).toEqual([0, 1, 2, 3, 4, 5]);
    expect(out.vertices).toEqual(
      Float32Array.from([...vertices.slice(0, 12), ...vertices.slice(24)]),
    );
    expect(g.vertices).toEqual(before);
    expect(g.indices).toEqual(indexBefore);
    expect(compactFillStorage(g, [500, 500, 501, 501])).toBeNull();
    expect(compactFillStorage(g, [-1000, -1000, 1000, 1000])).toBe(g);
  });
});
