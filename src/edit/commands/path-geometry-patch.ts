import type { EditCommand } from '../edit-command';
import type { MapshaperLayer, PathShape } from '../../types/mapshaper-types';
import { asMutableTopologySource, type TopologySource } from '../../source/source';
import type { FeatureRef } from '../../map/types';
import type { Selection, SelectionDiff, SelectionSnapshot } from '../../map/selection';
import {
  getDefaultMapshaperAdapter,
  type AppendedArc,
  type MapshaperAdapter,
} from '../../adapter/mapshaper-adapter';
import { markSourceChanged } from './_shared';

/** One feature's path shape replaced wholesale (before/after snapshots). */
export interface PathShapePatch {
  layer: MapshaperLayer;
  featureId: number;
  before: PathShape;
  after: PathShape;
}

export interface PathGeometryPatchCommandOptions {
  source: TopologySource;
  shapePatches: PathShapePatch[];
  /** Arc count BEFORE the first do(). undo() truncates back to this. */
  originalArcCount: number;
  /** Arcs appended by do(), in id order (first id = originalArcCount). */
  appendedArcs: AppendedArc[];
  selection: Selection;
  beforeSelection: SelectionSnapshot;
  afterSelection: FeatureRef[];
  publishSelection: (diff: SelectionDiff) => void;
  label: string;
  /** Adapter override for tests; defaults to the process-wide singleton. */
  adapter?: MapshaperAdapter;
}

function cloneShape(shape: PathShape): PathShape {
  return shape.map((part) => part.slice());
}

/**
 * In-place reversible patch for local path-geometry edits (add/delete ring,
 * add/delete part). Do/undo are exact mirror images:
 *
 *   do:   append arcs → write after shapes → apply afterSelection
 *   undo: truncate arcs → restore before shapes → restore beforeSelection
 *
 * Arc ids stay stable for the command's lifetime: nothing below the original
 * arc count is ever rewritten, and redo re-appends the same vertex data at
 * the same count. Both do and redo assert the collection still holds exactly
 * `originalArcCount` arcs so a bypassing append fails loudly instead of
 * corrupting history.
 *
 * Not a history barrier: `invalidatesPriorCommands` is intentionally absent,
 * so consecutive local edits stack into multi-level undo/redo.
 */
export class PathGeometryPatchCommand implements EditCommand {
  readonly label: string;
  private readonly opts: PathGeometryPatchCommandOptions;
  private pendingSelectionDiff: SelectionDiff | null = null;

  constructor(opts: PathGeometryPatchCommandOptions) {
    // Clone snapshots: caller arrays may be reused/mutated after construction.
    this.opts = {
      ...opts,
      shapePatches: opts.shapePatches.map((patch) => ({
        ...patch,
        before: cloneShape(patch.before),
        after: cloneShape(patch.after),
      })),
    };
    this.label = opts.label;
  }

  do(): void {
    const source = asMutableTopologySource(this.opts.source);
    const arcs = source.getArcs();
    if (!arcs) return;
    const adapter = this.opts.adapter ?? getDefaultMapshaperAdapter();
    if (this.opts.appendedArcs.length > 0) {
      if (arcs.size() !== this.opts.originalArcCount) {
        throw new Error(
          `PathGeometryPatchCommand: expected ${this.opts.originalArcCount} arcs before do(), found ${arcs.size()}`,
        );
      }
      adapter.appendArcs(arcs, this.opts.appendedArcs);
    }
    for (const patch of this.opts.shapePatches) {
      patch.layer.shapes![patch.featureId] = cloneShape(patch.after);
    }
    this.pendingSelectionDiff = this.opts.selection.apply(this.opts.afterSelection, 'replace');
    markSourceChanged(source);
  }

  undo(): void {
    const source = asMutableTopologySource(this.opts.source);
    const arcs = source.getArcs();
    if (!arcs) return;
    const adapter = this.opts.adapter ?? getDefaultMapshaperAdapter();
    if (this.opts.appendedArcs.length > 0) {
      const expected = this.opts.originalArcCount + this.opts.appendedArcs.length;
      if (arcs.size() !== expected) {
        throw new Error(
          `PathGeometryPatchCommand: expected ${expected} arcs before undo(), found ${arcs.size()}`,
        );
      }
      adapter.truncateArcs(arcs, this.opts.originalArcCount);
    }
    for (const patch of this.opts.shapePatches) {
      patch.layer.shapes![patch.featureId] = cloneShape(patch.before);
    }
    this.pendingSelectionDiff = this.opts.selection.restore(this.opts.beforeSelection);
    markSourceChanged(source);
  }

  publish(): void {
    this.opts.source.fire?.('data', { reason: 'edit' });
    if (this.pendingSelectionDiff?.changed) this.opts.publishSelection(this.pendingSelectionDiff);
    this.pendingSelectionDiff = null;
  }
}
