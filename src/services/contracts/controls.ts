import type { Control, ControlPosition } from '../../ui/control';

/** Explicit service contract. Providers implement this boundary; consumers do not import implementations. */
export interface ControlsContract {
  readonly _controls: Control[];
  addControl(control: Control, position?: ControlPosition): void;
  removeControl(control: Control): void;
  registerFactory(id: string, create: (options?: unknown) => Control): () => void;
  add(id: string, options?: unknown, position?: ControlPosition): Control;
  list(): readonly string[];
  dispose(): void;
}
