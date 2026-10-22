import type { WorkerRuntime } from '@mapseekai/tasklane';
import {
  planGeometryHandoff,
  type GeometryHandoffGroup,
} from '../../engine/rendering/luma/geometry-handoff';
import {
  GEOMETRY_BATCH_JOBS,
  GEOMETRY_BATCH_BYTES,
  geometryBatchBytes,
  geometryJobByteBound,
  type GeometryBatchItem,
} from '../../engine/rendering/luma/geometry-batch';
import { FillRangeIndex } from '../../engine/rendering/luma/fill-ranges';
import { arcVisibilityKey, arcVisibilityFilter } from '../../domain/geo/arc-visibility';
import {
  geometryYield,
  partitionGeometry,
  selectGeometryJobs,
  packGeometryJob,
  type GeometryInput,
  type GeometryPartition,
  type GeometryJob,
  type GeometryPacket,
} from '../../engine/rendering/luma/geometry-jobs';
import { PathRangeIndex } from '../../engine/rendering/luma/path-ranges';
import { compactStrokeCompatible } from '../../engine/rendering/luma/compact-stroke';
import { validateScreenPathRequest } from '../../engine/rendering/luma/screen-paths';
import { AffineTransform } from '../../domain/geo/transform';
import type { GeometryResult } from '../../engine/rendering/luma/geometry-packet';
import type { GpuMesh, GpuRenderer } from './gpu-renderer';
import { GeometryWorker } from './geometry-worker';

export interface GeometryOwner {
  id: string;
  sourceId: string;
  revision: number;
  content?: string;
  sourceSelection?: boolean;
}
interface StableSelection {
  ready: boolean;
  plan: Plan;
  owner: GeometryOwner;
  input: GeometryInput;
  promise: Promise<GeometryJob[]>;
  bytes: number;
  used: number;
  controller: AbortController;
}
interface PackedSource {
  owner: GeometryOwner;
  arcs: GeometryInput['arcs'];
  interval: number;
  coordinates: Float64Array;
  offsets: Uint32Array;
  features: Uint32Array;
  bytes: number;
}
interface Plan {
  key: string;
  sourceId: string;
  controller: AbortController;
  promise: Promise<GeometryPartition>;
  count: number;
  boundsBytes: number;
  revision: number;
  used: number;
  ready: boolean;
}
export interface GeometryEntry {
  id: string;
  family: string;
  /** Chunk numbers are meaningful only inside this exact partition. */
  partition: string;
  owner: GeometryOwner;
  job: GeometryJob;
  state: 'queued' | 'building' | 'ready' | 'error';
  meshes: GpuMesh[];
  ranges: (PathRangeIndex | undefined)[];
  screenSpace: boolean;
  screenView?: readonly [number, number, number, number];
  /** Only whole-layer affine filtering can cover a coarser physical resolution. */
  screenDetail?: {
    interval: number;
    resolution: readonly [number, number];
    revision: number;
  };
  fillRanges: (FillRangeIndex | undefined)[];
  memberRanges?: (Uint32Array | undefined)[];
  fallback?: GeometryEntry;
  bytes: number;
  used: number;
  screenStats?: GeometryResult['screenStats'];
  /** Observed CPU reconstruction cost, never a reservation or memory allowance. */
  preparationMs?: number;
  retentionPriority?: number;
  error?: Error;
  requiredBytes?: number;
  /** Exact-detail coverage of a derived fill; never reused across membership/LOD. */
  coverage?: { bounds: NonNullable<GeometryInput['storageBounds']>; interval: number };
}
export interface GeometryRequest {
  /** Stable ordinal within a source/paint family; distinct same-colour draws stay isolated. */
  slot?: number;
  selectionKey?: string;
  input: GeometryInput;
  owner: GeometryOwner;
  plan: Plan;
  controller: AbortController;
  key: string;
  entries: GeometryEntry[] | null;
  fallback?: GeometryEntry[];
  /** Same-partition presentation, independent of viewport-dependent membership hashes. */
  fallbackChunks?: Map<number, GeometryEntry[]>;
  fallbackGroups?: GeometryHandoffGroup[];
  error?: Error;
  /** Includes any partial allocation, so its cleanup alone cannot trigger another attempt. */
  requiredMetadataBytes?: number;
  frame: number;
  /** Monotone cursor through this immutable selection; no repeated prefix scans. */
  cursor: number;
}
type GeometryTransport = Pick<GeometryWorker, 'build' | 'dispose' | 'stats'> &
  Partial<Pick<GeometryWorker, 'triangulation' | 'retainSources' | 'buildBatch' | 'closed'>>;
interface Options {
  invalidate(): void;
  report(error: Error): void;
  workerRuntime?: WorkerRuntime;
  workerUrl: URL;
  cacheBytes?: number;
  /** Shared by plans, stable selections and reusable source packets. */
  partitionCacheBytes?: number;
  externalBytes?: () => number;
  /** Internal test/host transport seam, not a second source dataset. */
  transport?: GeometryTransport;
}
class GeometryAdmissionError extends RangeError {
  reported = false;
  reportPending = false;
}
class GeometryMetadataAdmissionError extends GeometryAdmissionError {
  constructor(readonly requiredBytes: number) {
    super('Geometry selection cache exceeds its bounded working set.');
  }
}
function containsBounds(a: readonly number[], b: readonly number[]): boolean {
  return a[0] <= b[0] && a[1] <= b[1] && a[2] >= b[2] && a[3] >= b[3];
}
function sameArray(a: ArrayLike<number> | undefined, b: ArrayLike<number> | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function sameJob(a: GeometryJob, b: GeometryJob): boolean {
  return sameArray(a.members, b.members) && sameArray(a.components, b.components);
}
function hashJob(job: GeometryJob): number {
  let h = 2166136261;
  for (const a of [job.members, job.components]) {
    h = Math.imul(h ^ (a?.length ?? 0), 16777619);
    if (a) for (const n of a) h = Math.imul(h ^ n, 16777619);
  }
  return h >>> 0;
}
/** Stable spatial chunk resources, separate from small immediate-mode draw slots.
 * All builds happen after rendering yields; only selected XY packets cross the Worker.
 */
export class GeometryChunkCache {
  private requests = new Map<string, GeometryRequest>();
  private plans = new Map<string, Plan>();
  private entries = new Map<string, GeometryEntry>();
  private selections = new Map<string, StableSelection>();
  private packed = new Map<GeometryJob, PackedSource>();
  private packedBytes = 0;
  private jobHashes = new WeakMap<GeometryJob, number>();
  private identities = new WeakMap<object, number>();
  private serial = 0;
  private frame = 0;
  private collecting = false;
  private wantedCache: Set<GeometryEntry> | null = null;
  private protectedCache: Set<GeometryEntry> | null = null;
  private trimCandidates: GeometryEntry[] | null = null;
  private trimCursor = 0;
  private presentationCost = 0;
  private firstPresentation = true;
  /** Dirty only when requests or pinned ownership change, not after every job. */
  private selectionChanged(): void {
    this.wantedCache = this.protectedCache = null;
    this.trimCandidates = null;
    this.trimCursor = 0;
  }
  didPresent(milliseconds: number): void {
    this.presentationCost = this.presentationCost * 0.7 + Math.max(0, milliseconds) * 0.3;
    this.firstPresentation = false;
  }
  private slots = new Map<string, number>();
  private worker: GeometryTransport;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private interacting = false;
  private notification: ReturnType<typeof setTimeout> | null = null;
  private resumeAdmission: (() => void) | null = null;
  private presentationPlanning = false;
  private pinned = new Set<GeometryEntry>();
  private latest = new Map<string, GeometryEntry>();
  private turn = 0;
  private handoffOwner: GeometryOwner | undefined;
  private handoffRequests: GeometryRequest[] = [];
  private disposed = false;
  /** Diagnostic seam; changing batching never changes logical chunks or GPU precision. */
  batchJobs = GEOMETRY_BATCH_JOBS;
  private active: { entries: Set<GeometryEntry>; controller: AbortController } | null = null;
  private clock = 0;
  // GreedyDual-size inflation ages out even an expensive unused mesh eventually.
  // Current/presenting/pinned entries remain protected independently of this score.
  private retentionAge = 0;
  private touch(entry: GeometryEntry): void {
    entry.used = ++this.clock;
    entry.retentionPriority =
      this.retentionAge + (entry.preparationMs ?? 0) / Math.max(1, entry.bytes);
  }
  private bytes = 0;
  private externalEstimate = 0;
  private residencyVersion = 0;
  private settledVersion = -1;
  private settledExternal = -1;
  private settledRequests: GeometryRequest[] = [];
  private get externalBytes(): number {
    return this.options.externalBytes?.() ?? this.externalEstimate;
  }
  private limit: number;
  readonly counters = {
    maintenanceSkips: 0,
    partitions: 0,
    partitionHits: 0,
    builds: 0,
    cacheHits: 0,
    evictions: 0,
    cancellations: 0,
    errors: 0,
    peakBytes: 0,
    maxMeshBytes: 0,
    peakResultBytes: 0,
    pendingUploadBytes: 0,
    uploadCpuMs: 0,
    maxMeshUploadMs: 0,
    maxUploadSliceMs: 0,
    uploadYields: 0,
    coverageHits: 0,
    selectionBuilds: 0,
    selectionHits: 0,
    packMs: 0,
    packedHits: 0,
    packedMisses: 0,
    batchAdmissionMs: 0,
    uploadCulledBytes: 0,
    directFeatures: 0,
    pathInputInstances: 0,
    pathOutputInstances: 0,
    preparationMs: 0,
    evictedPreparationMs: 0,
    evictedFillEntries: 0,
    evictedScreenEntries: 0,
  };
  constructor(
    private readonly gpu: GpuRenderer,
    private readonly options: Options,
  ) {
    this.worker = options.transport ?? new GeometryWorker(options.workerUrl, options.workerRuntime);
    this.limit = options.cacheBytes ?? 256 * 1024 ** 2;
  }
  get stats() {
    const requests = this.current(),
      entries = this.wanted();
    const queued = [...entries].filter((e) => e.state === 'queued').length;
    const building = [...entries].filter((e) => e.state === 'building').length;
    const failedEntries = [...entries].filter((e) => e.state === 'error').length;
    const blockedEntries = [...entries].filter(
      (e) => e.state === 'error' && e.requiredBytes !== undefined,
    ).length;
    const planningRequests = requests.filter((r) => !r.entries && !r.error).length;
    const pending = planningRequests + queued + building;
    return {
      ...this.counters,
      ...this.worker.stats,
      entries: this.entries.size,
      visibleChunks: this.wanted().size,
      visibleMeshes: [...this.wanted()].reduce((n, e) => n + e.meshes.length, 0),
      bytes: this.bytes,
      budgetBytes: this.limit,
      workingSetOverBudgetBytes: Math.max(0, this.bytes + this.externalBytes - this.limit),
      partitionBytes: [...this.plans.values()].reduce((n, p) => n + p.count * 4 + p.boundsBytes, 0),
      pending,
      queued,
      building,
      failedEntries,
      blockedEntries,
      planningRequests,
      failedRequests: requests.filter((r) => this.failed(r)).length,
      selectionCacheBytes: [...this.selections.values()].reduce((n, s) => n + s.bytes, 0),
      packedCacheBytes: this.packedBytes,
      packedCacheEntries: this.packed.size,
      paused: false,
      interacting: this.interacting,
      triangulation: this.worker.triangulation ? { ...this.worker.triangulation } : null,
      selectionBytes: [...this.requests.values()].reduce(
        (n, r) => n + (r.input.ids?.byteLength ?? 0) + (r.input.components?.byteLength ?? 0),
        0,
      ),
      screenChunks: [...this.wanted()].filter((e) => e.screenSpace).length,
      screenSegments: [...this.wanted()].reduce(
        (n, e) => n + (e.screenStats?.outputSegments ?? 0),
        0,
      ),
    };
  }
  admitExternal(incoming: number): void {
    this.trim(incoming);
    if (this.bytes + this.externalBytes + incoming > this.limit * 2)
      throw new RangeError('Shared geometry working set exceeds its bounded allocation limit.');
  }
  identity(value: object | undefined): number {
    if (!value) return 0;
    let id = this.identities.get(value);
    if (!id) {
      id = ++this.serial;
      this.identities.set(value, id);
    }
    return id;
  }
  begin(externalBytes = 0): void {
    this.frame++;
    this.selectionChanged();
    this.collecting = true;
    this.slots.clear();
    this.externalEstimate = externalBytes;
  }
  private inputKey(input: GeometryInput, owner: GeometryOwner): string {
    const visibility = input.arcs ? arcVisibilityKey(input.arcs, input.filter) : undefined;
    return JSON.stringify([
      owner.sourceId,
      owner.id,
      owner.revision,
      owner.content,
      input.kind,
      input.sourceSelection,
      this.identity(input.arcs),
      this.identity(input.shapes),
      input.arcs?.size(),
      input.shapes?.length,
      input.interval,
      input.forward,
      input.ordered,
      input.wholeLayer,
      input.spatialOrder,
      visibility,
      input.bounds,
      input.viewBounds,
      input.storageBounds,
      input.screen,
      input.compactStroke,
    ]);
  }
  request(input: GeometryInput, owner: GeometryOwner): GeometryRequest {
    this.selectionChanged();
    // Empty expression buckets may disappear as the viewport moves. Number slots
    // within each paint/content family, not across all colours in the layer.
    const ownerId = JSON.stringify([owner.sourceId, owner.id, owner.content, input.kind]),
      slot = this.slots.get(ownerId) ?? 0;
    this.slots.set(ownerId, slot + 1);
    const id = ownerId + ':' + slot,
      key = this.inputKey(input, owner),
      previous = this.requests.get(id);
    const retryMetadata =
      previous?.requiredMetadataBytes !== undefined &&
      this.bytes + this.externalBytes + previous.requiredMetadataBytes <= this.limit * 2;
    if (
      previous?.key === key &&
      sameArray(previous.input.ids, input.ids) &&
      sameArray(previous.input.components, input.components) &&
      !retryMetadata
    ) {
      previous.frame = this.frame;
      previous.plan.used = ++this.clock;
      // Completion requires resident entries, not only an old ready flag.
      // Recreate a lost selection defensively rather than leaving it pending
      // forever or presenting an incomplete frame as complete.
      if (previous.entries?.some((entry) => this.entries.get(entry.id) !== entry)) {
        previous.cursor = 0;
        previous.entries = previous.entries.map((entry) =>
          this.entries.get(entry.id) === entry ? entry : this.entry(entry.job, previous),
        );
        this.schedule();
      }
      for (const entry of previous.entries ?? []) this.touch(entry);
      return previous;
    }
    previous?.controller.abort();
    const snapshot = {
        ...input,
        ids:
          input.sourceSelection && sameArray(previous?.input.ids, input.ids)
            ? previous?.input.ids
            : input.ids?.slice(),
        components: input.components?.slice(),
      },
      controller = new AbortController();
    const planKey = JSON.stringify([
      owner.sourceId,
      owner.revision,
      input.kind === 'path' ? 'arcs' : input.kind,
      input.ordered,
      input.wholeLayer,
      this.identity(input.kind === 'path' ? input.arcs : input.shapes),
      this.identity(input.arcs),
      input.bounds,
    ]);
    let plan = this.plans.get(planKey);
    if (!plan) {
      const signal = new AbortController();
      plan = {
        key: planKey,
        sourceId: owner.sourceId,
        controller: signal,
        count: 0,
        boundsBytes: 0,
        revision: owner.revision,
        used: ++this.clock,
        ready: false,
        promise: Promise.resolve(null as unknown as GeometryPartition),
      };
      const retained = plan;
      retained.promise = (async () => {
        await geometryYield(signal.signal);
        const result = await partitionGeometry(snapshot, signal.signal);
        retained.count = result.membership.length;
        retained.boundsBytes =
          (result.bounds?.byteLength ?? 0) + (result.batchIds?.byteLength ?? 0);
        retained.ready = true;
        this.counters.partitions++;
        return result;
      })();
      // Request-specific consumers report the error; never leave an unhandled abort rejection.
      void retained.promise.catch(() => {});
      this.plans.set(planKey, retained);
    } else {
      plan.used = ++this.clock;
      this.counters.partitionHits++;
    }
    const request: GeometryRequest = {
      slot,
      selectionKey: this.selectionKey(snapshot, owner, plan, slot),
      input: snapshot,
      owner: { ...owner },
      plan,
      controller,
      key,
      entries: null,
      fallback:
        previous &&
        previous.owner.revision === owner.revision &&
        previous.owner.content === owner.content &&
        previous.input.shapes === input.shapes &&
        previous.input.kind === input.kind &&
        (previous.plan.key === planKey ||
          // stableSourceBounds retains this array per source/dataset/revision.
          // Reference equality, unchanged topology IDs and the revision/content
          // guards distinguish a DisplayArcs LOD switch from source replacement.
          (previous.input.bounds === input.bounds &&
            previous.input.ordered === input.ordered &&
            previous.input.arcs?.size() === input.arcs?.size())) &&
        previous.input.forward === input.forward &&
        previous.input.spatialOrder === input.spatialOrder &&
        previous.input.compactStroke === input.compactStroke
          ? this.drawable(previous)
          : undefined,
      frame: this.frame,
      cursor: 0,
    };
    this.requests.set(id, request);
    void (async () => {
      const partition = await plan.promise;
      controller.signal.throwIfAborted();
      const jobs = await this.selectJobs(request, partition);
      controller.signal.throwIfAborted();
      if (
        request.fallback?.length &&
        !snapshot.wholeLayer &&
        !snapshot.ordered &&
        request.fallback.some((entry) => entry.partition !== plan.key)
      ) {
        request.fallbackGroups = await planGeometryHandoff(
          jobs,
          request.fallback.map((entry) => entry.job),
          partition,
          snapshot.kind === 'path',
          controller.signal,
        );
        const used = new Map<number, number>();
        const retained: GeometryEntry[] = [];
        for (const group of request.fallbackGroups) {
          group.previous = group.previous.map((index) => {
            let next = used.get(index);
            if (next === undefined) {
              used.set(index, (next = retained.length));
              retained.push(request.fallback![index]);
            }
            return next;
          });
        }
        request.fallback = retained;
      }
      controller.signal.throwIfAborted();
      // Admit the selection together before its prefix exists outside request.entries.
      // Per-entry trimming could otherwise evict that not-yet-published prefix.
      const metadataBytes = jobs.reduce(
        (n, job) => n + job.members.byteLength + (job.components?.byteLength ?? 0),
        0,
      );
      if (this.bytes + this.externalBytes + metadataBytes > this.limit * 2)
        this.trim(metadataBytes, request);
      const allocatedBefore = this.bytes;
      try {
        request.entries = jobs.map((job) => this.entry(job, request));
      } catch (error) {
        if (error instanceof GeometryMetadataAdmissionError)
          request.requiredMetadataBytes = this.bytes - allocatedBefore + error.requiredBytes;
        throw error;
      }
      if (
        request.fallback &&
        !snapshot.wholeLayer &&
        !snapshot.ordered &&
        !request.fallbackGroups
      ) {
        const selected = new Set(jobs.map((job) => job.chunk));
        request.fallback = request.fallback.filter((entry) => selected.has(entry.job.chunk));
        request.fallbackChunks = new Map();
        for (const entry of request.fallback) {
          const chunk = entry.job.chunk;
          const entries = request.fallbackChunks.get(chunk);
          if (entries) entries.push(entry);
          else request.fallbackChunks.set(chunk, [entry]);
        }
      }
      this.selectionChanged();
      this.cancelObsolete();
      this.schedule();
      this.notify();
    })().catch((error) => {
      if (controller.signal.aborted || this.disposed) return;
      request.error = error instanceof Error ? error : new Error(String(error));
      if (request.error instanceof GeometryMetadataAdmissionError) {
        // finish() first removes this selection's unpublished metadata prefix
        // and presents other owners before deciding whether admission is terminal.
        if (request.requiredMetadataBytes! <= this.limit * 2) {
          this.notify();
          return;
        }
        request.error.reported = true;
      }
      this.counters.errors++;
      this.options.report(request.error);
      this.notify();
    });
    return request;
  }
  private admissionCapacity(owner: GeometryOwner): number {
    return (
      this.limit * 2 -
      this.bytes -
      this.externalBytes +
      this.provisionalAtomicEntries(owner).reduce(
        (n, e) => n + e.bytes - e.job.members.byteLength - (e.job.components?.byteLength ?? 0),
        0,
      )
    );
  }
  private canPrepare(
    request: GeometryRequest,
    capacity = this.admissionCapacity(request.owner),
  ): boolean {
    return (
      (request.requiredMetadataBytes !== undefined && request.requiredMetadataBytes <= capacity) ||
      (!request.error &&
        (request.entries === null ||
          request.entries.some(
            (entry) =>
              entry.state === 'queued' ||
              (entry.state === 'error' &&
                entry.requiredBytes !== undefined &&
                entry.requiredBytes <= capacity),
          )))
    );
  }
  private metadataCanProgress(request: GeometryRequest): boolean {
    return this.admissionCanProgress(request, request.requiredMetadataBytes);
  }
  private admissionCanProgress(
    request: GeometryRequest,
    required: number | undefined,
    entry?: GeometryEntry,
  ): boolean {
    if (required === undefined || required > this.limit * 2) return false;
    if (required <= this.admissionCapacity(request.owner)) return true;
    if (this.running || this.active) return true;
    const current = this.current();
    if (current.some((r) => this.canPrepare(r))) return true;
    // A real dependency walk can publish already prepared progressive geometry.
    // Planning that depends only on this failed selection cannot free capacity.
    return (
      this.presentationPlanning &&
      current.some(
        (r) =>
          (entry ||
            r.owner.sourceId !== request.owner.sourceId ||
            r.owner.id !== request.owner.id) &&
          !r.input.wholeLayer &&
          !r.input.ordered &&
          r.entries?.some((e) => this.isResident(e) && !this.pinned.has(e)),
      )
    );
  }
  private selectionKey(
    input: GeometryInput,
    owner: GeometryOwner,
    plan: Plan,
    slot: number,
  ): string | undefined {
    const visibility = input.arcs && arcVisibilityKey(input.arcs, input.filter);
    if (
      !input.sourceSelection ||
      input.ordered ||
      (input.kind !== 'fill' && input.kind !== 'path') ||
      (input.filter && !visibility)
    )
      return undefined;
    return JSON.stringify([
      plan.key,
      owner.id,
      owner.content,
      input.forward,
      input.spatialOrder,
      visibility?.[0],
      slot,
    ]);
  }
  /** Reuse immutable source/style membership; camera changes only select chunk boxes.
   * Arbitrary filters, ordered icons and callers with view-dependent IDs stay exact. */
  private async selectJobs(
    request: GeometryRequest,
    partition: GeometryPartition,
  ): Promise<GeometryJob[]> {
    const input = request.input;
    const visibility = input.arcs && arcVisibilityKey(input.arcs, input.filter);
    if (
      !input.sourceSelection ||
      input.ordered ||
      (!partition.bounds && !input.wholeLayer) ||
      (input.kind !== 'fill' && input.kind !== 'path') ||
      (input.filter && !visibility)
    )
      return selectGeometryJobs(input, partition, request.controller.signal);
    const key = request.selectionKey!;
    let selection = this.selections.get(key);
    if (selection && !sameArray(selection.input.ids, input.ids)) {
      selection.controller.abort();
      this.selections.delete(key);
      selection = undefined;
    }
    if (!selection) {
      const controller = new AbortController();
      const stable = {
        ...input,
        viewBounds: undefined,
        filter: visibility ? arcVisibilityFilter(input.arcs!, visibility[0], null) : undefined,
      };
      selection = {
        ready: false,
        plan: request.plan,
        owner: request.owner,
        input: stable,
        controller,
        used: ++this.clock,
        bytes: 0,
        promise: Promise.resolve([]),
      };
      const retained = selection;
      retained.promise = (async () => {
        const jobs = await selectGeometryJobs(stable, partition, controller.signal);
        const bounds = new Map<number, [number, number, number, number]>();
        for (let i = 0; partition.bounds && i < partition.chunks; i++) {
          const chunk = input.kind === 'path' && partition.batchIds ? partition.batchIds[i] : i;
          const b = partition.bounds!,
            at = i * 4;
          const old = bounds.get(chunk);
          if (old) {
            old[0] = Math.min(old[0], b[at]);
            old[1] = Math.min(old[1], b[at + 1]);
            old[2] = Math.max(old[2], b[at + 2]);
            old[3] = Math.max(old[3], b[at + 3]);
          } else bounds.set(chunk, [b[at], b[at + 1], b[at + 2], b[at + 3]]);
        }
        for (const job of jobs) job.bounds = bounds.get(job.chunk);
        retained.bytes =
          (stable.ids?.byteLength ?? 0) +
          (stable.components?.byteLength ?? 0) +
          jobs.reduce((n, j) => n + j.members.byteLength + (j.components?.byteLength ?? 0) + 32, 0);
        retained.ready = true;
        this.counters.selectionBuilds++;
        this.trimSelections();
        return jobs;
      })();
      void retained.promise.catch(() => {});
      this.selections.set(key, selection);
    } else {
      selection.used = ++this.clock;
      this.counters.selectionHits++;
    }
    const jobs = await selection.promise;
    request.controller.signal.throwIfAborted();
    if (input.wholeLayer) return jobs;
    const view = input.viewBounds;
    const visible = view
      ? jobs.filter(
          (j) =>
            !j.bounds ||
            !(
              j.bounds[0] > view[2] ||
              j.bounds[1] > view[3] ||
              j.bounds[2] < view[0] ||
              j.bounds[3] < view[1]
            ),
        )
      : jobs;
    // Keep complete boundary chunks resident; draw-range culling and the GPU
    // viewport clip them without rebuilding their membership on every pan.
    return visible;
  }

  private trimSelections(): void {
    const token = (owner: GeometryOwner) =>
      JSON.stringify([owner.sourceId, owner.id, owner.revision, owner.content]);
    const owners = new Set(
      (this.collecting ? [...this.requests.values()] : this.current()).map((r) => token(r.owner)),
    );
    const activeKeys = new Set(
      (this.collecting ? [...this.requests.values()] : this.current()).map((r) => r.selectionKey),
    );
    for (const [key, selection] of this.selections) {
      if (
        !this.plans.has(selection.plan.key) ||
        !owners.has(token(selection.owner)) ||
        (!selection.ready && !activeKeys.has(key))
      ) {
        selection.controller.abort();
        this.selections.delete(key);
      }
    }
    const indexBytes = [...this.plans.values()].reduce(
      (n, p) => n + p.count * 4 + p.boundsBytes,
      0,
    );
    const limit = Math.min(
      64 * 1024 ** 2,
      Math.max(0, (this.options.partitionCacheBytes ?? 128 * 1024 ** 2) - indexBytes),
    );
    let bytes = [...this.selections.values()].reduce((n, s) => n + s.bytes, 0);
    for (const [key, s] of [...this.selections].sort((a, b) => a[1].used - b[1].used)) {
      if (bytes <= limit && this.selections.size <= 128) break;
      // Evict completed membership only; current requests already own their selected jobs.
      if (!s.ready) continue;
      bytes -= s.bytes;
      this.selections.delete(key);
    }
    this.trimPacked();
  }
  private get packedLimit(): number {
    return Math.max(
      0,
      (this.options.partitionCacheBytes ?? 128 * 1024 ** 2) -
        [...this.plans.values()].reduce((n, p) => n + p.count * 4 + p.boundsBytes, 0) -
        [...this.selections.values()].reduce((n, s) => n + s.bytes, 0),
    );
  }
  private dropPacked(job: GeometryJob): void {
    const packet = this.packed.get(job);
    if (packet) this.packedBytes -= packet.bytes;
    this.packed.delete(job);
  }
  private trimPacked(): void {
    const requests = this.current();
    const jobs = requests.every((r) => r.entries !== null || r.error)
      ? new Set(requests.flatMap((r) => (r.entries ?? []).map((e) => e.job)))
      : null;
    for (const [job, packet] of this.packed)
      if (
        (jobs && !jobs.has(job)) ||
        !requests.some(
          (r) =>
            r.input.arcs === packet.arcs &&
            r.input.interval === packet.interval &&
            r.owner.sourceId === packet.owner.sourceId &&
            r.owner.id === packet.owner.id &&
            r.owner.revision === packet.owner.revision &&
            r.owner.content === packet.owner.content,
        )
      )
        this.dropPacked(job);
    const limit = this.packedLimit;
    for (const job of this.packed.keys()) {
      if (this.packedBytes <= limit) break;
      this.dropPacked(job);
    }
  }
  private async pack(
    request: GeometryRequest,
    entry: GeometryEntry,
    signal: AbortSignal,
  ): Promise<GeometryPacket> {
    signal.throwIfAborted();
    const input =
      request.input.kind === 'fill'
        ? { ...request.input, storageBounds: entry.coverage?.bounds }
        : request.input;
    const reusable = input.sourceSelection && input.kind === 'path' && !!input.screen;
    const old = this.packed.get(entry.job);
    if (
      reusable &&
      old &&
      old.arcs === input.arcs &&
      old.interval === input.interval &&
      old.owner.sourceId === request.owner.sourceId &&
      old.owner.id === request.owner.id &&
      old.owner.revision === request.owner.revision &&
      old.owner.content === request.owner.content
    ) {
      this.packed.delete(entry.job);
      this.packed.set(entry.job, old);
      this.counters.packedHits++;
      return {
        kind: 'path',
        screen: input.screen,
        compactStroke: input.compactStroke,
        storageBounds: input.storageBounds,
        coordinates: old.coordinates.slice(),
        offsets: old.offsets.slice(),
        features: old.features.slice(),
      };
    }
    if (old) this.dropPacked(entry.job);
    const packet = await packGeometryJob(input, entry.job, signal);
    signal.throwIfAborted();
    if (reusable) {
      this.counters.packedMisses++;
      const bytes =
        packet.coordinates.byteLength +
        packet.offsets.byteLength +
        packet.features.byteLength +
        entry.job.members.byteLength +
        (entry.job.components?.byteLength ?? 0);
      // Keep warm inputs when the working set exceeds capacity; cyclic eviction would miss every time.
      if (bytes <= GEOMETRY_BATCH_BYTES && this.packedBytes + bytes <= this.packedLimit) {
        this.packed.set(entry.job, {
          owner: request.owner,
          arcs: input.arcs,
          interval: input.interval,
          bytes,
          coordinates: packet.coordinates.slice(),
          offsets: packet.offsets.slice(),
          features: packet.features.slice(),
        });
        this.packedBytes += bytes;
      }
    }
    return packet;
  }
  private entry(job: GeometryJob, request: GeometryRequest): GeometryEntry {
    const storage = request.input.storageBounds;
    const fullChunk = job.bounds && storage && containsBounds(storage, job.bounds);
    const storageBounds = fullChunk ? undefined : storage;
    let jobHash = this.jobHashes.get(job);
    if (jobHash === undefined) {
      jobHash = hashJob(job);
      if (request.input.sourceSelection) this.jobHashes.set(job, jobHash);
    }
    const base = JSON.stringify([
      request.owner.id,
      request.plan.key,
      request.input.kind,
      job.chunk,
      jobHash,
      request.input.compactStroke,
    ]);
    let family = base,
      collision = 0,
      old = this.latest.get(family);
    while (old && !sameJob(old.job, job)) {
      family = base + ':' + ++collision;
      old = this.latest.get(family);
    }
    // A resident full-coverage mesh already contains this smaller view. Reuse
    // it rather than uploading a clipped duplicate solely because the camera moved.
    if (request.input.kind === 'fill') {
      const full = this.entries.get(
        JSON.stringify([family, request.input.interval, request.input.screen, undefined]),
      );
      if (full?.state === 'ready' && sameJob(full.job, job)) {
        this.touch(full);
        this.counters.cacheHits++;
        return full;
      }
    }
    const coverage = old?.coverage,
      requested =
        job.bounds && storage
          ? ([
              Math.max(storage[0], job.bounds[0]),
              Math.max(storage[1], job.bounds[1]),
              Math.min(storage[2], job.bounds[2]),
              Math.min(storage[3], job.bounds[3]),
            ] as const)
          : storage;
    if (
      request.input.kind === 'fill' &&
      !request.input.screen &&
      requested &&
      coverage &&
      old?.state === 'ready' &&
      this.entries.get(old.id) === old &&
      coverage.interval === request.input.interval &&
      sameJob(old.job, job) &&
      coverage.bounds[0] <= requested[0] &&
      coverage.bounds[1] <= requested[1] &&
      coverage.bounds[2] >= requested[2] &&
      coverage.bounds[3] >= requested[3]
    ) {
      this.touch(old);
      this.counters.cacheHits++;
      this.counters.coverageHits++;
      return old;
    }
    const prefix = JSON.stringify([
      family,
      request.input.interval,
      request.input.screen,
      storageBounds,
    ]);
    let id = prefix,
      n = 0,
      existing = this.entries.get(id);
    while (existing && !sameJob(existing.job, job)) {
      id = prefix + ':' + ++n;
      existing = this.entries.get(id);
    }
    if (existing) {
      this.touch(existing);
      this.counters.cacheHits++;
      return existing;
    }
    const screen = request.input.screen;
    const screenDetail =
      request.input.wholeLayer &&
      request.input.kind === 'path' &&
      screen?.halfPixel &&
      !screen.perspective &&
      !screen.smallArcs &&
      !screen.cull
        ? {
            interval: request.input.interval,
            resolution: [
              Math.abs(screen.view[0]) * screen.pixelRatio,
              Math.abs(screen.view[1]) * screen.pixelRatio,
            ] as const,
            revision: screen.revision,
          }
        : undefined;
    const oldDetail = old?.screenDetail;
    if (
      screen &&
      screenDetail &&
      oldDetail &&
      old?.screenSpace &&
      old.screenView &&
      old.screenStats &&
      // Each nonempty retained arc contributes one more vertex than segment.
      old.screenStats.outputSegments <=
        2 * (old.screenStats.outputVertices - old.screenStats.outputSegments) &&
      old.state === 'ready' &&
      this.entries.get(old.id) === old &&
      old.owner.content === request.owner.content &&
      sameJob(old.job, job) &&
      oldDetail.interval === screenDetail.interval &&
      oldDetail.revision === screenDetail.revision &&
      // One octave avoids per-level rebuilding without retaining arbitrarily finer detail.
      screenDetail.resolution.every(
        (value, axis) =>
          value <= oldDetail.resolution[axis] && oldDetail.resolution[axis] <= value * 2,
      ) &&
      compactStrokeCompatible(new AffineTransform(...screen.view), old.screenView)
    ) {
      validateScreenPathRequest(screen);
      // Finer cells retain exact positions and endpoints; zoom-out only reprojects them.
      this.touch(old);
      this.counters.cacheHits++;
      return old;
    }
    const metadataBytes = job.members.byteLength + (job.components?.byteLength ?? 0);
    if (this.bytes + this.externalBytes + metadataBytes > this.limit * 2)
      throw new GeometryMetadataAdmissionError(metadataBytes);
    const entry: GeometryEntry = {
      id,
      family,
      partition: request.plan.key,
      fallback:
        old?.state === 'ready' && old.owner.content === request.owner.content ? old : undefined,
      owner: request.owner,
      ...(request.input.kind === 'fill' && !request.input.screen && storageBounds
        ? { coverage: { bounds: storageBounds, interval: request.input.interval } }
        : {}),
      job,
      state: 'queued',
      meshes: [],
      ranges: [],
      fillRanges: [],
      screenSpace: false,
      ...(screenDetail ? { screenDetail } : {}),
      bytes: metadataBytes,
      used: ++this.clock,
    };
    this.residencyVersion++;
    this.entries.set(id, entry);
    this.bytes += entry.bytes;
    return entry;
  }
  /** A membership change is not a presentation commit. Keep each stable spatial
   * chunk's previous image until its replacement can draw, never both versions.
   * Other chunks (including newly visible coverage) can progress independently. */
  drawable(request: GeometryRequest): GeometryEntry[] {
    const resident = (
      entry: GeometryEntry | undefined,
    ): entry is GeometryEntry & { state: 'ready' } =>
      !!entry && entry.state === 'ready' && this.entries.get(entry.id) === entry;
    if (!request.entries) return (request.fallback ?? []).filter(resident);
    if (request.input.wholeLayer) {
      if (request.entries.every(resident)) return request.entries;
      return (request.fallback ?? []).filter(resident);
    }
    const selected = request.entries.map((entry) => {
      if (resident(entry)) return entry;
      const latest = this.latest.get(entry.family);
      if (resident(latest) && latest.owner.content === request.owner.content) return latest;
      const fallback = entry.fallback;
      return resident(fallback) && fallback.owner.content === request.owner.content
        ? fallback
        : undefined;
    });
    // Ordered icon batches may revisit one spatial chunk. Mixing old and new
    // runs would duplicate members or change their order: commit the run together.
    if (request.input.ordered) {
      const fallback = request.fallback?.filter(resident);
      if (fallback?.length && selected.some((entry) => !entry)) return fallback;
      return selected.filter(resident);
    }
    const result: GeometryEntry[] = [];
    if (request.fallbackGroups) {
      for (const group of request.fallbackGroups) {
        const ready = group.targets.every((index) => !!selected[index]);
        const previous = group.previous.map((index) => request.fallback?.[index]).filter(resident);
        if (!ready && previous.length) result.push(...previous);
        else for (const index of group.targets) if (selected[index]) result.push(selected[index]!);
      }
      return result;
    }
    for (let i = 0; i < selected.length; i++) {
      const entry = selected[i];
      if (entry) result.push(entry);
      else {
        const fallback = request.fallbackChunks?.get(request.entries[i].job.chunk);
        if (fallback) for (const old of fallback) if (resident(old)) result.push(old);
      }
    }
    return result;
  }
  /** A presentation reference must still own a resident, fully uploaded entry. */
  isResident(entry: GeometryEntry): boolean {
    return entry.state === 'ready' && this.entries.get(entry.id) === entry;
  }
  pin(entries: Iterable<GeometryEntry>, planning = false): void {
    this.trimCandidates = null;
    this.trimCursor = 0;
    this.pinned = new Set(entries);
    this.presentationPlanning = planning;
  }
  complete(request: GeometryRequest): boolean {
    return (
      !!request.entries &&
      request.entries.every((e) => e.state === 'ready' && this.entries.get(e.id) === e)
    );
  }
  failed(request: GeometryRequest): boolean {
    return !!request.error || !!request.entries?.some((e) => e.state === 'error');
  }
  private current(): GeometryRequest[] {
    return [...this.requests.values()].filter(
      (r) => r.frame === this.frame && !r.controller.signal.aborted,
    );
  }
  private wanted(): Set<GeometryEntry> {
    return (this.wantedCache ??= new Set(this.current().flatMap((r) => r.entries ?? [])));
  }
  private cancelObsolete(): void {
    const active = this.active,
      current = this.current();
    if (!active || !current.every((r) => r.entries !== null || r.error)) return;
    const wanted = this.wanted();
    // A bounded batch may finish while any member remains useful, including a
    // same-content camera refinement. Explicit source retirement still aborts it.
    if (
      [...active.entries].every(
        (entry) =>
          !wanted.has(entry) &&
          !current.some(
            (r) =>
              r.owner.sourceId === entry.owner.sourceId &&
              r.owner.id === entry.owner.id &&
              r.owner.revision === entry.owner.revision &&
              r.owner.content === entry.owner.content &&
              r.entries?.some(
                (e) =>
                  e.family === entry.family ||
                  // A bounded boundary-chunk refinement can finish while the same
                  // source chunk is still selected. Do not terminate the Worker
                  // (and its tessellation cache) for each small camera movement.
                  (r.input.sourceSelection &&
                    r.plan.key === entry.partition &&
                    e.job.chunk === entry.job.chunk),
              ),
          ),
      )
    ) {
      active.controller.abort();
      this.counters.cancellations++;
    }
  }
  finish(): void {
    this.collecting = false;
    const current = this.current();
    if (
      this.settledVersion === this.residencyVersion &&
      !this.running &&
      !this.active &&
      this.settledExternal === this.externalBytes &&
      current.length === this.requests.size &&
      current.length === this.settledRequests.length &&
      current.every((r, i) => r === this.settledRequests[i])
    ) {
      this.counters.maintenanceSkips++;
      return;
    }
    this.settledRequests = [];
    this.settledVersion = -1;
    this.selectionChanged();
    for (const [id, request] of this.requests)
      if (request.frame !== this.frame) {
        request.controller.abort();
        this.requests.delete(id);
      }
    for (const request of current) {
      if (request.fallback && this.complete(request)) {
        request.fallback = undefined;
        request.fallbackChunks = undefined;
        request.fallbackGroups = undefined;
      }
    }
    this.trimPlans();
    this.trimSelections();
    const owners = new Set(
      [...this.requests.values()].map((r) => JSON.stringify([r.owner.sourceId, r.owner.id])),
    );
    for (const entry of this.entries.values())
      if (!owners.has(JSON.stringify([entry.owner.sourceId, entry.owner.id]))) this.drop(entry);
    this.worker.retainSources?.(new Set(this.current().map((r) => r.owner.sourceId)));
    this.cancelObsolete();
    const wanted = this.wanted();
    if (this.current().every((r) => r.entries !== null || r.error))
      for (const entry of this.entries.values())
        if (!wanted.has(entry) && (entry.state === 'queued' || entry.state === 'error'))
          this.drop(entry);
    this.trim(0);
    for (const entry of wanted)
      if (
        entry.state === 'error' &&
        entry.requiredBytes !== undefined &&
        this.bytes + this.externalBytes + entry.requiredBytes <= this.limit * 2
      ) {
        for (const r of this.current()) r.cursor = 0;
      }
    if (
      current.some(
        (request) =>
          request.requiredMetadataBytes !== undefined &&
          this.bytes + this.externalBytes + request.requiredMetadataBytes <= this.limit * 2,
      )
    )
      this.notify();
    for (const request of current) {
      if (
        request.error instanceof GeometryMetadataAdmissionError &&
        !request.error.reported &&
        !this.metadataCanProgress(request)
      ) {
        request.error.reportPending = true;
        this.notify();
      }
      for (const entry of request.entries ?? [])
        if (
          entry.state === 'error' &&
          this.entries.get(entry.id) === entry &&
          entry.error instanceof GeometryAdmissionError &&
          !entry.error.reported &&
          !this.admissionCanProgress(request, entry.requiredBytes, entry)
        ) {
          entry.error.reportPending = true;
          this.notify();
        }
    }
    if (!this.running && !this.active && current.every((r) => this.complete(r))) {
      this.settledRequests = current;
      this.settledVersion = this.residencyVersion;
      this.settledExternal = this.externalBytes;
    }
    if (!this.presentationPlanning) this.resumeAdmission?.();
    this.schedule();
  }
  /** Retain compact completed spatial plans across full/low-detail switches.
   * Exact arc identity remains in the key; different LOD bounds are not aliased.
   * Inactive plans are bounded and disappear with their source/revision.
   */
  private trimPlans(): void {
    const active = new Set([...this.requests.values()].map((r) => r.plan));
    const revisions = new Map<string, Set<number>>();
    for (const request of this.requests.values()) {
      let versions = revisions.get(request.owner.sourceId);
      if (!versions) revisions.set(request.owner.sourceId, (versions = new Set()));
      versions.add(request.owner.revision);
    }
    for (const [key, plan] of this.plans) {
      if (!active.has(plan) && (!plan.ready || !revisions.get(plan.sourceId)?.has(plan.revision))) {
        plan.controller.abort();
        this.plans.delete(key);
      }
    }
    let bytes = 0;
    for (const plan of this.plans.values()) bytes += plan.count * 4 + plan.boundsBytes;
    const limit = this.options.partitionCacheBytes ?? 128 * 1024 ** 2;
    if (bytes <= limit && this.plans.size <= 64) return;
    const inactive = [...this.plans.values()]
      .filter((p) => !active.has(p))
      .sort((a, b) => a.used - b.used);
    for (const plan of inactive) {
      if (bytes <= limit && this.plans.size <= 64) break;
      this.plans.delete(plan.key);
      plan.controller.abort();
      bytes -= plan.count * 4 + plan.boundsBytes;
    }
  }
  setInteracting(value: boolean): void {
    this.interacting = value;
    // One bounded task at a time continues during navigation. Repaint notifications
    // are coalesced more aggressively instead of withholding newly visible content.
    this.schedule();
  }
  private notify(): void {
    if (this.disposed || this.notification !== null) return;
    // Do not rescan every request's complete prefix after each tiny Worker task.
    // The timer is a UI progress deadline, not an instruction to redraw at 30fps.
    const delay = this.firstPresentation
      ? 0
      : Math.max(this.interacting ? 80 : 32, Math.min(250, this.presentationCost * 4));
    this.notification = setTimeout(() => this.flushNotification(), delay);
  }
  private flushNotification(): void {
    this.notification = null;
    if (this.disposed) return;
    for (const request of this.current())
      for (const entry of [undefined, ...(request.entries ?? [])]) {
        const error = entry ? entry.error : request.error;
        if (
          this.disposed ||
          request.controller.signal.aborted ||
          request.frame !== this.frame ||
          (entry && (entry.state !== 'error' || this.entries.get(entry.id) !== entry)) ||
          !(error instanceof GeometryAdmissionError) ||
          error.reported ||
          !error.reportPending
        )
          continue;
        error.reportPending = false;
        if (
          entry
            ? this.admissionCanProgress(request, entry.requiredBytes, entry)
            : this.metadataCanProgress(request)
        )
          continue;
        error.reported = true;
        this.counters.errors++;
        this.options.report(error);
      }
    if (!this.disposed) this.options.invalidate();
  }
  private queued(request: GeometryRequest): GeometryEntry | undefined {
    if (request.error || !request.entries) return undefined;
    while (request.cursor < request.entries.length) {
      const entry = request.entries[request.cursor];
      // A failed member must not starve independent chunks behind it.
      if (entry.state === 'error') {
        // Select retries against current capacity; waking every individually
        // fitting failure would make later ones rebuild after that room is spent.
        if (
          entry.requiredBytes !== undefined &&
          this.bytes + this.externalBytes + entry.requiredBytes <= this.limit * 2
        )
          return entry;
        request.cursor++;
        continue;
      }
      if (entry.state === 'queued') return entry;
      if (entry.state === 'building') return undefined;
      request.cursor++;
    }
    return undefined;
  }
  private schedule(): void {
    if (this.timer !== null || this.running || this.disposed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.pump();
    }, 0);
  }
  private nextQueued(): { request: GeometryRequest; entry: GeometryEntry } | undefined {
    const current = this.current();
    let available = current.filter((r) => !!this.queued(r));
    const sameOwner = (a: GeometryOwner, b: GeometryOwner) =>
      a.sourceId === b.sourceId && a.id === b.id;
    const capacities = new Map<string, number>();
    const capacity = (owner: GeometryOwner) => {
      const key = JSON.stringify([owner.sourceId, owner.id, owner.revision]);
      let bytes = capacities.get(key);
      if (bytes === undefined) {
        bytes = this.admissionCapacity(owner);
        capacities.set(key, bytes);
      }
      return bytes;
    };
    const pending = (r: GeometryRequest) => this.canPrepare(r, capacity(r.owner));
    if (this.handoffOwner) {
      const owner = this.handoffOwner;
      const group = current.filter((r) => sameOwner(r.owner, owner));
      // A continuous gesture can replace this owner's requests before its
      // handoff completes. Its old priority no longer describes the current
      // retirement opportunity; reselect before spending more headroom.
      const unchanged =
        group.length === this.handoffRequests.length &&
        group.every((r, i) => r === this.handoffRequests[i]);
      const progressiveWaiting =
        group.every((r) => r.input.wholeLayer || r.input.ordered) &&
        current.some(
          (r) =>
            !r.input.wholeLayer &&
            !r.input.ordered &&
            pending(r) &&
            [...this.pinned].some((e) => sameOwner(e.owner, r.owner) && !this.wanted().has(e)),
        );
      // acceptResult() waits for presentation only when the hard budget needs
      // old pins released; the soft budget must not serialize every owner on rAF.
      if (
        !unchanged ||
        progressiveWaiting ||
        !group.length ||
        !group.some(pending) ||
        group.every(
          (r) =>
            this.complete(r) ||
            (r.error && r.requiredMetadataBytes === undefined) ||
            r.entries?.some((e) => e.state === 'error' && e.requiredBytes === undefined),
        )
      ) {
        this.handoffOwner = undefined;
        this.handoffRequests = [];
      }
    }
    if (!this.handoffOwner && this.bytes + this.externalBytes > this.limit) {
      // Round-robin across many LOD replacements can fill the hard limit while
      // no polygon has both its fill and outline ready to retire the old meshes.
      // Finish one layer's paint requests together, starting with the most old
      // residency to release. Cold loading keeps the normal fair scheduling.
      const owners = new Map<
        string,
        { owner: GeometryOwner; entries: Set<GeometryEntry>; progressive: boolean }
      >();
      const wanted = this.wanted();
      for (const r of current) {
        const key = JSON.stringify([r.owner.sourceId, r.owner.id]);
        let group = owners.get(key);
        if (!group)
          owners.set(key, (group = { owner: r.owner, entries: new Set(), progressive: false }));
        if (!r.input.wholeLayer && !r.input.ordered && !this.complete(r)) group.progressive = true;
      }
      for (const e of this.pinned) {
        if (!wanted.has(e))
          owners.get(JSON.stringify([e.owner.sourceId, e.owner.id]))?.entries.add(e);
      }
      let largest = 0,
        progressive = false;
      for (const { owner, entries, progressive: canProgress } of owners.values()) {
        const bytes = [...entries].reduce((sum, e) => sum + e.bytes, 0);
        // Planning order is asynchronous too: a large retiring layer must not
        // lose priority just because a smaller, growing layer planned first.
        // With no dispatchable work, a cold known-cost owner can also need
        // foreign unpublished payload rollback before its first admission.
        const preparing = current.some((r) => sameOwner(r.owner, owner) && pending(r));
        if (
          preparing &&
          (bytes || !available.length) &&
          (!this.handoffOwner ||
            (canProgress && !progressive) ||
            (canProgress === progressive && bytes > largest))
        ) {
          largest = bytes;
          progressive = canProgress;
          this.handoffOwner = owner;
          this.handoffRequests = current.filter((r) => sameOwner(r.owner, owner));
        }
      }
    }
    if (this.handoffOwner) {
      if (!available.some((r) => sameOwner(r.owner, this.handoffOwner!))) {
        let retry: { request: GeometryRequest; bytes: number } | undefined;
        for (const request of this.handoffRequests) {
          if (
            request.requiredMetadataBytes !== undefined &&
            (!retry || request.requiredMetadataBytes < retry.bytes)
          )
            retry = { request, bytes: request.requiredMetadataBytes };
          for (const entry of request.entries ?? [])
            if (
              entry.state === 'error' &&
              entry.requiredBytes !== undefined &&
              (!retry || entry.requiredBytes < retry.bytes)
            )
              retry = { request, bytes: entry.requiredBytes };
        }
        if (retry) {
          this.trim(retry.bytes, retry.request);
          for (const request of this.handoffRequests) request.cursor = 0;
          available = current.filter((r) => !!this.queued(r));
          if (
            retry.request.requiredMetadataBytes !== undefined &&
            this.bytes + this.externalBytes + retry.bytes <= this.limit * 2
          )
            this.notify();
        }
      }
      available = available.filter((r) => sameOwner(r.owner, this.handoffOwner!));
    }
    const preview =
      this.counters.builds === 0
        ? available.find((r) => r.input.kind === 'path' || r.input.kind === 'point')
        : undefined;
    const request =
      preview ?? (available.length ? available[this.turn++ % available.length] : undefined);
    const entry = request && this.queued(request);
    return request && entry ? { request, entry } : undefined;
  }
  private preparationError(request: GeometryRequest, entry: GeometryEntry, error: unknown): void {
    if (this.disposed || this.entries.get(entry.id) !== entry) return;
    entry.state = 'error';
    entry.error = error instanceof Error ? error : new Error(String(error));
    request.cursor = 0;
    if (entry.error instanceof GeometryAdmissionError) {
      if (entry.requiredBytes !== undefined && entry.requiredBytes <= this.limit * 2) return;
      entry.error.reported = true;
    }
    this.counters.errors++;
    this.options.report(entry.error);
  }
  private async acceptResult(
    request: GeometryRequest,
    entry: GeometryEntry,
    result: GeometryResult,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    const buffers = new Set<ArrayBufferLike>();
    for (const g of result.geometries)
      for (const a of [
        g.vertices,
        g.indices,
        g.pathRanges?.bounds,
        g.pathRanges?.segments,
        g.pathRanges?.uncullable,
        g.fillRanges?.bounds,
        g.memberRanges,
      ])
        if (a) buffers.add(a.buffer);
    const resultBytes = [...buffers].reduce((n, b) => n + b.byteLength, 0);
    this.counters.peakResultBytes = Math.max(this.counters.peakResultBytes, resultBytes);
    const fillRanges = result.geometries.map((g) =>
      g.fillRanges ? new FillRangeIndex(g.fillRanges, g.count) : undefined,
    );
    const ranges = result.geometries.map((g) =>
      g.pathRanges ? new PathRangeIndex(g.pathRanges, g.count) : undefined,
    );
    const payload = result.geometries.reduce(
      (n, g) =>
        n +
        (this.gpu.meshByteSize?.(g) ??
          g.vertices.byteLength + Math.ceil((g.indices?.byteLength ?? 0) / 4) * 4),
      0,
    );
    const cost =
      payload +
      ranges.reduce((n, r) => n + (r?.bytes ?? 0), 0) +
      fillRanges.reduce((n, r) => n + (r?.bytes ?? 0), 0) +
      result.geometries.reduce((n, g) => n + (g.memberRanges?.byteLength ?? 0), 0);
    this.trim(cost, request);
    if (
      this.bytes + this.externalBytes + cost > this.limit * 2 &&
      [...this.pinned].some((e) => !this.wanted().has(e)) &&
      [...this.wanted()].some((e) => this.isResident(e) && !this.pinned.has(e))
    ) {
      // Keep this bounded Worker result until presentation retires the ready
      // replacements' predecessors, rather than discarding and rebuilding it.
      await new Promise<void>((resolve) => {
        const resume = () => {
          signal.removeEventListener('abort', resume);
          this.resumeAdmission = null;
          resolve();
        };
        this.resumeAdmission = resume;
        signal.addEventListener('abort', resume, { once: true });
        this.notify();
      });
      signal.throwIfAborted();
      this.trim(cost, request);
    }
    if (this.bytes + this.externalBytes + cost > this.limit * 2) {
      entry.requiredBytes = cost;
      throw new GeometryAdmissionError(
        'Visible GPU geometry exceeds the bounded working-set limit; zoom in or hide layers. Source data was not simplified or truncated.',
      );
    }
    // Reserve the whole result before yielding: immediate draws must not spend
    // this capacity. Partial buffers belong to the building entry for cancellation,
    // but drawable() exposes only fully committed entries (or their old fallback).
    entry.bytes += cost;
    this.bytes += cost;
    this.counters.pendingUploadBytes = payload;
    this.counters.peakBytes = Math.max(this.counters.peakBytes, this.bytes);
    const meshes: GpuMesh[] = [];
    entry.meshes = meshes;
    let slice = performance.now(),
      sliceBytes = 0;
    try {
      for (let i = 0; i < result.geometries.length; i++) {
        signal.throwIfAborted();
        if (this.disposed || this.entries.get(entry.id) !== entry)
          throw new DOMException('Geometry upload retired', 'AbortError');
        const started = performance.now(),
          geometry = result.geometries[i];
        const mesh = this.gpu.createMesh(
          geometry,
          JSON.stringify([request.owner.sourceId, request.owner.id]),
        );
        const elapsed = performance.now() - started;
        this.counters.uploadCpuMs += elapsed;
        this.counters.maxMeshUploadMs = Math.max(this.counters.maxMeshUploadMs, elapsed);
        if (!mesh && geometry.count)
          throw new Error('GPU became unavailable during geometry upload');
        if (mesh) {
          meshes.push(mesh);
          sliceBytes += mesh.bytes;
          this.counters.pendingUploadBytes = Math.max(
            0,
            this.counters.pendingUploadBytes - mesh.bytes,
          );
          this.counters.maxMeshBytes = Math.max(this.counters.maxMeshBytes, mesh.bytes);
        }
        if (
          i + 1 < result.geometries.length &&
          (sliceBytes >= 2 * 1024 ** 2 || performance.now() - slice >= 4)
        ) {
          this.counters.maxUploadSliceMs = Math.max(
            this.counters.maxUploadSliceMs,
            performance.now() - slice,
          );
          this.counters.uploadYields++;
          await geometryYield(signal);
          slice = performance.now();
          sliceBytes = 0;
        }
      }
      signal.throwIfAborted();
      this.counters.maxUploadSliceMs = Math.max(
        this.counters.maxUploadSliceMs,
        performance.now() - slice,
      );
    } catch (error) {
      if (this.entries.get(entry.id) === entry) {
        entry.meshes = [];
        entry.bytes -= cost;
        this.bytes -= cost;
        const failures: unknown[] = [error];
        for (const mesh of meshes) {
          try {
            this.gpu.destroyMesh(mesh);
          } catch (cleanupError) {
            failures.push(cleanupError);
          }
        }
        if (failures.length > 1)
          throw new AggregateError(failures, 'Geometry upload rollback failed');
      }
      throw error;
    } finally {
      this.counters.pendingUploadBytes = 0;
    }
    entry.ranges = ranges;
    entry.fillRanges = fillRanges;
    entry.memberRanges = result.geometries.map((g) => g.memberRanges);
    entry.screenSpace = result.screenSpace;
    entry.screenView = result.screenSpace ? request.input.screen?.view : undefined;
    entry.fallback = undefined;
    this.latest.set(entry.family, entry);
    entry.screenStats = result.screenStats;
    entry.state = 'ready';
    entry.preparationMs =
      Number.isFinite(result.preparationMs) && result.preparationMs! >= 0
        ? result.preparationMs
        : 0;
    this.counters.preparationMs += entry.preparationMs ?? 0;
    this.touch(entry);
    entry.requiredBytes = undefined;
    this.counters.builds++;
    this.counters.uploadCulledBytes += result.uploadCulledBytes ?? 0;
    this.counters.directFeatures += result.directFeatures ?? 0;
    this.counters.pathInputInstances += result.pathInputInstances ?? 0;
    this.counters.pathOutputInstances += result.pathOutputInstances ?? 0;
  }
  private async pump(): Promise<void> {
    if (this.running || this.disposed) return;
    this.running = true;
    let progressed = false;
    try {
      while (!this.disposed) {
        if (this.packedBytes && this.packedBytes > this.packedLimit) this.trimPacked();
        const first = this.nextQueued();
        if (!first) break;
        const controller = new AbortController();
        this.active = { entries: new Set(), controller };
        const tasks: { request: GeometryRequest; entry: GeometryEntry; packet: GeometryPacket }[] =
          [];
        let bytes = 0;
        let retryBytes = 0;
        const packingStarted = performance.now();
        // First feedback never waits for a batch. Large/unknown jobs stay isolated.
        const maxJobs =
          this.counters.builds === 0 || first.request.cursor === 0 || !this.worker.buildBatch
            ? 1
            : Math.max(
                1,
                Math.min(
                  GEOMETRY_BATCH_JOBS,
                  Number.isSafeInteger(this.batchJobs) ? this.batchJobs : 1,
                ),
              );
        try {
          for (let i = 0; i < maxJobs; i++) {
            // Keep a batch inside one parent/paint request. A slow upper
            // layer must not hold a lower layer's first result in the same reply.
            const entryAfterFirst = i === 0 ? undefined : this.queued(first.request);
            const next =
              i === 0
                ? first
                : entryAfterFirst
                  ? { request: first.request, entry: entryAfterFirst }
                  : undefined;
            if (!next) break;
            const { request, entry } = next;
            if (
              entry.requiredBytes !== undefined &&
              this.bytes + this.externalBytes + retryBytes + entry.requiredBytes > this.limit * 2
            )
              break;
            if (tasks.length) {
              const admission = performance.now();
              const bound = geometryJobByteBound(
                request.input,
                entry.job,
                GEOMETRY_BATCH_BYTES - bytes,
              );
              this.counters.batchAdmissionMs += performance.now() - admission;
              if (bound > GEOMETRY_BATCH_BYTES - bytes) break;
            }
            progressed = true;
            retryBytes += entry.requiredBytes ?? 0;
            entry.requiredBytes = undefined;
            entry.state = 'building';
            entry.error = undefined;
            this.active.entries.add(entry);
            this.residencyVersion++;
            request.cursor++;
            const packing = performance.now();
            let packet: GeometryPacket;
            try {
              packet = await this.pack(request, entry, controller.signal);
              if (packet.kind === 'fill') {
                packet.sourceId = request.owner.sourceId;
                packet.cacheKey = JSON.stringify([
                  this.identity(request.input.arcs),
                  this.identity(request.input.shapes),
                ]);
                packet.featureIds = entry.job.members.slice();
              }
            } catch (error) {
              if (controller.signal.aborted) throw error;
              this.preparationError(request, entry, error);
              continue;
            } finally {
              this.counters.packMs += performance.now() - packing;
            }
            controller.signal.throwIfAborted();
            bytes += geometryBatchBytes([packet]);
            tasks.push({ request, entry, packet });
            if (bytes >= GEOMETRY_BATCH_BYTES || performance.now() - packingStarted >= 4) break;
          }
          if (!tasks.length) continue;
          const packets = tasks.map((task) => task.packet);
          const results: GeometryBatchItem[] =
            tasks.length > 1
              ? await this.worker.buildBatch!(packets, controller.signal)
              : [{ result: await this.worker.build(packets[0], controller.signal) }];
          controller.signal.throwIfAborted();
          let uploadSlice = performance.now();
          for (let i = 0; i < tasks.length; i++) {
            const { request, entry } = tasks[i];
            if (this.disposed || this.entries.get(entry.id) !== entry) continue;
            try {
              const item = results[i];
              if (!item || item.error !== undefined || !item.result)
                throw new Error(item?.error ?? 'Invalid geometry batch result');
              await this.acceptResult(request, entry, item.result, controller.signal);
            } catch (error) {
              if (controller.signal.aborted) throw error;
              this.preparationError(request, entry, error);
            }
            if (i + 1 < tasks.length && performance.now() - uploadSlice >= 4) {
              await geometryYield(controller.signal);
              uploadSlice = performance.now();
            }
          }
        } catch (error) {
          for (const entry of this.active.entries) {
            if (entry.state !== 'building' || this.entries.get(entry.id) !== entry) continue;
            if (controller.signal.aborted) entry.state = 'queued';
            else {
              const request = tasks.find((task) => task.entry === entry)?.request;
              if (request) this.preparationError(request, entry, error);
            }
          }
          // Reserved cursors advance before dispatch; cancellation must rewind
          // them or a reselected useful member could remain queued forever.
          for (const request of this.current()) request.cursor = 0;
        } finally {
          this.residencyVersion++;
          this.active = null;
          this.trimCandidates = null;
          this.trimCursor = 0;
        }
        this.notify();
      }
    } finally {
      this.running = false;
      if (
        progressed &&
        !this.disposed &&
        this.current().every((r) => this.complete(r) || this.failed(r))
      ) {
        if (this.notification !== null) clearTimeout(this.notification);
        this.notification = setTimeout(() => this.flushNotification(), 0);
      }
    }
  }
  private provisionalAtomicEntries(owner: GeometryOwner): GeometryEntry[] {
    const key = (owner: GeometryOwner) =>
      JSON.stringify([owner.sourceId, owner.id, owner.revision]);
    const atomic = this.current().filter((r) => r.input.wholeLayer || r.input.ordered);
    const incomplete = new Set(atomic.filter((r) => !this.complete(r)).map((r) => key(r.owner)));
    const wanted = this.wanted();
    const retiring = new Set(
      [...this.pinned].filter((e) => !wanted.has(e)).map((e) => key(e.owner)),
    );
    return [
      ...new Set(
        atomic
          .filter(
            (r) =>
              key(r.owner) !== key(owner) &&
              incomplete.has(key(r.owner)) &&
              retiring.has(key(r.owner)),
          )
          .flatMap((r) => r.entries ?? []),
      ),
    ].filter((e) => this.isResident(e) && !this.pinned.has(e) && !this.active?.entries.has(e));
  }
  private trim(incoming: number, request?: GeometryRequest): void {
    if (this.bytes + this.externalBytes + incoming <= this.limit) return;
    if (!this.trimCandidates) {
      // Protect requests from the preceding frame until all current slots exist.
      const wanted = this.collecting
        ? (this.protectedCache ??= new Set(
            [...this.requests.values()]
              .filter((r) => !r.controller.signal.aborted)
              .flatMap((r) => r.entries ?? []),
          ))
        : this.wanted();
      // A ready fallback can be needed before it has reached the next GPU frame.
      // Protect it even when a pending upload triggers eviction between frames.
      const presenting = new Set(
        (this.collecting ? [...this.requests.values()] : this.current()).flatMap((r) =>
          // Atomic layers pin their committed frame; provisional buckets may be superseded unseen.
          r.input.wholeLayer ? [] : this.drawable(r),
        ),
      );
      this.trimCandidates = [...this.entries.values()]
        .filter(
          (e) =>
            !wanted.has(e) &&
            !presenting.has(e) &&
            !this.pinned.has(e) &&
            !this.active?.entries.has(e),
        )
        .sort((a, b) => (a.retentionPriority ?? 0) - (b.retentionPriority ?? 0) || a.used - b.used);
      this.trimCursor = 0;
    }
    while (
      this.trimCursor < this.trimCandidates.length &&
      this.bytes + this.externalBytes + incoming > this.limit
    ) {
      const entry = this.trimCandidates[this.trimCursor++];
      if (this.entries.get(entry.id) !== entry) continue;
      this.retentionAge = Math.max(this.retentionAge, entry.retentionPriority ?? 0);
      this.counters.evictedPreparationMs += entry.preparationMs ?? 0;
      if (entry.meshes.some((mesh) => mesh.kind === 'fill')) this.counters.evictedFillEntries++;
      if (entry.screenSpace) this.counters.evictedScreenEntries++;
      this.drop(entry);
      this.counters.evictions++;
    }
    if (request && this.bytes + this.externalBytes + incoming > this.limit * 2) {
      for (const entry of this.provisionalAtomicEntries(request.owner)) {
        if (this.bytes + this.externalBytes + incoming <= this.limit * 2) break;
        if (!this.isResident(entry) || this.pinned.has(entry) || this.active?.entries.has(entry))
          continue;
        // An incomplete atomic owner still draws its committed pins. Release
        // only its unpublished payload; keep metadata and identity for retry.
        const metadata = entry.job.members.byteLength + (entry.job.components?.byteLength ?? 0);
        this.counters.evictedPreparationMs += entry.preparationMs ?? 0;
        if (entry.screenSpace) this.counters.evictedScreenEntries++;
        this.drop(entry);
        entry.bytes = metadata;
        entry.state = 'queued';
        entry.screenSpace = false;
        entry.screenStats = undefined;
        entry.screenView = undefined;
        entry.requiredBytes = undefined;
        entry.error = undefined;
        this.bytes += metadata;
        this.entries.set(entry.id, entry);
        for (const r of this.current()) r.cursor = 0;
        this.counters.evictions++;
      }
    }
  }
  private drop(entry: GeometryEntry): void {
    this.residencyVersion++;
    if (this.active?.entries.has(entry)) this.active.controller.abort();
    const meshes = entry.meshes;
    entry.meshes = [];
    entry.ranges = [];
    entry.fillRanges = [];
    entry.memberRanges = undefined;
    entry.fallback = undefined;
    this.pinned.delete(entry);
    if (this.latest.get(entry.family) === entry) this.latest.delete(entry.family);
    this.bytes -= entry.bytes;
    entry.bytes = 0;
    this.entries.delete(entry.id);
    const errors: unknown[] = [];
    for (const mesh of meshes) {
      try {
        this.gpu.destroyMesh(mesh);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Geometry entry cleanup failed');
  }
  clear(scope: { sourceId?: string; layerId?: string } = {}): void {
    this.settledRequests = [];
    this.settledVersion = -1;
    this.selectionChanged();
    const matches = (owner: GeometryOwner) =>
      scope.layerId !== undefined
        ? owner.id === scope.layerId
        : scope.sourceId !== undefined
          ? owner.sourceId === scope.sourceId
          : true;
    if (this.handoffOwner && matches(this.handoffOwner)) {
      this.handoffOwner = undefined;
      this.handoffRequests = [];
    }
    for (const [id, r] of this.requests)
      if (matches(r.owner)) {
        r.controller.abort();
        this.requests.delete(id);
      }
    const errors: unknown[] = [];
    for (const e of this.entries.values())
      if (matches(e.owner)) {
        try {
          this.drop(e);
        } catch (error) {
          errors.push(error);
        }
      }
    const retained = new Set([...this.requests.values()].map((r) => r.plan));
    for (const [key, plan] of this.plans)
      if (!retained.has(plan)) {
        plan.controller.abort();
        this.plans.delete(key);
      }
    this.trimSelections();
    this.worker.retainSources?.(new Set([...this.requests.values()].map((r) => r.owner.sourceId)));
    if (errors.length) throw new AggregateError(errors, 'Geometry cache cleanup failed');
  }
  get closed(): Promise<void> {
    return this.worker.closed ?? Promise.resolve();
  }
  dispose(): void {
    if (this.disposed) {
      this.worker.dispose();
      return;
    }
    this.disposed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.notification !== null) clearTimeout(this.notification);
    this.notification = null;
    this.active?.controller.abort();
    try {
      this.worker.dispose();
    } finally {
      try {
        this.clear();
      } finally {
        for (const request of this.requests.values()) request.controller.abort();
        for (const plan of this.plans.values()) plan.controller.abort();
        this.requests.clear();
        this.plans.clear();
        for (const selection of this.selections.values()) selection.controller.abort();
        this.selections.clear();
        this.packed.clear();
        this.packedBytes = 0;
        this.entries.clear();
        this.bytes = 0;
        this.pinned.clear();
        this.latest.clear();
        this.selectionChanged();
      }
    }
  }
}
