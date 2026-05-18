/** Outcome of a handler processing one normalized event. */
export type HandlerResult = 'passthrough' | 'consumed' | 'exclusive';

export interface PointerModifiers {
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
}

/** A DOM pointer/wheel event normalized to element-local coords + modifiers. */
export interface NormalizedPointerEvent {
  kind: 'down' | 'move' | 'up' | 'wheel' | 'click' | 'contextmenu' | 'dblclick';
  /** Element-local pixel position. */
  point: { x: number; y: number };
  modifiers: PointerModifiers;
  /** Mouse button for down/up/click; 0 otherwise. */
  button: number;
  /** Wheel delta (sign already normalized: +1 zoom-in direction). Absent if N/A. */
  wheelDirection?: number;
  originalEvent: Event;
}

/**
 * A unit of interaction (pan, zoom, selection…). Every interaction on the map
 * is one of these. Mirrors MapLibre's handler model.
 */
export interface Handler<Opts = unknown> {
  readonly name: string;
  enable(): void;
  disable(): void;
  isEnabled(): boolean;
  setOptions(opts: Partial<Opts>): void;
  getOptions(): Readonly<Opts>;
  /** Process one normalized event; report whether it was consumed. */
  handlePointer(ev: NormalizedPointerEvent): HandlerResult;
}

/** Runtime guard — used by HandlerManager.register and by consumers. */
export function isHandler(v: unknown): v is Handler {
  if (!v || typeof v !== 'object') return false;
  const h = v as Record<string, unknown>;
  return (
    typeof h.name === 'string' &&
    typeof h.enable === 'function' &&
    typeof h.disable === 'function' &&
    typeof h.isEnabled === 'function' &&
    typeof h.setOptions === 'function' &&
    typeof h.getOptions === 'function' &&
    typeof h.handlePointer === 'function'
  );
}
