import { describe, expect, it } from 'vitest';
import {
  buildArcLineGeometry,
  buildArcSegmentGeometry,
  filterArcSegmentGeometry,
  buildExpandedLineGeometry,
  buildPointQuadGeometry,
  buildPointGeometry,
  buildPolygonRingGeometry,
  buildPolygonTessellatedGeometry,
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

function makeSquareArcs() {
  const points: Array<[number, number]> = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];
  return {
    getShapeIter: () => makeArcIter(points),
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

  it('builds PathLayer-style segment attributes from arcs', () => {
    const geometry = buildArcSegmentGeometry(makeArcs() as any, i => i === 0);

    expect(geometry.segmentCount).toBe(2);
    expect(Array.from(geometry.leftPositions)).toEqual([
      0, 0,
      0, 0,
    ]);
    expect(Array.from(geometry.startPositions)).toEqual([
      0, 0,
      1, 0,
    ]);
    expect(Array.from(geometry.endPositions)).toEqual([
      1, 0,
      1, 1,
    ]);
    expect(Array.from(geometry.rightPositions)).toEqual([
      1, 1,
      1, 1,
    ]);
    expect(Array.from(geometry.segmentTypes)).toEqual([1, 2]);
    expect(Array.from(geometry.arcIds)).toEqual([0, 0]);
    expect(Array.from(geometry.arcSegmentStarts)).toEqual([0, 2]);
    expect(Array.from(geometry.arcSegmentCounts)).toEqual([2, 0]);
  });

  it('filters PathLayer-style segment attributes without re-reading arcs', () => {
    const base = buildArcSegmentGeometry(makeArcs() as any);
    const geometry = filterArcSegmentGeometry(base, i => i === 1);

    expect(geometry.segmentCount).toBe(1);
    expect(Array.from(geometry.startPositions)).toEqual([2, 2]);
    expect(Array.from(geometry.endPositions)).toEqual([3, 2]);
    expect(Array.from(geometry.arcIds)).toEqual([1]);
    expect(Array.from(geometry.arcSegmentStarts)).toEqual([0, 0]);
    expect(Array.from(geometry.arcSegmentCounts)).toEqual([0, 1]);
  });

  it('normalizes point shapes into positions', () => {
    const geometry = buildPointGeometry([[[4, 5], [6, 7]], [8, 9]]);
    expect(Array.from(geometry.positions)).toEqual([4, 5, 6, 7, 8, 9]);
    expect(geometry.vertexCount).toBe(3);
  });

  it('rebases generated coordinates around a local origin before Float32 upload', () => {
    const origin: [number, number] = [1_000_000, 2_000_000];
    const points = buildPointGeometry([[[1_000_000.25, 2_000_000.5]]], origin);
    const segments = buildArcSegmentGeometry({
      size: () => 1,
      getArcIter: () => makeArcIter([
        [1_000_000.25, 2_000_000.5],
        [1_000_001.25, 2_000_002.5],
      ]),
    } as any, undefined, origin);
    const polygon = buildPolygonTessellatedGeometry([[[0]]], {
      getShapeIter: () => makeArcIter([
        [1_000_000, 2_000_000],
        [1_000_010, 2_000_000],
        [1_000_010, 2_000_010],
        [1_000_000, 2_000_010],
      ]),
    } as any, undefined, origin);

    expect(Array.from(points.positions)).toEqual([0.25, 0.5]);
    expect(Array.from(segments.startPositions)).toEqual([0.25, 0.5]);
    expect(Array.from(segments.endPositions)).toEqual([1.25, 2.5]);
    expect(Math.max(...Array.from(polygon.positions).map(Math.abs))).toBe(10);
  });

  it('builds the unit quad used for instanced point circles', () => {
    const geometry = buildPointQuadGeometry();
    expect(Array.from(geometry.positions)).toEqual([
      -1, -1,
      1, -1,
      -1, 1,
      1, 1,
    ]);
    expect(geometry.vertexCount).toBe(4);
  });

  it('uses shape iterator so reversed polygon arcs are respected', () => {
    const geometry = buildPolygonRingGeometry([[[~0]]], makeArcs() as any);
    expect(Array.from(geometry.positions)).toEqual([1, 1, 1, 0, 0, 0]);
    expect(geometry.ringStarts).toEqual([0]);
    expect(geometry.ringCounts).toEqual([3]);
  });

  it('tessellates polygon rings into SolidPolygonLayer-style indexed triangles', () => {
    const geometry = buildPolygonTessellatedGeometry([[[0]]], makeSquareArcs() as any);

    expect(Array.from(geometry.positions)).toEqual([
      0, 0,
      0, 10,
      10, 10,
      10, 0,
      0, 0,
    ]);
    expect(Array.from(geometry.indices)).toHaveLength(6);
    expect(geometry.vertexCount).toBe(6);
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

  it('converts screen-space line width back through the active transform', () => {
    const geometry = buildExpandedLineGeometry(
      new Float32Array([0, 0, 10, 0]),
      4,
      { mx: 10, my: -10 },
    );
    const expected = [
      0, 0.2, 10, 0.2, 10, -0.2,
      0, 0.2, 10, -0.2, 0, -0.2,
    ];
    expect(geometry.vertexCount).toBe(6);
    Array.from(geometry.positions).forEach((value, i) => {
      expect(value).toBeCloseTo(expected[i]);
    });
  });
});
