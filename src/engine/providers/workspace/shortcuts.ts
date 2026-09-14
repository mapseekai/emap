import type { HistoryContract as HistoryServiceImpl } from '../../../runtime/services/contracts/history';
import type { SurfaceContract as SurfaceServiceImpl } from '../../../runtime/services/contracts/surface';

interface Dependencies {
  history: Pick<HistoryServiceImpl, 'redo' | 'undo'>;
  surface: Pick<SurfaceServiceImpl, '_canvasContainer'>;
}

/** shortcuts implementation, wired through explicit service dependencies. */
export class HistoryShortcutService {
  _historyShortcutUnbind: (() => void) | null = null;

  public bindHistoryShortcuts(target?: HTMLElement): () => void {
    this._historyShortcutUnbind?.();
    const el = target ?? this.deps.surface._canvasContainer;
    // Ensure the element can receive focus so it gets keydown events.
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');

    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const isZ = e.key === 'z' || e.key === 'Z';
      const isY = e.key === 'y' || e.key === 'Y';
      if (isZ && !e.shiftKey) {
        e.preventDefault();
        this.deps.history.undo();
      } else if ((isZ && e.shiftKey) || isY) {
        e.preventDefault();
        this.deps.history.redo();
      }
    };
    el.addEventListener('keydown', handler);
    const unbind = () => {
      el.removeEventListener('keydown', handler);
      if (this._historyShortcutUnbind === unbind) this._historyShortcutUnbind = null;
    };
    this._historyShortcutUnbind = unbind;
    return unbind;
  }

  dispose(): void {
    this._historyShortcutUnbind?.();
    this._historyShortcutUnbind = null;
  }

  constructor(private readonly deps: Dependencies) {}
}
