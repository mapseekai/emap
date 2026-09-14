// Centralised edit-mode state. Bundles the four pieces of state that
// must move together (`mode`, `vertex`, `draw`, `measurement`) so callers
// can no longer leave one stale when another changes — the store enforces
// the invariant that each overlay belongs to its active mode automatically.

import type { DrawOverlayState, MeasurementOverlayState } from '../rendering/painter';
import type { EditVertexState } from './types';

export type EditMode =
  | 'none'
  | 'vertex'
  | 'draw'
  | 'split'
  | 'measure'
  | 'transform'
  | 'reshape'
  | 'auto-complete'
  | 'ring'
  | 'part';

export interface EditStateSnapshot {
  mode: EditMode;
  vertex: EditVertexState | null;
  draw: DrawOverlayState | null;
  measurement: MeasurementOverlayState | null;
}

export interface EditStateChange {
  /** Snapshot after the mutation. */
  current: EditStateSnapshot;
  /** Mode before the mutation. Equal to `current.mode` for non-mode mutations. */
  previousMode: EditMode;
  /** True iff `current.mode !== previousMode`. */
  modeChanged: boolean;
}

/**
 * Single source of truth for edit-mode state. The owner (Emap) supplies
 * an `onChange` callback at construction; the store calls it on every
 * effective mutation so the owner can re-render, toggle the drag-pan
 * gesture, and emit `editmodechange` exactly once.
 *
 * Invariant: vertex/draw/measurement state is auto-cleared whenever the mode
 * leaves the corresponding edit mode, so a stale `setEditMode('none')` no
 * longer leaks the previous overlay into the next frame.
 */
export class EditStateStore {
  private _mode: EditMode = 'none';
  private _vertex: EditVertexState | null = null;
  private _draw: DrawOverlayState | null = null;
  private _measurement: MeasurementOverlayState | null = null;

  constructor(private _onChange: (change: EditStateChange) => void) {}

  get mode(): EditMode {
    return this._mode;
  }
  get vertex(): EditVertexState | null {
    return this._vertex;
  }
  get draw(): DrawOverlayState | null {
    return this._draw;
  }
  get measurement(): MeasurementOverlayState | null {
    return this._measurement;
  }

  setMode(mode: EditMode): void {
    if (mode === this._mode) return;
    const previousMode = this._mode;
    this._mode = mode;
    // Drop any state that no longer belongs to the active mode. Setting
    // to `null` directly (not via the setters) so we only emit one change.
    if (mode !== 'vertex') this._vertex = null;
    this._draw = null;
    if (mode !== 'measure') this._measurement = null;
    this._fire(previousMode);
  }

  setVertex(state: EditVertexState | null): void {
    if (this._vertex === state) return;
    this._vertex = state;
    this._fire(this._mode);
  }

  clearVertex(): void {
    this.setVertex(null);
  }

  setDraw(state: DrawOverlayState | null): void {
    if (this._draw === state) return;
    this._draw = state;
    this._fire(this._mode);
  }

  clearDraw(): void {
    this.setDraw(null);
  }

  setMeasurement(state: MeasurementOverlayState | null): void {
    if (this._measurement === state) return;
    this._measurement = state;
    this._fire(this._mode);
  }

  clearMeasurement(): void {
    this.setMeasurement(null);
  }

  private _fire(previousMode: EditMode): void {
    this._onChange({
      current: {
        mode: this._mode,
        vertex: this._vertex,
        draw: this._draw,
        measurement: this._measurement,
      },
      previousMode,
      modeChanged: previousMode !== this._mode,
    });
  }
}
