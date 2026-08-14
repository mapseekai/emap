import { describe, expect, it } from 'vitest';

(globalThis as { window?: { devicePixelRatio: number } }).window = { devicePixelRatio: 1 };

import { CanvasPainter } from './canvas-painter';
import type { MeasurementOverlayState } from './painter';

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

function makePainter(ctx: CanvasContextStub): CanvasPainter {
  const canvas = { getContext: () => ctx, width: 100, height: 100, style: {} };
  const canvasElement = canvas as unknown as HTMLCanvasElement; // Test-only Canvas2D subset.
  const painter = new CanvasPainter(canvasElement);
  Reflect.set(painter, '_transform', {
    mx: 1,
    my: 1,
    bx: 0,
    by: 0,
  });
  return painter;
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
  label: '12.4 km²',
  labelCoord: [0, 10],
  completed: true,
  drawColor: '#224466',
};

describe('CanvasPainter.drawMeasurementOverlay', () => {
  it('fills a completed area before drawing its vertex dots and label', () => {
    const { ctx, calls } = makeContext();
    const painter = makePainter(ctx);

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
  });
});
