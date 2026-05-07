/**
 * An undoable edit operation.
 *
 * Lifecycle (memento pattern):
 * - The caller mutates the data, then constructs the command and calls
 *   `Emap.pushCommand(cmd)`. The command stores any state needed to reverse
 *   the operation. `pushCommand` does NOT call `do()`.
 * - On undo, `EditHistory` invokes `cmd.undo()` to restore the prior state.
 * - On redo, `EditHistory` invokes `cmd.do()` to re-apply the operation.
 *
 * Implementations must capture enough state in their constructor that both
 * `do()` and `undo()` can run multiple times without diverging.
 */
export interface EditCommand {
  /** Re-apply the operation. Called by `EditHistory.redo()`. */
  do(): void;
  /** Reverse the operation. Called by `EditHistory.undo()`. */
  undo(): void;
  /** Optional human-readable label, surfaced in `historychange` events. */
  readonly label?: string;
  /**
   * Optional merge hook for collapsing consecutive related edits into one
   * history entry. Reserved for future use; v1 always pushes one entry per
   * command.
   */
  mergeable?(prev: EditCommand): boolean;

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
