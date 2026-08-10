// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CanvasPainter } from './canvas-painter';

function makePainter() {
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
    arc() {},
    fill() {},
    stroke() {},
    setLineDash() {},
    clearRect() {},
  } as unknown as CanvasRenderingContext2D;
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'getContext', { value: () => ctx });
  canvas.width = 100;
  canvas.height = 100;
  const painter = new CanvasPainter(canvas);
  Reflect.set(painter, '_transform', { mx: 1, my: 1, bx: 0, by: 0 });
  return { assignments, canvas, painter };
}

describe('CanvasPainter theme colors', () => {
  it('resolves inherited emap variables on every draw', () => {
    const { assignments, canvas, painter } = makePainter();
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
    expect(assignments).toContain('rgb(1, 2, 3)');

    canvas.style.setProperty('--emap-primary', 'rgb(4, 5, 6)');
    painter.drawPoints([[[10, 10]]] as any, {
      color: 'var(--emap-primary)',
      radius: 4,
      fill: true,
    });
    expect(assignments).toContain('rgb(4, 5, 6)');
    expect(getComputedStyle).toHaveBeenCalledTimes(2);
  });

  it('passes explicit literal colors unchanged', () => {
    const { assignments, painter } = makePainter();
    painter.drawPoints([[[10, 10]]] as any, {
      color: '#abcdef',
      radius: 4,
      fill: true,
    });
    expect(assignments).toContain('#abcdef');
  });
});

afterEach(() => vi.restoreAllMocks());
