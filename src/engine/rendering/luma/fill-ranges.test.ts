import { describe, expect, it } from 'vitest';
import { spatialFillGeometry, buildFillRanges, FillRangeIndex } from './fill-ranges';
import { AffineTransform } from '../../../domain/geo/transform';
import type { GeometryBuffer } from '../../../integrations/luma/types';
function grid(): GeometryBuffer {
  const vertices: number[] = [],
    indices: number[] = [];
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const first = vertices.length / 4;
      vertices.push(x, y, 0, 0, x + 0.8, y, 0, 0, x, y + 0.8, 0, 0);
      indices.push(first, first + 1, first + 2);
    }
  return {
    kind: 'fill',
    vertices: Float32Array.from(vertices),
    indices: Uint32Array.from(indices),
    count: indices.length,
  };
}
describe('immutable triangle visibility ranges', () => {
  it('keeps every triangle, culls deep views and does not rewrite GPU coordinates or indices on pan', () => {
    const source = grid(),
      mesh = spatialFillGeometry(source),
      ranges = new FillRangeIndex(buildFillRanges(mesh), mesh.count);
    expect([...mesh.indices!].sort((a, b) => a - b)).toEqual([...source.indices!]);
    expect(mesh.vertices).toBe(source.vertices);
    const all = ranges.select(new AffineTransform(1, 1, 0, 0), 100, 100);
    expect(all.ranges).toBeNull();
    expect(all.triangles).toBe(4096);
    const view = new AffineTransform(100, 100, -3000, -3000),
      near = ranges.select(view, 200, 200);
    expect(near.triangles).toBeGreaterThan(0);
    expect(near.triangles).toBeLessThan(4096 / 10);
    expect(ranges.select(view, 200, 200)).toBe(near);
    const seen = new Set<number>();
    for (const r of near.ranges!)
      for (let i = r.firstIndex; i < r.firstIndex + r.indexCount; i += 3)
        seen.add(mesh.indices![i]);
    expect(seen.has((31 * 64 + 31) * 3)).toBe(true);
    expect(ranges.select(new AffineTransform(1, 1, 1000, 1000), 100, 100).triangles).toBe(0);
  });
  it('retains a triangle that encloses the entire viewport even when all its vertices are offscreen', () => {
    const mesh: GeometryBuffer = {
      kind: 'fill',
      vertices: Float32Array.from([-100, -100, 0, 0, 100, -100, 0, 0, 0, 100, 0, 0]),
      indices: Uint32Array.from([0, 1, 2]),
      count: 3,
    };
    const index = new FillRangeIndex(buildFillRanges(mesh), 3);
    expect(index.select(new AffineTransform(10, -10, 50, 50), 100, 100).triangles).toBe(1);
    expect(() => new FillRangeIndex({ blockSize: 2, bounds: new Float64Array() }, 3)).toThrow();
  });
});
