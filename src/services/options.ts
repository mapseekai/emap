import type { CapabilityAuthorizer } from './capabilities';
import type { Plugin } from '../kernel/plugin';
import type { MapOptions } from '../map/types';

export type PresetName = 'editor' | 'viewer' | 'headless' | 'empty';

/** Container is required by browser presets, not by a headless processing workspace. */
export interface EmapOptions extends Omit<MapOptions, 'container'> {
  container?: MapOptions['container'];
  preset?: PresetName;
  /** Host policy for capability invocation; Agent writes are denied by default. */
  authorizeCapability?: CapabilityAuthorizer;
  /** Explicit overrides replace a preset plugin with the same id. */
  plugins?: readonly Plugin[];
  /** Exclusion is explicit; dependency validation rejects incomplete configurations. */
  excludePlugins?: readonly string[];
}
