import type {
  NormalizedDatasetCommit,
  MutableTopologySource,
  TopologySource,
} from '../source/source';
import type { TopologySourceInput, TopologySourceOptions } from '../source/topology-source';
import type { MapshaperDataset } from '../types/mapshaper-types';

export type SourceLoadRequest =
  | {
      readonly id: string;
      readonly source: TopologySource;
      readonly sourceCrs?: string;
    }
  | {
      readonly id: string;
      readonly input: TopologySourceInput;
      readonly sourceOptions?: Omit<TopologySourceOptions, 'data'>;
      readonly sourceCrs?: string;
    };

export interface SourceLoadAnswers {
  readonly sourceCrs?: string;
}

export type SourceLoadDiagnosticCode =
  | 'source-crs-invalid'
  | 'source-crs-required'
  | 'source-crs-overrides-metadata'
  | 'source-id-conflict'
  | 'source-load-cancelled'
  | 'source-load-rejected'
  | 'source-plan-invalid'
  | 'source-plan-stale';

export interface SourceLoadDiagnostic {
  readonly code: SourceLoadDiagnosticCode;
  readonly severity: 'warning' | 'error';
  readonly message?: string;
  readonly suppliedCrs?: string;
  readonly metadataCrs?: string;
  readonly effectiveCrs?: string;
}

export interface SourceLoadRequirement {
  readonly code: 'source-crs';
  readonly field: 'sourceCrs';
  readonly reason: 'missing' | 'invalid';
}

export interface SourceLoadSummary {
  readonly id: string;
  readonly layerCount: number;
  readonly metadataCrs?: string;
  readonly sourceCrs?: string;
}

/** Opaque handle retaining a parsed detached dataset for another preflight pass. */
export interface SourceLoadDraft {
  readonly kind: 'source-load-draft';
}

/** Opaque, map-bound, single-use handle consumed by {@link Emap.confirmSource}. */
export interface ReadySourceLoadPlan {
  readonly kind: 'ready-source-load-plan';
}

export type SourcePreflightResult =
  | {
      readonly status: 'ready';
      readonly plan: ReadySourceLoadPlan;
      readonly summary: SourceLoadSummary;
      readonly diagnostics: readonly SourceLoadDiagnostic[];
    }
  | {
      readonly status: 'needs-input';
      readonly draft: SourceLoadDraft;
      readonly requirements: readonly SourceLoadRequirement[];
      readonly summary: SourceLoadSummary;
      readonly diagnostics: readonly SourceLoadDiagnostic[];
    }
  | {
      readonly status: 'rejected';
      readonly diagnostics: readonly SourceLoadDiagnostic[];
    };

export class SourceLoadError extends Error {
  constructor(
    readonly code: SourceLoadDiagnosticCode,
    readonly diagnostics: readonly SourceLoadDiagnostic[],
  ) {
    super(diagnostics[0]?.message ?? code);
    this.name = 'SourceLoadError';
  }
}

export interface PreparedDatasetCommit extends NormalizedDatasetCommit {
  readonly intendedMapCrs: string;
}

export interface SourceLoadState {
  readonly owner: object;
  readonly id: string;
  readonly source: MutableTopologySource;
  readonly dataset: MapshaperDataset;
  readonly editVersion: number;
  readonly metadataCrs?: string;
  readonly mapCrs?: string;
}

export interface ReadySourceLoadState extends SourceLoadState {
  readonly sourceCrs: string;
  consumed: boolean;
}

const draftStates = new WeakMap<SourceLoadDraft, SourceLoadState>();
const readyStates = new WeakMap<ReadySourceLoadPlan, ReadySourceLoadState>();

export function createSourceLoadDraft(state: SourceLoadState): SourceLoadDraft {
  const draft: SourceLoadDraft = Object.freeze({ kind: 'source-load-draft' });
  draftStates.set(draft, state);
  return draft;
}

export function getSourceLoadDraftState(
  owner: object,
  draft: SourceLoadDraft,
): SourceLoadState | undefined {
  const state = draftStates.get(draft);
  return state?.owner === owner ? state : undefined;
}

export function createReadySourceLoadPlan(
  state: SourceLoadState,
  sourceCrs: string,
): ReadySourceLoadPlan {
  const plan: ReadySourceLoadPlan = Object.freeze({ kind: 'ready-source-load-plan' });
  readyStates.set(plan, { ...state, sourceCrs, consumed: false });
  return plan;
}

export function consumeReadySourceLoadPlan(
  owner: object,
  plan: ReadySourceLoadPlan,
): ReadySourceLoadState {
  const state = readyStates.get(plan);
  if (!state || state.owner !== owner || state.consumed) {
    const diagnostic: SourceLoadDiagnostic = {
      code: 'source-plan-invalid',
      severity: 'error',
      message: 'Source load plan is invalid, belongs to another map, or was already consumed',
    };
    throw new SourceLoadError(diagnostic.code, [diagnostic]);
  }
  state.consumed = true;
  return state;
}
