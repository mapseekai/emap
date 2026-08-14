import type { EditPainter } from './painter';
import type { ArcCollection } from '../types/mapshaper-types';
import type { EditDrawState, EditMeasurementState, EditVertexState } from '../map/types';
import type { EditMode } from '../map/edit-state-store';
import { EMAP_THEME_COLORS } from '../theme/colors';

const EDIT_VERTEX_COLOR = EMAP_THEME_COLORS.primary;

/**
 * Draws edit-mode-only decorations on top of the regular layer pass:
 *   - polygon fill highlight while editing a polygon's vertices
 *   - vertex dots (with hover affordance) while in vertex mode
 *   - the in-progress draw overlay while creating a new feature
 *   - the temporary measurement overlay while measuring
 *
 * Pulled out of `Emap.render()` so the main render loop deals with layers
 * only and doesn't need to introspect edit-mode flags or downcast the
 * Painter to a concrete implementation.
 */
export class EditOverlayRenderer {
  constructor(private _painter: EditPainter) {}

  /**
   * Render the edit-mode overlay for the current frame. No-op when
   * `editMode === 'none'` or the relevant state object is `null`.
   */
  render(
    editMode: EditMode,
    vertexState: EditVertexState | null,
    drawState: EditDrawState | null,
    measurementState: EditMeasurementState | null,
    vertexArcFilter?: (arcId: number) => boolean,
  ): void {
    if (editMode === 'vertex' && vertexState) {
      this._renderVertexOverlay(vertexState, vertexArcFilter);
    } else if (editMode === 'draw' && drawState) {
      this._painter.drawDrawingOverlay(drawState);
    } else if (editMode === 'measure' && measurementState) {
      this._painter.drawMeasurementOverlay(measurementState);
    }
  }

  private _renderVertexOverlay(
    state: EditVertexState,
    arcFilter?: (arcId: number) => boolean,
  ): void {
    // `EditVertexArcs` is structurally a subset of `ArcCollection` (both
    // expose `getArcIter`/`getShapeIter`); the cast keeps the Painter API
    // strictly typed without forcing the editor to depend on the full
    // mapshaper interface.
    const arcs = state.arcs as unknown as ArcCollection;

    // Polygon fill is drawn first so vertex dots stack on top of it.
    if (state.geometryType === 'polygon' && state.polygonFill) {
      this._painter.drawPolygonFill(state.shapes, arcs, state.polygonFill, arcFilter);
    }

    this._painter.drawVertexDots(state.shapes, arcs, {
      dotColor: EDIT_VERTEX_COLOR,
      dotRadius: 3,
      arcFilter,
      hoverVertex: state.hoverVertex,
      hoverType: state.hoverType ?? 'vertex',
      hoverColor: EDIT_VERTEX_COLOR,
      hoverRadius: 6,
    });
  }
}
