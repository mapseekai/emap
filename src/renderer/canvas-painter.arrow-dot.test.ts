import { describe, expect, it } from 'vitest';

(globalThis as any).window = { devicePixelRatio: 1 };

import { createCanvasPainterHarness } from '../../test/utils/canvas-painter';

type Segment = readonly [number, number, number, number];

function makePainter(width = 100, height = 100, pixelRatio = 1) {
  const segments: Segment[] = [];
  const strokes: number[] = [];
  let x = 0;
  let y = 0;
  const ctx: any = {
    canvas: { width, height },
    set strokeStyle(_value: string) {},
    set lineWidth(_value: number) {},
    set lineCap(_value: string) {},
    set lineJoin(_value: string) {},
    setLineDash() {},
    beginPath() {},
    moveTo(nx: number, ny: number) {
      x = nx;
      y = ny;
    },
    lineTo(nx: number, ny: number) {
      segments.push([x, y, nx, ny]);
      x = nx;
      y = ny;
    },
    stroke() {
      strokes.push(segments.length);
    },
    clearRect() {},
  };
  const { painter } = createCanvasPainterHarness(ctx, { width, height, pixelRatio });
  return { painter, segments, strokes };
}

function makeArcs(parts: readonly (readonly [number, number][])[]) {
  let iteratorCount = 0;
  return {
    size: () => parts.length,
    get iteratorCount() {
      return iteratorCount;
    },
    getVertexData: () => ({ nn: Uint32Array.from(parts.map((part) => part.length)) }),
    getArcIter(arcId: number) {
      iteratorCount += 1;
      const source = parts[arcId >= 0 ? arcId : ~arcId];
      const points = arcId >= 0 ? source : [...source].reverse();
      let index = -1;
      return {
        x: 0,
        y: 0,
        hasNext() {
          index += 1;
          if (index >= points.length) return false;
          this.x = points[index][0];
          this.y = points[index][1];
          return true;
        },
      };
    },
  };
}

const arrowStyle = {
  color: '#2463eb',
  width: 2,
  dashType: 'arrow-dot' as const,
  arrowSpacing: 20,
  arrowSize: 6,
};

function arrowWings(segments: readonly Segment[]): Segment[] {
  return segments.filter((segment) => Math.abs(segment[3] - segment[1]) > 0.01);
}

describe('CanvasPainter arrow-dot rendering', () => {
  it('follows positive and negative signed-arc direction', () => {
    const arcs = makeArcs([
      [
        [10, 50],
        [90, 50],
      ],
    ]);
    const forward = makePainter();
    forward.painter.drawArcs(arcs as any, arrowStyle, undefined, undefined, {
      shapes: [[[0]]],
      cacheKey: 'forward',
      geometryRevision: 0,
    });

    const reverse = makePainter();
    reverse.painter.drawArcs(arcs as any, arrowStyle, undefined, undefined, {
      shapes: [[[-1]]],
      cacheKey: 'reverse',
      geometryRevision: 0,
    });

    expect(arrowWings(forward.segments).every(([tipX, , tailX]) => tipX > tailX)).toBe(true);
    expect(arrowWings(reverse.segments).every(([tipX, , tailX]) => tipX < tailX)).toBe(true);
  });

  it('draws outer and inner polygon rings in each ring coordinate order', () => {
    const arcs = makeArcs([
      [
        [10, 10],
        [90, 10],
        [90, 90],
        [10, 90],
        [10, 10],
      ],
      [
        [35, 35],
        [35, 65],
        [65, 65],
        [65, 35],
        [35, 35],
      ],
    ]);
    const { painter, segments } = makePainter();

    painter.drawArcs(arcs as any, { ...arrowStyle, arrowSpacing: 16 }, undefined, undefined, {
      shapes: [[[0], [1]]],
      cacheKey: 'rings',
      geometryRevision: 0,
    });

    const wings = arrowWings(segments);
    expect(arcs.iteratorCount).toBe(2);
    expect(wings.some(([x1, , x2]) => x1 > x2)).toBe(true);
    expect(wings.some(([x1, , x2]) => x1 < x2)).toBe(true);
  });

  it('clips generated arrow tips to the visible backing canvas', () => {
    const arcs = makeArcs([
      [
        [-100, 50],
        [200, 50],
      ],
    ]);
    const { painter, segments } = makePainter(100, 100);

    painter.drawArcs(arcs as any, arrowStyle, undefined, undefined, {
      shapes: [[[0]]],
      cacheKey: 'clipped',
      geometryRevision: 0,
    });

    const tips = arrowWings(segments).map(([x, y]) => [x, y]);
    expect(tips.length).toBeGreaterThan(0);
    expect(tips.every(([x, y]) => x >= 0 && x <= 100 && y >= 0 && y <= 100)).toBe(true);
  });

  it('keeps arrow size in CSS pixels across zoom and high DPI', () => {
    const arcs = makeArcs([
      [
        [0, 40],
        [80, 40],
      ],
    ]);
    const { painter, segments } = makePainter(200, 100, 2);
    const options = { shapes: [[[0]]], cacheKey: 'hidpi', geometryRevision: 0 } as const;

    painter.drawArcs(arcs as any, arrowStyle, undefined, undefined, options as any);
    const firstWing = arrowWings(segments)[0];
    const firstLength = Math.hypot(firstWing[2] - firstWing[0], firstWing[3] - firstWing[1]);

    segments.length = 0;
    painter.setTransform({ mx: 2, my: 1, bx: 0, by: 0 } as any);
    painter.drawArcs(arcs as any, arrowStyle, undefined, undefined, options as any);
    const zoomedWing = arrowWings(segments)[0];
    const zoomedLength = Math.hypot(zoomedWing[2] - zoomedWing[0], zoomedWing[3] - zoomedWing[1]);

    expect(firstLength).toBeCloseTo(12, 5);
    expect(zoomedLength).toBeCloseTo(12, 5);
  });

  it('reuses generated commands until view, style, or geometry changes', () => {
    const arcs = makeArcs([
      [
        [10, 50],
        [90, 50],
      ],
    ]);
    const { painter } = makePainter();
    const options = { shapes: [[[0]]], cacheKey: 'cached', geometryRevision: 1 } as const;

    painter.drawArcs(arcs as any, arrowStyle, undefined, undefined, options as any);
    expect(arcs.iteratorCount).toBe(1);

    painter.drawArcs(arcs as any, { ...arrowStyle }, undefined, undefined, options as any);
    expect(arcs.iteratorCount).toBe(1);

    painter.setTransform({ mx: 2, my: 2, bx: 0, by: 0 } as any);
    painter.drawArcs(arcs as any, arrowStyle, undefined, undefined, options as any);
    expect(arcs.iteratorCount).toBe(2);

    painter.drawArcs(
      arcs as any,
      { ...arrowStyle, arrowSpacing: 24 },
      undefined,
      undefined,
      options as any,
    );
    expect(arcs.iteratorCount).toBe(3);

    painter.drawArcs(arcs as any, arrowStyle, undefined, undefined, {
      ...options,
      geometryRevision: 2,
    } as any);
    expect(arcs.iteratorCount).toBe(4);
  });
});
