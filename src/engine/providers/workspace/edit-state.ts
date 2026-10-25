import { EventDispatcher } from '../../core/events';
import { EditStateStore, type EditMode } from '../../map/edit-state-store';
import { type EditVertexState } from '../../map/types';
import type { DrawOverlayState, MeasurementOverlayState } from '../../rendering/painter';
import type { RenderSignalsContract as RenderSignals } from '../../../runtime/services/contracts/signals';

interface Dependencies {
  events: EventDispatcher;
  signals: RenderSignals;
}

/** editState implementation, wired through explicit service dependencies. */
export class EditStateServiceImpl {
  _editState: EditStateStore = new EditStateStore((change) => {
    if (change.modeChanged) {
      // Wholesale-disable pan only for modal editors that need full pointer
      // ownership (`vertex`, `draw`, `split`) — their handlers don't claim `'exclusive'`
      // on `'down'`, so they rely on this gate to keep `dragPan` from
      // intercepting. `'transform'` is different: `transformFeature` returns
      // `'exclusive'` on `'down'` when (and only when) the hit is an already-
      // selected feature; for every other point the arbiter falls through to
      // `dragPan` and pan should still work.

      this.deps.events.fire('editmodechange', { mode: change.current.mode });
    }
    if (change.modeChanged) this.deps.signals.requestRender();
    else this.deps.signals.requestOverlay();
  });

  public getEditMode(): EditMode {
    return this._editState.mode;
  }

  public setEditMode(mode: EditMode): void {
    this._editState.setMode(mode);
  }

  public setEditVertexState(state: EditVertexState): void {
    this._editState.setVertex(state);
  }

  public clearEditVertexState(): void {
    this._editState.clearVertex();
  }

  public setEditDrawState(state: DrawOverlayState): void {
    this._editState.setDraw(state);
  }

  public clearEditDrawState(): void {
    this._editState.clearDraw();
  }

  public setEditMeasurementState(state: MeasurementOverlayState): void {
    this._editState.setMeasurement(state);
  }

  public clearEditMeasurementState(): void {
    this._editState.clearMeasurement();
  }

  constructor(private readonly deps: Dependencies) {}
}
