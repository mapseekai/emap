import { describe, expect, it } from 'vitest';

(globalThis as any).window = { devicePixelRatio: 1 };

import { CanvasPainter } from './canvas-painter';
import type { PointMarkerShape, PointShape } from '../types/mapshaper-types';

function makePainter(strokeCalls: string[], dashCalls: number[][] = []) {
  const ctx: any = {
    canvas: { width: 100, height: 100 },
    set strokeStyle(_v: string) {},
    set lineWidth(_v: number) {},
    set lineCap(_v: string) {},
    set lineJoin(_v: string) {},
    setLineDash(values: number[]) {
      dashCalls.push(values);
    },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {
      strokeCalls.push('stroke');
    },
    clearRect() {},
  };
  const canvas = { getContext: () => ctx, width: 100, height: 100, style: {} };
  const painter = new CanvasPainter(canvas as any);
  (painter as any)._transform = { mx: 1, my: 1, bx: 0, by: 0 };
  (painter as any)._pixelRatio = 1;
  return painter;
}

function makeArcs(size: number) {
  return {
    size: () => size,
    getArcIter: (_i: number) => {
      let done = false;
      return {
        x: 0,
        y: 0,
        hasNext() {
          if (done) return false;
          done = true;
          return true;
        },
      };
    },
  };
}

function makeVertexCountArcs(vertexCounts: number[]) {
  return {
    size: () => vertexCounts.length,
    getVertexData: () => ({ nn: Uint32Array.from(vertexCounts) }),
    getArcIter: (_i: number) => {
      let done = false;
      return {
        x: 0,
        y: 0,
        hasNext() {
          if (done) return false;
          done = true;
          return true;
        },
      };
    },
  };
}

function makeCountingArcs(visited: number[]) {
  return {
    getArcIter: (i: number) => {
      visited.push(i);
      let done = false;
      return {
        x: i,
        y: i,
        hasNext() {
          if (done) return false;
          done = true;
          return true;
        },
      };
    },
  };
}

function makePointPainter(
  fillCalls: string[],
  arcCalls: unknown[] = [],
  pathCalls: string[] = [],
  vertexCalls: unknown[][] = [],
) {
  const ctx: any = {
    canvas: { width: 100, height: 100 },
    set strokeStyle(_v: string) {},
    set fillStyle(_v: string) {},
    beginPath() {},
    moveTo(...args: unknown[]) {
      pathCalls.push('moveTo');
      vertexCalls.push(args);
    },
    lineTo(...args: unknown[]) {
      pathCalls.push('lineTo');
      vertexCalls.push(args);
    },
    rect() {
      pathCalls.push('rect');
    },
    closePath() {
      pathCalls.push('closePath');
    },
    arc(...args: unknown[]) {
      arcCalls.push(args);
      pathCalls.push('arc');
    },
    fill() {
      fillCalls.push('fill');
    },
    stroke() {},
  };
  const canvas = { getContext: () => ctx, width: 100, height: 100, style: {} };
  const painter = new CanvasPainter(canvas as any);
  (painter as any)._transform = { mx: 1, my: 1, bx: 0, by: 0 };
  (painter as any)._pixelRatio = 1;
  return painter;
}

describe('CanvasPainter batching', () => {
  it('requests the GPU-friendly default 2d context', () => {
    const calls: unknown[][] = [];
    const ctx: any = {};
    const canvas = {
      getContext(...args: unknown[]) {
        calls.push(args);
        return ctx;
      },
      width: 100,
      height: 100,
      style: {},
    };

    new CanvasPainter(canvas as any);

    expect(calls).toEqual([['2d']]);
  });

  it('flushes drawArcs every 100 arcs plus a final stroke', () => {
    const strokes: string[] = [];
    const painter = makePainter(strokes);

    painter.drawArcs(makeArcs(250) as any, { color: '#333', width: 1 });

    expect(strokes).toHaveLength(3);
  });

  it('flushes drawArcs when the vertex budget would be exceeded', () => {
    const strokes: string[] = [];
    const painter = makePainter(strokes);

    painter.drawArcs(makeVertexCountArcs([8000, 5000, 2000]) as any, {
      color: '#333',
      width: 1,
    });

    expect(strokes).toHaveLength(2);
  });

  it('applies and clears device-pixel-scaled line dashes', () => {
    const strokes: string[] = [];
    const dashes: number[][] = [];
    const painter = makePainter(strokes, dashes);
    (painter as any)._pixelRatio = 2;

    painter.drawArcs(makeArcs(1) as any, { color: '#333', width: 1, dash: [8, 4] });
    painter.drawArcs(makeArcs(1) as any, { color: '#333', width: 1 });

    expect(dashes).toEqual([[16, 8], []]);
  });

  it('applies line dashes when drawing selected paths', () => {
    const dashes: number[][] = [];
    const painter = makePainter([], dashes);

    painter.drawPaths(
      [[[0]]] as any,
      { color: '#333', width: 1, dash: [6, 3] },
      makeArcs(1) as any,
    );

    expect(dashes).toEqual([[6, 3]]);
  });

  it('flushes drawPoints every 100 points plus a final fill', () => {
    const fills: string[] = [];
    const painter = makePointPainter(fills);
    const shapes = Array.from({ length: 250 }, (_, i) => [[i % 50, i % 50]]);

    painter.drawPoints(shapes as any, { color: '#333', radius: 4, fill: true });

    // flush at 100 and 200, plus the final fill after the loop
    expect(fills).toHaveLength(3);
  });

  it('culls points outside the backing canvas', () => {
    const fills: string[] = [];
    const arcs: unknown[] = [];
    const painter = makePointPainter(fills, arcs);

    painter.drawPoints([[[10, 10]], [[500, 500]]] as any, { color: '#333', radius: 4, fill: true });

    expect(arcs).toHaveLength(1);
  });

  it.each([
    ['circle', ['moveTo', 'arc']],
    ['square', ['rect']],
    ['triangle', ['moveTo', 'lineTo', 'lineTo', 'closePath']],
    ['triangle-down', ['moveTo', 'lineTo', 'lineTo', 'closePath']],
    ['diamond', ['moveTo', 'lineTo', 'lineTo', 'lineTo', 'closePath']],
    ['pentagon', ['moveTo', 'lineTo', 'lineTo', 'lineTo', 'lineTo', 'closePath']],
    [
      'star',
      [
        'moveTo',
        'lineTo',
        'lineTo',
        'lineTo',
        'lineTo',
        'lineTo',
        'lineTo',
        'lineTo',
        'lineTo',
        'lineTo',
        'closePath',
      ],
    ],
    [
      'cross',
      [
        'moveTo',
        'lineTo',
        'lineTo',
        'lineTo',
        'lineTo',
        'lineTo',
        'lineTo',
        'lineTo',
        'lineTo',
        'lineTo',
        'lineTo',
        'lineTo',
        'closePath',
      ],
    ],
    [
      'x',
      [
        'moveTo',
        'lineTo',
        'lineTo',
        'lineTo',
        'lineTo',
        'lineTo',
        'lineTo',
        'lineTo',
        'lineTo',
        'lineTo',
        'lineTo',
        'lineTo',
        'closePath',
      ],
    ],
    ['hexagon', ['moveTo', 'lineTo', 'lineTo', 'lineTo', 'lineTo', 'lineTo', 'closePath']],
    [
      'octagon',
      ['moveTo', 'lineTo', 'lineTo', 'lineTo', 'lineTo', 'lineTo', 'lineTo', 'lineTo', 'closePath'],
    ],
  ] satisfies ReadonlyArray<
    readonly [PointMarkerShape, readonly string[]]
  >)('draws the %s point marker path', (shape, expectedCalls) => {
    const fills: string[] = [];
    const pathCalls: string[] = [];
    const painter = makePointPainter(fills, [], pathCalls);
    const shapes: PointShape[] = [[[10, 10]]];

    painter.drawPoints(shapes, { color: '#333', radius: 4, fill: true, shape });

    expect(pathCalls).toEqual(expectedCalls);
    expect(fills).toEqual(['fill']);
  });

  it('orients triangle-down toward the bottom of the canvas', () => {
    const fills: string[] = [];
    const vertexCalls: unknown[][] = [];
    const painter = makePointPainter(fills, [], [], vertexCalls);
    const shapes: PointShape[] = [[[10, 10]]];

    painter.drawPoints(shapes, {
      color: '#333',
      radius: 4,
      fill: true,
      shape: 'triangle-down',
    });

    expect(vertexCalls[0]).toEqual([10, 14]);
  });

  it('skips vertex-dot arcs rejected by the edit viewport filter', () => {
    const fills: string[] = [];
    const visited: number[] = [];
    const painter = makePointPainter(fills);

    painter.drawVertexDots([[[0, 1, 2]]] as any, makeCountingArcs(visited) as any, {
      arcFilter: (arcId) => arcId === 1,
    });

    expect(visited).toEqual([1]);
    expect(fills).toHaveLength(1);
  });

  it('does not add offscreen vertex dots to the canvas path', () => {
    const fills: string[] = [];
    const arcCalls: unknown[] = [];
    const painter = makePointPainter(fills, arcCalls);
    const arcs = {
      getArcIter: () => {
        const points = [
          [-10, 10],
          [20, 20],
          [110, 20],
        ];
        let idx = -1;
        return {
          x: 0,
          y: 0,
          hasNext() {
            idx += 1;
            if (idx >= points.length) return false;
            this.x = points[idx][0];
            this.y = points[idx][1];
            return true;
          },
        };
      },
    };

    painter.drawVertexDots([[[0]]] as any, arcs as any);

    expect(arcCalls).toHaveLength(1);
  });
});
