import type { EditCommand } from '../../edit/edit-command';
import type { Transaction } from '../../edit/transaction';

/** Explicit service contract. Providers implement this boundary; consumers do not import implementations. */
export interface HistoryContract {
  /** @internal */
  _clearHistory(): void;
  pushCommand(cmd: EditCommand): void;
  undo(): boolean;
  redo(): boolean;
  /** @internal */
  _publishCommand(command: EditCommand): void;
  canUndo(): boolean;
  canRedo(): boolean;
  clearHistory(): void;
  beginTransaction(): Transaction;
  /** @internal */
  _fireHistoryChange(): void;
}
