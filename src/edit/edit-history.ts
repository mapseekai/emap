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

  constructor(options: EditHistoryOptions = {}) {
    this._maxSize = options.maxSize ?? 200;
    if (this._maxSize < 1) {
      throw new Error('EditHistory: maxSize must be >= 1');
    }
  }

  /** Push a new command, evicting the oldest entry if at capacity. */
  push(cmd: EditCommand): void {
    this._undoStack.push(cmd);
    this._redoStack.length = 0;
    if (this._undoStack.length > this._maxSize) {
      this._undoStack.shift();
    }
  }

  /**
   * Pop the top command, invoke its `undo()`, and move it to the redo stack.
   * Returns the executed command, or `null` if there was nothing to undo.
   */
  undo(): EditCommand | null {
    const cmd = this._undoStack.pop();
    if (!cmd) return null;
    cmd.undo();
    this._redoStack.push(cmd);
    return cmd;
  }

  /**
   * Pop the top redo entry, invoke its `do()`, and move it back to the undo
   * stack. Returns the executed command, or `null` if there was nothing.
   */
  redo(): EditCommand | null {
    const cmd = this._redoStack.pop();
    if (!cmd) return null;
    cmd.do();
    this._undoStack.push(cmd);
    return cmd;
  }

  /** Empty both stacks. */
  clear(): void {
    this._undoStack.length = 0;
    this._redoStack.length = 0;
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
    return {
      canUndo: this._undoStack.length > 0,
      canRedo: this._redoStack.length > 0,
      label: top?.label,
    };
  }
}
