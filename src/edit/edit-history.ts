import type { EditCommand } from './edit-command';

export interface EditHistoryOptions {
  /**
   * Maximum number of commands retained in the undo stack. Older commands
   * are evicted when this is exceeded. Defaults to 200.
   */
  maxSize?: number;
}

export interface HistoryStateSnapshot {
  canUndo: boolean;
  canRedo: boolean;
  /** Label of the most recent command at the top of the undo stack, if any. */
  label?: string;
  /**
   * Number of commands currently in the undo stack flagged as
   * `stale`. Non-zero after any `DatasetReplaceCommand` lands; the UI
   * can render a divider in the history list at the boundary.
   */
  staleCount: number;
  /**
   * `true` iff the command that {@link EditHistory.undo} would next visit is stale
   * (i.e. cannot be reversed in place). Provides a single boolean for UI
   * tooltips like "the next undo crosses a topology rebuild — earlier
   * edits cannot be replayed".
   */
  topIsStale: boolean;
  /**
   * `true` only on the {@link HistoryStateSnapshot} produced immediately
   * after `undo()` skipped a stale command. Resets on the next event.
   * Used by UI to surface a one-shot toast.
   */
  skippedStale?: boolean;
}

/**
 * Linear undo / redo history.
 *
 * - `push(cmd)` records `cmd` and clears any pending redo entries. It does NOT
 *   invoke `cmd.do()` — the caller is expected to have already performed the
 *   work; the command captures what was changed so it can be reversed.
 * - `undo()` invokes `cmd.undo()` and moves `cmd` from the undo stack to the
 *   redo stack.
 * - `redo()` invokes `cmd.do()` and moves `cmd` back onto the undo stack.
 */
export class EditHistory {
  private _undoStack: EditCommand[] = [];
  private _redoStack: EditCommand[] = [];
  private _maxSize: number;
  /**
   * `true` for exactly one snapshot following an `undo()` / `redo()` call
   * that traversed a stale command. Surfaced via `snapshot().skippedStale`
   * so the host can fire one-shot UI feedback. Reset on the next
   * non-stale traversal or on `clear()`.
   */
  private _lastSkippedStale = false;
  /**
   * Active capture buffer for the {@link beginCapture} protocol used by
   * `Transaction`. While non-null, every `push(cmd)` diverts into this
   * buffer instead of mutating the undo stack. `endCapture()` returns
   * the collected commands and unsets this. Nested captures are not
   * supported — a second `beginCapture()` while one is active throws.
   */
  private _captureBuffer: EditCommand[] | null = null;

  constructor(options: EditHistoryOptions = {}) {
    this._maxSize = options.maxSize ?? 200;
    if (this._maxSize < 1) {
      throw new Error('EditHistory: maxSize must be >= 1');
    }
  }

  /**
   * Push a new command, evicting the oldest entry if at capacity.
   *
   * Merge fast-path: if the top of the undo stack defines a `merge`
   * companion AND the incoming command's `mergeable(top)` returns true,
   * the top absorbs the incoming command and nothing is pushed. The
   * redo stack is still cleared (the new edit invalidates forward
   * replay). Used by `VertexMoveCommand` / `FeatureTranslateCommand`
   * to coalesce rapid drag / nudge sequences into one undo step.
   *
   * If `cmd.invalidatesPriorCommands` is `true` (DatasetReplaceCommand),
   * prior undo entries are released and replaced with one lightweight stale
   * boundary before this command is pushed. The command itself remains undoable.
   */
  push(cmd: EditCommand): void {
    // Capture mode (Transaction): divert without touching undo / redo
    // stacks. Merge / barrier / eviction logic is NOT applied here — the
    // captured commands are folded into a single CompositeCommand on
    // commit, which then goes through this method normally.
    if (this._captureBuffer) {
      this._captureBuffer.push(cmd);
      return;
    }
    // Merge attempt comes BEFORE the barrier check so the merged command
    // (still on top) keeps its non-stale status. A barrier never tries
    // to merge — it's not a vertex/translate operation.
    const top = this._undoStack[this._undoStack.length - 1];
    if (top && !top.stale && top.merge && cmd.mergeable?.(top)) {
      top.merge(cmd);
      this._redoStack.length = 0;
      return;
    }

    if (cmd.invalidatesPriorCommands) {
      if (this._undoStack.length > 0) {
        this._undoStack.length = 0;
        this._undoStack.push({
          label: 'Earlier edits unavailable',
          stale: true,
          do() {},
          undo() {},
        });
      }
      this._redoStack.length = 0;
    }
    this._undoStack.push(cmd);
    this._redoStack.length = 0;
    if (this._undoStack.length > this._maxSize) {
      this._undoStack.shift();
    }
  }

  /**
   * Begin a transaction-style capture session. While active, `push(cmd)`
   * routes every command into an internal buffer instead of mutating the
   * undo stack, so a multi-step transaction can batch its child commands
   * and present them as a single undo entry on commit.
   *
   * Throws if a capture is already in progress — nested transactions are
   * not supported. Pair with {@link endCapture}; for safety, transaction
   * code should call `endCapture()` from a `finally`-style path so an
   * error in the middle doesn't leave the history stuck in capture mode.
   */
  beginCapture(): void {
    if (this._captureBuffer) {
      throw new Error('EditHistory: nested capture not supported');
    }
    this._captureBuffer = [];
  }

  /**
   * End the active capture session and return the collected commands in
   * push order. No-op (returns `[]`) if no capture is active. After this
   * call, subsequent `push()` calls resume normal undo-stack behaviour.
   */
  endCapture(): EditCommand[] {
    const buf = this._captureBuffer;
    this._captureBuffer = null;
    return buf ?? [];
  }

  /** True iff a {@link beginCapture} session is currently active. */
  isCapturing(): boolean {
    return this._captureBuffer !== null;
  }

  /**
   * Pop the top command, invoke its `undo()`, and move it to the redo stack.
   * Returns the executed command, or `null` if there was nothing to undo.
   *
   * **Stale handling**: when the top command's `stale` flag is `true`, the
   * command is moved to the redo stack WITHOUT invoking `undo()` (its
   * captured references point at an object the live dataset no longer
   * uses; running it would write to the wrong place). The skip is
   * reflected in the next {@link snapshot} via `skippedStale: true`.
   * `undo()` still returns the moved command so callers can detect that
   * a step was traversed.
   */
  undo(): EditCommand | null {
    const cmd = this._undoStack.pop();
    if (!cmd) return null;
    if (cmd.stale) {
      this._lastSkippedStale = true;
    } else {
      cmd.undo();
      this._lastSkippedStale = false;
    }
    this._redoStack.push(cmd);
    return cmd;
  }

  /**
   * Pop the top redo entry, invoke its `do()`, and move it back to the undo
   * stack. Returns the executed command, or `null` if there was nothing.
   *
   * Stale commands on the redo stack get the same skip semantics as
   * `undo()` — the redo is a no-op transition because the captured refs
   * are still orphaned even though the entry is moving forward in time.
   */
  redo(): EditCommand | null {
    const cmd = this._redoStack.pop();
    if (!cmd) return null;
    if (cmd.stale) {
      this._lastSkippedStale = true;
    } else {
      cmd.do();
      this._lastSkippedStale = false;
    }
    this._undoStack.push(cmd);
    return cmd;
  }

  /** Empty both stacks. */
  clear(): void {
    this._undoStack.length = 0;
    this._redoStack.length = 0;
    this._lastSkippedStale = false;
  }

  canUndo(): boolean {
    return this._undoStack.length > 0;
  }

  canRedo(): boolean {
    return this._redoStack.length > 0;
  }

  /** Number of commands currently in the undo stack. */
  size(): number {
    return this._undoStack.length;
  }

  /** Snapshot of the public history state, suitable for event payloads. */
  snapshot(): HistoryStateSnapshot {
    const top = this._undoStack[this._undoStack.length - 1];
    let staleCount = 0;
    for (const cmd of this._undoStack) if (cmd.stale) staleCount++;
    const snap: HistoryStateSnapshot = {
      canUndo: this._undoStack.length > 0,
      canRedo: this._redoStack.length > 0,
      label: top?.label,
      staleCount,
      topIsStale: !!top?.stale,
    };
    if (this._lastSkippedStale) snap.skippedStale = true;
    return snap;
  }
}
