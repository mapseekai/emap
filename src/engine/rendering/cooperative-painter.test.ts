import { describe, expect, it, vi } from 'vitest';
import { CooperativePainter } from './cooperative-painter';
import type { CorePainter } from './painter';

function targetPainter() {
  return {
    drawRasterImage: vi.fn(),
    drawPaths: vi.fn(),
    drawArcs: vi.fn(),
    drawPoints: vi.fn(),
    drawPolygonFill: vi.fn(),
    clear: vi.fn(),
    resize: vi.fn(),
    setTransform: vi.fn(),
    setPixelRatio: vi.fn(),
  } satisfies CorePainter;
}

describe('CooperativePainter', () => {
  it('splits large arc draws into browser-yielding chunks', async () => {
    const target = targetPainter();
    const painter = new CooperativePainter(target);
    const arcs = { size: () => 1200 } as never;

    painter.drawArcs(arcs, { width: 1 });
    expect(await painter.replay(() => true)).toBe(true);

    expect(target.drawArcs).toHaveBeenCalledTimes(3);
    expect(target.drawArcs.mock.calls.map((call) => call[3]?.length)).toEqual([512, 512, 176]);
  });

  it('stops replaying stale work between chunks', async () => {
    const target = targetPainter();
    const painter = new CooperativePainter(target);
    const arcs = { size: () => 1200 } as never;
    let current = true;
    target.drawArcs.mockImplementation(() => {
      current = false;
    });

    painter.drawArcs(arcs, { width: 1 });
    expect(await painter.replay(() => current)).toBe(false);
    expect(target.drawArcs).toHaveBeenCalledTimes(1);
  });
});
