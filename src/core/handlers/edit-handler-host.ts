import type { EditCommand } from '../../edit/edit-command';
import type { EditMode } from '../../map/edit-state-store';
import type { EditSessions } from '../../map/edit-sessions';
import type { EditDrawState, EditVertexState, FeatureRef } from '../../map/types';
import type { EventDispatcher } from '../events';
import type { SelectionHandlerHost } from './selection-handler-host';

export interface EditHandlerHost extends SelectionHandlerHost {
  readonly editSession: EditSessions;
  readonly on: EventDispatcher['on'];
  readonly off: EventDispatcher['off'];
  readonly fire: EventDispatcher['fire'];
  canRedo(): boolean;
  clearEditDrawState(): void;
  clearEditVertexState(): void;
  isSelected(feature: FeatureRef): boolean;
  pushCommand(command: EditCommand): void;
  render(): void;
  setEditDrawState(state: EditDrawState): void;
  setEditMode(mode: EditMode): void;
  setEditVertexState(state: EditVertexState): void;
  unproject(x: number, y: number): [number, number];
  _invalidateShapeCachesForSources(sourceIds: Iterable<string>): void;
}
