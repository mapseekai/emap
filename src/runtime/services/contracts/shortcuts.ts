/** Explicit service contract. Providers implement this boundary; consumers do not import implementations. */
export interface ShortcutsContract {
  /** @internal */
  _historyShortcutUnbind: (() => void) | null;
  bindHistoryShortcuts(target?: HTMLElement): () => void;
  dispose(): void;
}
