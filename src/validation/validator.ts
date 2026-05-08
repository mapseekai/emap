// Validator interface — pluggable post-edit checks for GIS constraints.
//
// A validator is a named, async function that's called after each
// committed edit. Typical use: enforce topology validity ("no polygon
// may have a self-intersection"), attribute schemas ("every feature
// must have a non-empty `code` field"), value-domain constraints, etc.
//
// Triggering: the engine fires `historychange` whenever a command lands
// on the undo stack (or a transaction commit drops a CompositeCommand
// into it). `Emap` listens to that event and asks the registry to run
// every registered `'after-commit'` validator. Failures are surfaced
// via the `validationfailed` event — emap does NOT auto-undo. The app
// is in charge of deciding what to do (show toast, call `engine.undo()`,
// etc.).
//
// Async by design — non-trivial topology checks (segment intersection
// scans, cross-layer attribute joins) can take 100+ ms on big-ish
// datasets, and we don't want them blocking the UI thread.

import type { FeatureRef } from '../map/types';
import type { EmapHostInternal } from '../map/emap-host';

/**
 * Phase at which a validator runs. Currently only `'after-commit'` is
 * supported — runs after `historychange` fires. Reserved here as a
 * union so future phases (`'before-commit'` for pre-flight rejection,
 * `'on-load'` for source-import validation) can be added without a
 * breaking signature change.
 */
export type ValidatorPhase = 'after-commit';

/** One issue surfaced by a validator run. */
export interface ValidationIssue {
  severity: 'error' | 'warning';
  message: string;
  /** Optional reference to the offending feature (UI can highlight it). */
  ref?: FeatureRef;
}

/** Result of a single validator run. */
export interface ValidationReport {
  /** `true` iff `issues` is empty OR contains only warnings. */
  ok: boolean;
  issues: ValidationIssue[];
}

/**
 * Information passed to validators about the change that triggered the
 * run. Lets a validator scope its work — e.g. only re-check the source
 * that was just modified.
 */
export interface ValidationChange {
  /** Label of the command that just committed (matches history.label). */
  label: string;
}

/**
 * A pluggable validator. Construct via `engine.validators.register(...)`.
 * The `name` is opaque to the engine but is included in the
 * `validationfailed` event payload so apps can route by source.
 */
export interface Validator {
  name: string;
  phase: ValidatorPhase;
  run(host: EmapHostInternal, change: ValidationChange): Promise<ValidationReport>;
}

/** Per-validator outcome bundled into the `validationfailed` event. */
export interface ValidatorResult {
  validator: string;
  report: ValidationReport;
}
