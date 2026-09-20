import { describe, expect, it } from 'vitest';
import type { ArcCollection, PointMarkerShape } from '../../../shared/types/mapshaper-types';
import {
  arcIdsFromShapes,
  lineGeometry,
  markerVertices,
  packPosition,
  pointGeometry,
  pointsFromShapes,
  polygonGeometry,
  readPart,
  triangulateRings,
  type Point,
  type Shapes,
} from './geometry';
const square = (x: number, y: number, size: number): Point[] => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
  [x, y],
];
function area(mesh: ReturnType<typeof triangulateRings>): number {
  let total = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.positions[mesh.indices[i]],
      b = mesh.positions[mesh.indices[i + 1]],
      c = mesh.positions[mesh.indices[i + 2]];
    total += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
  }
  return total;
}
function arcs(paths: Point[][]): ArcCollection {
  return {
    size: () => paths.length,
    getArcIter(id) {
      const points = id < 0 ? [...paths[~id]].reverse() : paths[id];
      let offset = 0;
      return {
        x: 0,
        y: 0,
        hasNext() {
          if (offset >= points.length) return false;
          [this.x, this.y] = points[offset++];
          return true;
        },
      };
    },
  };
}
describe('mapshaper GPU geometry', () => {
  it('packs high/low coordinates without losing projected sub-metre detail', () => {
    const packed: number[] = [];
    packPosition(packed, 20037508.123456, -19999999.987654);
    const data = Float32Array.from(packed);
    expect(data[0] + data[2]).toBeCloseTo(20037508.123456, 6);
    expect(data[1] + data[3]).toBeCloseTo(-19999999.987654, 6);
  });
  it('traverses reversed arcs and removes only shared junction duplicates', () => {
    const source = arcs([
      [
        [0, 0],
        [1, 0],
      ],
      [
        [2, 0],
        [1, 0],
      ],
    ]);
    expect(readPart(source, [0, ~1])).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
    expect(readPart(source, [~0])).toEqual([
      [1, 0],
      [0, 0],
    ]);
  });
  it('deduplicates shared topology without changing source shape indices', () => {
    const shapes = [[[0, 1]], [[~1, 2]], null];
    expect([...arcIdsFromShapes(shapes)]).toEqual([0, 1, 2]);
    expect([...arcIdsFromShapes(shapes, new Uint32Array([1]))]).toEqual([~1, 2]);
    expect(shapes[2]).toBeNull();
  });
  it('supports legacy points, multipart selection and deleted features', () => {
    const shapes: Shapes = [
      [3, 4],
      null,
      [
        [5, 6],
        [7, 8],
      ],
    ];
    expect(pointsFromShapes(shapes).count).toBe(3);
    const selected = pointsFromShapes(shapes, new Uint32Array([2]), new Uint32Array([1]));
    expect([...selected.vertices]).toEqual([7, 8, 0, 0]);
    expect(
      pointGeometry([
        [NaN, 0],
        [1, 2],
        [Infinity, 4],
      ]).count,
    ).toBe(1);
  });
  it('retains signed-distance offsets across adjacent line segments', () => {
    const mesh = lineGeometry([
      [
        [0, 0],
        [3, 0],
        [3, 4],
        [3, 4],
      ],
    ]);
    expect(mesh.count).toBe(2);
    expect(mesh.vertices[8] + mesh.vertices[9]).toBe(0);
    expect(mesh.vertices[18] + mesh.vertices[19]).toBe(3);
  });
  it('triangulates holes irrespective of ring order or winding', () => {
    const shell = square(0, 0, 10),
      hole = square(2, 2, 6);
    expect(area(triangulateRings([shell, hole]))).toBeCloseTo(64);
    expect(area(triangulateRings([[...hole].reverse(), [...shell].reverse()]))).toBeCloseTo(64);
  });
  it('preserves nested islands and disjoint polygon parts', () => {
    expect(
      area(triangulateRings([square(2, 2, 6), square(4, 4, 2), square(0, 0, 10)])),
    ).toBeCloseTo(68);
    expect(area(triangulateRings([square(0, 0, 10), square(20, 0, 5)]))).toBeCloseTo(125);
  });
  it('keeps independent overlapping features separate for source-over blending', () => {
    const mesh = polygonGeometry([[square(0, 0, 10)], [square(5, 0, 10)]]);
    expect(mesh.indices).toBeInstanceOf(Uint32Array);
    expect(mesh.count).toBe(12);
    expect(mesh.vertices.length / 4).toBe(10);
  });
  it('handles empty and degenerate rings', () => {
    expect(triangulateRings([])).toEqual({ positions: [], indices: [] });
    expect(
      polygonGeometry([
        [
          [
            [0, 0],
            [1, 0],
            [2, 0],
          ],
        ],
      ]).count,
    ).toBe(0);
  });
  it('provides all eleven marker outlines within the shader vertex budget', () => {
    const shapes: PointMarkerShape[] = [
      'circle',
      'square',
      'triangle',
      'triangle-down',
      'diamond',
      'pentagon',
      'star',
      'cross',
      'x',
      'hexagon',
      'octagon',
    ];
    for (const shape of shapes) {
      const outline = markerVertices(shape);
      expect(outline.length).toBeLessThanOrEqual(24);
      expect(outline.every(Number.isFinite)).toBe(true);
      expect(markerVertices(shape)).toBe(outline);
    }
  });
});
