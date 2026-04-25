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
}
