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
  fillRanges: (FillRangeIndex | undefined)[];
  memberRanges?: (Uint32Array | undefined)[];
  fallback?: GeometryEntry;
  bytes: number;
  used: number;
  screenStats?: GeometryResult['screenStats'];
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
  frame: number;
  /** Monotone cursor through this immutable selection; no repeated prefix scans. */
  cursor: number;
}
type GeometryTransport = Pick<GeometryWorker, 'build' | 'dispose' | 'stats'> &
  Partial<Pick<GeometryWorker, 'triangulation' | 'retainSources' | 'buildBatch'>>;
interface Options {
  invalidate(): void;
  report(error: Error): void;
  workerUrl: URL;
  cacheBytes?: number;
  /** Includes active plans; only inactive completed plans may be evicted. */
  partitionCacheBytes?: number;
  externalBytes?: () => number;
  /** Internal test/host transport seam, not a second source dataset. */
  transport?: GeometryTransport;
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
  private pinned = new Set<GeometryEntry>();
  private latest = new Map<string, GeometryEntry>();
  private turn = 0;
  private disposed = false;
  /** Diagnostic seam; changing batching never changes logical chunks or GPU precision. */
  batchJobs = GEOMETRY_BATCH_JOBS;
  private active: { entries: Set<GeometryEntry>; controller: AbortController } | null = null;
  private clock = 0;
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
    batchAdmissionMs: 0,
    uploadCulledBytes: 0,
    directFeatures: 0,
    pathInputInstances: 0,
    pathOutputInstances: 0,
  };
  constructor(
    private readonly gpu: GpuRenderer,
    private readonly options: Options,
  ) {
    this.worker = options.transport ?? new GeometryWorker(options.workerUrl);
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
    if (
      previous?.key === key &&
      sameArray(previous.input.ids, input.ids) &&
      sameArray(previous.input.components, input.components)
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
      for (const entry of previous.entries ?? []) entry.used = ++this.clock;
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
      request.entries = jobs.map((job) => this.entry(job, request));
      if (request.fallback && !snapshot.ordered && !request.fallbackGroups) {
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
      this.counters.errors++;
      this.options.report(request.error);
      this.notify();
    });
    return request;
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
      !partition.bounds ||
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
        for (let i = 0; i < partition.chunks; i++) {
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
    // Interior chunks already satisfy the exact viewport predicate. Only boundary
    // chunks need the cheap arc test; keep offscreen path storage bounded without
    // rescanning every source shape/ring on each navigation refresh.
    if (input.kind !== 'path' || !visibility || visibility.length !== 5) return visible;
    const bbox = visibility.slice(1);
    const result: GeometryJob[] = [];
    let slice = performance.now();
    for (const job of visible) {
      if (job.bounds && containsBounds(bbox, job.bounds)) {
        result.push(job);
        continue;
      }
      const members: number[] = [];
      for (let i = 0; i < job.members.length; i++) {
        const signed = job.members[i],
          id = signed < 0 ? ~signed : signed;
        if (input.filter!(id)) members.push(signed);
        if ((i & 2047) === 0 && performance.now() - slice >= 4) {
          await geometryYield(request.controller.signal);
          slice = performance.now();
        }
      }
      if (members.length === job.members.length) result.push(job);
      else if (members.length) result.push({ ...job, members: Int32Array.from(members) });
    }
    return result;
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
        full.used = ++this.clock;
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
      old.used = ++this.clock;
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
      existing.used = ++this.clock;
      this.counters.cacheHits++;
      return existing;
    }
    const metadataBytes = job.members.byteLength + (job.components?.byteLength ?? 0);
    if (this.bytes + this.externalBytes + metadataBytes > this.limit * 2)
      throw new RangeError('Geometry selection cache exceeds its bounded working set.');
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
  pin(entries: Iterable<GeometryEntry>): void {
    this.trimCandidates = null;
    this.trimCursor = 0;
    this.pinned = new Set(entries);
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
        entry.state = 'queued';
        entry.error = undefined;
        for (const r of this.current()) r.cursor = 0;
      }
    if (!this.running && !this.active && current.every((r) => this.complete(r))) {
      this.settledRequests = current;
      this.settledVersion = this.residencyVersion;
      this.settledExternal = this.externalBytes;
    }
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
    this.notification = setTimeout(() => {
      this.notification = null;
      if (!this.disposed) this.options.invalidate();
    }, delay);
  }
  private queued(request: GeometryRequest): GeometryEntry | undefined {
    if (request.error || !request.entries) return undefined;
    while (request.cursor < request.entries.length) {
      const entry = request.entries[request.cursor];
      // A failed member must not starve independent chunks behind it.
      if (entry.state === 'error') {
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
    const available = this.current().filter((r) => !!this.queued(r));
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
    this.trim(cost);
    if (this.bytes + this.externalBytes + cost > this.limit * 2) {
      entry.requiredBytes = cost;
      throw new RangeError(
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
        const first = this.nextQueued();
        if (!first) break;
        const controller = new AbortController();
        this.active = { entries: new Set(), controller };
        const tasks: { request: GeometryRequest; entry: GeometryEntry; packet: GeometryPacket }[] =
          [];
        let bytes = 0;
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
            entry.state = 'building';
            this.active.entries.add(entry);
            this.residencyVersion++;
            request.cursor++;
            const packing = performance.now();
            let packet: GeometryPacket;
            try {
              packet = await packGeometryJob(
                request.input.kind === 'fill'
                  ? { ...request.input, storageBounds: entry.coverage?.bounds }
                  : request.input,
                entry.job,
                controller.signal,
              );
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
        this.notification = setTimeout(() => {
          this.notification = null;
          if (!this.disposed) this.options.invalidate();
        }, 0);
      }
    }
  }
  private trim(incoming: number): void {
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
          this.drawable(r),
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
        .sort((a, b) => a.used - b.used);
      this.trimCursor = 0;
    }
    while (
      this.trimCursor < this.trimCandidates.length &&
      this.bytes + this.externalBytes + incoming > this.limit
    ) {
      const entry = this.trimCandidates[this.trimCursor++];
      if (this.entries.get(entry.id) !== entry) continue;
      this.drop(entry);
      this.counters.evictions++;
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
  dispose(): void {
    if (this.disposed) return;
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
        this.entries.clear();
        this.bytes = 0;
        this.pinned.clear();
        this.latest.clear();
        this.selectionChanged();
      }
    }
  }
}
