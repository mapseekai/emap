/**
 * Worker pool that runs mapshaper commands off-thread.
 *
 * Wire protocol matches `src/worker/mapshaper-worker.ts`:
 *
 *   main → worker:  { id, type: 'run', cmd, packed, inputFiles? }
 *   worker → main:  { id, type: 'ok', packed }
 *                |  { id, type: 'error', message }
 *
 * **Concurrency model**: the pool maintains N workers (default 1).
 * mapshaper itself is not reentrant inside ONE worker — it shares
 * module-level state (parser tables, internal caches) across calls,
 * which is why the worker entry serialises via an internal queue.
 * Across DIFFERENT workers there is no shared state: each worker hosts
 * its own mapshaper instance, so the pool can run `poolSize` jobs in
 * true parallel as long as the underlying datasets are independent.
 *
 * Dispatch picks the worker with the fewest in-flight requests; ties
 * break by round-robin index so the load distribution is stable and
 * predictable.
 *
 * Lazy worker spawn: the underlying `Worker`s are constructed on
 * demand, not at pool construction. Cheap to keep an unused pool
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
  /**
   * Number of worker threads to maintain. Each adds its own mapshaper
   * instance, so peak parallelism = `poolSize`. Default `1` to keep
   * the historical single-worker semantics; set to e.g.
   * `navigator.hardwareConcurrency - 1` to scale.
   *
   * Workers spawn lazily as load grows; constructing a pool with
   * `poolSize: 4` does NOT immediately spawn 4 workers — only the
   * first dispatch creates one, the second creates a second only if
   * the first is busy, and so on.
   */
  poolSize?: number;
}

interface PendingResolver {
  resolve: (packed: any) => void;
  reject: (err: Error) => void;
  /** Index into `_slots` of the worker handling this request. */
  workerIndex: number;
  /** Worker epoch at the time the request was posted. Used to discard
   *  late messages from a worker that's since been terminated. */
  epoch: number;
}

interface RunMessage {
  id: number;
  type: 'run';
  /** Legacy CLI string path. Worker calls `parseCommands(cmd)` on it. */
  cmd?: string;
  /** Pre-parsed command path (PR-4b). Skips the worker-side CLI parser
   *  entirely — eliminates a class of escaping bugs and lets ops build
   *  commands as structured objects. Mutually exclusive with `cmd`. */
  commands?: ParsedCommandWire[];
  packed: any;
  inputFiles?: Record<string, Uint8Array | string>;
}

/**
 * Wire-format ParsedCommand. Mirrors `mapshaper.internal.parseCommands(...)`
 * output: `{ name: kebab-case, options: snake_case key/values }`. Plain
 * data, structured-clone friendly.
 */
export interface ParsedCommandWire {
  name: string;
  options: Record<string, unknown>;
}

type ResponseMessage =
  | { id: number; type: 'ok'; packed: any }
  | { id: number; type: 'error'; message: string };

/**
 * Per-worker state. `worker` is null until first use (lazy spawn);
 * `epoch` increments every time we terminate to differentiate late
 * messages from the now-dead worker; `pendingCount` is the live
 * dispatch count (used for least-loaded selection).
 */
interface WorkerSlot {
  worker: Worker | null;
  epoch: number;
  pendingCount: number;
}

export class MapshaperWorkerPool {
  private _workerUrl: string;
  private _WorkerCtor: typeof Worker;
  private _slots: WorkerSlot[];
  private _pending: Map<number, PendingResolver> = new Map();
  private _nextId: number = 1;
  /** Round-robin tie-breaker pointer for dispatch. */
  private _rrCursor: number = 0;
  private _destroyed: boolean = false;

  constructor(opts: MapshaperWorkerPoolOptions) {
    this._workerUrl = opts.workerUrl;
    // Tests can inject a mock; production uses the global Worker.
    this._WorkerCtor = opts.WorkerCtor ?? (globalThis as any).Worker;
    const poolSize = Math.max(1, Math.floor(opts.poolSize ?? 1));
    this._slots = Array.from({ length: poolSize }, () => ({
      worker: null,
      epoch: 0,
      pendingCount: 0,
    }));
  }

  /**
   * Send a command + packed dataset to the worker pool and resolve with
   * the packed result. Each call gets a unique correlation id so multiple
   * in-flight requests don't cross wires.
   */
  run(
    cmdOrCommands: string | ParsedCommandWire[],
    packed: any,
    inputFiles?: Record<string, Uint8Array | string>,
  ): Promise<any> {
    return this.runWithId(cmdOrCommands, packed, inputFiles).promise;
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
    cmdOrCommands: string | ParsedCommandWire[],
    packed: any,
    inputFiles?: Record<string, Uint8Array | string>,
  ): { id: number; promise: Promise<any> } {
    const id = this.reserveId();
    return { id, promise: this.dispatchWithId(id, cmdOrCommands, packed, inputFiles) };
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
    cmdOrCommands: string | ParsedCommandWire[],
    packed: any,
    inputFiles?: Record<string, Uint8Array | string>,
    /**
     * Optional list of `Transferable` objects (typed-array `.buffer`s,
     * `MessagePort`s, …) handed to `postMessage`. When supplied,
     * ownership moves to the worker — saves a structured-clone copy
     * and roughly halves the main-thread memory peak around a
     * pack/unpack round-trip.
     *
     * Callers that share the buffers with main-thread code must NOT
     * pass them via this list (transfer is destructive on the source
     * realm).
     */
    transferList?: Transferable[],
  ): Promise<any> {
    if (this._destroyed) {
      return Promise.reject(new Error('MapshaperWorkerPool: destroyed'));
    }
    const workerIndex = this._pickWorker();
    let worker: Worker;
    try {
      worker = this._ensureWorker(workerIndex);
    } catch (err: any) {
      // Wrap synchronous spawn failure (e.g. missing Worker constructor)
      // in a rejected promise so callers using only `pool.run().catch(...)`
      // see the same shape as every other failure mode. Without this,
      // run() would synchronously throw, breaking the Promise contract
      // implied by the return type.
      return Promise.reject(err);
    }
    const slot = this._slots[workerIndex];
    const epoch = slot.epoch;
    slot.pendingCount++;
    return new Promise<any>((resolve, reject) => {
      this._pending.set(id, { resolve, reject, workerIndex, epoch });
      const msg: RunMessage = { id, type: 'run', packed };
      if (typeof cmdOrCommands === 'string') {
        msg.cmd = cmdOrCommands;
      } else {
        msg.commands = cmdOrCommands;
      }
      if (inputFiles) msg.inputFiles = inputFiles;
      if (transferList && transferList.length > 0) {
        worker.postMessage(msg, transferList);
      } else {
        worker.postMessage(msg);
      }
    });
  }

  /**
   * Terminate every spawned worker, reject every pending request, and
   * refuse subsequent `run()` calls. Idempotent.
   */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this._terminateAll(new Error('MapshaperWorkerPool: destroyed'));
  }

  /**
   * Hard-kill every spawned worker and reject every pending request as
   * `'cancelled'`. Unlike {@link destroy}, the pool stays usable — the
   * next {@link run} call spawns fresh workers on demand.
   *
   * mapshaper isn't interruptible mid-command, so this is the only sound
   * way to abandon a job that's already running: terminate the whole
   * worker, lose any other queued jobs as collateral, and start over. A
   * future iteration could add per-request cancellation tokens; v1 keeps
   * this honest by exposing only the all-or-nothing semantics.
   */
  cancelAll(): void {
    if (this._destroyed) return;
    this._terminateAll(new Error('MapshaperWorkerPool: cancelled'));
  }

  /** True iff at least one worker has been spawned. Test/diagnostics aid. */
  isWorkerSpawned(): boolean {
    return this._slots.some((s) => s.worker !== null);
  }

  /** Number of worker slots configured (NOT the count of currently-spawned workers). */
  get poolSize(): number {
    return this._slots.length;
  }

  // ---------------------------------------------------------------------------

  /**
   * Pick the worker slot to dispatch the next request to.
   *
   * Algorithm:
   *   1. Among slots with the LOWEST `pendingCount`, prefer those that
   *      are already spawned (avoid paying spawn cost when load is low).
   *   2. Within that subset, pick by round-robin so the load stays even
   *      across slots over time. The cursor advances on every dispatch.
   */
  private _pickWorker(): number {
    let bestIndex = 0;
    let bestCount = Infinity;
    let bestSpawned = false;
    const n = this._slots.length;
    for (let i = 0; i < n; i++) {
      const idx = (this._rrCursor + i) % n;
      const slot = this._slots[idx];
      const spawned = slot.worker !== null;
      const better =
        slot.pendingCount < bestCount
        // Same load — prefer spawned over un-spawned to avoid spawn cost
        || (slot.pendingCount === bestCount && spawned && !bestSpawned);
      if (better) {
        bestIndex = idx;
        bestCount = slot.pendingCount;
        bestSpawned = spawned;
      }
    }
    this._rrCursor = (bestIndex + 1) % n;
    return bestIndex;
  }

  private _terminateAll(reason: Error): void {
    for (const slot of this._slots) {
      if (slot.worker) {
        slot.worker.terminate();
        slot.worker = null;
      }
      slot.epoch++;
      slot.pendingCount = 0;
    }
    for (const { reject } of this._pending.values()) reject(reason);
    this._pending.clear();
  }

  private _ensureWorker(index: number): Worker {
    const slot = this._slots[index];
    if (slot.worker) return slot.worker;
    if (!this._WorkerCtor) {
      throw new Error('MapshaperWorkerPool: Worker constructor not available in this environment');
    }
    const w = new this._WorkerCtor(this._workerUrl);
    w.onmessage = (e: MessageEvent) => this._onMessage(index, e.data as ResponseMessage);
    w.onerror = (e: ErrorEvent) => this._onWorkerError(index, e);
    slot.worker = w;
    return w;
  }

  private _onMessage(workerIndex: number, data: ResponseMessage): void {
    if (!data || typeof data.id !== 'number') return;
    const pending = this._pending.get(data.id);
    if (!pending) return;
    // Defensive: if a fresh worker was spawned after this request's
    // worker was terminated, a late message from the dead worker would
    // otherwise resolve a NEW pending entry that happens to share the
    // same id. The epoch check rules this out. We also verify the
    // message came from the SAME worker the request was dispatched to —
    // shouldn't happen, but cheap to guard.
    const slot = this._slots[workerIndex];
    if (pending.workerIndex !== workerIndex || pending.epoch !== slot.epoch) return;
    this._pending.delete(data.id);
    slot.pendingCount = Math.max(0, slot.pendingCount - 1);
    if (data.type === 'ok') {
      pending.resolve(data.packed);
    } else {
      pending.reject(new Error(data.message || 'mapshaper worker error'));
    }
  }

  private _onWorkerError(workerIndex: number, e: ErrorEvent): void {
    // An uncaught worker exception (e.g. mapshaper bundle failed to parse)
    // doesn't fire onmessage, so we have to fail every pending request
    // dispatched to THIS worker to avoid hung promises. Other workers in
    // the pool stay alive — pool size > 1 means a partial outage doesn't
    // bring down everything.
    const err = new Error(`mapshaper worker error: ${e.message || 'unknown'}`);
    const slot = this._slots[workerIndex];
    if (slot.worker) {
      slot.worker.terminate();
      slot.worker = null;
    }
    slot.epoch++;
    slot.pendingCount = 0;
    // Fail only this worker's pending requests; leave others alone.
    const toFail: number[] = [];
    for (const [id, p] of this._pending) {
      if (p.workerIndex === workerIndex) toFail.push(id);
    }
    for (const id of toFail) {
      const p = this._pending.get(id);
      this._pending.delete(id);
      p?.reject(err);
    }
  }
}
