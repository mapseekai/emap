export interface DuckDbSpatialAggregateRunRegistration<Source> {
  source: Source;
  cleanup: () => void;
}

export interface DuckDbSpatialAggregateRunOptions<Runtime, Dataset, Source> {
  getRuntime: () => Promise<Runtime>;
  execute: (runtime: Runtime) => Promise<Dataset>;
  discardResult?: (dataset: Dataset) => void;
  register: (
    dataset: Dataset,
    isCurrent: () => boolean,
  ) => Promise<DuckDbSpatialAggregateRunRegistration<Source> | undefined>;
  publish: (result: {
    dataset: Dataset;
    registration: DuckDbSpatialAggregateRunRegistration<Source>;
  }) => void;
  publishError?: (error: unknown) => void;
  finish?: () => void;
}

export interface DuckDbSpatialAggregateRunCoordinator {
  invalidateRuns: () => void;
  run: <Runtime, Dataset, Source>(
    options: DuckDbSpatialAggregateRunOptions<Runtime, Dataset, Source>,
  ) => Promise<void>;
}

export interface DuckDbSpatialAggregateSourceMap {
  getLayers: () => ReadonlyArray<{ id: string; source?: string }>;
  removeLayer: (id: string) => void;
  removeSource: (id: string) => void;
}

export interface DuckDbSpatialAggregateMapOpResult<Dataset> {
  ok: boolean;
  value?: { dataset: Dataset };
  error?: { id?: string; kind: string; reason?: string };
}

export interface DuckDbSpatialAggregateQueryOptions<Dataset> {
  entrypoint: 'helper' | 'mapop';
  runHelper: () => Promise<Dataset>;
  runMapOp: () => Promise<DuckDbSpatialAggregateMapOpResult<Dataset>>;
}

export function removeDuckDbSpatialAggregateSource(
  map: DuckDbSpatialAggregateSourceMap,
  sourceId: string,
) {
  for (const layer of map.getLayers()) {
    if (layer.source === sourceId) map.removeLayer(layer.id);
  }
  map.removeSource(sourceId);
}

export async function executeDuckDbSpatialAggregateQuery<Dataset>({
  entrypoint,
  runHelper,
  runMapOp,
}: DuckDbSpatialAggregateQueryOptions<Dataset>): Promise<Dataset> {
  if (entrypoint === 'helper') return runHelper();

  const result = await runMapOp();
  if (!result.ok || !result.value) {
    throw new Error(
      `${result.error?.kind ?? 'unknown'}: ${result.error?.reason ?? result.error?.id}`,
    );
  }
  return result.value.dataset;
}

export function createDuckDbSpatialAggregateRunCoordinator(
  getInputGeneration: () => number,
): DuckDbSpatialAggregateRunCoordinator {
  let runVersion = 0;

  function invalidateRuns() {
    runVersion += 1;
  }

  async function run<Runtime, Dataset, Source>({
    getRuntime,
    execute,
    discardResult,
    register,
    publish,
    publishError,
    finish,
  }: DuckDbSpatialAggregateRunOptions<Runtime, Dataset, Source>): Promise<void> {
    const inputGeneration = getInputGeneration();
    const runToken = ++runVersion;
    const isCurrent = () => inputGeneration === getInputGeneration() && runToken === runVersion;

    try {
      const runtime = await getRuntime();
      if (!isCurrent()) return;

      const dataset = await execute(runtime);
      if (!isCurrent()) {
        discardResult?.(dataset);
        return;
      }

      const registration = await register(dataset, isCurrent);
      if (!isCurrent()) {
        registration?.cleanup();
        return;
      }
      if (!registration) return;

      if (!isCurrent()) {
        registration.cleanup();
        return;
      }
      publish({ dataset, registration });
    } catch (error) {
      if (isCurrent()) publishError?.(error);
    } finally {
      if (isCurrent()) finish?.();
    }
  }

  return { invalidateRuns, run };
}
