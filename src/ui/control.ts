import type { Emap } from '../map/map';

export interface Control {
  onAdd(map: Emap): HTMLElement;
  onRemove(map?: Emap): void;
}

export type ControlPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
