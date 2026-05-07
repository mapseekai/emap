import type { EditCommand } from '../edit-command';
import {
  isPathLayer,
  type ArcCollection,
  type MapshaperLayer,
  type PathShape,
} from '../../types/mapshaper-types';
import type { TopologySource } from '../../source/source';

/**
 * One feature whose shape was rewritten to point at duplicated arc ids.
 * Captured at command-construction time so undo restores it exactly.
 */
export interface SplitSharedArcsRemap {
  layer: MapshaperLayer;
  featureId: number;
  /** Snapshot of `layer.shapes[featureId]` BEFORE the split (deep cloned). */
  originalShape: PathShape;
  /** The post-split shape that uses the new arc ids. */
  newShape: PathShape;
}

/**
 * Vertex data for a single arc to be appended onto the source's `ArcCollection`.
 * Slices of the original arc's xx/yy (and zz when simplification is in play).
 */
export interface AppendedArc {
  xx: Float64Array;
  yy: Float64Array;
  zz?: Float64Array | null;
}

export interface SplitSharedArcsCommandOptions {
  source: TopologySource;
  /** Pre-computed shape rewrites — one entry per affected feature. */
  remaps: SplitSharedArcsRemap[];
  /**
   * Vertex data for every arc to append, in the order the new arc ids were
   * assigned (first appended arc id = `originalArcCount`, second = +1, …).
   */
  appendedArcs: AppendedArc[];
  /** Arc count BEFORE the split. Used by undo to truncate. */
  originalArcCount: number;
}

/**
 * Duplicate "shared" arcs (arcs referenced by both selected and unselected
 * features) so a subsequent translate / rotate / scale on the selection no
 * longer drags unselected neighbours along by their shared boundary.
 *
 * Topology stays valid: unselected features keep their original arc ids,
 * selected features get rewritten to point at the duplicates.
 *
 * Undo restores every rewritten shape to its captured pre-split state and
 * truncates the appended arcs off the `ArcCollection`. Redo re-appends and
 * re-rewrites. Both directions go through `arcs.updateVertexData` so the
 * collection's bounds and indices stay coherent.
 */
export class SplitSharedArcsCommand implements EditCommand {
  readonly label: string;

  constructor(private readonly opts: SplitSharedArcsCommandOptions) {
    this.label = `Split ${opts.appendedArcs.length} shared arc${opts.appendedArcs.length === 1 ? '' : 's'}`;
  }

  do(): void {
    const arcs = this.opts.source.getArcs();
    if (!arcs) return;
    appendArcs(arcs, this.opts.appendedArcs);
    for (const r of this.opts.remaps) {
      r.layer.shapes![r.featureId] = cloneShape(r.newShape);
    }
    this.opts.source.markDisplayArcsDirty?.();
  }

  undo(): void {
    const arcs = this.opts.source.getArcs();
    if (!arcs) return;
    truncateArcs(arcs, this.opts.originalArcCount);
    for (const r of this.opts.remaps) {
      r.layer.shapes![r.featureId] = cloneShape(r.originalShape);
    }
    this.opts.source.markDisplayArcsDirty?.();
  }
}

// ---------------------------------------------------------------------------
// Public helper: compute the split plan from a selection
// ---------------------------------------------------------------------------

/**
 * Walks the dataset's path-feature shapes once, finds arcs referenced by
 * BOTH selected and unselected features, and returns the data needed to
 * construct a {@link SplitSharedArcsCommand}. Returns `null` (no command
 * needed) when the selection has no boundary shared with anything outside.
 *
 * `selected` lists `(layer, featureId)` pairs in the active selection; the
 * caller is responsible for restricting these to one source. `allLayers`
 * is the full layer list of that source so we can find unselected
 * references.
 */
export function planSharedArcSplit(
  source: TopologySource,
  selected: Array<{ layer: MapshaperLayer; featureId: number }>,
  allLayers: MapshaperLayer[],
): SplitSharedArcsCommandOptions | null {
  const arcs = source.getArcs();
  if (!arcs) return null;
  const arcCount = arcs.size();
  if (arcCount === 0 || selected.length === 0) return null;

  // O(features) sweep: for every absolute arc id, count how many selected
  // and unselected references touch it. Path features only — points don't
  // share arcs.
  const selectedRefs = new Uint32Array(arcCount);
  const unselectedRefs = new Uint32Array(arcCount);

  const selectedKey = new Set<string>();
  for (const s of selected) {
    selectedKey.add(featureKey(s.layer, s.featureId));
  }

  for (const layer of allLayers) {
    if (!layer.shapes) continue;
    if (!isPathLayer(layer)) continue;
    const shapes = layer.shapes;
    for (let fid = 0; fid < shapes.length; fid++) {
      const shape = shapes[fid];
      if (!shape) continue;
      const isSelected = selectedKey.has(featureKey(layer, fid));
      for (const part of shape) {
        if (!Array.isArray(part)) continue;
        for (const raw of part) {
          if (typeof raw !== 'number') continue;
          const abs = raw >= 0 ? raw : ~raw;
          if (abs < 0 || abs >= arcCount) continue;
          if (isSelected) selectedRefs[abs]++;
          else unselectedRefs[abs]++;
        }
      }
    }
  }

  // Decide which arcs need duplication: shared with at least one
  // unselected feature.
  const sharedAbs: number[] = [];
  for (let i = 0; i < arcCount; i++) {
    if (selectedRefs[i] > 0 && unselectedRefs[i] > 0) sharedAbs.push(i);
  }
  if (sharedAbs.length === 0) return null;

  // Allocate the new arc ids in the order they appear in `sharedAbs`.
  const oldToNew = new globalThis.Map<number, number>();
  for (let i = 0; i < sharedAbs.length; i++) {
    oldToNew.set(sharedAbs[i], arcCount + i);
  }

  // Build vertex-data slices for each duplicated arc.
  const data = arcs.getVertexData?.();
  if (!data) return null;
  const { xx, yy, zz, ii, nn } = data;
  const appendedArcs: AppendedArc[] = sharedAbs.map((arcId) => {
    const start = ii[arcId];
    const len = nn[arcId];
    return {
      xx: new Float64Array(xx.subarray(start, start + len)),
      yy: new Float64Array(yy.subarray(start, start + len)),
      zz: zz ? new Float64Array(zz.subarray(start, start + len)) : null,
    };
  });

  // Rewrite each selected feature's shape: any signed reference to a shared
  // arc → corresponding new arc id with the same sign (preserving direction).
  const remaps: SplitSharedArcsRemap[] = [];
  for (const s of selected) {
    if (!isPathLayer(s.layer)) continue;
    const oldShape = s.layer.shapes?.[s.featureId];
    if (!oldShape) continue;
    let touched = false;
    const newShape: PathShape = oldShape.map((part) =>
      part.map((raw) => {
        const abs = raw >= 0 ? raw : ~raw;
        const replacement = oldToNew.get(abs);
        if (replacement === undefined) return raw;
        touched = true;
        return raw >= 0 ? replacement : ~replacement;
      }),
    );
    if (!touched) continue;
    remaps.push({
      layer: s.layer,
      featureId: s.featureId,
      originalShape: cloneShape(oldShape),
      newShape,
    });
  }

  if (remaps.length === 0) return null;

  return {
    source,
    remaps,
    appendedArcs,
    originalArcCount: arcCount,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function featureKey(layer: MapshaperLayer, featureId: number): string {
  // Layer object identity is enough as a key — within one dataset the same
  // layer reference is stable. Encode by mixing object identity into a
  // weak-map alternative wouldn't be JSON-serialisable, so we just use a
  // per-call string built from the layer's name + featureId. Within one
  // session the layer name is stable.
  return `${layer.name ?? ''}#${featureId}`;
}

function cloneShape(shape: PathShape): PathShape {
  return shape.map((part) => part.slice());
}

/**
 * Append the given arcs onto `arcs`. Builds new typed arrays once and hands
 * them to `updateVertexData`, which rebuilds bounds and indexes internally.
 */
function appendArcs(arcs: ArcCollection, appended: AppendedArc[]): void {
  const data = arcs.getVertexData?.();
  if (!data) return;
  const { xx, yy, zz, nn } = data;
  const hasZ = !!zz && appended.every((a) => a.zz);

  let extraPoints = 0;
  for (const a of appended) extraPoints += a.xx.length;

  const newXx = new Float64Array(xx.length + extraPoints);
  const newYy = new Float64Array(yy.length + extraPoints);
  const newZz = hasZ ? new Float64Array(zz!.length + extraPoints) : null;
  newXx.set(xx);
  newYy.set(yy);
  if (newZz && zz) newZz.set(zz);

  let cursor = xx.length;
  for (const a of appended) {
    newXx.set(a.xx, cursor);
    newYy.set(a.yy, cursor);
    if (newZz && a.zz) newZz.set(a.zz, cursor);
    cursor += a.xx.length;
  }

  const newNn = new Int32Array(nn.length + appended.length);
  newNn.set(nn);
  for (let i = 0; i < appended.length; i++) newNn[nn.length + i] = appended[i].xx.length;

  arcs.updateVertexData!(newNn, newXx, newYy, newZz);
}

/**
 * Truncate `arcs` back to `targetArcCount`. Used by undo. Drops the tail
 * vertex data along with the arc-count slot.
 */
function truncateArcs(arcs: ArcCollection, targetArcCount: number): void {
  const data = arcs.getVertexData?.();
  if (!data) return;
  const { xx, yy, zz, nn } = data;
  if (nn.length === targetArcCount) return;
  if (targetArcCount > nn.length) return; // shouldn't happen — defensive

  let keptPoints = 0;
  for (let i = 0; i < targetArcCount; i++) keptPoints += nn[i];

  const newNn = new Int32Array(targetArcCount);
  newNn.set(nn.subarray(0, targetArcCount));
  const newXx = new Float64Array(xx.subarray(0, keptPoints));
  const newYy = new Float64Array(yy.subarray(0, keptPoints));
  const newZz = zz ? new Float64Array(zz.subarray(0, keptPoints)) : null;

  arcs.updateVertexData!(newNn, newXx, newYy, newZz);
}
