// Shared context handed to every op function. Decouples the bodies from
// the `MapshaperOps` class so each op can be unit-tested in isolation
// (just hand it a stub `host` and a stub `runDatasetCommand`).
//
// Rationale: PR-7 splits the 1700-line `mapshaper-ops.ts` into one file
// per op family. Each op imports only this module + `op-result` +
// `command-args` + `layer-registry` — the `MapshaperOps` class itself
// becomes a thin facade that constructs an OpContext and delegates.

import type { EmapHostInternal } from '../emap-host';
import type { MapshaperDataset } from '../../types/mapshaper-types';
import type { OpResult } from '../op-result';

/**
 * Run a CLI-style mapshaper command against a source's dataset, snapshotting
 * for undo and pushing a `DatasetReplaceCommand`. Provided to ops via the
 * `OpContext` rather than as a method on a class so unit tests can mock the
 * whole pipeline by injecting a stub function.
 */
export type RunDatasetCommand = (
  sourceId: string,
  cmd: string,
  label: string,
  inputFiles?: Record<string, Uint8Array | string>,
) => Promise<OpResult>;

/**
 * Worker-only path used by `intersectionPointsLayer` / `rebuildTopology`
 * which bypass `parseCommands` and call mapshaper internals directly to
 * produce the `after` dataset. Centralised here so the dataset-replace
 * bookkeeping (history barrier flag, selection clear, render schedule)
 * stays consistent across every op that produces an `after` snapshot.
 */
export type ApplyDatasetReplace = (
  sourceId: string,
  before: MapshaperDataset,
  after: MapshaperDataset,
  label: string,
) => OpResult;

/**
 * Everything an op function needs from the host. Intentionally narrow —
 * adding new fields here is a deliberate signal that the op surface is
 * growing.
 */
export interface OpContext {
  /** Internal host surface (sources, history, selection, worker config…). */
  host: EmapHostInternal;
  /** Shared CLI-command runner; see {@link RunDatasetCommand}. */
  runDatasetCommand: RunDatasetCommand;
  /** Direct dataset-replace path; see {@link ApplyDatasetReplace}. */
  applyDatasetReplace: ApplyDatasetReplace;
}
