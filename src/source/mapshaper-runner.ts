// @deprecated Prefer `MapshaperAdapter.runImport` from
// `src/adapter/mapshaper-adapter`. This module is kept as a thin shim so
// existing imports (`getDefaultMapshaperRunner`, `DefaultMapshaperRunner`,
// `MapshaperRunner`) keep resolving while the wider migration to the
// adapter is in progress. New code should depend on `MapshaperAdapter`
// directly.

import type { MapshaperDataset } from '../types/mapshaper-types';
import { getDefaultMapshaperAdapter, type MapshaperAdapter } from '../adapter/mapshaper-adapter';

/** Files injected into the runner's input cache (e.g. `.shp` payloads). */
export type RunnerInputFiles = Record<string, Uint8Array | string>;

export interface MapshaperRunner {
  /**
   * Run a mapshaper CLI-style command string and resolve to the first
   * default-target dataset. Throws on parse / runtime errors.
   */
  runImport(cmd: string, inputFiles: RunnerInputFiles): Promise<MapshaperDataset>;
}

/**
 * Production runner that delegates to {@link MapshaperAdapter.runImport}.
 * Kept as a class so callers can subclass for instrumentation (timing,
 * telemetry, error remapping).
 */
export class DefaultMapshaperRunner implements MapshaperRunner {
  constructor(private readonly _adapter: MapshaperAdapter = getDefaultMapshaperAdapter()) {}

  async runImport(cmd: string, inputFiles: RunnerInputFiles): Promise<MapshaperDataset> {
    return this._adapter.runImport(cmd, inputFiles);
  }
}

/** Lazy default singleton — most callers don't need their own instance. */
let _default: MapshaperRunner | null = null;
export function getDefaultMapshaperRunner(): MapshaperRunner {
  return _default ?? (_default = new DefaultMapshaperRunner());
}
