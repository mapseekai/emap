import type { ControlContext } from '../services/controls';

export interface Control {
  onAdd(map: ControlContext): HTMLElement;
  onRemove(map?: ControlContext): void;
}

export type ControlPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
