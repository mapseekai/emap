import { describe, expect, it, vi } from 'vitest';
import { EditOverlayRenderer } from './edit-overlay-renderer';
import type { EditPainter } from './painter';
import type { EditMeasurementState, EditVertexState } from '../map/types';
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
    drawMeasurementOverlay: vi.fn(),
  } as unknown as EditPainter;
}

const measurementState: EditMeasurementState = {
  mode: 'area',
  vertices: [
    [0, 0],
    [1, 0],
    [0, 1],
  ],
  committedPath: [
    [0, 0],
    [1, 0],
    [0, 1],
  ],
  previewPath: null,
  fillPath: [
    [0, 0],
    [1, 0],
    [0, 1],
  ],
  segmentLabels: [],
  label: '12.4 km²',
  labelCoord: [0, 1],
  completed: true,
  drawColor: '#000',
};

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

    renderer.render('vertex', state, null, null, arcFilter);

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

    renderer.render('vertex', state, null, null, arcFilter);

    expect(painter.drawPolygonFill).toHaveBeenCalledWith(
      state.shapes,
      state.arcs,
      state.polygonFill,
      arcFilter,
    );
  });

  it('keeps the default themed polygon fill translucent so shared edges remain visible', () => {
    const painter = makePainter();
    const renderer = new EditOverlayRenderer(painter);
    const arcFilter = vi.fn(() => true);
    const state: EditVertexState = {
      shapes: [[[0]]],
      arcs: { getArcIter: () => ({ x: 0, y: 0, hasNext: () => false }) },
      hoverVertex: null,
      geometryType: 'polygon',
      polygonFill: EMAP_THEME_COLORS.selection,
    };

    renderer.render('vertex', state, null, null, arcFilter);

    expect(painter.drawPolygonFill).toHaveBeenCalledWith(
      state.shapes,
      state.arcs,
      state.polygonFill,
      arcFilter,
      0.2,
    );
  });

  it('routes measurement state only while measure mode is active', () => {
    const painter = makePainter();
    const renderer = new EditOverlayRenderer(painter);

    renderer.render('measure', null, null, measurementState);
    renderer.render('draw', null, null, measurementState);

    expect(painter.drawMeasurementOverlay).toHaveBeenCalledTimes(1);
    expect(painter.drawMeasurementOverlay).toHaveBeenCalledWith(measurementState);
  });
});
