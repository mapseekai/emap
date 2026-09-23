import type { GeometryBuffer } from './types';
import type { GpuMesh, GpuRenderer } from './gpu-renderer';
import { PathRangeIndex } from '../../engine/rendering/luma/path-ranges';

export interface GeometryKey {
  references: readonly unknown[];
  values: readonly (string | number | undefined)[];
  selections?: readonly (Uint32Array | Int32Array | undefined)[];
}
export interface CachedGeometry {
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
function sameKey(a: GeometryKey, b: GeometryKey): boolean {
  return (
    sameArray(a.references, b.references) &&
    sameArray(a.values, b.values) &&
    (a.selections?.length ?? 0) === (b.selections?.length ?? 0) &&
    (a.selections ?? []).every((v, i) => sameArray(v, b.selections?.[i]))
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
  ) {}
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
    const owner = JSON.stringify([this.context?.sourceId ?? null, this.context?.id ?? null]);
    const slot = this.slots.get(owner) ?? 0;
    this.slots.set(owner, slot + 1);
    const id = `${owner}:${slot}`;
    const fullKey: GeometryKey = {
      ...key,
      values: [...key.values, this.context?.revision ?? this.frame],
    };
    const previous = this.entries.get(id);
    if (previous && sameKey(previous.key, fullKey)) {
      previous.used = this.frame;
      return previous;
    }
    const geometry = build();
    let mesh: GpuMesh | null = null;
    try {
      mesh = this.gpu.createMesh(geometry);
      const ranges = geometry.pathRanges
        ? new PathRangeIndex(geometry.pathRanges, geometry.count)
        : undefined;
      const selections = fullKey.selections?.map((a) => a?.slice());
      const bytes =
        (mesh?.bytes ?? 0) +
        (selections?.reduce((n, a) => n + (a?.byteLength ?? 0), 0) ?? 0) +
        (geometry.pathRanges?.bounds.byteLength ?? 0) +
        (geometry.pathRanges?.segments.byteLength ?? 0);
      const result: CachedGeometry = {
        key: { references: [...fullKey.references], values: [...fullKey.values], selections },
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
  finish(): void {
    for (const [id, entry] of this.entries)
      if (entry.used !== this.frame || entry.layerId === null) this.drop(id, entry);
    // Evict only after submission; never destroy a buffer still referenced by a WebGPU pass.
    for (const [id, entry] of this.entries) {
      if (this.bytes <= this.limit) break;
      this.drop(id, entry);
    }
  }
  clear(scope: { sourceId?: string; layerId?: string } = {}): void {
    for (const [id, entry] of this.entries)
      if (
        scope.layerId !== undefined
          ? entry.layerId === scope.layerId
          : scope.sourceId !== undefined
            ? entry.sourceId === scope.sourceId
            : true
      )
        this.drop(id, entry);
  }
  private drop(id: string, entry: CachedGeometry): void {
    if (entry.mesh) this.gpu.destroyMesh(entry.mesh);
    this.entries.delete(id);
    this.bytes -= entry.bytes;
  }
}
