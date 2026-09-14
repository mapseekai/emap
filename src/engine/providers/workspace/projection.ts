import { EventDispatcher } from '../../core/events';
import { ReprojectMapCommand } from '../../../domain/edit/commands/reproject-map';
import { Bounds } from '../../../domain/geo/bounds';
import {
  EpsgProjectionError,
  normalizeProjectCrs,
  normalizeProjectCrsMetadata,
  resolveProjectCrs,
} from '../../../domain/geo/crs-resolver';
import type { CacheContract as WorkspaceCache } from '../../../runtime/services/contracts/cache';
import type { DocumentContract as WorkspaceDocument } from '../../../runtime/services/contracts/document';
import type { HistoryContract as HistoryServiceImpl } from '../../../runtime/services/contracts/history';
import type { RenderSignalsContract as RenderSignals } from '../../../runtime/services/contracts/signals';
import type { ViewContract as ViewServiceImpl } from '../../../runtime/services/contracts/view';

interface Dependencies {
  cache: Pick<WorkspaceCache, '_clearSpatialIndexesForSources' | '_invalidateAllShapeCaches'>;
  document: Pick<
    WorkspaceDocument,
    '_activeTransaction' | '_crsEstablished' | '_history' | '_removed' | '_sources'
  >;
  events: EventDispatcher;
  history: Pick<HistoryServiceImpl, '_fireHistoryChange'>;
  signal: AbortSignal;
  signals: RenderSignals;
  view: Pick<ViewServiceImpl, '_projection' | '_viewport'>;
}

/** projection implementation, wired through explicit service dependencies. */
export class ProjectionServiceImpl {
  public setCRS(crs: string): void {
    if (this.deps.document._sources.size > 0) {
      throw new Error(
        'Cannot change the map CRS while sources are registered; use map.reproject()',
      );
    }
    this.deps.view._projection.setCRS(crs);
    this.deps.view._viewport.setCRS(crs);
    this.deps.document._crsEstablished = true;
    this.deps.events.fire('crschange');
  }

  public async reproject(targetCrs: string): Promise<void> {
    if (this.deps.document._activeTransaction) {
      throw new Error('Cannot reproject during an active transaction');
    }
    if (targetCrs.trim().length === 0) {
      throw new Error('targetCrs must be a non-empty CRS string');
    }
    const startCrs = this.deps.view._projection.crs;
    const sourceStates = new Map(
      Array.from(this.deps.document._sources, ([id, source]) => {
        const dataset = source.getDataset();
        return [
          id,
          {
            source,
            dataset,
            editVersion: dataset?.editVersion ?? 0,
            attributeVersion: dataset?.attributeVersion ?? 0,
          },
        ] as const;
      }),
    );
    const assertCurrent = () => {
      if (this.deps.document._removed || this.deps.signal.aborted)
        throw new Error('Map was removed during reprojection');
      if (this.deps.document._activeTransaction)
        throw new Error('Cannot reproject during an active transaction');
      if (this.deps.view._projection.crs !== startCrs)
        throw new Error('Map CRS changed during reprojection');
      if (this.deps.document._sources.size !== sourceStates.size)
        throw new Error('Map sources changed during reprojection');
      for (const [id, state] of sourceStates) {
        if (
          this.deps.document._sources.get(id) !== state.source ||
          state.source.getDataset() !== state.dataset ||
          (state.dataset?.editVersion ?? 0) !== state.editVersion ||
          (state.dataset?.attributeVersion ?? 0) !== state.attributeVersion
        )
          throw new Error(`Source "${id}" changed during reprojection`);
      }
    };
    assertCurrent();
    const targetCrsMetadata = normalizeProjectCrsMetadata(targetCrs);
    const normalizedTarget = await resolveProjectCrs(targetCrs);
    let normalizedCurrent: string;
    try {
      normalizedCurrent = await resolveProjectCrs(this.deps.view._projection.crs);
    } catch (err) {
      if (!(err instanceof EpsgProjectionError)) throw err;
      normalizedCurrent = normalizeProjectCrs(this.deps.view._projection.crs);
    }
    assertCurrent();
    if (normalizedCurrent === normalizedTarget) return;

    const beforeView = {
      crs: this.deps.view._projection.crs,
      extent: this.deps.view._viewport.extent.clone(),
    };
    const prepared = await this.deps.view._projection.prepareReproject(
      normalizedTarget,
      this.deps.document._sources,
      targetCrsMetadata,
    );
    assertCurrent();
    for (const replacement of prepared.replacements) {
      if (
        this.deps.document._sources.get(replacement.sourceId) !== replacement.source ||
        replacement.source.getDataset() !== replacement.before ||
        (replacement.before.editVersion ?? 0) !== replacement.beforeEditVersion ||
        (replacement.before.attributeVersion ?? 0) !== (replacement.beforeAttributeVersion ?? 0)
      ) {
        throw new Error(`Source "${replacement.sourceId}" changed during reprojection`);
      }
    }

    const afterExtent = prepared.extent.hasBounds()
      ? prepared.extent
      : this.deps.view._viewport.extent.clone();
    const command = new ReprojectMapCommand({
      replacements: prepared.replacements,
      before: beforeView,
      after: { crs: normalizedTarget, extent: afterExtent },
      applyViewState: (state) => this._applyReprojectedView(state.crs, state.extent),
      publishViewState: () => {
        this.deps.events.fire('crschange');
        this.deps.events.fire('move');
      },
    });
    command.do();
    this.deps.document._history.push(command);
    this.deps.cache._invalidateAllShapeCaches();
    this.deps.signals.requestRender();
    command.publish();
    this.deps.history._fireHistoryChange();
  }

  _applyReprojectedView(crs: string, extent: Bounds): void {
    this.deps.view._projection.setCRS(crs);
    this.deps.view._viewport.setCRS(crs);
    this.deps.document._crsEstablished = true;
    this.deps.view._viewport.clearInitialState();
    this.deps.cache._clearSpatialIndexesForSources(this.deps.document._sources.keys());
    if (extent.hasBounds()) this.deps.view._viewport.setExtent(extent);
  }

  constructor(private readonly deps: Dependencies) {}
}
