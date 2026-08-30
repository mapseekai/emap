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
import { appendArcsCompat, markSourceChanged, truncateArcsCompat } from './_shared';
import type { PathShapePatch } from './path-geometry-patch';

type MutableRecords = Array<Record<string, unknown> | null>;

export interface SplitFeaturesCommandOptions {
  source: TopologySource;
  /** Spliced-neighbor patches and split targets' retained-piece shapes. */
  shapePatches: PathShapePatch[];
  /** Arc count before the first do(). */
  originalArcCount: number;
  /** Arcs appended in stable id order. */
  appendedArcs: AppendedArc[];
  /** The single layer receiving the appended split features. */
  layer: MapshaperLayer;
  appendedShapes: PathShape[];
  appendedRecords: (Record<string, unknown> | null)[];
  /** Target layer shape count before the first do(). */
  originalFeatureCount: number;
  selection: Selection;
  /** Opaque snapshot consumed only by Selection.restore(). */
  beforeSelection: SelectionSnapshot;
  afterSelection: FeatureRef[];
  publishSelection: (diff: SelectionDiff) => void;
  label: string;
  /** Adapter override for focused tests. */
  adapter?: MapshaperAdapter;
}

function cloneShape(shape: PathShape): PathShape {
  return shape.map((part) => part.slice());
}

function cloneRecord(record: Record<string, unknown> | null): Record<string, unknown> | null {
  return record === null ? null : { ...record };
}

function getRecords(layer: MapshaperLayer): MutableRecords | null {
  const records = layer.data?.getRecords?.();
  // Mapshaper preserves positional feature/data alignment and may carry null rows.
  return records ? (records as unknown as MutableRecords) : null;
}

/**
 * Reversible in-place command for a path split that appends features. Arc ids
 * remain stable because do only appends from the captured base count and undo
 * only truncates back to it.
 */
export class SplitFeaturesCommand implements EditCommand {
  readonly label: string;
  private readonly opts: SplitFeaturesCommandOptions;
  private readonly adapter: MapshaperAdapter;
  private readonly originalRecordCount: number | null;
  private pendingSelectionDiff: SelectionDiff | null = null;

  constructor(opts: SplitFeaturesCommandOptions) {
    this.opts = {
      ...opts,
      shapePatches: opts.shapePatches.map((patch) => ({
        ...patch,
        before: cloneShape(patch.before),
        after: cloneShape(patch.after),
      })),
      appendedArcs: opts.appendedArcs.map((arc) => ({
        xx: new Float64Array(arc.xx),
        yy: new Float64Array(arc.yy),
        zz: arc.zz ? new Float64Array(arc.zz) : arc.zz,
      })),
      appendedShapes: opts.appendedShapes.map(cloneShape),
      appendedRecords: opts.appendedRecords.map(cloneRecord),
      beforeSelection: new Set(opts.beforeSelection),
      afterSelection: opts.afterSelection.map((ref) => ({ ...ref })),
    };
    this.adapter = opts.adapter ?? getDefaultMapshaperAdapter();
    this.originalRecordCount = getRecords(opts.layer)?.length ?? null;
    this.label = opts.label;
  }

  do(): void {
    const source = asMutableTopologySource(this.opts.source);
    const arcs = source.getArcs();
    if (!arcs) throw new Error('SplitFeaturesCommand: source has no arcs');
    this.preflightDo(arcs.size());

    appendArcsCompat(this.adapter, arcs, this.opts.appendedArcs);
    this.writePatches('after');
    this.appendFeatures();
    this.pendingSelectionDiff = this.opts.selection.apply(this.opts.afterSelection, 'replace');
    markSourceChanged(source);
  }

  undo(): void {
    const source = asMutableTopologySource(this.opts.source);
    const arcs = source.getArcs();
    if (!arcs) throw new Error('SplitFeaturesCommand: source has no arcs');
    this.preflightUndo(arcs.size());

    truncateArcsCompat(this.adapter, arcs, this.opts.originalArcCount);
    this.writePatches('before');
    this.truncateFeatures();
    this.pendingSelectionDiff = this.opts.selection.restore(this.opts.beforeSelection);
    markSourceChanged(source);
  }

  publish(): void {
    this.opts.source.fire?.('data', { reason: 'edit' });
    if (this.pendingSelectionDiff?.changed) this.opts.publishSelection(this.pendingSelectionDiff);
    this.pendingSelectionDiff = null;
  }

  private preflightDo(arcCount: number): void {
    if (arcCount !== this.opts.originalArcCount) {
      throw new Error(
        `SplitFeaturesCommand: expected ${this.opts.originalArcCount} arcs before do(), found ${arcCount}`,
      );
    }
    this.preflightFeatures(this.opts.originalFeatureCount, this.originalRecordCount);
  }

  private preflightUndo(arcCount: number): void {
    const expectedArcCount = this.opts.originalArcCount + this.opts.appendedArcs.length;
    if (arcCount !== expectedArcCount) {
      throw new Error(
        `SplitFeaturesCommand: expected ${expectedArcCount} arcs before undo(), found ${arcCount}`,
      );
    }
    this.preflightFeatures(
      this.opts.originalFeatureCount + this.opts.appendedShapes.length,
      this.originalRecordCount === null
        ? null
        : this.originalRecordCount + this.opts.appendedRecords.length,
    );
  }

  private preflightFeatures(expectedShapeCount: number, expectedRecordCount: number | null): void {
    if (this.opts.appendedRecords.length !== this.opts.appendedShapes.length) {
      throw new Error('SplitFeaturesCommand: appended shape and record counts differ');
    }
    const shapes = this.opts.layer.shapes;
    if (!shapes) throw new Error('SplitFeaturesCommand: target layer has no shapes');
    if (shapes.length !== expectedShapeCount) {
      throw new Error(
        `SplitFeaturesCommand: expected ${expectedShapeCount} target shapes, found ${shapes.length}`,
      );
    }

    const records = getRecords(this.opts.layer);
    if (expectedRecordCount === null) {
      if (records) throw new Error('SplitFeaturesCommand: target record table changed');
    } else {
      if (!records) throw new Error('SplitFeaturesCommand: target record table is unavailable');
      if (records.length !== expectedRecordCount) {
        throw new Error(
          `SplitFeaturesCommand: expected ${expectedRecordCount} target records, found ${records.length}`,
        );
      }
    }

    for (const patch of this.opts.shapePatches) {
      const patchShapes = patch.layer.shapes;
      if (!patchShapes) throw new Error('SplitFeaturesCommand: patched layer has no shapes');
      if (
        !Number.isInteger(patch.featureId) ||
        patch.featureId < 0 ||
        patch.featureId >= patchShapes.length
      ) {
        throw new Error(`SplitFeaturesCommand: patched feature ${patch.featureId} is unavailable`);
      }
    }
  }

  private writePatches(state: 'before' | 'after'): void {
    for (const patch of this.opts.shapePatches) {
      patch.layer.shapes![patch.featureId] = cloneShape(patch[state]);
    }
  }

  private appendFeatures(): void {
    const shapes = this.opts.layer.shapes!;
    for (const shape of this.opts.appendedShapes) shapes.push(cloneShape(shape));
    const records = getRecords(this.opts.layer);
    if (records) {
      for (const record of this.opts.appendedRecords) records.push(cloneRecord(record));
    }
  }

  private truncateFeatures(): void {
    this.opts.layer.shapes!.length = this.opts.originalFeatureCount;
    const records = getRecords(this.opts.layer);
    if (records && this.originalRecordCount !== null) records.length = this.originalRecordCount;
  }
}
