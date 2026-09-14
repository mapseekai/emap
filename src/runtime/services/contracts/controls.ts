import type { Control, ControlPosition } from '../../../ui/control';

/** Explicit service contract. Providers implement this boundary; consumers do not import implementations. */
export interface ControlsContract {
  readonly _controls: Control[];
  addControl(control: Control, position?: ControlPosition): Promise<void>;
  removeControl(control: Control): Promise<void>;
  registerFactory(id: string, create: (options?: unknown) => Control): () => Promise<void>;
  add(id: string, options?: unknown, position?: ControlPosition): Promise<Control>;
  list(): readonly string[];
  dispose(): Promise<void>;
}
