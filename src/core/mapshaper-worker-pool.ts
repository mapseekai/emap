/**
 * Single-worker pool that runs mapshaper commands off-thread.
 *
 * Wire protocol matches `src/worker/mapshaper-worker.ts`:
 *
 *   main → worker:  { id, type: 'run', cmd, packed, inputFiles? }
 *   worker → main:  { id, type: 'ok', packed }
 *                |  { id, type: 'error', message }
 *
 * One Emap instance gets one worker. mapshaper inside a single worker
 * isn't reentrant-safe (it shares globals), but multiple in-flight
 * `run()` calls are fine because each request reseeds its own Job +
 * Catalog from the packed payload — no shared state across requests.
 *
 * Lazy worker spawn: the underlying `Worker` is constructed on first
 * `run()`, not at pool construction. Cheap to keep an unused pool
 * around; useful for callers that toggle `useWorker` at runtime.
 */
export interface MapshaperWorkerPoolOptions {
  /**
   * URL of the worker bundle (`emap-worker.js`). Resolved by the browser
   * the same way as any `new Worker(url)` argument — pass the absolute or
   * page-relative URL where the file is served.
   */
  workerUrl: string;
  /**
   * Optional override for the `Worker` constructor itself. Used by tests
   * to inject a `MockWorker`. Defaults to the global `Worker`.
   */
  WorkerCtor?: typeof Worker;
}

interface PendingResolver {
  resolve: (packed: any) => void;
  reject: (err: Error) => void;
}

interface RunMessage {
  id: number;
  type: 'run';
  cmd: string;
  packed: any;
  inputFiles?: Record<string, Uint8Array | string>;
}

type ResponseMessage =
  | { id: number; type: 'ok'; packed: any }
  | { id: number; type: 'error'; message: string };

export class MapshaperWorkerPool {
  private _workerUrl: string;
  private _WorkerCtor: typeof Worker;
  private _worker: Worker | null = null;
  private _pending: Map<number, PendingResolver> = new Map();
  private _nextId: number = 1;
  private _destroyed: boolean = false;

  constructor(opts: MapshaperWorkerPoolOptions) {
    this._workerUrl = opts.workerUrl;
    // Tests can inject a mock; production uses the global Worker.
    this._WorkerCtor = opts.WorkerCtor ?? (globalThis as any).Worker;
  }

  /**
   * Send a command + packed dataset to the worker and resolve with the
   * packed result. Each call gets a unique correlation id so multiple
   * in-flight requests don't cross wires.
   */
  run(
    cmd: string,
    packed: any,
    inputFiles?: Record<string, Uint8Array | string>,
  ): Promise<any> {
    return this.runWithId(cmd, packed, inputFiles).promise;
  }

  /**
   * Same as {@link run}, but also surfaces the correlation id synchronously
   * so the caller can fire an event referencing the id BEFORE the promise
   * resolves. Used by Emap's `workerjobstart` / `workerjobend` events.
   */
  runWithId(
    cmd: string,
    packed: any,
    inputFiles?: Record<string, Uint8Array | string>,
  ): { id: number; promise: Promise<any> } {
    if (this._destroyed) {
      return { id: -1, promise: Promise.reject(new Error('MapshaperWorkerPool: destroyed')) };
    }
    const worker = this._ensureWorker();
    const id = this._nextId++;
    const promise = new Promise<any>((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      const msg: RunMessage = { id, type: 'run', cmd, packed };
      if (inputFiles) msg.inputFiles = inputFiles;
      worker.postMessage(msg);
    });
    return { id, promise };
  }

  /**
   * Terminate the underlying worker (if spawned), reject every pending
   * request, and refuse subsequent `run()` calls. Idempotent.
   */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this._terminate(new Error('MapshaperWorkerPool: destroyed'));
  }

  /**
   * Hard-kill the underlying worker (if spawned) and reject every pending
   * request as `'cancelled'`. Unlike {@link destroy}, the pool stays usable —
   * the next {@link run} call spawns a fresh worker.
   *
   * mapshaper isn't interruptible mid-command, so this is the only sound
   * way to abandon a job that's already running: terminate the whole
   * worker, lose any other queued jobs as collateral, and start over. A
   * future iteration could add per-request cancellation tokens; v1 keeps
   * this honest by exposing only the all-or-nothing semantics.
   */
  cancelAll(): void {
    if (this._destroyed) return;
    this._terminate(new Error('MapshaperWorkerPool: cancelled'));
  }

  /** True iff the worker has been spawned at least once. Test/diagnostics aid. */
  isWorkerSpawned(): boolean {
    return this._worker !== null;
  }

  // ---------------------------------------------------------------------------

  /** Internal: terminate the worker (if any) and reject all pending. */
  private _terminate(reason: Error): void {
    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
    }
    for (const { reject } of this._pending.values()) reject(reason);
    this._pending.clear();
  }

  private _ensureWorker(): Worker {
    if (this._worker) return this._worker;
    if (!this._WorkerCtor) {
      throw new Error('MapshaperWorkerPool: Worker constructor not available in this environment');
    }
    const w = new this._WorkerCtor(this._workerUrl);
    w.onmessage = (e: MessageEvent) => this._onMessage(e.data as ResponseMessage);
    w.onerror = (e: ErrorEvent) => this._onWorkerError(e);
    this._worker = w;
    return w;
  }

  private _onMessage(data: ResponseMessage): void {
    if (!data || typeof data.id !== 'number') return;
    const pending = this._pending.get(data.id);
    if (!pending) return;
    this._pending.delete(data.id);
    if (data.type === 'ok') {
      pending.resolve(data.packed);
    } else {
      pending.reject(new Error(data.message || 'mapshaper worker error'));
    }
  }

  private _onWorkerError(e: ErrorEvent): void {
    // An uncaught worker exception (e.g. mapshaper bundle failed to parse)
    // doesn't fire onmessage, so we have to fail every pending request to
    // avoid hung promises. The caller can construct a fresh pool to retry.
    const err = new Error(`mapshaper worker error: ${e.message || 'unknown'}`);
    for (const { reject } of this._pending.values()) reject(err);
    this._pending.clear();
    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
    }
  }
}
