import type { EditCommand } from '../../edit/edit-command';
import type { MapshaperOps } from '../../map/mapshaper-ops';
import type { EditMode } from '../../map/edit-state-store';
import type { EditSessions } from '../../map/edit-sessions';
import type {
  EditDrawState,
  EditMeasurementState,
  EditVertexState,
  FeatureRef,
} from '../../map/types';
import type { EventDispatcher } from '../events';
import type { SelectionHandlerHost } from './selection-handler-host';

export interface EditHandlerHost extends SelectionHandlerHost {
  readonly editSession: EditSessions;
  readonly ops: Pick<MapshaperOps, 'splitSelected'>;
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
  setEditDrawState(state: EditDrawState): void;
  setEditMode(mode: EditMode): void;
  setEditVertexState(state: EditVertexState): void;
  setEditMeasurementState(state: EditMeasurementState): void;
  unproject(x: number, y: number): [number, number];
  _invalidateShapeCachesForSources(sourceIds: Iterable<string>): void;
}
