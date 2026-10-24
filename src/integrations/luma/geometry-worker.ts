import {
  packetByteLength,
  type WorkerRuntime,
  type TaskHandle,
  type WorkerSession,
} from '@mapseekai/tasklane';
import {
  SessionOwner,
  taskValue,
  workerError,
  reportWorkerCleanupFailure,
  MIB,
} from '../tasklane/runtime';
import {
  geometryBatchBytes,
  validateGeometryBatch,
  type GeometryBatchItem,
} from '../../engine/rendering/luma/geometry-batch';
import { collectTransferables } from '../../engine/worker/transferables';
import type { GeometryPacket } from '../../engine/rendering/luma/geometry-jobs';
import type { GeometryResult } from '../../engine/rendering/luma/geometry-packet';
type RecycledInput = Pick<GeometryPacket, 'coordinates' | 'offsets' | 'features'> & {
  index: number;
};

/** One lazy Worker per map, at most one bounded transferable batch in flight.
 * Cancellation terminates computation, rather than leaving a stale triangulation queued.
 */
export class GeometryWorker {
  private readonly owner: SessionOwner;
  private pending: TaskHandle<unknown> | null = null;
  private disposed = false;
  readonly stats = {
    workers: 0,
    jobs: 0,
    messages: 0,
    batchedJobs: 0,
    maxBatchJobs: 0,
    workerMs: 0,
    inputBytes: 0,
    peakInputBytes: 0,
    recycledInputBytes: 0,
  };
  private sources = new Set<string>();
  private retentionVersion = 0;
  private retaining = false;
  readonly triangulation = { bytes: 0, entries: 0, hits: 0, misses: 0, evictions: 0 };
  retainSources(sources: ReadonlySet<string>): void {
    if (sources.size === this.sources.size && [...sources].every((s) => this.sources.has(s)))
      return;
    this.sources = new Set(sources);
    this.retentionVersion++;
    this.flushRetention();
    if (!sources.size) this.triangulation.bytes = this.triangulation.entries = 0;
  }
  private flushRetention(): void {
    const session = this.owner.currentSession;
    if (
      !session ||
      session.state === 'lost' ||
      session.state === 'closed' ||
      this.retaining ||
      this.disposed
    )
      return;
    this.retaining = true;
    const version = this.retentionVersion;
    const payload = { retainSources: [...this.sources] };
    try {
      const handle = session.enqueue('geometry', {
        budget: { inputBytes: packetByteLength(payload), scratchBytes: 0, outputBytes: 4096 },
        prepare: () => ({ payload }),
      });
      void taskValue(handle, (response) => {
        if (this.owner.owns(session)) Object.assign(this.triangulation, response.cache);
      })
        .catch(async () => {
          if (this.owner.owns(session)) await this.owner.close().catch(reportWorkerCleanupFailure);
        })
        .finally(() => {
          this.retaining = false;
          if (version !== this.retentionVersion) this.flushRetention();
        });
    } catch (error) {
      this.retaining = false;
      void this.owner.close().catch(reportWorkerCleanupFailure);
      reportWorkerCleanupFailure(error);
    }
  }
  constructor(url: URL, runtime?: WorkerRuntime) {
    this.owner = new SessionOwner('geometry', url, runtime);
  }
  async build(packet: GeometryPacket, signal: AbortSignal): Promise<GeometryResult> {
    const response = await this.send({ packet }, signal);
    // A reply may arrive before the awaiting continuation runs.
    signal.throwIfAborted();
    if (this.disposed) throw new DOMException('Geometry Worker disposed', 'AbortError');
    return response.result!;
  }
  async buildBatch(packets: GeometryPacket[], signal: AbortSignal): Promise<GeometryBatchItem[]> {
    validateGeometryBatch(packets);
    const response = await this.send({ packets }, signal);
    // A reply may arrive before the awaiting continuation runs.
    signal.throwIfAborted();
    if (this.disposed) throw new DOMException('Geometry Worker disposed', 'AbortError');
    return response.results!;
  }
  private async send(
    payload: { packet?: GeometryPacket; packets?: GeometryPacket[] },
    signal: AbortSignal,
  ): Promise<{ result?: GeometryResult; results?: GeometryBatchItem[] }> {
    signal.throwIfAborted();
    if (this.disposed) throw new DOMException('Geometry Worker disposed', 'AbortError');
    if (this.pending) throw new Error('Geometry Worker already has an active job');
    const packets = payload.packets ?? [payload.packet!];
    const bytes = geometryBatchBytes(packets);
    const recycling = packets.flatMap((packet, index) =>
      packet.recycleInput
        ? [
            {
              index,
              packet,
              sizes: [packet.coordinates, packet.offsets, packet.features].map((a) => [
                a.length,
                a.byteOffset,
                a.buffer.byteLength,
              ]),
            },
          ]
        : [],
    );
    const recycledBytes = geometryBatchBytes(recycling.map((item) => item.packet));
    let session: WorkerSession | undefined;
    try {
      session = this.owner.session;
      const message = { ...payload, retainSources: [...this.sources] };
      const handle = session.enqueue('geometry', {
        budget: {
          inputBytes: packetByteLength(message),
          scratchBytes: 256 * MIB,
          outputBytes: 256 * MIB + recycledBytes,
        },
        signal,
        cancellation: 'terminate',
        priority: 'interactive',
        executionTimeoutMs: 120_000,
        prepare: () => ({ payload: message, transfer: collectTransferables(packets) }),
      });
      this.pending = handle;
      this.stats.workers = 1;
      this.stats.messages++;
      this.stats.inputBytes = bytes;
      this.stats.peakInputBytes = Math.max(this.stats.peakInputBytes, bytes);
      this.stats.maxBatchJobs = Math.max(this.stats.maxBatchJobs, packets.length);
      if (packets.length > 1) this.stats.batchedJobs += packets.length;
      void handle.settled.then(() => {
        if (this.pending === handle) {
          this.pending = null;
          this.stats.inputBytes = 0;
        }
      });
      return await taskValue(handle, (response) => {
        signal.throwIfAborted();
        if (!session || !this.owner.owns(session))
          throw new DOMException('Geometry generation released', 'AbortError');
        const valid = payload.packets
          ? Array.isArray(response.results) &&
            response.results.length === packets.length &&
            response.results.every(
              (item: GeometryBatchItem) =>
                !!item && !!item.result !== (typeof item.error === 'string'),
            )
          : !!response.result;
        const recycled: RecycledInput[] = response.recycled === undefined ? [] : response.recycled;
        const seen = new Set<number>();
        if (!valid || !Array.isArray(recycled) || recycled.length !== recycling.length)
          throw new Error('Invalid geometry Worker response');
        for (const input of recycled) {
          const expected = recycling.find((item) => item.index === input?.index);
          if (
            !expected ||
            seen.has(input.index) ||
            !(input.coordinates instanceof Float64Array) ||
            !(input.offsets instanceof Uint32Array) ||
            !(input.features instanceof Uint32Array) ||
            [input.coordinates, input.offsets, input.features].some(
              (a, i) =>
                a.length !== expected.sizes[i][0] ||
                a.byteOffset !== expected.sizes[i][1] ||
                a.buffer.byteLength !== expected.sizes[i][2],
            )
          )
            throw new Error('Invalid geometry Worker response');
          seen.add(input.index);
        }
        // Validate the complete reply before restoring any borrowed input ownership.
        for (const input of recycled) {
          const packet = packets[input.index];
          packet.coordinates = input.coordinates;
          packet.offsets = input.offsets;
          packet.features = input.features;
        }
        this.stats.recycledInputBytes += recycledBytes;
        Object.assign(this.triangulation, response.cache);
        this.stats.jobs +=
          response.results?.filter((item: GeometryBatchItem) => !!item.result).length ?? 1;
        this.stats.workerMs += handle.timing.workerMs;
        return response;
      });
    } catch (error) {
      // A terminated Session cannot be rebound; the next build gets a fresh generation.
      if (session && this.owner.owns(session))
        await this.owner.close().catch(reportWorkerCleanupFailure);
      this.stats.workers = 0;
      this.triangulation.bytes = this.triangulation.entries = 0;
      throw workerError(error);
    }
  }
  get closed(): Promise<void> {
    return this.owner.closed;
  }
  dispose(): void {
    this.disposed = true;
    void this.owner.close().catch(reportWorkerCleanupFailure);
    this.stats.workers = 0;
    this.triangulation.bytes = this.triangulation.entries = 0;
    this.sources.clear();
  }
}
