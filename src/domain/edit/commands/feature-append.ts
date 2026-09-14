import type { EditCommand } from '../edit-command';
import type { FeatureShape, MapshaperLayer } from '../../../shared/types/mapshaper-types';
import type { TopologySource } from '../../source/source';
import { markShapeCountChanged } from './_shared';

export interface FeatureAppendCommandOptions {
  /** Layer the feature was appended to. */
  layer: MapshaperLayer;
  /** Source so undo/redo can bump the edit version and publish can fire. */
  source: TopologySource;
  /**
   * Shape pushed onto `layer.shapes`. References EXISTING arcs (e.g. a
   * fill-ring feature sharing the hole's arcs) — this command never appends
   * or deletes arcs, unlike `FeatureCreateCommand`.
   */
  appendedShape: FeatureShape;
  /** Record pushed onto `layer.data.getRecords()`; null when the layer has no data table. */
  appendedRecord: Record<string, unknown> | null;
  label?: string;
}

/**
 * Append a feature whose geometry references existing arcs. do/undo only
 * push/pop the shape and (optional) record; the arc collection is untouched,
 * so arc ids captured by other history entries never shift.
 */
export class FeatureAppendCommand implements EditCommand {
  readonly label: string;

  constructor(private readonly opts: FeatureAppendCommandOptions) {
    this.label = opts.label ?? 'Append feature';
  }

  do(): void {
    const o = this.opts;
    if (!o.layer.shapes) o.layer.shapes = [];
    o.layer.shapes.push(o.appendedShape);
    if (o.appendedRecord !== null) {
      const records = o.layer.data?.getRecords?.();
      records?.push(o.appendedRecord);
    }
    markShapeCountChanged(o.source);
  }

  undo(): void {
    const o = this.opts;
    o.layer.shapes?.pop();
    if (o.appendedRecord !== null) {
      const records = o.layer.data?.getRecords?.();
      records?.pop();
    }
    markShapeCountChanged(o.source);
  }

  publish(): void {
    this.opts.source.fire?.('data', { reason: 'edit' });
  }
}
