// Shared context handed to every op function. Decouples the bodies from
// the `MapshaperOps` class so each op can be unit-tested in isolation
// (just hand it a stub `host` and a stub `runDatasetCommand`).
//
// Rationale: PR-7 splits the 1700-line `mapshaper-ops.ts` into one file
// per op family. Each op imports only this module + `op-result` +
// `command-args` + `layer-registry` — the `MapshaperOps` class itself
// becomes a thin facade that constructs an OpContext and delegates.

import type { EmapHostInternal } from '../emap-host';
import type { OpResult } from '../op-result';
import type { ParsedCommand } from '../../adapter/mapshaper-adapter';
import type { MapshaperDataset } from '../../types/mapshaper-types';
import type { FeatureRef } from '../types';

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
 * PR-4b parsed-command runner. Same dataset-replace pipeline as
 * {@link RunDatasetCommand} but accepts pre-built `ParsedCommand[]`. New
 * ops should prefer this — it skips the CLI parser, eliminating an entire
 * class of escaping bugs.
 */
export type RunDatasetCommandParsed = (
  sourceId: string,
  commands: ParsedCommand[],
  label: string,
  inputFiles?: Record<string, Uint8Array | string>,
) => Promise<OpResult>;

/** Prepare the runner-owned dataset copy before parsed-command dispatch. */
export type PrepareDatasetCommand = (working: MapshaperDataset, original: MapshaperDataset) => void;

/** Parsed-command runner with an isolated working-copy preparation step. */
export type RunPreparedDatasetCommandParsed = (
  sourceId: string,
  commands: ParsedCommand[],
  label: string,
  prepare: PrepareDatasetCommand,
  inputFiles?: Record<string, Uint8Array | string>,
) => Promise<OpResult>;

export interface PreparedDatasetMutationResult<T> {
  value: T;
  selection: FeatureRef[];
}

export type RunPreparedDatasetMutation = <T>(
  sourceId: string,
  label: string | ((value: T) => string),
  mutate: (
    working: MapshaperDataset,
    original: MapshaperDataset,
  ) => PreparedDatasetMutationResult<T> | OpResult<T> | Promise<PreparedDatasetMutationResult<T> | OpResult<T>>,
) => Promise<OpResult<T>>;

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
  /** Parsed-command runner (PR-4b); see {@link RunDatasetCommandParsed}. */
  runDatasetCommandParsed: RunDatasetCommandParsed;
  /** Prepared parsed-command runner; see {@link RunPreparedDatasetCommandParsed}. */
  runPreparedDatasetCommandParsed: RunPreparedDatasetCommandParsed;
  /** Prepared mutation runner that installs an explicit final selection. */
  runPreparedDatasetMutation: RunPreparedDatasetMutation;
}
