import { MapseekMap } from '../map/map';

export interface Control {
  onAdd(map: MapseekMap): HTMLElement;
  onRemove(map: MapseekMap): void;
}

export type ControlPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
