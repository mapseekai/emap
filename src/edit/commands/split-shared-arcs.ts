import type { EditCommand } from '../edit-command';
import {
  getDefaultMapshaperAdapter,
  type AppendedArc,
} from '../../adapter/mapshaper-adapter';
import {
  absArcId,
  isPathLayer,
  type MapshaperLayer,
  type PathShape,
} from '../../types/mapshaper-types';
import { asMutableTopologySource, type TopologySource } from '../../source/source';
import { markSourceChanged } from './_shared';
// Re-exported so the public `@/edit/commands/split-shared-arcs` import path
// (and `src/index.ts`) keep working after the type moved to the adapter.
export type { AppendedArc };


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
    const source = asMutableTopologySource(this.opts.source);
    const arcs = source.getArcs();
    if (!arcs) return;
    if (this.opts.appendedArcs.length > 0) {
      if (arcs.size() !== this.opts.originalArcCount) {
        throw new Error(
          `SplitSharedArcsCommand: expected ${this.opts.originalArcCount} arcs before do(), found ${arcs.size()}`,
        );
      }
      getDefaultMapshaperAdapter().appendArcs(arcs, this.opts.appendedArcs);
    }
    for (const r of this.opts.remaps) {
      r.layer.shapes![r.featureId] = cloneShape(r.newShape);
    }
    markSourceChanged(source);
  }

  undo(): void {
    const source = asMutableTopologySource(this.opts.source);
    const arcs = source.getArcs();
    if (!arcs) return;
    if (this.opts.appendedArcs.length > 0) {
      const expected = this.opts.originalArcCount + this.opts.appendedArcs.length;
      if (arcs.size() !== expected) {
        throw new Error(
          `SplitSharedArcsCommand: expected ${expected} arcs before undo(), found ${arcs.size()}`,
        );
      }
      getDefaultMapshaperAdapter().truncateArcs(arcs, this.opts.originalArcCount);
    }
    for (const r of this.opts.remaps) {
      r.layer.shapes![r.featureId] = cloneShape(r.originalShape);
    }
    markSourceChanged(source);
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
  const mutableSource = asMutableTopologySource(source);
  const arcs = mutableSource.getArcs();
  if (!arcs) return null;
  const arcCount = arcs.size();
  if (arcCount === 0 || selected.length === 0) return null;

  // O(features) sweep: for every absolute arc id, count how many selected
  // and unselected references touch it. Path features only — points don't
  // share arcs.
  const selectedRefs = new Uint32Array(arcCount);
  const unselectedRefs = new Uint32Array(arcCount);

  const selectedByLayer = new globalThis.Map<MapshaperLayer, Set<number>>();
  for (const s of selected) {
    const featureIds = selectedByLayer.get(s.layer) ?? new Set<number>();
    featureIds.add(s.featureId);
    selectedByLayer.set(s.layer, featureIds);
  }

  for (const layer of allLayers) {
    if (!layer.shapes) continue;
    if (!isPathLayer(layer)) continue;
    const shapes = layer.shapes;
    for (let fid = 0; fid < shapes.length; fid++) {
      const shape = shapes[fid];
      if (!shape) continue;
      const isSelected = selectedByLayer.get(layer)?.has(fid) === true;
      for (const part of shape) {
        if (!Array.isArray(part)) continue;
        for (const raw of part) {
          if (typeof raw !== 'number') continue;
          const abs = absArcId(raw);
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
        const abs = absArcId(raw);
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

function cloneShape(shape: PathShape): PathShape {
  return shape.map((part) => part.slice());
}

