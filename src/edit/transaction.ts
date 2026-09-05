// Transaction — atomic multi-step editing.
//
// A `Transaction` lets a caller stage several ops / edit commands and
// either commit them as a single undo step or roll the dataset back to
// the state that existed at `beginTransaction()`.
//
// Mechanism:
//
// 1. `Emap.beginTransaction()` constructs a Transaction, which:
//    - calls `host._history.beginCapture()` so subsequent
//      `host._history.push(cmd)` calls divert into the capture buffer
//      instead of mutating the undo stack;
//    - takes a `Selection.snapshot()` so the user's selection can be
//      restored on rollback;
//    - registers itself on `host._activeTransaction` so the runner's
//      `_applyDatasetReplace` can record per-source first-touch dataset
//      snapshots before each op overwrites the live dataset.
//
// 2. While the transaction is active, ops run normally — they push their
//    `DatasetReplaceCommand` (or other EditCommand) to history, but the
//    capture buffer absorbs them silently. Each op also leaves the
//    dataset in its post-op state on the source, so subsequent ops in
//    the transaction see the cumulative effect.
//
// 3. On `commit(label)`:
//    - the buffer is drained;
//    - if non-empty, a single `CompositeCommand` wrapping every captured
//      child is pushed to the real undo stack (the children's effects
//      are NOT replayed — they already happened);
//    - `historychange` fires, and the transaction is closed.
//
// 4. On `rollback()`:
//    - the buffer is drained and captured commands are reverse-undone;
//    - every source touched during the transaction has its dataset
//      restored to the pre-transaction snapshot;
//    - the selection is restored;
//    - `historychange` + `selectionchange` fire and a render is
//      scheduled.
//
// Nesting is not supported. Calling `beginTransaction()` while another
// is open throws via `EditHistory.beginCapture`.

import { CompositeCommand } from './commands/composite';
import { Err, OK, type OpResult } from '../map/op-result';
import type { EmapHostInternal } from '../map/emap-host';
import type { MapshaperDataset } from '../types/mapshaper-types';
import type { SelectionSnapshot } from '../map/selection';
/** Internal surface of a Transaction consumed by the host and op runner. */
export interface TransactionInternal {
  readonly isOpen: boolean;
  _captureFirstTouch(sourceId: string, before: MapshaperDataset): void;
  _trackOperation(operation: Promise<unknown>): void;
}

/**
 * Atomic multi-step edit unit. Stages every command pushed during its
 * lifetime; `commit()` collapses them into one history entry and
 * `rollback()` restores the dataset + selection to the state at
 * construction.
 *
 * Construct via `Emap.beginTransaction()` — direct construction is
 * supported for tests but bypasses the Emap host wiring.
 */
export class Transaction implements TransactionInternal {
  private readonly _host: EmapHostInternal;
  private readonly _datasetSnapshots = new globalThis.Map<string, MapshaperDataset>();
  private readonly _selectionSnapshot: SelectionSnapshot;
  private _closed = false;
  private readonly _pendingOperations = new Set<Promise<unknown>>();

  constructor(host: EmapHostInternal) {
    if (host._activeTransaction) {
      throw new Error('Transaction: another transaction is already active');
    }
    this._host = host;
    this._selectionSnapshot = host._selection.snapshot();
    host._history.beginCapture();
    host._activeTransaction = this;
  }

  /**
   * Internal — invoked by the runner the first time each source's
   * dataset is about to be swapped within this transaction. The dataset
   * passed here is the pre-op snapshot the runner already produced for
   * its own undo bookkeeping; we keep a reference so rollback can
   * restore the source to its true pre-transaction state regardless of
   * how many ops touched it later.
   */
  _captureFirstTouch(sourceId: string, before: MapshaperDataset): void {
    if (!this._datasetSnapshots.has(sourceId)) {
      this._datasetSnapshots.set(sourceId, before);
    }
  }

  _trackOperation(operation: Promise<unknown>): void {
    if (this._closed) return;
    this._pendingOperations.add(operation);
    const settle = () => this._pendingOperations.delete(operation);
    void operation.then(settle, settle);
  }

  /** True iff `commit()` / `rollback()` has not been called yet. */
  get isOpen(): boolean {
    return !this._closed;
  }

  /**
   * Drain the capture buffer, push a single `CompositeCommand` wrapping
   * every staged child to the undo stack (no-op if nothing was staged),
   * and close the transaction. Returns `OK` on success or
   * `Err.hostRemoved()` if the host was torn down mid-transaction.
   *
   * The composite's children are NOT re-executed — their effects were
   * applied as each child was originally captured.
   */
  async commit(label: string): Promise<OpResult> {
    while (this._pendingOperations.size > 0) {
      await Promise.allSettled(this._pendingOperations);
    }
    this._end();
    const cmds = this._host._history.endCapture();
    this._datasetSnapshots.clear();
    if (cmds.length === 0) {
      // Restore controls disabled at beginTransaction(), even without edits.
      if (this._host._history.canUndo() || this._host._history.canRedo()) {
        this._host._fireHistoryChange();
      }
      return this._host._removed ? Err.hostRemoved() : OK;
    }
    const composite = new CompositeCommand(cmds, label);
    this._host._history.push(composite);
    this._host._fireHistoryChange();
    return this._host._removed ? Err.hostRemoved() : OK;
  }

  /**
   * Reverse-undo every staged command, restore each touched source's
   * dataset to its pre-transaction snapshot, restore the selection, and
   * close the transaction. Fires `selectionchange`, `historychange`, and
   * schedules a render.
   *
   * Idempotent only in the sense that calling it twice throws — once
   * the transaction is closed it cannot be re-used.
   */
  rollback(): void {
    this._end();
    // Drain the capture buffer and reverse every captured command in
    // reverse order. This is the only correct rollback path for in-place
    // (direct) commands: they mutate the very dataset object the snapshots
    // below reference, so `setDataset(snapshot)` alone cannot revert them.
    // For replacement commands, undo() re-attaches the pre-op dataset —
    // equivalent to the snapshot restore that follows — so existing
    // behavior is preserved.
    const cmds = this._host._history.endCapture();
    for (let i = cmds.length - 1; i >= 0; i--) {
      try {
        cmds[i]!.undo();
      } catch (error) {
        // Best effort — failures are logged via console.error; replacement-touched
        // sources are still recovered by the snapshot restore below.
        console.error(
          `emap: rollback could not undo "${cmds[i]!.label}"; in-place state may be partially reverted`,
          error,
        );
      }
    }
    // Restore every touched source's dataset to its first-touch snapshot.
    // For sources touched only by direct commands the snapshot IS the live
    // object; re-attaching it is a no-op mutation-wise and doubles as the
    // 'data' notification + DisplayArcs rebuild for the in-place rollback.
    for (const [sourceId, before] of this._datasetSnapshots) {
      const source = this._host._sources.get(sourceId);
      if (source) source.setDataset(before);
    }
    this._datasetSnapshots.clear();
    // Restore selection. `restore` returns the diff between the
    // current (transaction-modified) state and the snapshot so we can
    // fire one `selectionchange` event with the right `added`/`removed`.
    const diff = this._host._selection.restore(this._selectionSnapshot);
    if (diff.changed) this._host._fireSelectionChange(diff);
    // History stack itself didn't grow (capture diverted everything),
    // but listeners that surface "is rollback in progress" UI may want
    // to refresh — fire historychange anyway.
    this._host._fireHistoryChange();
    this._host._scheduleRender();
  }

  private _end(): void {
    if (this._closed) {
      throw new Error('Transaction: already committed or rolled back');
    }
    this._closed = true;
    this._host._activeTransaction = null;
  }
}
