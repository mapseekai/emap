import { describe, expect, it, vi } from 'vitest';
import { EditOverlayRenderer } from './edit-overlay-renderer';
import type { EditPainter } from './painter';
import type { EditVertexState } from '../map/types';
import { EMAP_THEME_COLORS } from '../theme/colors';

function makePainter(): EditPainter {
  return {
    drawPaths: vi.fn(),
    drawArcs: vi.fn(),
    drawPoints: vi.fn(),
    drawPolygonFill: vi.fn(),
    clear: vi.fn(),
    resize: vi.fn(),
    setTransform: vi.fn(),
    setPixelRatio: vi.fn(),
    drawVertexDots: vi.fn(),
    drawDrawingOverlay: vi.fn(),
  } as unknown as EditPainter;
}

describe('EditOverlayRenderer', () => {
  it('renders vertex edit dots and hover affordances with the primary theme color', () => {
    const painter = makePainter();
    const renderer = new EditOverlayRenderer(painter);
    const arcFilter = vi.fn(() => true);
    const state: EditVertexState = {
      shapes: [[[0]]],
      arcs: { getArcIter: () => ({ x: 0, y: 0, hasNext: () => false }) },
      hoverVertex: [1, 2],
      hoverType: 'interpolated',
    };

    renderer.render('vertex', state, null, arcFilter);

    expect(painter.drawVertexDots).toHaveBeenCalledWith(
      state.shapes,
      state.arcs,
      expect.objectContaining({
        dotColor: EMAP_THEME_COLORS.primary,
        arcFilter,
        hoverColor: EMAP_THEME_COLORS.primary,
        hoverType: 'interpolated',
      }),
    );
  });

  it('uses the viewport arc filter for polygon fill in vertex edit mode', () => {
    const painter = makePainter();
    const renderer = new EditOverlayRenderer(painter);
    const arcFilter = vi.fn(() => true);
    const state: EditVertexState = {
      shapes: [[[0]]],
      arcs: { getArcIter: () => ({ x: 0, y: 0, hasNext: () => false }) },
      hoverVertex: null,
      geometryType: 'polygon',
      polygonFill: 'rgba(76,175,80,0.2)',
    };

    renderer.render('vertex', state, null, arcFilter);

    expect(painter.drawPolygonFill).toHaveBeenCalledWith(
      state.shapes,
      state.arcs,
      state.polygonFill,
      arcFilter,
    );
  });
});
