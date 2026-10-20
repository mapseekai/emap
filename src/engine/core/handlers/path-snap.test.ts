import { describe, expect, it, vi } from 'vitest';
import type { ArcCollection, ArcVertexData } from '../../../shared/types/mapshaper-types';
import { collectPathShapeArcIds, findPathSnapTarget } from './path-snap';

describe('path snapping geometry', () => {
  it('collects shared forward and reversed arc IDs once in first-seen order', () => {
    const vertexData: ArcVertexData = {
      xx: new Float64Array([0, 10, 20, 30]),
      yy: new Float64Array([0, 0, 0, 0]),
      nn: new Uint32Array([2, 2]),
      ii: new Uint32Array([0, 2]),
      zz: null,
    };
    const ids = new Set<number>();
    expect(
      collectPathShapeArcIds(
        [
          [-2, 0],
          [1, -1],
        ],
        0,
        1,
        vertexData,
        ids,
      ),
    ).toBe(true);
    expect([...ids]).toEqual([1, 0]);
  });

  it('culls remote vertices and segments but keeps an edge crossing the bbox', () => {
    const vertexData: ArcVertexData = {
      xx: new Float64Array([-10, 10, 30, 40]),
      yy: new Float64Array([0, 0, 30, 40]),
      nn: new Uint32Array([2, 2]),
      ii: new Uint32Array([0, 2]),
      zz: null,
    };
    const forEachArcSegment = vi.fn(
      (id: number, callback: (i: number, j: number, xx: Float64Array, yy: Float64Array) => void) =>
        callback(id * 2, id * 2 + 1, vertexData.xx, vertexData.yy),
    );
    const arcs = { forEachArcSegment } as unknown as ArcCollection;
    // Reversed x axis verifies bbox normalization; scaling distinguishes world and pixel distance.
    const map = {
      project: vi.fn((x: number, y: number): [number, number] => [100 - 2 * x, 200 + 2 * y]),
      unproject: vi.fn((x: number, y: number): [number, number] => [(100 - x) / 2, (y - 200) / 2]),
    };

    expect(findPathSnapTarget(map, 100, 202, 5, { arcs, vertexData, arcIds: [0, 1] })).toEqual({
      coord: [0, 0],
      kind: 'edge',
    });
    expect(map.project.mock.calls).toEqual([
      [-10, 0],
      [10, 0],
    ]);
    expect(map.unproject.mock.calls).toEqual([
      [95, 197],
      [105, 207],
      [100, 200],
    ]);
    expect(forEachArcSegment.mock.calls.map(([id]) => id)).toEqual([0, 1]);
  });
});
