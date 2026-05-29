import { describe, expect, it, vi } from 'vitest';

vi.mock('earcut', () => ({
  default: vi.fn(() => [0, 1, 2]),
}));

import { buildPolygonTessellatedGeometry } from './geometry';

function makeArcIter(points: Array<[number, number]>) {
  let i = -1;
  return {
    x: 0,
    y: 0,
    hasNext() {
      i++;
      const p = points[i];
      if (!p) return false;
      this.x = p[0];
      this.y = p[1];
      return true;
    },
  };
}

function makeLargeSquareArcs(vertexCount: number) {
  const points: Array<[number, number]> = [];
  const side = Math.max(1, Math.floor(vertexCount / 4));
  for (let i = 0; i < side; i++) points.push([i, 0]);
  for (let i = 0; i < side; i++) points.push([side, i]);
  for (let i = 0; i < side; i++) points.push([side - i, side]);
  for (let i = 0; i < side; i++) points.push([0, side - i]);
  return {
    getShapeIter: () => makeArcIter(points),
  };
}

describe('buildPolygonTessellatedGeometry large rings', () => {
  it('appends large polygon coordinate arrays without spreading onto the call stack', () => {
    const geometry = buildPolygonTessellatedGeometry(
      [[[0]]],
      makeLargeSquareArcs(100_000) as any,
    );

    expect(geometry.positions.length).toBeGreaterThan(150_000);
    expect(Array.from(geometry.indices)).toEqual([0, 1, 2]);
  });
});
