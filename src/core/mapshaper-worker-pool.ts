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
  /** Worker epoch at the time the request was posted. Used to discard
   *  late messages from a worker that's since been terminated. */
  epoch: number;
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
  // Epoch counter — incremented every time we spawn a fresh worker (e.g.
  // after `cancelAll` or worker error). Late messages from a prior worker
  // that arrive after termination would otherwise leak through to a future
  // request sharing the same correlation id; the epoch lets us discard
  // them. Each pending entry stamps its epoch at creation.
  private _workerEpoch: number = 0;
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
   *
   * Even on an immediately-rejecting path (destroyed pool, or environments
   * lacking a `Worker` constructor), the returned `id` is still drawn from
   * the same monotonic counter so it never collides with live ids — UI
   * code can correlate a `workerjobstart` with a synchronously-rejecting
   * `workerjobend` without aliasing.
   */
  runWithId(
    cmd: string,
    packed: any,
    inputFiles?: Record<string, Uint8Array | string>,
  ): { id: number; promise: Promise<any> } {
    const id = this.reserveId();
    return { id, promise: this.dispatchWithId(id, cmd, packed, inputFiles) };
  }

  /**
   * Reserve a correlation id without sending anything. Call {@link dispatchWithId}
   * with the same id later to actually post the message. Useful when the
   * caller wants to fire a "started" event with a stable id BEFORE doing
   * expensive sync work (e.g. dataset packing) that delays the postMessage.
   */
  reserveId(): number {
    return this._nextId++;
  }

  /**
   * Send a message using a previously-reserved id (see {@link reserveId}).
   * Returns the result promise. Same failure modes as {@link run}: pool
   * destroyed → rejects; worker spawn fails → rejects.
   */
  dispatchWithId(
    id: number,
    cmd: string,
    packed: any,
    inputFiles?: Record<string, Uint8Array | string>,
  ): Promise<any> {
    if (this._destroyed) {
      return Promise.reject(new Error('MapshaperWorkerPool: destroyed'));
    }
    let worker: Worker;
    try {
      worker = this._ensureWorker();
    } catch (err: any) {
      // Wrap synchronous spawn failure (e.g. missing Worker constructor)
      // in a rejected promise so callers using only `pool.run().catch(...)`
      // see the same shape as every other failure mode. Without this,
      // run() would synchronously throw, breaking the Promise contract
      // implied by the return type.
      return Promise.reject(err);
    }
    const epoch = this._workerEpoch;
    return new Promise<any>((resolve, reject) => {
      this._pending.set(id, { resolve, reject, epoch });
      const msg: RunMessage = { id, type: 'run', cmd, packed };
      if (inputFiles) msg.inputFiles = inputFiles;
      worker.postMessage(msg);
    });
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

  /** Internal: terminate the worker (if any) and reject all pending. Bumps
   *  the epoch so any late messages from the now-dead worker are ignored
   *  (see {@link _onMessage}). */
  private _terminate(reason: Error): void {
    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
    }
    this._workerEpoch++;
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
    // Defensive: if a fresh worker was spawned after this request's
    // worker was terminated, a late message from the dead worker would
    // otherwise resolve a NEW pending entry that happens to share the
    // same id. The epoch check rules this out.
    if (pending.epoch !== this._workerEpoch) return;
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
    // Same epoch-bump as {@link _terminate} so late messages don't leak.
    const err = new Error(`mapshaper worker error: ${e.message || 'unknown'}`);
    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
    }
    this._workerEpoch++;
    for (const { reject } of this._pending.values()) reject(err);
    this._pending.clear();
  }
}
