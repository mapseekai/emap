import { describe, expect, it } from 'vitest';
import { slicePathMembers, selectPathMembers } from './path-members';
import { flatPathGeometry, flatScreenPathGeometry } from './flat-path';
import { compactStrokeParts } from './compact-stroke';
import { buildGeometryPacket, splitGeometry } from './geometry-packet';

const xy = Float64Array.from([0, 0, 1, 0, 1, 1, 0, 0, 2, 2, 3, 2, 3, 3, 2, 2]);
const offsets = Uint32Array.from([0, 4, 8]);

describe('shared path member ranges', () => {
  it('merges padding between enabled arcs but never crosses a disabled member', () => {
    const ranges = Uint32Array.from([0, 0, 3, 1, 6, 3, 2, 12, 3]),
      members = Int32Array.from([10, 11, 12]);
    expect(selectPathMembers(ranges, members, new Set([10, 11, 12]))).toEqual([
      { firstInstance: 0, count: 15 },
    ]);
    expect(selectPathMembers(ranges, members, new Set([10, 12]))).toEqual([
      { firstInstance: 0, count: 3 },
      { firstInstance: 12, count: 3 },
    ]);
  });

  it('tracks complete independent paths without changing GPU vertices or neighbors', () => {
    const raw = flatPathGeometry(xy, offsets),
      tracked = flatPathGeometry(xy, offsets, true);
    expect(tracked.vertices).toEqual(raw.vertices);
    expect(tracked.count).toBe(raw.count);
    expect([...tracked.memberRanges!]).toEqual([0, 0, 3, 1, 6, 3]);
    expect(
      selectPathMembers(tracked.memberRanges!, Int32Array.from([7, ~9]), new Set([9])),
    ).toEqual([{ firstInstance: 6, count: 3 }]);
  });
  it('intersects ownership and viewport ranges and never widens an empty selection', () => {
    const ranges = Uint32Array.from([0, 0, 5, 1, 8, 4]);
    const members = Int32Array.from([3, 4]);
    expect(
      selectPathMembers(ranges, members, new Set([3, 4]), [{ firstInstance: 2, count: 8 }]),
    ).toEqual([{ firstInstance: 2, count: 8 }]);
    expect(selectPathMembers(ranges, members, new Set([99]))).toEqual([]);
    expect(selectPathMembers(ranges, members, new Set([3]), [])).toEqual([]);
    expect([...slicePathMembers(ranges, 3, 7)]).toEqual([0, 0, 2, 1, 5, 2]);
  });
  it('preserves original member IDs through empty and half-pixel collapsed screen paths', () => {
    const positions = Float64Array.from([0, 0, 0.1, 0, 2, 2, 3, 2]);
    const screen = {
      view: [1, -1, 0, 0] as [number, number, number, number],
      width: 100,
      height: 100,
      pixelRatio: 1,
      initialScale: 0,
      smallArcs: false,
      halfPixel: true,
      cull: false,
      padding: 8,
      revision: 0,
    };
    const result = flatScreenPathGeometry(positions, Uint32Array.from([0, 0, 2, 4]), screen, true);
    expect([...result.geometry.memberRanges!].filter((_, i) => i % 3 === 0)).toEqual([1, 2]);
  });
  it('retains each owner after compact XY/precise separation', () => {
    const data = Float64Array.from(
      Array.from({ length: 20 }, (_, i) => [
        i + 0.1 * (i % 2),
        i + 0.2 * (i % 2),
        i + 1 + 0.1 * (i % 2),
        i + 0.2 * (i % 2),
      ]).flat(),
    );
    const geometry = flatPathGeometry(
      data,
      Uint32Array.from({ length: 21 }, (_, i) => i * 2),
      true,
    );
    const parts = compactStrokeParts(geometry, 10);
    expect(parts.length).toBe(2);
    const owners = parts
      .flatMap((p) => [...p.memberRanges!].filter((_, i) => i % 3 === 0))
      .sort((a, b) => a - b);
    expect(owners).toEqual(Array.from({ length: 20 }, (_, i) => i));
    for (const part of parts)
      expect([...part.memberRanges!].filter((_, i) => i % 3 === 2).reduce((a, b) => a + b, 0)).toBe(
        part.count,
      );
  });
  it('splits long paths at GPU allocation boundaries without losing owner coverage', () => {
    const data = Float64Array.from({ length: 140000 }, (_, i) => (i % 2 ? 0 : i / 2));
    const geometry = flatPathGeometry(data, Uint32Array.from([0, 70000]), true);
    const parts = splitGeometry(geometry);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.reduce((n, p) => n + p.memberRanges![2], 0)).toBe(69999);
    for (const p of parts)
      expect(p.memberRanges![1] + p.memberRanges![2]).toBeLessThanOrEqual(p.count);
  });
  it('the Worker result carries member ranges on raw path meshes', () => {
    const result = buildGeometryPacket({
      kind: 'path',
      coordinates: xy,
      offsets,
      features: Uint32Array.from([0, 1, 2]),
    });
    expect(result.geometries[0].memberRanges).toEqual(Uint32Array.from([0, 0, 3, 1, 6, 3]));
  });
});
