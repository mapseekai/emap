import { describe, expect, it } from 'vitest';
import { createCanvasPainterHarness } from '../../test/utils/canvas-painter';
import type { ArcCollection } from '../types/mapshaper-types';

(globalThis as unknown as { window: { devicePixelRatio: number } }).window = {
  devicePixelRatio: 1,
};

function harness() {
  const fills: number[] = [];
  let parts = 0;
  const { painter } = createCanvasPainterHarness({
    globalAlpha: 1,
    fillStyle: '',
    beginPath: () => {
      parts = 0;
    },
    moveTo: () => {
      parts++;
    },
    lineTo: () => {},
    fill: () => fills.push(parts),
  });
  const arcs = {
    size: () => 3,
    getVertexData: () => ({ nn: new Uint32Array([5, 5, 5]) }),
    getShapeIter(part: number[]) {
      const offset = part[0] === 1 ? 10 : part[0] === 2 ? 3 : 0;
      const coords = [
        [offset, offset],
        [offset + 20, offset],
        [offset + 20, offset + 20],
        [offset, offset + 20],
        [offset, offset],
      ];
      let i = -1;
      return {
        hasNext: () => ++i < coords.length,
        get x() {
          return coords[i][0];
        },
        get y() {
          return coords[i][1];
        },
      };
    },
  } as unknown as ArcCollection;
  return { painter, arcs, fills };
}

describe('polygon fills isolate independent features', () => {
  it('overlapping features never share an evenodd path', () => {
    const { painter, arcs, fills } = harness();
    painter.drawPolygonFill([[[0]], [[1]]], arcs, '#333');
    expect(fills).toEqual([1, 1]);
  });
  it('keeps a feature shell and hole in the same path', () => {
    const { painter, arcs, fills } = harness();
    painter.drawPolygonFill([[[0], [2]], [[1]]], arcs, '#333');
    expect(fills).toEqual([2, 1]);
  });
  it('does not change parity at the old 100-feature batch boundary', () => {
    const { painter, arcs, fills } = harness();
    painter.drawPolygonFill(
      Array.from({ length: 101 }, () => [[0]]),
      arcs,
      '#333',
      undefined,
      0.5,
    );
    expect(fills).toHaveLength(101);
    expect(fills.every((n) => n === 1)).toBe(true);
  });
  it('also isolates overlapping features in a style bucket', () => {
    const { painter, arcs, fills } = harness();
    painter.drawPolygonFill([[[0]], [[1]]], arcs, '#333', undefined, 0.5, {
      styleBuckets: { buckets: [new Uint32Array([0, 1])], colors: ['#333'] },
    });
    expect(fills).toEqual([1, 1]);
  });
});
