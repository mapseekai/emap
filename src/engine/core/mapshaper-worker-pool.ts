import type { WorkerRuntime, RuntimeScope } from '@mapseekai/tasklane';
import type { PackedSession } from '../../integrations/mapshaper/adapter';
import {
  encodeWorkerPacket,
  workerPacketTransfers,
  workerDataByteBound,
  decodeWorkerData,
} from '../../integrations/mapshaper/binary';
import {
  IMPORT_BYTES,
  standaloneRuntime,
  taskValue,
  workerFactory,
  reportWorkerCleanupFailure,
} from '../../integrations/tasklane/runtime';
export interface MapshaperWorkerPoolOptions {
  /**
   * URL of the worker bundle (`emap-worker.js`). Resolved by the browser
   * the same way as any `new Worker(url)` argument — pass the absolute or
   * page-relative URL where the file is served.
   */
  workerUrl: string;
  /** Borrowed application runtime; must contain the mapshaper pool. */
  workerRuntime?: WorkerRuntime;
  /**
   * Optional override for the `Worker` constructor itself. Used by tests
   * to inject a `MockWorker`. Defaults to the global `Worker`.
   */
  WorkerCtor?: typeof Worker;
  /**
   * Number of worker threads to maintain. Each adds its own mapshaper
   * instance. Actual parallelism is bounded by pool size, runtime limits and budgets.
   * Default `1` to keep
   * the historical single-worker semantics; set to e.g.
   * `navigator.hardwareConcurrency - 1` to scale.
   *
   * Workers spawn lazily as load grows; constructing a pool with
   * `poolSize: 4` does NOT immediately spawn 4 workers — only the
   * first dispatch creates one, the second creates a second only if
   * the first is busy, and so on.
   */
  poolSize?: number;
  /** Positive integer timeout in milliseconds (maximum 2^31-1). Default 120 seconds. */
  jobTimeoutMs?: number;
}

export interface ParsedCommandWire {
  name: string;
  options: Record<string, unknown>;
}

/** Tasklane owns physical scheduling, timeouts and worker generations. */
export class MapshaperWorkerPool {
  private readonly runtime: WorkerRuntime;
  private scope: RuntimeScope;
  private nextId = 1;
  private destroyed = false;
  private readonly timeout: number;
  readonly poolSize: number;
  private closing: Promise<void> = Promise.resolve();
  private readonly retiredScopes = new Set<RuntimeScope>();
  constructor(private readonly options: MapshaperWorkerPoolOptions) {
    this.poolSize = Math.max(1, Math.floor(options.poolSize ?? 1));
    this.timeout = options.jobTimeoutMs ?? 120_000;
    if (!Number.isSafeInteger(this.timeout) || this.timeout < 1 || this.timeout > 2_147_483_647)
      throw new Error(
        'MapshaperWorkerPool: jobTimeoutMs must be an integer from 1 to 2147483647; unbounded execution is unsupported',
      );
    this.runtime =
      options.workerRuntime ??
      standaloneRuntime(
        'mapshaper',
        workerFactory(options.workerUrl, options.WorkerCtor),
        this.poolSize,
      );
    this.scope = this.runtime.createScope('mapshaper');
  }
  reserveId(): number {
    return this.nextId++;
  }
  run(
    cmd: string | ParsedCommandWire[],
    packed: any,
    inputFiles?: Record<string, Uint8Array | string>,
  ): Promise<any> {
    return this.runWithId(cmd, packed, inputFiles).promise;
  }
  runWithId(
    cmd: string | ParsedCommandWire[],
    packed: any,
    inputFiles?: Record<string, Uint8Array | string>,
  ): { id: number; promise: Promise<any> } {
    const id = this.reserveId();
    return { id, promise: this.dispatchWithId(id, cmd, packed, inputFiles) };
  }
  async dispatchWithId(
    id: number,
    cmd: string | ParsedCommandWire[],
    packed: any,
    inputFiles?: Record<string, Uint8Array | string>,
    transferList?: Transferable[],
  ): Promise<any> {
    return this.dispatchPreparedWithId(
      id,
      cmd,
      async () => {
        // Preserve explicit ownership transfer; implicit calls keep their inputs intact.
        return transferList?.length ? structuredClone(packed, { transfer: transferList }) : packed;
      },
      inputFiles,
      workerDataByteBound({ packed, cmd, inputFiles }),
    );
  }
  async dispatchPreparedWithId(
    id: number,
    cmd: string | ParsedCommandWire[],
    prepare: () => Promise<any>,
    inputFiles?: Record<string, Uint8Array | string>,
    inputByteLimit = IMPORT_BYTES,
  ): Promise<PackedSession> {
    if (this.destroyed) throw new Error('MapshaperWorkerPool: destroyed');
    const handle = this.scope.enqueuePrepared('mapshaper', {
      pool: 'mapshaper',
      group: String(id),
      cancellation: 'terminate',
      budget: { inputBytes: inputByteLimit, outputBytes: IMPORT_BYTES, scratchBytes: IMPORT_BYTES },
      preparationScratchBytes: IMPORT_BYTES,
      executionTimeoutMs: this.timeout,
      prepareAsync: async ({ signal }) => {
        const packed = await prepare();
        signal.throwIfAborted();
        // A binary envelope avoids tasklane's object-graph limit for millions of shapes.
        const bytes = encodeWorkerPacket(packed);
        return {
          payload: {
            bytes,
            cmd: typeof cmd === 'string' ? cmd : undefined,
            commands: typeof cmd === 'string' ? undefined : cmd,
            inputFiles,
          },
          transfer: workerPacketTransfers(bytes),
        };
      },
    });
    return taskValue<PackedSession>(handle, (bytes: Uint8Array) => decodeWorkerData(bytes));
  }
  cancelAll(): void {
    if (this.destroyed) return;
    const previous = this.scope;
    this.scope = this.runtime.createScope('mapshaper');
    this.retiredScopes.add(previous);
    this.closeScopes();
  }
  destroy(): void {
    this.destroyed = true;
    this.retiredScopes.add(this.scope);
    this.closeScopes();
  }
  private closeScopes(): void {
    this.closing = Promise.all([
      ...[...this.retiredScopes].map((scope) =>
        scope.dispose().then(() => {
          this.retiredScopes.delete(scope);
        }),
      ),
      this.destroyed && !this.options.workerRuntime ? this.runtime.dispose() : undefined,
    ]).then(() => {});
    void this.closing.catch(reportWorkerCleanupFailure);
  }
  get closed(): Promise<void> {
    return this.closing;
  }
}
