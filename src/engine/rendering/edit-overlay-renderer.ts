import type { DrawOverlayState, EditPainter, MeasurementOverlayState } from './painter';
import type { ArcCollection } from '../../shared/types/mapshaper-types';
import type { EditVertexState } from '../map/types';
import type { EditMode } from '../map/edit-state-store';
import { EMAP_THEME_COLORS } from '../../ui/theme/colors';

const EDIT_VERTEX_COLOR = EMAP_THEME_COLORS.primary;
const EDIT_POLYGON_FILL_OPACITY = 0.2;

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
    drawState: DrawOverlayState | null,
    measurementState: MeasurementOverlayState | null,
    vertexArcFilter?: (arcId: number) => boolean,
  ): void {
    if (editMode === 'vertex' && vertexState) {
      this._renderVertexOverlay(vertexState, vertexArcFilter);
    } else if (
      (editMode === 'draw' ||
        editMode === 'split' ||
        editMode === 'reshape' ||
        editMode === 'auto-complete' ||
        editMode === 'ring' ||
        editMode === 'part') &&
      drawState
    ) {
      this._painter.drawDrawingOverlay(drawState);
    } else if (editMode === 'measure' && measurementState) {
      this._painter.drawMeasurementOverlay(measurementState);
    }
  }

  private _renderVertexOverlay(
    state: EditVertexState,
    arcFilter?: (arcId: number) => boolean,
  ): void {
    const arcs = state.arcs as unknown as ArcCollection;
    if (state.geometryType === 'polygon' && state.polygonFill) {
      if (state.polygonFill === EMAP_THEME_COLORS.selection) {
        this._painter.drawPolygonFill(
          state.shapes,
          arcs,
          state.polygonFill,
          arcFilter,
          EDIT_POLYGON_FILL_OPACITY,
        );
      } else {
        this._painter.drawPolygonFill(state.shapes, arcs, state.polygonFill, arcFilter);
      }
    }

    this._painter.drawVertexDots(state.shapes, arcs, {
      dotColor: EDIT_VERTEX_COLOR,
      dotRadius: 3,
      arcFilter,
      hoverVertex: state.hoverVertex,
      hoverType: state.hoverType ?? 'vertex',
      hoverColor: EDIT_VERTEX_COLOR,
      hoverRadius: 6,
      selectedVertices: state.selectedVertices,
      selectedColor: EMAP_THEME_COLORS.selection,
    });
    if (state.band) this._painter.drawVertexBand(state.band);
  }
}
