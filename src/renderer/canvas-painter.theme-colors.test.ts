// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CanvasPainter } from './canvas-painter';
import { EMAP_THEME_COLORS, EMAP_THEME_FALLBACKS } from '../theme/colors';

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
    lineTo() {},
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
  it('uses the primary fallback when drawPaths receives an unset primary token', () => {
    const { assignments, painter } = makePainter();
    mockMissingThemeVariables();

    painter.drawPaths([[[0]]] as any, { color: EMAP_THEME_COLORS.primary, width: 1 }, {
      getArcIter: () =>
        makeArcIterator([
          [0, 0],
          [10, 10],
        ]),
    } as any);

    expect(assignments).toContain(EMAP_THEME_FALLBACKS.primary);
  });

  it('uses the selection fallback when drawPolygonFill receives an unset selection token', () => {
    const { assignments, painter } = makePainter();
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
    const { assignments, canvas, painter } = makePainter();
    const getComputedStyle = vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: (name: string) =>
        name === '--emap-primary'
          ? 'var(--cycle)'
          : name === '--cycle'
            ? 'var(--emap-primary)'
            : '',
    } as CSSStyleDeclaration);

    painter.drawPaths([[[0]]] as any, { color: EMAP_THEME_COLORS.primary, width: 1 }, {
      getArcIter: () =>
        makeArcIterator([
          [0, 0],
          [10, 10],
        ]),
    } as any);

    expect(assignments).toContain(EMAP_THEME_FALLBACKS.primary);
    expect(getComputedStyle).toHaveBeenCalledWith(canvas);
  });

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

  it('prefers a local host primary over the inherited emap alias', () => {
    const { assignments, canvas, painter } = makePainter();
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
