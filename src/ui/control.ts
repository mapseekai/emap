import type { Inject } from 'cordis';
import type { ControlContext } from '../runtime/services/controls';

export interface Control {
  /** Native Cordis dependencies of the child plugin that owns this control. */
  readonly inject?: Inject;
  onAdd(map: ControlContext): HTMLElement;
  onRemove(map?: ControlContext): void;
}

export type ControlPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
