// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createCanvasPainterHarness } from '../../test/utils/canvas-painter';
import type { ArcCollection, PathShape } from '../types/mapshaper-types';

describe('classified path arc cache', () => {
  it('does not revisit shapes on a warm draw, retains direction, and invalidates on revision', () => {
    const visited: number[] = [];
    const arcs: ArcCollection = {
      size: () => 3,
      getArcIter: (id) => {
        visited.push(id);
        let next = true;
        return {
          x: 0,
          y: 0,
          hasNext: () => {
            const result = next;
            next = false;
            return result;
          },
        };
      },
    };
    const context = { beginPath() {}, stroke() {}, moveTo() {}, lineTo() {}, setLineDash() {} };
    const { painter } = createCanvasPainterHarness(context);
    const first = vi.fn(() => [[~1, 0]]);
    const shapes: PathShape[] = [];
    Object.defineProperty(shapes, '0', { get: first, configurable: true });
    shapes[1] = [[1, 2]];
    const ids = new Uint32Array([0, 1]);
    painter.drawPaths(shapes, { width: 1, color: '#123456' }, arcs, undefined, ids, 0);
    expect(visited).toEqual([~1, 0, 2]);
    first.mockClear();
    visited.length = 0;
    painter.drawPaths(shapes, { width: 1, color: '#123456' }, arcs, (id) => id !== 0, ids, 0);
    expect(first).not.toHaveBeenCalled();
    expect(visited).toEqual([~1, 2]);
    painter.drawPaths(shapes, { width: 1, color: '#123456' }, arcs, undefined, ids, 1);
    expect(first).toHaveBeenCalled();
  });
});
