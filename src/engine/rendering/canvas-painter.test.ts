// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CanvasPainter } from './canvas-painter';
import type { MeasurementOverlayState } from './painter';
import { EMAP_THEME_COLORS, EMAP_THEME_FALLBACKS } from '../../ui/theme/colors';
import type {
  ArcCollection,
  PathShape,
  PointMarkerShape,
  PointShape,
} from '../../shared/types/mapshaper-types';
import { createCanvasPainterHarness } from '../../../test/utils/canvas-painter';

type Segment = readonly [number, number, number, number];

function makeArrowPainter(width = 100, height = 100, pixelRatio = 1) {
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

function makeArrowArcs(parts: readonly (readonly [number, number][])[]) {
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
    const arcs = makeArrowArcs([
      [
        [10, 50],
        [90, 50],
      ],
    ]);
    const forward = makeArrowPainter();
    forward.painter.drawArcs(arcs as any, arrowStyle, undefined, undefined, {
      shapes: [[[0]]],
      cacheKey: 'forward',
      geometryRevision: 0,
    });

    const reverse = makeArrowPainter();
    reverse.painter.drawArcs(arcs as any, arrowStyle, undefined, undefined, {
      shapes: [[[-1]]],
      cacheKey: 'reverse',
      geometryRevision: 0,
    });

    expect(arrowWings(forward.segments).every(([tipX, , tailX]) => tipX > tailX)).toBe(true);
    expect(arrowWings(reverse.segments).every(([tipX, , tailX]) => tipX < tailX)).toBe(true);
  });

  it('draws outer and inner polygon rings in each ring coordinate order', () => {
    const arcs = makeArrowArcs([
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
    const { painter, segments } = makeArrowPainter();

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
    const arcs = makeArrowArcs([
      [
        [-100, 50],
        [200, 50],
      ],
    ]);
    const { painter, segments } = makeArrowPainter(100, 100);

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
    const arcs = makeArrowArcs([
      [
        [0, 40],
        [80, 40],
      ],
    ]);
    const { painter, segments } = makeArrowPainter(200, 100, 2);
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
    const arcs = makeArrowArcs([
      [
        [10, 50],
        [90, 50],
      ],
    ]);
    const { painter } = makeArrowPainter();
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

  it('evicts arrow command entries by byte budget, not only entry count', () => {
    const arcs = makeArrowArcs([
      [
        [10, 50],
        [90, 50],
      ],
    ]);
    const { painter } = makeArrowPainter();
    const first = { shapes: [[[0]]], cacheKey: 'first', geometryRevision: 1 } as const;
    const second = { ...first, cacheKey: 'second' } as const;

    painter.drawArcs(arcs as any, arrowStyle, undefined, undefined, first as any);
    const oneEntryBytes = Reflect.get(painter, '_arrowDotCacheBytes') as number;
    expect(oneEntryBytes).toBeGreaterThan(0);
    Reflect.set(painter, '_arrowDotCacheByteLimit', oneEntryBytes);

    painter.drawArcs(arcs as any, arrowStyle, undefined, undefined, second as any);
    expect(arcs.iteratorCount).toBe(2);
    expect(Reflect.get(painter, '_arrowDotCacheBytes')).toBe(oneEntryBytes);

    painter.drawArcs(arcs as any, arrowStyle, undefined, undefined, first as any);
    expect(arcs.iteratorCount).toBe(3);
  });
});

function makeBatchPainter(strokeCalls: string[], dashCalls: number[][] = []) {
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
  return createCanvasPainterHarness(ctx).painter;
}

function makeBatchArcs(size: number) {
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

function makeCountingArcs(visited: number[], size = 4) {
  return {
    size: () => size,
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
  return createCanvasPainterHarness(ctx).painter;
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
    const painter = makeBatchPainter(strokes);

    painter.drawArcs(makeBatchArcs(250) as any, { color: '#333', width: 1 });

    expect(strokes).toHaveLength(3);
  });

  it('flushes drawArcs when the vertex budget would be exceeded', () => {
    const strokes: string[] = [];
    const painter = makeBatchPainter(strokes);

    painter.drawArcs(makeVertexCountArcs([8000, 5000, 2000]) as any, {
      color: '#333',
      width: 1,
    });

    expect(strokes).toHaveLength(2);
  });

  it('applies and clears device-pixel-scaled line dashes', () => {
    const strokes: string[] = [];
    const dashes: number[][] = [];
    const painter = makeBatchPainter(strokes, dashes);
    (painter as any)._pixelRatio = 2;

    painter.drawArcs(makeBatchArcs(1) as any, { color: '#333', width: 1, dash: [8, 4] });
    painter.drawArcs(makeBatchArcs(1) as any, { color: '#333', width: 1 });

    expect(dashes).toEqual([[16, 8], []]);
  });

  it('applies line dashes when drawing selected paths', () => {
    const dashes: number[][] = [];
    const painter = makeBatchPainter([], dashes);

    painter.drawPaths(
      [[[0]]] as any,
      { color: '#333', width: 1, dash: [6, 3] },
      makeBatchArcs(1) as any,
    );

    expect(dashes).toEqual([[6, 3]]);
  });

  it('drawPaths consumes feature indices directly, applies viewport culling, and deduplicates shared arcs', () => {
    const visited: number[] = [];
    const painter = makeBatchPainter([]);
    const arcs = makeCountingArcs(visited, 4);
    const shapes = [[[0, 1]], [[1, 2]], [[3]]] as any;

    painter.drawPaths(
      shapes,
      { color: '#333', width: 1 },
      arcs as any,
      (arcId) => arcId !== 2,
      Uint32Array.from([0, 1]),
    );

    expect(visited).toEqual([0, 1]);
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

  it('drawPoints consumes feature indices directly without scanning unrelated shapes', () => {
    const fills: string[] = [];
    const arcs: unknown[] = [];
    const painter = makePointPainter(fills, arcs);
    const shapes = [[[10, 10]], [[20, 20]], [[30, 30]]] as any;

    painter.drawPoints(shapes, { color: '#333', radius: 4, fill: true }, Uint32Array.from([1]));

    expect(arcs).toHaveLength(1);
    expect(arcs[0]).toEqual([20, 20, 4, 0, Math.PI * 2]);
  });

  it('does not flush empty point batches for offscreen points after a full batch', () => {
    const fills: string[] = [];
    const painter = makePointPainter(fills);
    const visible = Array.from({ length: 100 }, (_, i) => [[i % 50, i % 50]]);
    const offscreen = Array.from({ length: 500 }, () => [[500, 500]]);

    painter.drawPoints([...visible, ...offscreen] as any, {
      color: '#333',
      radius: 4,
      fill: true,
    });

    expect(fills).toHaveLength(1);
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

function makeFillHarness(shapeCount: number) {
  const styleSets: string[] = [];
  const fills: Array<string | undefined> = [];
  let tracedParts = 0;
  // 渲染桩：只记录 fillStyle 切换与 fill 调用，不实现任何 Canvas2D 行为。
  const ctx = {
    canvas: { width: 100, height: 100 },
    globalAlpha: 1,
    set fillStyle(v: string) {
      styleSets.push(v);
    },
    get fillStyle() {
      return '';
    },
    beginPath() {},
    fill(rule?: string) {
      fills.push(rule);
    },
    moveTo() {},
    lineTo() {},
    closePath() {},
    clearRect() {},
  };
  const { painter } = createCanvasPainterHarness(ctx);
  const arcs = {
    size: () => shapeCount,
    getVertexData: () => ({ nn: Int32Array.from({ length: shapeCount }, () => 2) }),
    getShapeIter: () => {
      tracedParts++;
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
  const shapes = Array.from({ length: shapeCount }, (_, i) => [[i]]);
  return { painter, arcs, shapes, styleSets, fills, traced: () => tracedParts };
}

describe('drawPolygonFill styleBuckets', () => {
  it('sets fillStyle once per non-empty bucket; every shape traced exactly once', () => {
    const { painter, arcs, shapes, styleSets, fills, traced } = makeFillHarness(3);
    painter.drawPolygonFill(shapes, arcs as never, '#000000', undefined, undefined, {
      styleBuckets: {
        buckets: [Uint32Array.from([0, 2]), Uint32Array.from([1])],
        colors: ['#111111', '#999999'],
      },
    });
    expect(styleSets).toEqual(['#111111', '#999999']); // 每桶恰好一次（_resolveColor 对合法 hex 原样返回）
    expect(traced()).toBe(3); // 覆盖完备：跨桶无重复无遗漏
    expect(fills.length).toBeGreaterThanOrEqual(2); // flush 次数由批次边界决定，不断言等于桶数
  });

  it('omitting styleBuckets keeps the legacy single-style path', () => {
    const { painter, arcs, shapes, styleSets, traced } = makeFillHarness(2);
    painter.drawPolygonFill(shapes, arcs as never, '#123456');
    expect(styleSets).toEqual(['#123456']);
    expect(traced()).toBe(2);
  });
});

// CanvasPainter reads `window.devicePixelRatio` in a field initializer; stub
// it before importing so node's default vitest environment doesn't blow up.

// Mock just enough of CanvasRenderingContext2D for drawPolygonFill to run.
function makeCtx() {
  const calls: Array<[string, any]> = [];
  let _alpha = 1;
  const ctx: any = {
    get globalAlpha() {
      return _alpha;
    },
    set globalAlpha(v: number) {
      _alpha = v;
      calls.push(['globalAlpha=', v]);
    },
    set fillStyle(v: string) {
      calls.push(['fillStyle=', v]);
    },
    beginPath() {
      calls.push(['beginPath', null]);
    },
    moveTo() {},
    lineTo() {},
    closePath() {
      calls.push(['closePath', null]);
    },
    fill(rule?: string) {
      calls.push(['fill', rule]);
    },
    clearRect() {},
  };
  return { ctx, calls };
}

function makeOpacityPainter(ctx: any) {
  return createCanvasPainterHarness(ctx).painter;
}

function makeOpacityArcs() {
  // Single-segment polygon: one part [0], one arc with 4 vertices forming a square.
  const arcs: any = {
    size: () => 1,
    getShapeIter: (_part: number[]) => {
      const xs = [0, 1, 1, 0, 0];
      const ys = [0, 0, 1, 1, 0];
      let i = 0;
      return {
        get x() {
          return xs[i];
        },
        get y() {
          return ys[i];
        },
        hasNext() {
          if (i >= xs.length) return false;
          i++;
          return true;
        },
      };
    },
  };
  return arcs;
}

function makeVisibilityArcs(visitedParts: number[][]) {
  return {
    getSimpleShapeBbox: (part: number[], out: number[]) => {
      const arcId = part[0];
      if (arcId === 0) {
        out[0] = 0;
        out[1] = 0;
        out[2] = 1;
        out[3] = 1;
      } else {
        out[0] = 10;
        out[1] = 10;
        out[2] = 11;
        out[3] = 11;
      }
    },
    getShapeIter: (part: number[]) => {
      visitedParts.push(part);
      const xs = [0, 1, 0];
      const ys = [0, 0, 1];
      let i = 0;
      return {
        get x() {
          return xs[i];
        },
        get y() {
          return ys[i];
        },
        hasNext() {
          if (i >= xs.length) return false;
          i++;
          return true;
        },
      };
    },
  };
}

function makeBudgetArcs() {
  return {
    getVertexData: () => ({
      nn: new Int32Array([10_000, 10_000]),
    }),
    getShapeIter: (_part: number[]) => {
      const xs = [0, 1, 0];
      const ys = [0, 0, 1];
      let i = 0;
      return {
        get x() {
          return xs[i];
        },
        get y() {
          return ys[i];
        },
        hasNext() {
          if (i >= xs.length) return false;
          i++;
          return true;
        },
      };
    },
  };
}

describe('CanvasPainter.drawPolygonFill — fill-opacity', () => {
  const shapes = [[[0]]];

  it('leaves globalAlpha untouched when opacity is undefined', () => {
    const { ctx, calls } = makeCtx();
    const painter = makeOpacityPainter(ctx);
    const arcs = makeOpacityArcs();
    painter.drawPolygonFill(shapes as any, arcs as any, '#1e88e5');
    const alphaSets = calls.filter(([k]) => k === 'globalAlpha=');
    expect(alphaSets).toHaveLength(0);
  });

  it('multiplies opacity onto current globalAlpha and restores it', () => {
    const { ctx, calls } = makeCtx();
    const painter = makeOpacityPainter(ctx);
    const arcs = makeOpacityArcs();
    ctx.globalAlpha = 0.8; // pretend something upstream already set this
    calls.length = 0; // clear setup noise
    painter.drawPolygonFill(shapes as any, arcs as any, '#1e88e5', undefined, 0.5);
    const alphaSets = calls.filter(([k]) => k === 'globalAlpha=').map(([, v]) => v);
    // First write multiplies onto prevAlpha (0.8 * 0.5 = 0.4); restore returns to 0.8.
    expect(alphaSets).toEqual([0.4, 0.8]);
  });

  it('clamps opacity to [0, 1]', () => {
    const { ctx, calls } = makeCtx();
    const painter = makeOpacityPainter(ctx);
    const arcs = makeOpacityArcs();
    calls.length = 0;
    painter.drawPolygonFill(shapes as any, arcs as any, '#1e88e5', undefined, 1.5);
    const sets = calls.filter(([k]) => k === 'globalAlpha=').map(([, v]) => v);
    expect(sets[0]).toBe(1); // clamped to 1
  });

  it('opacity = 1 is a no-op (no globalAlpha writes)', () => {
    const { ctx, calls } = makeCtx();
    const painter = makeOpacityPainter(ctx);
    const arcs = makeOpacityArcs();
    calls.length = 0;
    painter.drawPolygonFill(shapes as any, arcs as any, '#1e88e5', undefined, 1);
    const sets = calls.filter(([k]) => k === 'globalAlpha=');
    expect(sets).toHaveLength(0);
  });

  it('lets fill implicitly close polygon parts instead of calling closePath per part', () => {
    const { ctx, calls } = makeCtx();
    const painter = makeOpacityPainter(ctx);
    const arcs = makeOpacityArcs();

    painter.drawPolygonFill(shapes as any, arcs as any, '#1e88e5');

    expect(calls.filter(([k]) => k === 'closePath')).toHaveLength(0);
    expect(calls.filter(([k]) => k === 'fill')).toEqual([['fill', 'evenodd']]);
  });

  it('skips polygon parts whose bbox is outside the viewport', () => {
    const { ctx } = makeCtx();
    const painter = makeOpacityPainter(ctx);
    const visitedParts: number[][] = [];
    const arcs = makeVisibilityArcs(visitedParts);

    painter.drawPolygonFill([[[0], [1]]] as any, arcs as any, '#1e88e5', undefined, undefined, {
      viewBBox: [0, 0, 2, 2],
    });

    expect(visitedParts).toEqual([[0]]);
  });

  it('flushes polygon fill paths when the vertex budget would be exceeded', () => {
    const { ctx, calls } = makeCtx();
    const painter = makeOpacityPainter(ctx);
    const arcs = makeBudgetArcs();

    painter.drawPolygonFill([[[0]], [[1]]] as any, arcs as any, '#1e88e5');

    expect(calls.filter(([k]) => k === 'fill')).toEqual([
      ['fill', 'evenodd'],
      ['fill', 'evenodd'],
    ]);
  });
});

type CanvasCall = [string, ...unknown[]];

interface CanvasContextStub {
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  fill(): void;
  stroke(): void;
  setLineDash(segments: number[]): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  clearRect(): void;
}

interface CanvasContextFixture {
  ctx: CanvasContextStub;
  calls: CanvasCall[];
}

function makeContext(): CanvasContextFixture {
  const calls: CanvasCall[] = [];
  let alpha = 1;
  const ctx = {
    set fillStyle(value: string) {
      calls.push(['fillStyle', value]);
    },
    set strokeStyle(value: string) {
      calls.push(['strokeStyle', value]);
    },
    set lineWidth(value: number) {
      calls.push(['lineWidth', value]);
    },
    set lineJoin(value: CanvasLineJoin) {
      calls.push(['lineJoin', value]);
    },
    set lineCap(value: CanvasLineCap) {
      calls.push(['lineCap', value]);
    },
    set font(value: string) {
      calls.push(['font', value]);
    },
    get globalAlpha() {
      return alpha;
    },
    set globalAlpha(value: number) {
      alpha = value;
      calls.push(['globalAlpha', value]);
    },
    beginPath() {
      calls.push(['beginPath']);
    },
    closePath() {
      calls.push(['closePath']);
    },
    moveTo(x: number, y: number) {
      calls.push(['moveTo', x, y]);
    },
    lineTo(x: number, y: number) {
      calls.push(['lineTo', x, y]);
    },
    arc(x: number, y: number, radius: number, startAngle: number, endAngle: number) {
      calls.push(['arc', x, y, radius, startAngle, endAngle]);
    },
    fill() {
      calls.push(['fill']);
    },
    stroke() {
      calls.push(['stroke']);
    },
    setLineDash(segments: number[]) {
      calls.push(['setLineDash', segments]);
    },
    fillRect(x: number, y: number, width: number, height: number) {
      calls.push(['fillRect', x, y, width, height]);
    },
    fillText(text: string, x: number, y: number) {
      calls.push(['fillText', text, x, y]);
    },
    measureText() {
      return { width: 48 };
    },
    clearRect() {},
  };
  return { ctx, calls };
}

function makeMeasurementPainter(ctx: CanvasContextStub): CanvasPainter {
  return createCanvasPainterHarness(ctx).painter;
}

const completedArea: MeasurementOverlayState = {
  mode: 'area',
  vertices: [
    [0, 0],
    [10, 0],
    [0, 10],
  ],
  committedPath: [
    [0, 0],
    [10, 0],
    [0, 10],
    [0, 0],
  ],
  previewPath: null,
  fillPath: [
    [0, 0],
    [10, 0],
    [0, 10],
    [0, 0],
  ],
  segmentLabels: [{ label: '5.50 km', coord: [5, 0] }],
  label: '12.4 km²',
  labelCoord: [0, 10],
  completed: true,
  drawColor: '#224466',
};

describe('CanvasPainter.drawVertexDots', () => {
  it('deduplicates shared arcs and batches large vertex paths', () => {
    const fills: number[] = [];
    let dots = 0;
    const visited: number[] = [];
    const { painter } = createCanvasPainterHarness({
      set fillStyle(_value: string) {},
      beginPath() {
        dots = 0;
      },
      moveTo() {},
      arc() {
        dots++;
      },
      fill() {
        fills.push(dots);
      },
    });
    const arcs = {
      size: () => 2,
      getArcIter(id: number) {
        visited.push(id);
        let index = 0;
        return {
          x: 0,
          y: 0,
          hasNext() {
            if (index >= 60) return false;
            this.x = index;
            this.y = id * 10;
            index++;
            return true;
          },
        };
      },
    } as unknown as ArcCollection;

    painter.drawVertexDots([[[0, 1]], [[0]]] as PathShape[], arcs, {
      dotColor: '#123456',
      hoverColor: '#123456',
    });

    expect(visited).toEqual([0, 1]);
    expect(fills).toEqual([100, 20]);
  });
});

describe('CanvasPainter.drawMeasurementOverlay', () => {
  it('fills a completed area before drawing its vertex dots and label', () => {
    const { ctx, calls } = makeContext();
    const painter = makeMeasurementPainter(ctx);

    painter.drawMeasurementOverlay(completedArea);

    const firstFill = calls.findIndex(([name]) => name === 'fill');
    const firstVertexArc = calls.findIndex(([name]) => name === 'arc');
    expect(firstFill).toBeGreaterThanOrEqual(0);
    expect(firstFill).toBeLessThan(firstVertexArc);
    expect(calls).toContainEqual([
      'fillRect',
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    ]);
    expect(calls).toContainEqual(['fillText', '12.4 km²', expect.any(Number), expect.any(Number)]);
    expect(calls).toContainEqual(['fillText', '5.50 km', expect.any(Number), expect.any(Number)]);
  });
});

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

function makeArcIterator(points: Array<[number, number]>) {
  let index = 0;
  return {
    x: 0,
    y: 0,
    hasNext() {
      const point = points[index++];
      if (!point) return false;
      this.x = point[0];
      this.y = point[1];
      return true;
    },
  };
}

function mockMissingThemeVariables() {
  return vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    getPropertyValue: () => '',
  } as CSSStyleDeclaration);
}

function makeThemePainter() {
  const assignments: string[] = [];
  const ctx = {
    set fillStyle(value: string) {
      assignments.push(value);
    },
    set strokeStyle(value: string) {
      assignments.push(value);
    },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    fill() {},
    stroke() {},
    setLineDash() {},
    clearRect() {},
  } as unknown as CanvasRenderingContext2D;
  const canvas = document.createElement('canvas');
  const { painter } = createCanvasPainterHarness(ctx, { canvas });
  return { assignments, canvas, painter };
}

describe('CanvasPainter theme colors', () => {
  it('uses the primary fallback when drawPaths receives an unset primary token', () => {
    const { assignments, painter } = makeThemePainter();
    mockMissingThemeVariables();

    painter.drawPaths([[[0]]] as any, { color: EMAP_THEME_COLORS.primary, width: 1 }, {
      size: () => 1,
      getArcIter: () =>
        makeArcIterator([
          [0, 0],
          [10, 10],
        ]),
    } as any);

    expect(assignments).toContain(EMAP_THEME_FALLBACKS.primary);
  });

  it('uses the selection fallback when drawPolygonFill receives an unset selection token', () => {
    const { assignments, painter } = makeThemePainter();
    mockMissingThemeVariables();

    painter.drawPolygonFill(
      [[[0]]] as any,
      {
        getShapeIter: () =>
          makeArcIterator([
            [0, 0],
            [10, 0],
            [10, 10],
          ]),
      } as any,
      EMAP_THEME_COLORS.selection,
    );

    expect(assignments).toContain(EMAP_THEME_FALLBACKS.selection);
  });

  it('uses the primary fallback when a primary token resolves through a cycle', () => {
    const { assignments, canvas, painter } = makeThemePainter();
    const getComputedStyle = vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: (name: string) =>
        name === '--emap-primary'
          ? 'var(--cycle)'
          : name === '--cycle'
            ? 'var(--emap-primary)'
            : '',
    } as CSSStyleDeclaration);

    painter.drawPaths([[[0]]] as any, { color: EMAP_THEME_COLORS.primary, width: 1 }, {
      size: () => 1,
      getArcIter: () =>
        makeArcIterator([
          [0, 0],
          [10, 10],
        ]),
    } as any);

    expect(assignments).toContain(EMAP_THEME_FALLBACKS.primary);
    expect(getComputedStyle).toHaveBeenCalledWith(canvas);
  });

  it('resolves computed theme variables once per frame and refreshes after clear', () => {
    const { assignments, canvas, painter } = makeThemePainter();
    const getComputedStyle = vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const values = new Map(
        Array.from((element as HTMLElement).style).map((name) => [
          name,
          (element as HTMLElement).style.getPropertyValue(name),
        ]),
      );
      return {
        getPropertyValue: (name: string) => values.get(name) ?? '',
      } as CSSStyleDeclaration;
    });
    canvas.style.setProperty('--emap-primary', 'rgb(1, 2, 3)');
    painter.drawPoints([[[10, 10]]] as any, {
      color: 'var(--emap-primary)',
      radius: 4,
      fill: true,
    });
    painter.drawPoints([[[20, 20]]] as any, {
      color: 'var(--emap-primary)',
      radius: 4,
      fill: true,
    });
    expect(assignments).toContain('rgb(1, 2, 3)');
    expect(getComputedStyle).toHaveBeenCalledTimes(1);

    canvas.style.setProperty('--emap-primary', 'rgb(4, 5, 6)');
    painter.clear();
    painter.drawPoints([[[10, 10]]] as any, {
      color: 'var(--emap-primary)',
      radius: 4,
      fill: true,
    });
    expect(assignments).toContain('rgb(4, 5, 6)');
    expect(getComputedStyle).toHaveBeenCalledTimes(2);
  });

  it('prefers a local host primary over the inherited emap alias', () => {
    const { assignments, canvas, painter } = makeThemePainter();
    const host = document.createElement('div');
    host.style.setProperty('--primary', 'rgb(10, 20, 30)');
    canvas.style.setProperty('--emap-primary', 'rgb(40, 50, 60)');
    host.append(canvas);
    vi.spyOn(window, 'getComputedStyle').mockImplementation(
      (element) =>
        ({
          getPropertyValue: (name: string) =>
            (element as HTMLElement).style.getPropertyValue(name) ||
            (element as HTMLElement).parentElement?.style.getPropertyValue(name) ||
            '',
        }) as CSSStyleDeclaration,
    );

    painter.drawPoints([[[10, 10]]] as any, {
      color: EMAP_THEME_COLORS.primary,
      radius: 4,
      fill: true,
    });

    expect(assignments).toContain('rgb(10, 20, 30)');
  });

  it('passes explicit literal colors unchanged', () => {
    const { assignments, painter } = makeThemePainter();
    painter.drawPoints([[[10, 10]]] as any, {
      color: '#abcdef',
      radius: 4,
      fill: true,
    });
    expect(assignments).toContain('#abcdef');
  });
});

afterEach(() => vi.restoreAllMocks());
