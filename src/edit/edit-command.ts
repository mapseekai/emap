/**
 * An undoable edit memento. NOT to be confused with a mapshaper
 * "operation" (`emap.ops.*`) — those wrap a CLI / parsed-command run
 * against a dataset and internally push a `DatasetReplaceCommand` to
 * history. `EditCommand` is the lower-level abstraction that lives on
 * the undo / redo stack.
 *
 * Lifecycle (memento pattern):
 * - The caller mutates the data, then constructs the command and calls
 *   `Emap.pushCommand(cmd)`. The command stores any state needed to
 *   reverse the change. `pushCommand` does NOT call `do()`.
 * - On undo, `EditHistory` invokes `cmd.undo()` to restore the prior state.
 * - On redo, `EditHistory` invokes `cmd.do()` to re-apply the change.
 *
 * Implementations must capture enough state in their constructor that
 * both `do()` and `undo()` can run multiple times without diverging.
 */
export interface EditCommand {
  /** Re-apply the operation. Called by `EditHistory.redo()`. */
  do(): void;
  /** Reverse the operation. Called by `EditHistory.undo()`. */
  undo(): void;
  /** Optional human-readable label, surfaced in `historychange` events. */
  readonly label?: string;
  /**
   * Optional merge predicate, evaluated by `EditHistory.push` against the
   * current top of the undo stack. When `true`, the new command is NOT
   * pushed; instead `prev.merge(this)` is invoked and `prev` absorbs the
   * follow-up's effect. Used to collapse rapid repeated edits — successive
   * arrow-key vertex nudges, mouse-drag tween steps, etc. — into one
   * undoable entry.
   *
   * Implementations should be cheap (O(N) at worst over command-internal
   * fields) and stable (no I/O, no side effects).
   */
  mergeable?(prev: EditCommand): boolean;

  /**
   * Companion to {@link mergeable}: invoked by `EditHistory.push` only
   * when `next.mergeable(this)` returned `true`. Mutates this command in
   * place to absorb `next`'s effect; `next` is discarded after the call
   * returns. Implementations typically refresh a "newest-coordinate"
   * field while preserving the oldest "starting" capture so undo still
   * reverses the cumulative work.
   */
  merge?(next: EditCommand): void;

  /**
   * Static marker: when `true`, pushing this command tells `EditHistory`
   * to flag every command currently in the undo stack as `stale`. Used by
   * `DatasetReplaceCommand` (clip / dissolve / buffer / …) — those swap
   * out the live dataset object, so commands captured against the OLD
   * dataset can no longer mutate the right reference.
   *
   * The command itself is NOT stale at push time; only the entries below
   * it become stale.
   */
  readonly invalidatesPriorCommands?: boolean;

  /**
   * Set by `EditHistory.push` when an `invalidatesPriorCommands` command
   * is pushed above this entry. Stays `true` for the rest of this entry's
   * lifetime — even after the invalidating command is undone, the captured
   * dataset reference is still orphaned (the in-place undo of a
   * dataset-swap restores a deep copy that has a different identity from
   * the object this command was constructed against).
   *
   * `EditHistory.undo` skips stale commands: pops them onto the redo
   * stack without invoking `undo()` and surfaces the skip via the
   * `HistoryStateSnapshot.skippedStale` flag on the next change event.
   * UIs should treat the boundary as a "history barrier" — visible in
   * the list, but un-replayable.
   */
  stale?: boolean;
}
