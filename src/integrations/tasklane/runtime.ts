import {
  browserWorker,
  consumeResult,
  createWorkerRuntime,
  type RuntimeError,
  type PoolOptions,
  type RuntimeOptions,
  type WorkerEndpoint,
  type WorkerRuntime,
  type TaskHandle,
  type RuntimeScope,
  type WorkerSession,
} from '@mapseekai/tasklane';

export const MIB = 1024 ** 2;
export const IMPORT_BYTES = 2 * 1024 ** 3;
export const RESOURCE_BYTES = {
  geometry: 64 * MIB,
  msdf: 256 * MIB,
  geotiff: 256 * MIB,
  geopackage: IMPORT_BYTES,
};
export type EmapWorkerPool = 'mapshaper' | 'geometry' | 'msdf' | 'geotiff' | 'geopackage';
export interface EmapWorkerRuntimeOptions {
  /** Assets must come from the same emap build as the main bundle. */
  urls?: Partial<Record<EmapWorkerPool, string | URL>>;
  sizes?: Partial<Record<EmapWorkerPool, number>>;
  /** Opt-in pool feedback control. Keep minimum capacity/cache sufficient for pinned readers. */
  adaptive?: Partial<Record<EmapWorkerPool, NonNullable<PoolOptions['adaptive']>>>;
  /** Explicit application-wide limits; persistent Sessions consume worker slots. */
  limits?: Omit<RuntimeOptions, 'pools'>;
}

/** Own this runtime at application/map scope. Injected runtimes are always borrowed. */
export function createEmapWorkerRuntime(options: EmapWorkerRuntimeOptions = {}): WorkerRuntime {
  const assets: Record<EmapWorkerPool, string> = {
    mapshaper: 'emap-worker.js',
    geometry: 'emap-geometry-worker.js',
    msdf: 'emap-msdf-worker.js',
    geotiff: 'emap-geotiff-worker.js',
    geopackage: 'emap-geopackage-worker.js',
  };
  const sizes = { mapshaper: 1, geometry: 4, msdf: 4, geotiff: 8, geopackage: 2, ...options.sizes };
  const pools: Record<string, PoolOptions> = {};
  const urls: Partial<Record<EmapWorkerPool, string | URL>> = {};
  for (const name of Object.keys(assets) as EmapWorkerPool[]) {
    let serial = 0;
    urls[name] = options.urls?.[name] ?? new URL(/* @vite-ignore */ assets[name], import.meta.url);
    pools[name] = {
      factory: () =>
        browserWorker(urls[name]!, {
          type: 'classic',
          name: `emap-${name}-${serial++}`,
        })(),
      size: sizes[name],
      cacheBytes: name === 'mapshaper' ? 0 : RESOURCE_BYTES[name],
      cacheEntries: 8,
      allowHardCancel: true,
      idleTimeoutMs: 30_000,
      adaptive: options.adaptive?.[name]
        ? {
            ...(name === 'geotiff'
              ? { minWorkers: Math.min(2, sizes[name]), minCacheBytes: RESOURCE_BYTES.geotiff }
              : {}),
            ...options.adaptive[name],
          }
        : undefined,
    };
  }
  return describeWorkerPools(
    createWorkerRuntime({
      ...runtimeLimits,
      ...options.limits,
      budgets: { ...executionBudgets(sizes.mapshaper, true), ...options.limits?.budgets },
      pools,
    }),
    urls,
  );
}

// Reservation ceilings, not eagerly allocated memory or a browser RSS guarantee.
const runtimeLimits: Omit<RuntimeOptions, 'pools'> = {
  maxWorkers: 19,
  maxActiveTasks: 4,
  maxPreparingTasks: 1,
  maxQueuedTasks: 64,
  queueTimeoutMs: 120_000,
  executionTimeoutMs: 120_000,
};

function executionBudgets(mapshaperSize: number, shared = false) {
  const parallel = Math.max(1, Math.min(4, mapshaperSize));
  return {
    inputBytes: parallel * IMPORT_BYTES + (shared ? 3 * 64 * MIB : 0),
    outputBytes: parallel * IMPORT_BYTES + (shared ? 3 * 256 * MIB : 0),
    scratchBytes: (parallel + 1) * IMPORT_BYTES,
    cacheBytes: 8 * IMPORT_BYTES,
    residentBytes: 256 * MIB,
  };
}

/** Standalone clients own only their pool, and never create a hidden global runtime. */
export function standaloneRuntime(
  pool: string,
  factory: () => WorkerEndpoint,
  size = 1,
  cacheBytes = 0,
): WorkerRuntime {
  return createWorkerRuntime({
    ...runtimeLimits,
    budgets: executionBudgets(pool === 'mapshaper' ? size : 1),
    pools: {
      [pool]: {
        factory,
        size,
        cacheBytes,
        cacheEntries: 8,
        allowHardCancel: true,
        idleTimeoutMs: 30_000,
      },
    },
  });
}

/** Class identity differs between independently bundled public entry points. */
export function isWorkerRuntimeError(error: unknown): error is RuntimeError {
  return (
    error instanceof Error &&
    error.name === 'RuntimeError' &&
    typeof (error as RuntimeError).code === 'string'
  );
}

/** Preserve public AbortError and domain error contracts across the tasklane boundary. */
export function workerError(error: unknown): unknown {
  if (!isWorkerRuntimeError(error)) return error;
  const failure = error;
  if (failure.code === 'ABORTED' || failure.code === 'CLOSED')
    return new DOMException(error.message, 'AbortError');
  if (failure.remoteError) {
    const result = new Error(failure.remoteError.message) as Error & { code?: string };
    result.name = failure.remoteError.name;
    result.code = failure.remoteError.code;
    return result;
  }
  return error;
}

/** Consume the lease before returning ownership to the caller. */
export async function taskValue<T>(
  handle: TaskHandle<unknown>,
  consume: (value: any) => T | Promise<T> = (value) => value,
): Promise<T> {
  try {
    return await consumeResult(handle, consume);
  } catch (error) {
    throw workerError(error);
  }
}

/** Test seam for the public Mapshaper WorkerCtor option. */
export function workerFactory(
  url: string | URL,
  Ctor: typeof Worker = globalThis.Worker,
): () => WorkerEndpoint {
  return () => {
    const worker = new Ctor(url, { type: 'classic' });
    return {
      postMessage: (message, transfer) => worker.postMessage(message, [...(transfer ?? [])]),
      onMessage: (listener) => {
        const handler = (event: MessageEvent) => listener(event.data);
        worker.addEventListener('message', handler);
        return () => worker.removeEventListener('message', handler);
      },
      onFailure: (listener) => {
        const handler = (event: Event) =>
          listener(new Error((event as ErrorEvent).message || 'Worker message failed'));
        worker.addEventListener('error', handler);
        worker.addEventListener('messageerror', handler);
        return () => {
          worker.removeEventListener('error', handler);
          worker.removeEventListener('messageerror', handler);
        };
      },
      terminate: () => worker.terminate(),
    };
  };
}

export function reportWorkerCleanupFailure(error: unknown): void {
  console.error('emap Worker cleanup failed; disposal can be retried.', error);
}

/** Lazy Session owner. Reset is also used for reusable font/geometry clients. */
export class SessionOwner {
  private runtime?: WorkerRuntime;
  private scope?: RuntimeScope;
  private current?: WorkerSession;
  private closing: Promise<void> = Promise.resolve();
  private readonly retired = new Set<{
    scope: RuntimeScope;
    runtime?: WorkerRuntime;
    closing?: Promise<void>;
  }>();
  constructor(
    private readonly pool: EmapWorkerPool,
    private readonly url: string | URL,
    private readonly borrowed?: WorkerRuntime,
  ) {}
  owns(session: WorkerSession): boolean {
    return this.current === session;
  }
  get currentSession(): WorkerSession | undefined {
    return this.current;
  }
  get session(): WorkerSession {
    if (this.current?.state === 'lost' || this.current?.state === 'closed')
      void this.close().catch(reportWorkerCleanupFailure);
    if (!this.current) {
      const runtime =
        this.borrowed ??
        standaloneRuntime(
          this.pool,
          browserWorker(this.url, { type: 'classic', name: `emap-${this.pool}` }),
          1,
          this.pool === 'mapshaper' ? 0 : RESOURCE_BYTES[this.pool],
        );
      let scope: RuntimeScope | undefined;
      try {
        scope = runtime.createScope(this.pool);
        const session = scope.session(this.pool);
        this.runtime = runtime;
        this.scope = scope;
        this.current = session;
      } catch (error) {
        if (scope) {
          this.retired.add({ scope, runtime: this.borrowed ? undefined : runtime });
          void this.close().catch(reportWorkerCleanupFailure);
        } else if (!this.borrowed) void runtime.dispose().catch(reportWorkerCleanupFailure);
        throw error;
      }
    }
    return this.current;
  }
  close(): Promise<void> {
    if (this.scope)
      this.retired.add({ scope: this.scope, runtime: this.borrowed ? undefined : this.runtime });
    this.scope = undefined;
    this.current = undefined;
    this.runtime = undefined;
    this.closing = Promise.all(
      [...this.retired].map((entry) => {
        if (!entry.closing) {
          entry.closing = (async () => {
            await entry.scope.dispose();
            await entry.runtime?.dispose();
            this.retired.delete(entry);
          })().catch((error) => {
            entry.closing = undefined;
            throw error;
          });
        }
        return entry.closing;
      }),
    ).then(() => {});
    return this.closing;
  }
  get closed(): Promise<void> {
    return this.closing;
  }
}

// Shared by separately bundled entry points; never inspect tasklane private state.
const runtimeConfigKey = Symbol.for('@mapseekai/emap/worker-runtime/pools/v2');
interface RuntimeDescriptor {
  urls: Partial<Record<EmapWorkerPool, string | URL>>;
}
function describeWorkerPools(
  runtime: WorkerRuntime,
  urls: RuntimeDescriptor['urls'],
): WorkerRuntime {
  Object.defineProperty(runtime, runtimeConfigKey, { value: { urls } });
  return runtime;
}
function descriptor(runtime: WorkerRuntime): RuntimeDescriptor | undefined {
  return (runtime as WorkerRuntime & { [runtimeConfigKey]?: RuntimeDescriptor })[runtimeConfigKey];
}
export function runtimeWorkerUrl(
  runtime: WorkerRuntime | undefined,
  pool: EmapWorkerPool,
): string | URL | undefined {
  return runtime && descriptor(runtime)?.urls[pool];
}
