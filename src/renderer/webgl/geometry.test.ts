import { describe, expect, it } from 'vitest';
import {
  buildArcLineGeometry,
  buildExpandedLineGeometry,
  buildPointGeometry,
  buildPolygonRingGeometry,
} from './geometry';

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

function makeArcs() {
  const arcPoints = [
    [[0, 0], [1, 0], [1, 1]],
    [[2, 2], [3, 2]],
  ] as Array<Array<[number, number]>>;

  return {
    size: () => arcPoints.length,
    getArcIter: (arcId: number) => makeArcIter(arcPoints[arcId >= 0 ? arcId : ~arcId]),
    getShapeIter: (part: number[]) => {
      const points: Array<[number, number]> = [];
      for (const arcId of part) {
        const arc = arcPoints[arcId >= 0 ? arcId : ~arcId];
        points.push(...(arcId >= 0 ? arc : [...arc].reverse()));
      }
      return makeArcIter(points);
    },
  };
}

describe('webgl geometry helpers', () => {
  it('builds line-list vertices from filtered arcs', () => {
    const geometry = buildArcLineGeometry(makeArcs() as any, i => i === 0);
    expect(Array.from(geometry.positions)).toEqual([
      0, 0, 1, 0,
      1, 0, 1, 1,
    ]);
    expect(geometry.vertexCount).toBe(4);
  });

  it('normalizes point shapes into positions', () => {
    const geometry = buildPointGeometry([[[4, 5], [6, 7]], [8, 9]]);
    expect(Array.from(geometry.positions)).toEqual([4, 5, 6, 7, 8, 9]);
    expect(geometry.vertexCount).toBe(3);
  });

  it('uses shape iterator so reversed polygon arcs are respected', () => {
    const geometry = buildPolygonRingGeometry([[[~0]]], makeArcs() as any);
    expect(Array.from(geometry.positions)).toEqual([1, 1, 1, 0, 0, 0]);
    expect(geometry.ringStarts).toEqual([0]);
    expect(geometry.ringCounts).toEqual([3]);
  });

  it('expands a segment into a screen-space quad for stable line width', () => {
    const geometry = buildExpandedLineGeometry(
      new Float32Array([0, 0, 10, 0]),
      4,
    );
    expect(geometry.vertexCount).toBe(6);
    expect(Array.from(geometry.positions)).toEqual([
      0, -2, 10, -2, 10, 2,
      0, -2, 10, 2, 0, 2,
    ]);
  });
});
