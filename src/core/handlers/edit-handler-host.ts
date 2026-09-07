import type { EditCommand } from '../../edit/edit-command';
import type { MapshaperOps } from '../../map/mapshaper-ops';
import type { EditMode } from '../../map/edit-state-store';
import type { EditSessions } from '../../map/edit-sessions';
import type { DrawOverlayState, MeasurementOverlayState } from '../../renderer/painter';
import type { EditVertexState, FeatureRef } from '../../map/types';
import type { EventDispatcher } from '../events';
import type { SelectionHandlerHost } from './selection-handler-host';

export interface EditHandlerHost extends SelectionHandlerHost {
  readonly editSession: EditSessions;
  readonly ops: Pick<
    MapshaperOps,
    | 'splitSelected'
    | 'reshapeSelected'
    | 'autoCompletePolygon'
    | 'addRing'
    | 'deleteRing'
    | 'fillRing'
    | 'addPart'
    | 'deletePart'
  >;
  readonly on: EventDispatcher['on'];
  readonly off: EventDispatcher['off'];
  readonly fire: EventDispatcher['fire'];
  canRedo(): boolean;
  clearEditDrawState(): void;
  clearEditMeasurementState(): void;
  clearEditVertexState(): void;
  isSelected(feature: FeatureRef): boolean;
  getCRS(): string;
  getSelection(): FeatureRef[];
  pushCommand(command: EditCommand): void;
  render(): void;
  setEditDrawState(state: DrawOverlayState): void;
  setEditMode(mode: EditMode): void;
  setEditVertexState(state: EditVertexState): void;
  setEditMeasurementState(state: MeasurementOverlayState): void;
  unproject(x: number, y: number): [number, number];
  _invalidateShapeCachesForSources(sourceIds: Iterable<string>): void;
}
