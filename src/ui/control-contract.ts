export interface ControlContract<TMap> {
  onAdd(map: TMap): HTMLElement;
  onRemove(map?: TMap): void;
}

export type ControlPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
