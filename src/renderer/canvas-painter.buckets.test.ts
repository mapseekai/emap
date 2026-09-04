import { describe, expect, it } from 'vitest';

(globalThis as any).window = { devicePixelRatio: 1 };

import { createCanvasPainterHarness } from '../../test/utils/canvas-painter';

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
