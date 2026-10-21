import {
  polygonPresentationGroups,
  polygonColdGroups,
  type PolygonColdGroup,
  type PolygonGeometryPart,
} from '../../engine/rendering/luma/polygon-groups';
import type { GeometryHandoffGroup } from '../../engine/rendering/luma/geometry-handoff';
import type { Shapes } from '../../engine/rendering/luma/geometry';
import type { GeometryEntry, GeometryRequest } from './geometry-cache';

export interface PolygonChannel {
  /** Stable paint bucket identity and ordering, including currently empty buckets. */
  key: string;
  order: number;
  request: GeometryRequest;
  draw(
    entries: readonly GeometryEntry[],
    members?: ReadonlyMap<GeometryEntry, ReadonlySet<number> | undefined>,
  ): void;
}
interface Part {
  channel: PolygonChannel;
  entry: GeometryEntry;
  members?: ReadonlySet<number>;
}
interface Plan {
  current: Part[];
  previous: Part[];
  groups: GeometryHandoffGroup[];
  cold?: PolygonColdGroup[];
}
interface Options {
  /** Whole stroke layers commit all paint buckets together. */
  atomic?: boolean;
  ready(entry: GeometryEntry): boolean;
  complete(request: GeometryRequest): boolean;
  invalidate(): void;
  report(error: Error): void;
}

/** A semantic polygon command owns fill plus optional outline presentation.
 * Geometry remains in the existing shared cache/Worker; this object owns only
 * references and a cancellable, bounded topology dependency plan. */
export class PolygonPresentation {
  private channels: PolygonChannel[] = [];
  private entries: (GeometryEntry[] | null)[] = [];
  private presented: Part[][] = [];
  private previous: Part[][] = [];
  private plan: Plan | undefined;
  private stableFills: GeometryEntry[] = [];
  private currentParts: Part[] | undefined;
  private controller: AbortController | undefined;
  private failed = false;
  private disposed = false;
  complete = false;

  get planning(): boolean {
    return (
      !this.options.atomic && !!this.controller && !this.plan && !this.failed && !this.disposed
    );
  }

  constructor(
    private readonly shapes: Shapes,
    private readonly options: Options,
  ) {}

  update(channels: PolygonChannel[]): void {
    const changed =
      channels.length !== this.channels.length ||
      channels.some(
        (c, i) => c.key !== this.channels[i].key || c.request !== this.channels[i].request,
      );
    this.channels = channels;
    if (changed) this.reset();
  }
  private reset(): void {
    this.controller?.abort();
    this.controller = undefined;
    this.plan = undefined;
    this.currentParts = undefined;
    this.failed = false;
    this.complete = false;
    this.previous = this.presented;
    this.entries = this.channels.map((c) => c.request.entries);
  }
  private parts(): Part[] {
    return (this.currentParts ??= this.channels.flatMap((channel) =>
      (channel.request.entries ?? []).map((entry) => ({ channel, entry })),
    ));
  }
  private prepare(current: Part[]): void {
    const controller = new AbortController();
    this.controller = controller;
    const previous = this.previous.flat();
    void (async () => {
      const convert = async ({ channel, entry }: Part): Promise<PolygonGeometryPart> => {
        const kind = channel.request.input.kind;
        if (kind === 'point') throw new Error('Point geometry cannot belong to a polygon command');
        return { kind, job: entry.job, partition: await channel.request.plan.promise };
      };
      const [targets, old] = await Promise.all([
        Promise.all(current.map(convert)),
        Promise.all(previous.map(convert)),
      ]);
      controller.signal.throwIfAborted();
      const previousFills = new Map<string, Set<GeometryEntry>>();
      for (let i = 0; i < previous.length; i++) {
        if (old[i].kind !== 'fill') continue;
        const part = previous[i];
        let entries = previousFills.get(part.channel.key);
        if (!entries) previousFills.set(part.channel.key, (entries = new Set()));
        entries.add(part.entry);
      }
      const sharedFills = new Map<string, Set<GeometryEntry>>();
      for (let i = 0; i < current.length; i++) {
        const part = current[i];
        if (
          targets[i].kind !== 'fill' ||
          !previousFills.get(part.channel.key)?.has(part.entry) ||
          !this.options.ready(part.entry)
        )
          continue;
        targets[i].stableFill = true;
        let entries = sharedFills.get(part.channel.key);
        if (!entries) sharedFills.set(part.channel.key, (entries = new Set()));
        entries.add(part.entry);
      }
      for (let i = 0; i < previous.length; i++)
        if (
          old[i].kind === 'fill' &&
          sharedFills.get(previous[i].channel.key)?.has(previous[i].entry)
        )
          old[i].stableFill = true;
      const stableFills = [
        ...new Set([...sharedFills.values()].flatMap((entries) => [...entries])),
      ];
      const cold = previous.length
        ? undefined
        : await polygonColdGroups(targets, this.shapes, controller.signal);
      const groups = cold
        ? []
        : await polygonPresentationGroups(targets, old, this.shapes, controller.signal);
      controller.signal.throwIfAborted();
      if (stableFills.some((entry) => !this.options.ready(entry))) {
        // The cooperative dependency walk may yield while residency changes.
        this.controller = undefined;
        this.options.invalidate();
        return;
      }
      this.stableFills = stableFills;
      this.plan = { current, previous, groups, cold };
      this.options.invalidate();
    })().catch((error) => {
      if (controller.signal.aborted || this.disposed) return;
      this.failed = true;
      this.options.report(error instanceof Error ? error : new Error(String(error)));
      this.options.invalidate();
    });
  }
  draw(): void {
    if (this.disposed) return;
    // A lost residency selection can be repaired in place by the geometry cache.
    if (this.channels.some((c, i) => c.request.entries !== this.entries[i])) this.reset();
    if (this.stableFills.some((entry) => !this.options.ready(entry))) {
      // Independent boundary handoffs are safe only while the shared face stays
      // resident. Rejoin the last frame before replanning its full dependencies.
      this.reset();
      this.previous = this.previous.length ? [this.previous.flat()] : [];
      this.stableFills = [];
    }
    this.complete = false;
    let selected = this.previous.filter((group) => group.every((p) => this.options.ready(p.entry)));
    const planned = this.channels.every(
      (c) => c.request.entries !== null && !c.request.controller.signal.aborted,
    );
    if (planned) {
      if (this.channels.every((c) => this.options.complete(c.request))) {
        const current = this.parts();
        if (current.every((p) => this.options.ready(p.entry))) {
          // Warm/fully ready frames need no dependency walk or extra latency.
          this.controller?.abort();
          this.controller = undefined;
          this.plan = undefined;
          this.stableFills = [];
          selected = current.length ? [current] : [];
          this.previous = [];
          this.complete = true;
        }
      } else if (!this.options.atomic) {
        if (!this.plan && !this.controller && !this.failed) this.prepare(this.parts());
        if (this.plan) {
          const plan = this.plan;
          selected = [];
          if (plan.cold)
            for (const group of plan.cold) {
              const fill = plan.current[group.fill];
              const strokes = group.strokes.map((i) => plan.current[i]);
              if (
                !this.options.ready(fill.entry) ||
                !strokes.every(
                  (p) =>
                    this.options.ready(p.entry) &&
                    p.entry.meshes.every((_, i) => p.entry.memberRanges?.[i] !== undefined),
                )
              )
                continue;
              const members = new Set(group.arcs);
              selected.push([fill, ...strokes.map((part) => ({ ...part, members }))]);
            }
          for (const group of plan.groups) {
            const targets = group.targets.map((i) => plan.current[i]);
            if (targets.every((p) => this.options.ready(p.entry))) selected.push(targets);
            else {
              const old = group.previous.map((i) => plan.previous[i]);
              if (old.length && old.every((p) => this.options.ready(p.entry))) selected.push(old);
            }
          }
        }
      }
    }
    const latest = new Map(this.channels.map((c) => [c.key, c]));
    const draws = new Map<
      string,
      { channel: PolygonChannel; entries: Map<GeometryEntry, Set<number> | undefined> }
    >();
    for (const group of selected)
      for (const part of group) {
        let draw = draws.get(part.channel.key);
        if (!draw) {
          draw = {
            channel: latest.get(part.channel.key) ?? part.channel,
            entries: new Map<GeometryEntry, Set<number> | undefined>(),
          };
          draws.set(part.channel.key, draw);
        }
        if (!draw.entries.has(part.entry))
          draw.entries.set(part.entry, part.members ? new Set(part.members) : undefined);
        else if (!part.members) draw.entries.set(part.entry, undefined);
        else {
          const members = draw.entries.get(part.entry);
          if (members) for (const id of part.members) members.add(id);
        }
      }
    // All fills retain expression-bucket order; all outlines remain above them.
    // Shared path meshes draw once with the union of published owners, never twice.
    for (const draw of [...draws.values()].sort((a, b) => a.channel.order - b.channel.order)) {
      const original = draw.channel.request.entries ?? [];
      if (
        original.length === draw.entries.size &&
        original.every((entry) => draw.entries.has(entry))
      ) {
        draw.channel.draw(original, draw.entries);
      } else {
        const order = new Map(original.map((entry, i) => [entry, i]));
        draw.channel.draw(
          [...draw.entries.keys()].sort(
            (a, b) => (order.get(a) ?? a.job.chunk) - (order.get(b) ?? b.job.chunk),
          ),
          draw.entries,
        );
      }
    }
    this.presented = selected;
  }
  dispose(): void {
    this.disposed = true;
    this.controller?.abort();
    this.controller = undefined;
    this.channels = [];
    this.entries = [];
    this.presented = this.previous = [];
    this.currentParts = undefined;
    this.plan = undefined;
    this.stableFills = [];
    this.complete = false;
  }
}
