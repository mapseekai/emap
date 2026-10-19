import type { FormatRegistryContract } from '../../../runtime/services/formats';
import type { SourceFactoryContract } from '../../../runtime/services/source-factory';
import { EventDispatcher, type EventListener } from '../../core/events';
import {
  normalizeProjectCrsMetadata,
  resolveDatasetCRSMetadata,
  resolveProjectCrsDefinition,
  setDatasetCrsMetadata,
} from '../../../domain/geo/crs-resolver';
import { type LayerSpecification } from '../../map/layer';
import {
  consumeReadySourceLoadPlan,
  createReadySourceLoadPlan,
  createSourceLoadDraft,
  getSourceLoadDraftState,
  SourceLoadError,
  type PreparedDatasetCommit,
  type ReadySourceLoadPlan,
  type ReadySourceLoadState,
  type SourceLoadAnswers,
  type SourceLoadDiagnostic,
  type SourceLoadDraft,
  type SourceLoadRequest,
  type SourceLoadState,
  type SourcePreflightResult,
} from '../../map/source-loading';
import type { CreateLayerOptions } from '../../../domain/source/create-layer';
import {
  isMutableTopologySource,
  type MutableTopologySource,
  type TopologySource,
} from '../../../domain/source/source';
import { TopologySource as ConcreteTopologySource } from '../../../domain/source/topology-source';
import type { MapshaperDataset } from '../../../shared/types/mapshaper-types';
import type { CacheContract as WorkspaceCache } from '../../../runtime/services/contracts/cache';
import type { DocumentContract as WorkspaceDocument } from '../../../runtime/services/contracts/document';
import type { HistoryContract as HistoryServiceImpl } from '../../../runtime/services/contracts/history';
import type { LayerContract as LayerServiceImpl } from '../../../runtime/services/contracts/layers';
import type { SelectionContract as SelectionServiceImpl } from '../../../runtime/services/contracts/selection';
import type { RenderSignalsContract as RenderSignals } from '../../../runtime/services/contracts/signals';
import type { ViewContract as ViewServiceImpl } from '../../../runtime/services/contracts/view';

interface PreparedSourceRegistration {
  readonly token: symbol;
  readonly state: ReadySourceLoadState;
  readonly dataset: MapshaperDataset;
  readonly targetCrs: string;
  readonly expectedMapCrs?: string;
}

function sourceLoadError(code: SourceLoadDiagnostic['code'], message: string): SourceLoadError {
  return new SourceLoadError(code, [{ code, severity: 'error', message }]);
}

function renderedLayersEqual(
  left: readonly LayerSpecification[],
  right: readonly LayerSpecification[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((layer, index) => {
    const candidate = right[index];
    return (
      candidate !== undefined &&
      layer.id === candidate.id &&
      layer.type === candidate.type &&
      layer.source === candidate.source &&
      layer['source-layer'] === candidate['source-layer'] &&
      (layer.layout?.visibility ?? 'visible') === (candidate.layout?.visibility ?? 'visible')
    );
  });
}

interface Dependencies {
  formats: FormatRegistryContract;
  cache: Pick<WorkspaceCache, '_featureQuery' | '_invalidateShapeCachesForSources'>;
  document: Pick<
    WorkspaceDocument,
    | '_activeTransaction'
    | '_crsEstablished'
    | '_highlightManager'
    | '_removed'
    | '_selection'
    | '_sources'
  >;
  events: EventDispatcher;
  history: Pick<HistoryServiceImpl, '_clearHistory'>;
  layers: Pick<
    LayerServiceImpl,
    '_defaultLayersDirty' | '_filterResolver' | '_fireLayerChange' | '_layers' | 'getRenderedLayers'
  >;
  selection: Pick<SelectionServiceImpl, '_fireSelectionChange'>;
  signal: AbortSignal;
  signals: RenderSignals;
  sourceFactory: SourceFactoryContract;
  view: Pick<ViewServiceImpl, '_projection' | '_viewport'>;
}

/** source implementation, wired through explicit service dependencies. */
export class SourceServiceImpl {
  private readonly formatReleases = new Map<string, () => void>();
  _sourceListeners = new globalThis.Map<
    string,
    EventListener<{ reason?: 'edit' | 'load' | 'replace' | 'reproject' }>
  >();

  _pendingSourceCommits = new globalThis.Map<string, symbol>();

  public async preflightSource(request: SourceLoadRequest): Promise<SourcePreflightResult>;

  public async preflightSource(
    draft: SourceLoadDraft,
    answers: SourceLoadAnswers,
  ): Promise<SourcePreflightResult>;

  public async preflightSource(
    requestOrDraft: SourceLoadRequest | SourceLoadDraft,
    answers: SourceLoadAnswers = {},
  ): Promise<SourcePreflightResult> {
    if (this.deps.document._removed || this.deps.signal.aborted) {
      return {
        status: 'rejected',
        diagnostics: [
          {
            code: 'source-load-cancelled',
            severity: 'error',
            message: 'Cannot preflight a source after the map has been removed',
          },
        ],
      };
    }
    let state: SourceLoadState;
    let draft: SourceLoadDraft;
    let suppliedCrs: string | undefined;

    if ('kind' in requestOrDraft) {
      const draftState = getSourceLoadDraftState(this, requestOrDraft);
      if (!draftState) {
        return {
          status: 'rejected',
          diagnostics: [
            {
              code: 'source-plan-invalid',
              severity: 'error',
              message: 'Source load draft is invalid or belongs to another map',
            },
          ],
        };
      }
      state = draftState;
      draft = requestOrDraft;
      suppliedCrs = answers.sourceCrs;
    } else {
      const id = requestOrDraft.id;
      if (this.deps.document._sources.has(id)) {
        return {
          status: 'rejected',
          diagnostics: [
            {
              code: 'source-id-conflict',
              severity: 'error',
              message: `Source "${id}" already exists`,
            },
          ],
        };
      }

      let source: TopologySource;
      if ('source' in requestOrDraft) {
        source = requestOrDraft.source;
      } else {
        let parsedSource: ConcreteTopologySource;
        try {
          parsedSource = await this.deps.sourceFactory.fromInput(
            id,
            requestOrDraft.input,
            requestOrDraft.sourceOptions,
          );
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Source parsing failed';
          return {
            status: 'rejected',
            diagnostics: [{ code: 'source-load-rejected', severity: 'error', message }],
          };
        }
        source = parsedSource;
      }

      if (!isMutableTopologySource(source)) {
        return {
          status: 'rejected',
          diagnostics: [
            {
              code: 'source-load-rejected',
              severity: 'error',
              message: `Source "${id}" does not implement the mutable topology contract`,
            },
          ],
        };
      }
      const dataset = source.getDataset();
      if (!dataset) {
        return {
          status: 'rejected',
          diagnostics: [
            {
              code: 'source-load-rejected',
              severity: 'error',
              message: `Source "${id}" has no parsed dataset`,
            },
          ],
        };
      }
      state = {
        owner: this,
        id,
        source,
        dataset,
        editVersion: dataset.editVersion ?? 0,
        metadataCrs: resolveDatasetCRSMetadata(dataset),
        mapCrs: this.deps.document._crsEstablished ? this.deps.view._projection.crs : undefined,
      };
      draft = createSourceLoadDraft(state);
      suppliedCrs = requestOrDraft.sourceCrs;
    }

    const summaryBase = {
      id: state.id,
      layerCount: state.dataset.layers.length,
      metadataCrs: state.metadataCrs,
    };
    const hasSuppliedCrs = suppliedCrs !== undefined;
    const trimmedCrs = suppliedCrs?.trim();
    if (hasSuppliedCrs && !trimmedCrs) {
      return {
        status: 'needs-input',
        draft,
        requirements: [{ code: 'source-crs', field: 'sourceCrs', reason: 'invalid' }],
        summary: summaryBase,
        diagnostics: [
          {
            code: 'source-crs-invalid',
            severity: 'error',
            message: 'Source CRS cannot be empty',
            suppliedCrs: trimmedCrs,
            metadataCrs: state.metadataCrs,
          },
        ],
      };
    }
    const candidateCrs = trimmedCrs ?? state.metadataCrs;
    if (!candidateCrs) {
      return {
        status: 'needs-input',
        draft,
        requirements: [{ code: 'source-crs', field: 'sourceCrs', reason: 'missing' }],
        summary: summaryBase,
        diagnostics: [],
      };
    }

    let resolvedCandidate;
    try {
      resolvedCandidate = await resolveProjectCrsDefinition(candidateCrs);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Source CRS is invalid';
      return {
        status: 'needs-input',
        draft,
        requirements: [{ code: 'source-crs', field: 'sourceCrs', reason: 'invalid' }],
        summary: summaryBase,
        diagnostics: [
          {
            code: 'source-crs-invalid',
            severity: 'error',
            message,
            suppliedCrs: trimmedCrs,
            metadataCrs: state.metadataCrs,
          },
        ],
      };
    }

    const effectiveCrs = normalizeProjectCrsMetadata(candidateCrs) ?? candidateCrs;
    const diagnostics: SourceLoadDiagnostic[] = [];
    if (trimmedCrs && state.metadataCrs) {
      try {
        const resolvedMetadata = await resolveProjectCrsDefinition(state.metadataCrs);
        if (resolvedMetadata.signature !== resolvedCandidate.signature) {
          diagnostics.push({
            code: 'source-crs-overrides-metadata',
            severity: 'warning',
            suppliedCrs: trimmedCrs,
            metadataCrs: state.metadataCrs,
            effectiveCrs,
          });
        }
      } catch {
        diagnostics.push({
          code: 'source-crs-overrides-metadata',
          severity: 'warning',
          suppliedCrs: trimmedCrs,
          metadataCrs: state.metadataCrs,
          effectiveCrs,
        });
      }
    }

    return {
      status: 'ready',
      plan: createReadySourceLoadPlan(state, effectiveCrs),
      summary: { ...summaryBase, sourceCrs: effectiveCrs },
      diagnostics,
    };
  }

  public async addSource(
    id: string,
    source: TopologySource,
    answers: SourceLoadAnswers = {},
  ): Promise<void> {
    const result = await this.preflightSource({ id, source, sourceCrs: answers.sourceCrs });
    if (result.status === 'ready') {
      await this.confirmSource(result.plan);
      return;
    }

    const diagnostics =
      result.diagnostics.length > 0
        ? result.diagnostics
        : [
            {
              code: 'source-crs-required' as const,
              severity: 'error' as const,
              message: `Source "${id}" requires an explicit CRS`,
            },
          ];
    throw new SourceLoadError(diagnostics[0].code, diagnostics);
  }

  public async createLayer(
    id: string,
    options: CreateLayerOptions,
  ): Promise<ConcreteTopologySource> {
    const source = await this.deps.sourceFactory.create(id, options);
    await this.addSource(id, source);
    return source;
  }

  public async confirmSource(plan: ReadySourceLoadPlan): Promise<void> {
    if (this.deps.document._activeTransaction) {
      throw new Error('Cannot add a source during an active transaction');
    }
    const state = consumeReadySourceLoadPlan(this, plan);
    if (this.deps.document._removed || this.deps.signal.aborted) {
      throw sourceLoadError('source-load-cancelled', 'Cannot confirm a source after map removal');
    }
    const pending = (this._pendingSourceCommits ??= new globalThis.Map<string, symbol>());
    if (this.deps.document._sources.has(state.id) || pending.has(state.id)) {
      throw sourceLoadError(
        'source-id-conflict',
        `Source "${state.id}" already exists or is loading`,
      );
    }
    if (
      state.mapCrs !== undefined &&
      (!this.deps.document._crsEstablished || this.deps.view._projection.crs !== state.mapCrs)
    ) {
      throw sourceLoadError(
        'source-plan-stale',
        `Map CRS changed after source "${state.id}" was preflighted`,
      );
    }

    const token = Symbol(state.id);
    pending.set(state.id, token);
    try {
      for (;;) {
        this._assertSourceLoadState(state, token);
        const expectedMapCrs = this.deps.document._crsEstablished
          ? this.deps.view._projection.crs
          : undefined;
        const targetCrs = expectedMapCrs ?? state.sourceCrs;
        let prepared: MapshaperDataset = {
          ...state.dataset,
          info: { ...state.dataset.info },
        };
        setDatasetCrsMetadata(prepared, state.sourceCrs);

        const [resolvedSource, resolvedTarget] = await Promise.all([
          resolveProjectCrsDefinition(state.sourceCrs),
          resolveProjectCrsDefinition(targetCrs),
        ]);
        if (resolvedSource.signature !== resolvedTarget.signature) {
          const targetMetadata = normalizeProjectCrsMetadata(targetCrs) ?? targetCrs;
          prepared = await state.source.prepareReprojectDataset(
            prepared,
            targetCrs,
            targetMetadata,
          );
        }

        this._assertSourceLoadState(state, token);
        const preparedCrs = resolveDatasetCRSMetadata(prepared);
        if (
          !preparedCrs ||
          (await resolveProjectCrsDefinition(preparedCrs)).signature !== resolvedTarget.signature
        ) {
          throw sourceLoadError(
            'source-load-rejected',
            `Prepared dataset for source "${state.id}" does not match map CRS`,
          );
        }
        if (
          this._commitPreparedSource({
            token,
            state,
            dataset: prepared,
            targetCrs,
            expectedMapCrs,
          })
        ) {
          return;
        }
      }
    } finally {
      if (pending.get(state.id) === token) pending.delete(state.id);
    }
  }

  _commitPreparedSource(registration: PreparedSourceRegistration): boolean {
    const { token, state, dataset, targetCrs, expectedMapCrs } = registration;
    this._assertSourceLoadState(state, token);
    const currentMapCrs = this.deps.document._crsEstablished
      ? this.deps.view._projection.crs
      : undefined;
    if (currentMapCrs !== expectedMapCrs) {
      if (state.mapCrs === undefined) return false;
      throw sourceLoadError(
        'source-plan-stale',
        `Map CRS changed while source "${state.id}" was being prepared`,
      );
    }
    if ((expectedMapCrs ?? state.sourceCrs) !== targetCrs) {
      throw sourceLoadError(
        'source-plan-stale',
        `Source "${state.id}" was prepared for a stale map CRS`,
      );
    }

    const { id, source } = state;
    const previousMapCrs = this.deps.view._projection.crs;
    const previousCrsEstablished = this.deps.document._crsEstablished;
    const previousDefaultLayersDirty = this.deps.layers._defaultLayersDirty;
    const renderedLayersBefore = this.deps.layers.getRenderedLayers();
    const adoptedMapCrs = expectedMapCrs === undefined;
    const onData: EventListener<{ reason?: 'edit' | 'load' | 'replace' | 'reproject' }> = (
      event,
    ) => {
      if (event.type === 'display') {
        if (this.deps.document._sources.get(id) === source) this.deps.signals.requestRender();
        return;
      }
      this._handleSourceData(id, source, event);
    };

    const releaseFormat = source.bindFormatRegistry?.(this.deps.formats);
    try {
      source.setDatasetNormalizer((nextDataset) =>
        this._normalizeSourceDataset(id, source, nextDataset),
      );
      source.setManagedCRS(() => this.deps.view._projection.crs);
      source.setDataset(dataset, false);
      if (adoptedMapCrs) {
        this.deps.view._projection.setCRS(targetCrs);
        this.deps.view._viewport.setCRS(targetCrs);
        this.deps.document._crsEstablished = true;
      }
      this.deps.document._sources.set(id, source);
      this._sourceListeners.set(id, onData);
      source.on('data', onData);
      source.on('display', onData);
      if (releaseFormat) this.formatReleases.set(id, releaseFormat);

      this._pendingSourceCommits.delete(id);
      this._handleSourceData(id, source, { reason: 'load' }, renderedLayersBefore, adoptedMapCrs);
      return true;
    } catch (error: unknown) {
      releaseFormat?.();
      this.formatReleases.delete(id);
      source.off('data', onData);
      source.off('display', onData);
      this._sourceListeners.delete(id);
      if (this.deps.document._sources.get(id) === source) this.deps.document._sources.delete(id);
      source.setDatasetNormalizer(null);
      source.setManagedCRS(null);
      source.setDataset(state.dataset, false);
      if (adoptedMapCrs) {
        this.deps.view._projection.setCRS(previousMapCrs);
        this.deps.view._viewport.setCRS(previousMapCrs);
      }
      this.deps.document._crsEstablished = previousCrsEstablished;
      this.deps.layers._defaultLayersDirty = previousDefaultLayersDirty;
      throw error;
    }
  }

  _assertSourceLoadState(state: ReadySourceLoadState, token: symbol): void {
    if (this.deps.document._removed || this.deps.signal.aborted) {
      throw sourceLoadError('source-load-cancelled', 'Map was removed during source loading');
    }
    if (this.deps.document._activeTransaction) {
      throw new Error('Cannot add a source during an active transaction');
    }
    if (this._pendingSourceCommits.get(state.id) !== token) {
      throw sourceLoadError('source-load-cancelled', `Source load for "${state.id}" was cancelled`);
    }
    const dataset = state.source.getDataset();
    if (dataset !== state.dataset || (dataset.editVersion ?? 0) !== state.editVersion) {
      throw sourceLoadError(
        'source-plan-stale',
        `Source "${state.id}" changed after it was preflighted`,
      );
    }
    if (this.deps.document._sources.has(state.id)) {
      throw sourceLoadError('source-id-conflict', `Source "${state.id}" already exists`);
    }
  }

  _handleSourceData(
    id: string,
    source: MutableTopologySource,
    event: { reason?: 'edit' | 'load' | 'replace' | 'reproject'; origin?: 'external' },
    renderedLayersBefore = this.deps.layers.getRenderedLayers(),
    crsChanged = false,
  ): void {
    if (this.deps.document._sources.get(id) !== source) return;
    this.deps.layers._defaultLayersDirty = true;
    this.deps.cache._invalidateShapeCachesForSources([id]);
    if (event.reason !== 'edit') this.deps.cache._featureQuery?.prebuildForRendering(id);
    const renderedLayersAfter = this.deps.layers.getRenderedLayers();
    if (!renderedLayersEqual(renderedLayersBefore, renderedLayersAfter)) {
      this.deps.layers._fireLayerChange('effective', undefined, renderedLayersAfter);
    }
    if (event.reason === 'load' || event.origin === 'external') {
      this.deps.history._clearHistory();
      const selected = this.deps.document._selection.getAll().filter((ref) => ref.source === id);
      if (selected.length > 0)
        this.deps.selection._fireSelectionChange(this.deps.document._selection.remove(selected));
      this.deps.document._highlightManager?.removeSource(id);
    }
    if (crsChanged) this.deps.events.fire('crschange');
    this.deps.events.fire('data', {
      sourceId: id,
      reason: event.reason,
      ...(event.origin ? { origin: event.origin } : {}),
    });
    this.deps.signals.requestRender();
  }

  async _normalizeSourceDataset(
    id: string,
    source: MutableTopologySource,
    dataset: MapshaperDataset,
  ): Promise<MapshaperDataset | PreparedDatasetCommit> {
    this._assertNormalizationCommit(id, source, this.deps.view._projection.crs);
    if (this.deps.document._sources.get(id) !== source) {
      throw new Error(`Source "${id}" is no longer registered`);
    }
    const sourceCrs = resolveDatasetCRSMetadata(dataset);
    if (!sourceCrs) {
      throw new Error(`Dataset for source "${id}" has no explicit CRS metadata`);
    }

    const targetCrs = this.deps.view._projection.crs;
    const [resolvedSource, resolvedTarget] = await Promise.all([
      resolveProjectCrsDefinition(sourceCrs),
      resolveProjectCrsDefinition(targetCrs),
    ]);
    this._assertNormalizationCommit(id, source, targetCrs);
    if (resolvedSource.signature === resolvedTarget.signature) {
      return {
        dataset,
        intendedMapCrs: targetCrs,
        assertCommittable: () => this._assertNormalizationCommit(id, source, targetCrs),
      };
    }

    const targetMetadata = normalizeProjectCrsMetadata(targetCrs) ?? targetCrs;
    const projected = await source.prepareReprojectDataset(dataset, targetCrs, targetMetadata);
    this._assertNormalizationCommit(id, source, targetCrs);
    return {
      dataset: projected,
      intendedMapCrs: targetCrs,
      assertCommittable: () => this._assertNormalizationCommit(id, source, targetCrs),
    };
  }

  _assertNormalizationCommit(id: string, source: MutableTopologySource, crs: string): void {
    if (this.deps.document._removed || this.deps.signal.aborted)
      throw new Error('Cannot replace data after map removal');
    if (this.deps.document._activeTransaction) {
      throw new Error('Cannot replace external data during an active transaction');
    }
    if (this.deps.document._sources.get(id) !== source) {
      throw new Error(`Source "${id}" is no longer registered`);
    }
    if (this.deps.view._projection.crs !== crs) {
      throw new Error(`Map CRS changed during source normalization for "${id}"`);
    }
  }

  public removeSource(id: string): void {
    if (this.deps.document._activeTransaction) {
      throw new Error('Cannot remove a source during an active transaction');
    }
    this._pendingSourceCommits?.delete(id);
    const source = this.deps.document._sources.get(id);
    if (!source) return;
    const renderedLayersBefore = this.deps.layers.getRenderedLayers();

    const listener = this._sourceListeners.get(id);
    if (listener) {
      source.off('data', listener);
      source.off('display', listener);
    }
    source.setDatasetNormalizer(null);
    source.setManagedCRS(null);
    this._sourceListeners.delete(id);
    this.formatReleases.get(id)?.();
    this.formatReleases.delete(id);
    this.deps.document._sources.delete(id);

    this.deps.layers._layers = this.deps.layers._layers.filter((layer) => layer.source !== id);
    this.deps.layers._filterResolver.clear();
    this.deps.layers._defaultLayersDirty = true;
    this.deps.cache._featureQuery.clear(id);
    this.deps.events.fire('rendercacheclear', { sourceId: id });
    this.deps.cache._invalidateShapeCachesForSources([id]);
    this.deps.document._highlightManager.removeSource(id);
    const renderedLayersAfter = this.deps.layers.getRenderedLayers();
    if (!renderedLayersEqual(renderedLayersBefore, renderedLayersAfter)) {
      this.deps.layers._fireLayerChange('effective', undefined, renderedLayersAfter);
    }

    const selected = this.deps.document._selection.getAll().filter((ref) => ref.source === id);
    if (selected.length > 0) {
      this.deps.selection._fireSelectionChange(this.deps.document._selection.remove(selected));
    }

    this.deps.history._clearHistory();
    this.deps.signals.requestRender();
  }

  public getSource(id: string): TopologySource | undefined {
    return this.deps.document._sources.get(id);
  }

  dispose(): void {
    for (const [id, source] of this.deps.document._sources) {
      const listener = this._sourceListeners.get(id);
      if (listener) {
        source.off('data', listener);
        source.off('display', listener);
      }
      if (isMutableTopologySource(source)) {
        source.setDatasetNormalizer(null);
        source.setManagedCRS(null);
      }
    }
    for (const release of this.formatReleases.values()) release();
    this.formatReleases.clear();
    this._sourceListeners.clear();
    this._pendingSourceCommits.clear();
  }

  constructor(private readonly deps: Dependencies) {}
}
