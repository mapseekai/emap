// Thin abstraction over `mapshaper.internal.parseCommands +
// runParsedCommands`. Lets `TopologySource` (and, eventually, the
// dataset-replace ops) accept an injected runner instead of reaching
// into the unstable `mapshaper.internal.*` API directly. The default
// implementation still uses the internal API; tests may swap in a mock.

import mapshaper from 'mapshaper';
import type { MapshaperDataset } from '../types/mapshaper-types';

/** Files injected into the runner's input cache (e.g. `.shp` payloads). */
export type RunnerInputFiles = Record<string, Uint8Array | string>;

export interface MapshaperRunner {
  /**
   * Run a mapshaper CLI-style command string and resolve to the first
   * default-target dataset. Throws on parse / runtime errors.
   *
   * `inputFiles` is injected onto the parsed `-i` command's `input`
   * option, mirroring mapshaper's GUI import path.
   */
  runImport(cmd: string, inputFiles: RunnerInputFiles): Promise<MapshaperDataset>;
}

/**
 * Production runner that delegates straight to `mapshaper.internal`.
 * Kept as a class so callers can subclass for instrumentation
 * (timing, telemetry, error remapping) without touching call sites.
 */
export class DefaultMapshaperRunner implements MapshaperRunner {
  async runImport(cmd: string, inputFiles: RunnerInputFiles): Promise<MapshaperDataset> {
    const commands = mapshaper.internal.parseCommands(cmd);
    if (commands.length > 0 && commands[0].name === 'i') {
      commands[0].options.input = inputFiles;
    }
    return new Promise<MapshaperDataset>((resolve, reject) => {
      mapshaper.internal.runParsedCommands(
        commands,
        new mapshaper.internal.Job(),
        (err: any, job: any) => {
          if (err) {
            reject(err);
            return;
          }
          const targets = job.catalog.getDefaultTargets();
          if (targets.length === 0) {
            reject(new Error('No layers found in dataset'));
            return;
          }
          resolve(targets[0].dataset);
        },
      );
    });
  }
}

/** Lazy default singleton — most callers don't need their own instance. */
let _default: MapshaperRunner | null = null;
export function getDefaultMapshaperRunner(): MapshaperRunner {
  return _default ?? (_default = new DefaultMapshaperRunner());
}
