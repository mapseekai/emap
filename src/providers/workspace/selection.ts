import { EventDispatcher } from '../../core/events';
import { SelectionDiff, type SelectMode } from '../../map/selection';
import { type FeatureRef, type HighlightStyle, type QueriedFeature } from '../../map/types';
import type { DocumentContract as WorkspaceDocument } from '../../services/contracts/document';
import type { RenderSignalsContract as RenderSignals } from '../../services/contracts/signals';

interface Dependencies {
  document: Pick<WorkspaceDocument, '_highlightManager' | '_selection'>;
  events: EventDispatcher;
  signals: RenderSignals;
}

/** selection implementation, wired through explicit service dependencies. */
export class SelectionServiceImpl {
  public setHighlightedFeatures(
    features: Array<QueriedFeature | FeatureRef>,
    style?: HighlightStyle,
  ): void {
    this.deps.document._highlightManager.setHighlightedFeatures(features, style);
    this.deps.signals.requestRender();
  }

  public clearHighlightedFeatures(): void {
    if (this.deps.document._highlightManager.clearHighlightedFeatures()) {
      this.deps.signals.requestRender();
    }
  }

  public setHighlightStyle(style: HighlightStyle): void {
    if (this.deps.document._highlightManager.setHighlightStyle(style)) {
      this.deps.signals.requestRender();
    }
  }

  public select(features: ReadonlyArray<FeatureRef>, options?: { mode?: SelectMode }): void {
    const mode = options?.mode ?? 'replace';
    const diff = this.deps.document._selection.apply(features, mode);
    this._fireSelectionChange(diff);
  }

  public deselect(features: ReadonlyArray<FeatureRef>): void {
    const diff = this.deps.document._selection.remove(features);
    this._fireSelectionChange(diff);
  }

  public clearSelection(): void {
    const diff = this.deps.document._selection.clear();
    this._fireSelectionChange(diff);
  }

  public getSelection(): FeatureRef[] {
    return this.deps.document._selection.getAll();
  }

  public isSelected(feature: FeatureRef): boolean {
    return this.deps.document._selection.has(feature);
  }

  _fireSelectionChange(diff: SelectionDiff): void {
    if (!diff.changed) return;
    this.deps.events.fire('selectionchange', {
      selected: this.deps.document._selection.getAll(),
      added: diff.added,
      removed: diff.removed,
    });
  }

  _clearHighlightsForLayer(sourceId: string, layerKeys: readonly string[]): void {
    let removed = false;
    for (const key of layerKeys)
      removed = this.deps.document._highlightManager.removeLayer(sourceId, key) || removed;
    if (removed) this.deps.signals.requestRender();
  }

  constructor(private readonly deps: Dependencies) {}
}
