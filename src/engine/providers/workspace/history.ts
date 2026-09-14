import { EventDispatcher } from '../../core/events';
import type { EditCommand } from '../../../domain/edit/edit-command';
import { HistoryStateSnapshot } from '../../../domain/edit/edit-history';
import { Transaction } from '../../../domain/edit/transaction';
import type { EmapHostInternal } from '../../map/emap-host';
import type { CacheContract as WorkspaceCache } from '../../../runtime/services/contracts/cache';
import type { DocumentContract as WorkspaceDocument } from '../../../runtime/services/contracts/document';
import type { RenderSignalsContract as RenderSignals } from '../../../runtime/services/contracts/signals';

interface Dependencies {
  cache: Pick<WorkspaceCache, '_invalidateAllShapeCaches'>;
  document: Pick<WorkspaceDocument, '_history' | '_removed'>;
  events: EventDispatcher;
  host: EmapHostInternal;
  signal: AbortSignal;
  signals: RenderSignals;
}

/** history implementation, wired through explicit service dependencies. */
export class HistoryServiceImpl {
  _clearHistory(): void {
    const history = this.deps.document._history.snapshot();
    if (history.canUndo || history.canRedo) {
      this.deps.document._history.clear();
      this._fireHistoryChange();
    }
  }

  public pushCommand(cmd: EditCommand): void {
    this.deps.document._history.push(cmd);
    this._fireHistoryChange();
  }

  public undo(): boolean {
    const cmd = this.deps.document._history.undo();
    if (!cmd) return false;
    // Any command that touched `layer.shapes` (delete/create/...) will have
    // moved feature ids around; invalidate every shape-derived cache rather
    // than threading per-command source ids through the history.
    this.deps.cache._invalidateAllShapeCaches();
    this.deps.signals.requestRender();
    this._publishCommand(cmd);
    this._fireHistoryChange();
    return true;
  }

  public redo(): boolean {
    const cmd = this.deps.document._history.redo();
    if (!cmd) return false;
    this.deps.cache._invalidateAllShapeCaches();
    this.deps.signals.requestRender();
    this._publishCommand(cmd);
    this._fireHistoryChange();
    return true;
  }

  _publishCommand(command: EditCommand): void {
    if ('publish' in command && typeof command.publish === 'function') {
      command.publish();
    }
  }

  public canUndo(): boolean {
    return this.deps.document._history.canUndo();
  }

  public canRedo(): boolean {
    return this.deps.document._history.canRedo();
  }

  public clearHistory(): void {
    const wasNonEmpty =
      this.deps.document._history.canUndo() || this.deps.document._history.canRedo();
    this.deps.document._history.clear();
    if (wasNonEmpty) this._fireHistoryChange();
  }

  public beginTransaction(): Transaction {
    if (this.deps.document._removed || this.deps.signal.aborted)
      throw new Error('Cannot begin a transaction after map removal');
    const transaction = new Transaction(this.deps.host);
    this._fireHistoryChange();
    return transaction;
  }

  _fireHistoryChange(): void {
    const snap: HistoryStateSnapshot = this.deps.document._history.snapshot();
    this.deps.events.fire('historychange', snap);
  }

  constructor(private readonly deps: Dependencies) {}
}
