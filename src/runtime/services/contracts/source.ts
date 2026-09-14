import type { EventListener } from '../../../engine/core/events';
import type { LayerSpecification } from '../../../engine/map/layer';
import type {
  PreparedDatasetCommit,
  ReadySourceLoadPlan,
  ReadySourceLoadState,
  SourceLoadAnswers,
  SourceLoadDraft,
  SourceLoadRequest,
  SourcePreflightResult,
} from '../../../engine/map/source-loading';
import type { CreateLayerOptions } from '../../../domain/source/create-layer';
import type { MutableTopologySource, TopologySource } from '../../../domain/source/source';
import type { TopologySource as ConcreteTopologySource } from '../../../domain/source/topology-source';
import type { MapshaperDataset } from '../../../shared/types/mapshaper-types';

interface PreparedSourceRegistration {
  readonly token: symbol;
  readonly state: ReadySourceLoadState;
  readonly dataset: MapshaperDataset;
  readonly targetCrs: string;
  readonly expectedMapCrs?: string;
}
/** Explicit service contract. Providers implement this boundary; consumers do not import implementations. */
export interface SourceContract {
  /** @internal */
  _sourceListeners: Map<
    string,
    EventListener<{
      reason?: 'edit' | 'load' | 'replace' | 'reproject';
    }>
  >;
  /** @internal */
  _pendingSourceCommits: Map<string, symbol>;
  preflightSource(request: SourceLoadRequest): Promise<SourcePreflightResult>;
  preflightSource(
    draft: SourceLoadDraft,
    answers: SourceLoadAnswers,
  ): Promise<SourcePreflightResult>;
  addSource(id: string, source: TopologySource, answers?: SourceLoadAnswers): Promise<void>;
  createLayer(id: string, options: CreateLayerOptions): Promise<ConcreteTopologySource>;
  confirmSource(plan: ReadySourceLoadPlan): Promise<void>;
  /** @internal */
  _commitPreparedSource(registration: PreparedSourceRegistration): boolean;
  /** @internal */
  _assertSourceLoadState(state: ReadySourceLoadState, token: symbol): void;
  /** @internal */
  _handleSourceData(
    id: string,
    source: MutableTopologySource,
    event: {
      reason?: 'edit' | 'load' | 'replace' | 'reproject';
      origin?: 'external';
    },
    renderedLayersBefore?: readonly LayerSpecification[],
    crsChanged?: boolean,
  ): void;
  /** @internal */
  _normalizeSourceDataset(
    id: string,
    source: MutableTopologySource,
    dataset: MapshaperDataset,
  ): Promise<MapshaperDataset | PreparedDatasetCommit>;
  /** @internal */
  _assertNormalizationCommit(id: string, source: MutableTopologySource, crs: string): void;
  removeSource(id: string): void;
  getSource(id: string): TopologySource | undefined;
  dispose(): void;
}
