import { absArcId, type PathShape } from '../../../shared/types/mapshaper-types';
import type { Shapes } from './geometry';
import {
  EMPTY_COMPONENT,
  geometryYield,
  type GeometryJob,
  type GeometryPartition,
} from './geometry-jobs';
import type { GeometryHandoffGroup } from './geometry-handoff';

export interface PolygonGeometryPart {
  kind: 'fill' | 'path' | 'arrow';
  job: GeometryJob;
  partition: GeometryPartition;
  /** Identical resident fill and paint in both frames; no boundary replacement. */
  stableFill?: boolean;
}

/** Couple actual render units, not equal-looking chunk numbers from unrelated
 * partitions. Reuse the existing source membership indexes: only O(chunk count)
 * temporary metadata is allocated, never another per-vertex/source index.
 * Shared strokes and old/new LOD coverage join the same atomic component. */
export async function polygonPresentationGroups(
  current: readonly PolygonGeometryPart[],
  previous: readonly PolygonGeometryPart[],
  shapes: Shapes,
  signal: AbortSignal,
): Promise<GeometryHandoffGroup[]> {
  signal.throwIfAborted();
  const parts = [...current, ...previous];
  const parents = Uint32Array.from(parts, (_, i) => i);
  const root = (id: number): number => {
    while (parents[id] !== id) {
      parents[id] = parents[parents[id]];
      id = parents[id];
    }
    return id;
  };
  const join = (a: number, b: number) => {
    parents[root(a)] = root(b);
  };
  const domains: { partition: GeometryPartition; paths: boolean; chunks: Map<number, number> }[] =
    [];
  const indexes = new Map<GeometryPartition, Map<boolean, (typeof domains)[number]>>();
  const stableFills = new Map<GeometryJob, number>();
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i],
      paths = part.kind === 'path';
    if (part.kind === 'fill' && part.stableFill) {
      // Pair the retained old/new face without making it a bridge between
      // independent stroke or changing-fill chunks in either partition.
      const existing = stableFills.get(part.job);
      if (existing === undefined) stableFills.set(part.job, i);
      else join(i, existing);
      continue;
    }
    let kinds = indexes.get(part.partition);
    if (!kinds) indexes.set(part.partition, (kinds = new Map<boolean, (typeof domains)[number]>()));
    let domain = kinds.get(paths);
    if (!domain) {
      domain = { partition: part.partition, paths, chunks: new Map<number, number>() };
      kinds.set(paths, domain);
      domains.push(domain);
    }
    const existing = domain.chunks.get(part.job.chunk);
    if (existing === undefined) domain.chunks.set(part.job.chunk, i);
    else join(i, existing);
  }
  const paths = domains.filter((d) => d.paths),
    features = domains.filter((d) => !d.paths);
  const connect = (node: number, id: number, domains: typeof paths) => {
    for (const domain of domains) {
      const chunk = domain.partition.membership[id];
      if (chunk === undefined || chunk === EMPTY_COMPONENT) continue;
      const selected = domain.chunks.get(
        domain.paths && domain.partition.batchIds ? domain.partition.batchIds[chunk] : chunk,
      );
      if (selected !== undefined) join(node, selected);
    }
  };
  let visited = 0,
    slice = performance.now();
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.kind === 'fill' && part.stableFill) continue;
    for (const member of part.job.members) {
      if (part.kind === 'path') connect(i, absArcId(member), paths);
      else {
        connect(i, member, features);
        for (const ring of (shapes[member] ?? []) as PathShape)
          for (const arc of ring) {
            connect(i, absArcId(arc), paths);
            if ((++visited & 2047) === 0 && performance.now() - slice >= 4) {
              await geometryYield(signal);
              slice = performance.now();
            }
          }
      }
      if ((++visited & 2047) === 0 && performance.now() - slice >= 4) {
        await geometryYield(signal);
        slice = performance.now();
      }
    }
  }
  const groups = new Map<number, GeometryHandoffGroup>();
  for (let i = 0; i < parts.length; i++) {
    const id = root(i);
    let group = groups.get(id);
    if (!group) groups.set(id, (group = { targets: [], previous: [] }));
    if (i < current.length) group.targets.push(i);
    else group.previous.push(i - current.length);
  }
  signal.throwIfAborted();
  // Old content with no current dependency has left the selected viewport.
  return [...groups.values()].filter((group) => group.targets.length > 0);
}

export interface PolygonColdGroup {
  fill: number;
  strokes: { part: number; arcs: Int32Array }[];
}

/** Cold presentation has directed dependencies: a ready face needs its boundary,
 * but the same shared boundary never has to wait for both adjacent faces.
 * Stroke member masks keep unrelated edges inside that GPU mesh invisible.
 * The optional compact ID lists are capped; oversized cases use coarse groups. */
export async function polygonColdGroups(
  current: readonly PolygonGeometryPart[],
  shapes: Shapes,
  signal: AbortSignal,
): Promise<PolygonColdGroup[] | undefined> {
  signal.throwIfAborted();
  if (current.some((part) => part.kind === 'arrow')) return undefined;
  const paths = new Map<GeometryPartition, Map<number, number>>();
  for (let i = 0; i < current.length; i++) {
    const part = current[i];
    if (part.kind !== 'path') continue;
    let chunks = paths.get(part.partition);
    if (!chunks) paths.set(part.partition, (chunks = new Map<number, number>()));
    // Multiple paint owners of the same path partition need the conservative plan.
    if (chunks.has(part.job.chunk)) return undefined;
    chunks.set(part.job.chunk, i);
  }
  const groups: PolygonColdGroup[] = [];
  let visits = 0,
    bytes = 0,
    slice = performance.now();
  for (let i = 0; i < current.length; i++) {
    const part = current[i];
    if (part.kind !== 'fill') continue;
    const arcs = new Set<number>(),
      strokes = new Map<number, number[]>();
    for (const feature of part.job.members) {
      for (const ring of (shapes[feature] ?? []) as PathShape)
        for (const signed of ring) {
          const arc = absArcId(signed);
          if (!arcs.has(arc)) {
            arcs.add(arc);
            for (const [partition, chunks] of paths) {
              const chunk = partition.membership[arc];
              if (chunk === undefined || chunk === EMPTY_COMPONENT) continue;
              const stroke = chunks.get(partition.batchIds ? partition.batchIds[chunk] : chunk);
              if (stroke !== undefined) {
                let members = strokes.get(stroke);
                if (!members) strokes.set(stroke, (members = []));
                members.push(arc);
                bytes += 4;
                if (bytes > 32 * 1024 ** 2) return undefined;
              }
            }
          }
          if ((++visits & 2047) === 0 && performance.now() - slice >= 4) {
            await geometryYield(signal);
            slice = performance.now();
          }
        }
    }
    groups.push({
      fill: i,
      // A face can span many stroke chunks; never copy all its edges into each mask.
      strokes: [...strokes].map(([part, members]) => ({ part, arcs: Int32Array.from(members) })),
    });
  }
  signal.throwIfAborted();
  return groups;
}
