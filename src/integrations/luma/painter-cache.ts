import type { GeometryBuffer } from './types';
import type { GpuMesh, GpuRenderer } from './gpu-renderer';
import { PathRangeIndex } from '../../engine/rendering/luma/path-ranges';

export interface GeometryKey {
  references: readonly unknown[];
  values: readonly (string | number | undefined)[];
  selections?: readonly (Uint32Array | Int32Array | undefined)[];
}
export interface PreparedGeometry {
  key: GeometryKey;
  build: () => GeometryBuffer;
}
export interface CachedGeometry {
  preparationKey?: GeometryKey;
  preparationBytes: number;
  key: GeometryKey;
  mesh: GpuMesh | null;
  ranges?: PathRangeIndex;
  bytes: number;
  used: number;
  layerId: string | null;
  sourceId: string | null;
}
function sameArray(a: ArrayLike<unknown> | undefined, b: ArrayLike<unknown> | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}
function sameIndices(
  a: Uint32Array | Int32Array | undefined,
  b: Uint32Array | Int32Array | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function snapshotKey(key: GeometryKey): GeometryKey {
  return {
    references: [...key.references],
    values: [...key.values],
    selections: key.selections?.map((a) => a?.slice()),
  };
}
function selectionBytes(key: GeometryKey | undefined): number {
  return key?.selections?.reduce((n, a) => n + (a?.byteLength ?? 0), 0) ?? 0;
}
function sameKey(a: GeometryKey, b: GeometryKey): boolean {
  return (
    sameArray(a.references, b.references) &&
    sameArray(a.values, b.values) &&
    (a.selections?.length ?? 0) === (b.selections?.length ?? 0) &&
    (a.selections ?? []).every((v, i) => sameIndices(v, b.selections?.[i]))
  );
}
/** Geometry is independent of paint. Keep the current selection for each ordered draw slot.
 * A new source/revision/selection replaces only that slot; invisible/deleted owners are released.
 */
export class PainterGeometryCache {
  private entries = new Map<string, CachedGeometry>();
  private context: { id: string; sourceId: string; revision: number } | null = null;
  private slots = new Map<string, number>();
  private frame = 0;
  private bytes = 0;
  constructor(
    private readonly gpu: GpuRenderer,
    private readonly limit = 256 * 1024 ** 2,
    private readonly retainFrame = false,
    private readonly reserveShared?: (incoming: number) => void,
  ) {}
  get byteSize(): number {
    return this.bytes;
  }
  get stats() {
    return { entries: this.entries.size, bytes: this.bytes };
  }
  begin(): void {
    this.frame++;
    this.slots.clear();
    this.context = null;
  }
  contextFor(context: typeof this.context): void {
    this.context = context;
  }
  get(key: GeometryKey, build: () => GeometryBuffer): CachedGeometry {
    return this.resolve(undefined, () => ({ key, build }));
  }
  /** Memoize selection preparation before filtering/flattening arcs. A changed
   * view can still reuse the mesh when the resulting ordered selection is equal.
   * Both keys share the mesh's owner, revision, lifecycle and byte budget.
   */
  getPrepared(key: GeometryKey, prepare: () => PreparedGeometry): CachedGeometry {
    return this.resolve(key, prepare);
  }
  private resolve(
    preparation: GeometryKey | undefined,
    prepare: () => PreparedGeometry,
  ): CachedGeometry {
    const owner = JSON.stringify([this.context?.sourceId ?? null, this.context?.id ?? null]);
    const slot = this.slots.get(owner) ?? 0;
    this.slots.set(owner, slot + 1);
    const id = `${owner}:${slot}`;
    const versioned = (key: GeometryKey): GeometryKey => ({
      ...key,
      values: [...key.values, this.context?.revision ?? this.frame],
    });
    const previous = this.entries.get(id);
    const preparationKey = preparation && versioned(preparation);
    if (
      previous?.preparationKey &&
      preparationKey &&
      sameKey(previous.preparationKey, preparationKey)
    ) {
      previous.used = this.frame;
      return previous;
    }
    const { key, build } = prepare();
    const fullKey = versioned(key);
    // Snapshots detect in-place selector mutations, not only replacement objects.
    const preparedSnapshot = preparationKey && snapshotKey(preparationKey);
    const preparationBytes = selectionBytes(preparedSnapshot);
    if (previous && sameKey(previous.key, fullKey)) {
      this.reserve(Math.max(0, preparationBytes - previous.preparationBytes));
      this.bytes += preparationBytes - previous.preparationBytes;
      previous.bytes += preparationBytes - previous.preparationBytes;
      previous.preparationBytes = preparationBytes;
      previous.preparationKey = preparedSnapshot;
      previous.used = this.frame;
      return previous;
    }
    const geometry = build();
    this.reserve(
      geometry.vertices.byteLength +
        (geometry.indices?.byteLength ?? 0) +
        selectionBytes(fullKey) +
        preparationBytes +
        (geometry.pathRanges?.bounds.byteLength ?? 0) +
        (geometry.pathRanges?.segments.byteLength ?? 0),
    );
    let mesh: GpuMesh | null = null;
    try {
      mesh = this.gpu.createMesh(geometry);
      const ranges = geometry.pathRanges
        ? new PathRangeIndex(geometry.pathRanges, geometry.count)
        : undefined;
      const snapshot = snapshotKey(fullKey);
      const bytes =
        (mesh?.bytes ?? 0) +
        selectionBytes(snapshot) +
        preparationBytes +
        (geometry.pathRanges?.bounds.byteLength ?? 0) +
        (geometry.pathRanges?.segments.byteLength ?? 0);
      const result: CachedGeometry = {
        key: snapshot,
        preparationKey: preparedSnapshot,
        preparationBytes,
        mesh,
        ranges,
        bytes,
        used: this.frame,
        layerId: this.context?.id ?? null,
        sourceId: this.context?.sourceId ?? null,
      };
      if (previous) this.drop(id, previous);
      this.entries.set(id, result);
      this.bytes += bytes;
      return result;
    } catch (error) {
      if (mesh) this.gpu.destroyMesh(mesh);
      throw error;
    }
  }
  private reserve(incoming: number): void {
    if (!this.retainFrame) return;
    // Keep the displayed/replay frame alive. Refuse an over-budget replacement
    // before GPU allocation instead of deleting visible meshes behind its commands.
    if (this.bytes + incoming > this.limit * 2)
      throw new RangeError('Immediate geometry exceeds the bounded visible working set.');
    this.reserveShared?.(incoming);
  }
  finish(): void {
    for (const [id, entry] of this.entries)
      if (entry.used !== this.frame || (entry.layerId === null && !this.retainFrame))
        this.drop(id, entry);
    // Evict only after submission; never destroy a buffer still referenced by a WebGPU pass.
    for (const [id, entry] of this.entries) {
      if (this.bytes <= this.limit) break;
      if (this.retainFrame && entry.used === this.frame) continue;
      this.drop(id, entry);
    }
  }
  clear(scope: { sourceId?: string; layerId?: string } = {}): void {
    const errors: unknown[] = [];
    for (const [id, entry] of this.entries)
      if (
        scope.layerId !== undefined
          ? entry.layerId === scope.layerId
          : scope.sourceId !== undefined
            ? entry.sourceId === scope.sourceId
            : true
      ) {
        try {
          this.drop(id, entry);
        } catch (error) {
          errors.push(error);
        }
      }
    if (errors.length) throw new AggregateError(errors, 'Immediate geometry cleanup failed');
  }
  private drop(id: string, entry: CachedGeometry): void {
    this.entries.delete(id);
    this.bytes -= entry.bytes;
    if (entry.mesh) this.gpu.destroyMesh(entry.mesh);
  }
}
