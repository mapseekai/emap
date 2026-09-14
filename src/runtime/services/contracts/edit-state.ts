import type { EditStateStore, EditMode } from '../../../engine/map/edit-state-store';
import type { EditVertexState } from '../../../engine/map/types';
import type { DrawOverlayState, MeasurementOverlayState } from '../../../engine/rendering/painter';

/** Explicit service contract. Providers implement this boundary; consumers do not import implementations. */
export interface EditStateContract {
  /** @internal */
  _editState: EditStateStore;
  getEditMode(): EditMode;
  setEditMode(mode: EditMode): void;
  setEditVertexState(state: EditVertexState): void;
  clearEditVertexState(): void;
  setEditDrawState(state: DrawOverlayState): void;
  clearEditDrawState(): void;
  setEditMeasurementState(state: MeasurementOverlayState): void;
  clearEditMeasurementState(): void;
}
