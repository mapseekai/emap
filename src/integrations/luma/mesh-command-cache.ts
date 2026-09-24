import type { RenderBundle } from '@luma.gl/core';
import type { GpuMesh } from './gpu-renderer';
import type { PathDrawRange, FillDrawRange } from './types';
import type { PipelineKind } from './portable-shaders';
export interface MeshDraw {
  mesh: GpuMesh;
  ranges?: readonly PathDrawRange[] | null;
  indexRanges?: readonly FillDrawRange[] | null;
}
export interface CompiledMeshDraw extends MeshDraw {
  original?: GpuMesh;
}
export interface MeshCommandPlan {
  draws: MeshDraw[];
  states: unknown[][];
  compiled: CompiledMeshDraw[];
  key: string;
  orderOpaque: boolean;
  groupFills: boolean;
  repeats: number;
  weight: number;
  frame: number;
  native?: { bundle: RenderBundle; kinds: PipelineKind[]; counts: Record<string, number> };
  dispose?: () => void;
}
function meshState(m: GpuMesh): unknown[] {
  return [
    m.kind,
    m.buffer,
    m.indices,
    m.count,
    m.indexBytes,
    m.firstIndex,
    m.firstInstance,
    m.logicalCount,
    m.compactStroke,
    m.pageSlice?.page,
    m.pageSlice?.released,
    m.compactStrokeXY,
  ];
}
function sameState(s: readonly unknown[], m: GpuMesh): boolean {
  return (
    s[0] === m.kind &&
    s[1] === m.buffer &&
    s[2] === m.indices &&
    s[3] === m.count &&
    s[4] === m.indexBytes &&
    s[5] === m.firstIndex &&
    s[6] === m.firstInstance &&
    s[7] === m.logicalCount &&
    s[8] === m.compactStroke &&
    s[9] === m.pageSlice?.page &&
    s[10] === m.pageSlice?.released &&
    s[11] === m.compactStrokeXY
  );
}
function sameDraw(a: MeshDraw, b: MeshDraw): boolean {
  if (a.mesh !== b.mesh) return false;
  const x = a.ranges,
    y = b.ranges,
    u = a.indexRanges,
    v = b.indexRanges;
  return (
    ((!x && !y) ||
      (!!x &&
        !!y &&
        x.length === y.length &&
        x.every((r, i) => r.firstInstance === y[i].firstInstance && r.count === y[i].count))) &&
    ((!u && !v) ||
      (!!u &&
        !!v &&
        u.length === v.length &&
        u.every((r, i) => r.firstIndex === v[i].firstIndex && r.indexCount === v[i].indexCount)))
  );
}
/** Validate in each original slice's coordinate space before enlarging a span. */
function validateRanges(draw: MeshDraw): void {
  const { mesh, ranges, indexRanges } = draw;
  if (ranges && mesh.kind !== 'path') throw new Error('Instance ranges require a path mesh.');
  if (indexRanges && mesh.kind !== 'fill') throw new Error('Triangle ranges require a fill mesh.');
  for (const r of ranges ?? [])
    if (
      !Number.isSafeInteger(r.firstInstance) ||
      !Number.isSafeInteger(r.count) ||
      r.firstInstance < 0 ||
      r.count < 0 ||
      r.firstInstance + r.count > mesh.count
    )
      throw new Error('Invalid path instance range');
  for (const r of indexRanges ?? [])
    if (
      !Number.isSafeInteger(r.firstIndex) ||
      !Number.isSafeInteger(r.indexCount) ||
      r.firstIndex < 0 ||
      r.indexCount < 0 ||
      r.firstIndex % 3 ||
      r.indexCount % 3 ||
      r.firstIndex + r.indexCount > mesh.count
    )
      throw new Error('Invalid fill index range');
}
function emptyDraw(draw: MeshDraw): boolean {
  return draw.ranges?.length === 0 || draw.indexRanges?.length === 0;
}
/** Keep all selected intervals, coalesce only exact adjacency, never bridge a
 * retired region or an unselected triangle. Fill alignment padding stays omitted. */
function spanRanges(
  draws: readonly MeshDraw[],
  first: number,
  end: number,
): Pick<MeshDraw, 'ranges' | 'indexRanges'> {
  const mesh = draws[first].mesh,
    fill = mesh.kind === 'fill';
  const base = fill ? (mesh.firstIndex ?? 0) : (mesh.firstInstance ?? 0);
  const ranges: { firstInstance: number; count: number }[] = [];
  for (let i = first; i < end; i++) {
    const d = draws[i],
      offset = (fill ? (d.mesh.firstIndex ?? 0) : (d.mesh.firstInstance ?? 0)) - base;
    const selected = fill
      ? d.indexRanges?.map((r) => ({ firstInstance: r.firstIndex, count: r.indexCount }))
      : d.ranges;
    for (const r of selected ?? [{ firstInstance: 0, count: d.mesh.count }]) {
      if (!r.count) continue;
      const start = offset + r.firstInstance,
        last = ranges.at(-1);
      if (last && last.firstInstance + last.count === start) last.count += r.count;
      else ranges.push({ firstInstance: start, count: r.count });
    }
  }
  return fill
    ? { indexRanges: ranges.map((r) => ({ firstIndex: r.firstInstance, indexCount: r.count })) }
    : { ranges };
}
/** Compile adjacent physical slices without moving anything across a range or paint boundary. */
function compile(
  draws: readonly MeshDraw[],
  orderOpaque: boolean,
  groupFills: boolean,
  mergeSelected = true,
): CompiledMeshDraw[] {
  for (const draw of draws) validateRanges(draw);
  if (orderOpaque || groupFills) {
    // Group only a commutative single paint scope. Opaque strokes form a coverage
    // union; constant-color fills preserve the count of identical source-over
    // operations at each sample, including alpha. Never cross paints/layers.
    const buffers = new Map<GpuMesh['buffer'], MeshDraw[]>();
    for (const d of draws) {
      let group = buffers.get(d.mesh.buffer);
      if (!group) buffers.set(d.mesh.buffer, (group = []));
      group.push(d);
    }
    draws = [...buffers.values()].flatMap((group) =>
      group.sort((a, b) =>
        groupFills
          ? (a.mesh.firstIndex ?? 0) - (b.mesh.firstIndex ?? 0)
          : (a.mesh.firstInstance ?? 0) - (b.mesh.firstInstance ?? 0),
      ),
    );
  }
  const result: CompiledMeshDraw[] = [];
  for (let i = 0; i < draws.length; ) {
    const a = draws[i],
      first = a.mesh;
    let last = first,
      j = i + 1,
      logical = first.count,
      hasRanges = !!a.ranges || !!a.indexRanges;
    while (!emptyDraw(a) && (mergeSelected || !hasRanges) && first.pageSlice && j < draws.length) {
      const b = draws[j],
        next = b.mesh;
      if (
        emptyDraw(b) ||
        (!mergeSelected && (!!b.ranges || !!b.indexRanges)) ||
        next.pageSlice?.page !== first.pageSlice.page ||
        next.kind !== first.kind ||
        next.compactStroke !== first.compactStroke ||
        next.compactStrokeXY !== first.compactStrokeXY
      )
        break;
      const adjacent =
        first.kind === 'fill'
          ? next.firstIndex === (last.firstIndex ?? 0) + last.pageSlice!.storageCount
          : next.firstInstance === (last.firstInstance ?? 0) + last.count;
      if (!adjacent) break;
      hasRanges ||= !!b.ranges || !!b.indexRanges;
      logical += next.count;
      last = next;
      j++;
    }
    if (j === i + 1) result.push(a);
    else {
      const span: GpuMesh = Object.create(first);
      span.count =
        first.kind === 'fill'
          ? last.firstIndex! + last.count - first.firstIndex!
          : last.firstInstance! + last.count - first.firstInstance!;
      span.logicalCount = logical;
      const selected = hasRanges ? spanRanges(draws, i, j) : {};
      if (hasRanges) {
        let priorDraws = 0,
          wholeRun = false;
        for (let k = i; k < j; k++) {
          const d = draws[k],
            ranges = d.ranges ?? d.indexRanges;
          if (ranges) {
            priorDraws += ranges.length;
            wholeRun = false;
          } else {
            if (!wholeRun) priorDraws++;
            wholeRun = true;
          }
        }
        // Omitting padding between partial fills can split an existing cheap
        // full-span draw. Never trade fewer command objects for more draw calls.
        if ((selected.ranges?.length ?? selected.indexRanges?.length ?? 0) > priorDraws) {
          result.push(...compile(draws.slice(i, j), false, false, false));
          i = j;
          continue;
        }
      }
      result.push({ mesh: span, original: first, ...selected });
    }
    i = j;
  }
  return result;
}
/** Frame-local ordered scopes, bounded independently of GPU geometry storage.
 * Numeric range snapshots detect in-place edits; references are dropped on resource retirement. */
export class MeshCommandCache {
  private entries = new Map<number, MeshCommandPlan>();
  private dependencies = new Map<GpuMesh, Set<number>>();
  private retiredPlans = 0;
  private slot = 0;
  private frame = 0;
  private commands = 0;
  private hits = 0;
  private builds = 0;
  constructor(
    private readonly maxEntries = 128,
    private readonly maxCommands = 32768,
  ) {}
  begin(): void {
    this.slot = 0;
    this.frame++;
  }
  get stats() {
    return {
      entries: this.entries.size,
      dependencies: this.dependencies.size,
      retiredPlans: this.retiredPlans,
      commands: this.commands,
      hits: this.hits,
      builds: this.builds,
    };
  }
  select(
    key: string,
    draws: readonly MeshDraw[],
    orderOpaque = false,
    groupFills = false,
  ): MeshCommandPlan {
    const slot = this.slot++,
      old = this.entries.get(slot);
    if (
      old?.key === key &&
      old.orderOpaque === orderOpaque &&
      old.groupFills === groupFills &&
      old.draws.length === draws.length &&
      draws.every((d, i) => sameDraw(old.draws[i], d) && sameState(old.states[i], d.mesh))
    ) {
      old.frame = this.frame;
      old.repeats++;
      this.hits++;
      return old;
    }
    if (old) this.drop(slot);
    const snapshots = draws.map((d) => ({
      mesh: d.mesh,
      ranges: d.ranges?.map((r) => ({ ...r })) ?? d.ranges,
      indexRanges: d.indexRanges?.map((r) => ({ ...r })) ?? d.indexRanges,
    }));
    const plan: MeshCommandPlan = {
      key,
      draws: snapshots,
      states: draws.map((d) => meshState(d.mesh)),
      compiled: compile(snapshots, orderOpaque, groupFills),
      orderOpaque,
      groupFills,
      repeats: 0,
      weight: draws.reduce(
        (n, d) => n + Math.max(1, d.ranges?.length ?? 0, d.indexRanges?.length ?? 0),
        0,
      ),
      frame: this.frame,
    };
    this.builds++;
    if (plan.weight <= this.maxCommands && this.maxEntries > 0) {
      while (
        this.entries.size &&
        (this.entries.size >= this.maxEntries || this.commands + plan.weight > this.maxCommands)
      )
        this.drop(this.entries.keys().next().value!);
      this.entries.set(slot, plan);
      for (const { mesh } of snapshots) {
        let slots = this.dependencies.get(mesh);
        if (!slots) this.dependencies.set(mesh, (slots = new Set()));
        slots.add(slot);
      }
      this.commands += plan.weight;
    }
    return plan;
  }
  end(): void {
    for (const [slot, plan] of this.entries) if (plan.frame !== this.frame) this.drop(slot);
  }
  /** Retire only plans that name this exact slice. Other slices on the same
   * physical page remain valid until their own ownership or draw ranges change. */
  retire(mesh: GpuMesh): void {
    const slots = this.dependencies.get(mesh);
    if (!slots) return;
    for (const slot of [...slots]) {
      this.retiredPlans++;
      this.drop(slot);
    }
  }
  clear(): void {
    for (const slot of this.entries.keys()) this.drop(slot);
  }
  private drop(slot: number): void {
    const plan = this.entries.get(slot);
    if (!plan) return;
    for (const { mesh } of plan.draws) {
      const slots = this.dependencies.get(mesh);
      slots?.delete(slot);
      if (!slots?.size) this.dependencies.delete(mesh);
    }
    plan.dispose?.();
    plan.native = undefined;
    plan.dispose = undefined;
    this.commands -= plan.weight;
    this.entries.delete(slot);
  }
}
