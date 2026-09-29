import type { TaskHandle, WorkerSession, SessionGroup } from '@mapseekai/tasklane';
import { packetByteLength } from '@mapseekai/tasklane';
import {
  taskValue,
  workerError,
  isWorkerRuntimeError,
  reportWorkerCleanupFailure,
  MIB,
} from '../tasklane/runtime';
import { RasterError } from '../../domain/raster/policy';
import type { GeoTIFFWorkerCommand, GeoTIFFWorkerResponse } from './worker-protocol';

/** Domain admission waits for tasklane's physical settlement, including cancellation. */
export class RasterWorkerClient {
  private readonly active = new Set<TaskHandle<unknown>>();
  private direct?: TaskHandle<unknown>;
  private closed = false;
  private disposalError?: unknown;
  private closing: Promise<void> = Promise.resolve();
  constructor(
    private readonly session: WorkerSession,
    private idle?: () => void,
    private fatal?: (error: unknown) => void,
    private started?: () => void,
  ) {}
  /** Direct Session calls remain serialized; groups own their physical admission. */
  get busy(): boolean {
    return this.direct !== undefined;
  }
  get pendingCount(): number {
    return this.active.size;
  }
  get queuedCount(): number {
    return [...this.active].filter((task) => task.state === 'queued').length;
  }
  get runningCount(): number {
    return [...this.active].filter((task) =>
      ['starting', 'preparing', 'running', 'cancelling'].includes(task.state),
    ).length;
  }
  async call(
    message: GeoTIFFWorkerCommand,
    signal?: AbortSignal,
    transfer: Transferable[] = [],
    options?: {
      group?: () => SessionGroup;
      keys?: string[];
      settled?: () => void;
      cacheCapacityBytes?: () => number;
    },
  ): Promise<GeoTIFFWorkerResponse> {
    let handle: TaskHandle<unknown> | undefined;
    const release = () => {
      if (!this.closed) {
        options?.settled?.();
        this.idle?.();
      }
    };
    try {
      signal?.throwIfAborted();
      if (this.closed) throw new RasterError('SOURCE_CLOSED', 'Raster Worker is closed.');
      if (!options?.group && this.direct)
        throw new RasterError('RASTER_WORKER_BUSY', 'Only one direct job per Worker is allowed.');
      const fileBytes =
        message.type === 'open' ? message.file.size + (message.overviewFile?.size ?? 0) : 0;
      handle = (options?.group?.() ?? this.session).enqueue('raster', {
        ...(options?.keys ? { affinity: { keys: options.keys } } : {}),
        budget: {
          // Reserve the hint's metadata too; its actual value is read only at
          // admission, after any pressure/resize maintenance ahead of this job.
          inputBytes: packetByteLength(
            options?.cacheCapacityBytes
              ? { ...message, cacheCapacityBytes: Number.MAX_SAFE_INTEGER }
              : message,
          ),
          scratchBytes: 256 * MIB,
          outputBytes: 65 * MIB,
        },
        blobLimits: { inputBytes: fileBytes, outputBytes: 0 },
        signal,
        cancellation: 'cooperative',
        executionTimeoutMs: 60_000,
        priority: 'interactive',
        prepare: () => {
          // Observe after synchronous prepare/postMessage, before browser replies.
          // Queued work must not inflate the source's execution peak.
          queueMicrotask(() => {
            if (!this.closed) this.started?.();
          });
          const payload = options?.cacheCapacityBytes
            ? { ...message, cacheCapacityBytes: options.cacheCapacityBytes() }
            : message;
          return { payload, transfer };
        },
      });
      this.active.add(handle);
      if (!options?.group) this.direct = handle;
      void handle.settled.then(() => {
        this.active.delete(handle!);
        if (this.direct === handle) this.direct = undefined;
        release();
      });
      return await taskValue<GeoTIFFWorkerResponse>(handle);
    } catch (error) {
      let failure = this.disposalError ?? workerError(error);
      const fatalFailure =
        isWorkerRuntimeError(error) &&
        [
          'EXECUTION_TIMEOUT',
          'STARTUP_TIMEOUT',
          'WORKER_FAILED',
          'PROTOCOL_ERROR',
          'SESSION_LOST',
        ].includes(error.code);
      if (fatalFailure)
        failure = new RasterError(
          error.code.includes('TIMEOUT') ? 'RASTER_WORKER_TIMEOUT' : 'RASTER_WORKER_FAILED',
          error.message,
        );
      if (this.session.state === 'lost' || (options?.group && fatalFailure)) {
        const callback = this.fatal;
        this.dispose();
        callback?.(failure);
      }
      if (!handle) release();
      throw failure;
    }
  }
  dispose(_error?: unknown): void {
    this.closed = true;
    this.disposalError ??= _error;
    this.closing = this.session.dispose();
    void this.closing.catch(reportWorkerCleanupFailure);
    this.idle = undefined;
    this.fatal = undefined;
    this.started = undefined;
  }
  get settled(): Promise<void> {
    return this.closing;
  }
}
