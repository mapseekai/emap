import mapshaper from 'mapshaper';
import type { EditCommand } from '../edit-command';
import type {
  ArcCollection,
  FeatureShape,
  MapshaperLayer,
} from '../../types/mapshaper-types';
import type { TopologySource } from '../../source/source';

export type FeatureGeometryType = 'point' | 'polyline' | 'polygon';

export interface FeatureCreateCommandOptions {
  geometryType: FeatureGeometryType;
  /** Layer the feature was appended to. */
  layer: MapshaperLayer;
  /** Source so we can refresh DisplayArcs after the mutation. */
  source: TopologySource;
  /** The shape value pushed onto `layer.shapes`. */
  appendedShape: FeatureShape;
  /**
   * The data record pushed onto `layer.data.getRecords()`. `null` when the
   * layer has no data table.
   */
  appendedRecord: Record<string, unknown> | null;
  /**
   * Vertex coordinates of the new arc, in original order. Required for path
   * geometries (polyline / polygon); omitted for points.
   */
  arcVertices?: [number, number][];
  /** The shared ArcCollection for path geometries; omitted for points. */
  arcs?: ArcCollection;
}

/**
 * Reverse the creation of a drawn feature.
 *
 * For path features: the last appended arc is removed via mapshaper's
 * `internal.deleteLastArc`, and the shape / record are popped. Redo
 * re-creates the arc using mapshaper's canonical `appendEmptyArc` +
 * `appendVertex` pattern, so vertex storage and z-values match the original
 * append exactly.
 *
 * For point features: only the shape and (optional) record are popped /
 * re-pushed.
 */
export class FeatureCreateCommand implements EditCommand {
  readonly label: string;

  constructor(private readonly opts: FeatureCreateCommandOptions) {
    this.label = `Draw ${opts.geometryType}`;
  }

  do(): void {
    const o = this.opts;
    if (o.geometryType !== 'point') {
      if (!o.arcs || !o.arcVertices) {
        throw new Error('FeatureCreateCommand: path features require arcs and arcVertices');
      }
      // Re-create the arc using mapshaper's canonical helpers, matching what
      // DrawFeatureControl produced originally.
      mapshaper.internal.appendEmptyArc(o.arcs);
      for (const v of o.arcVertices) {
        mapshaper.internal.appendVertex(o.arcs, v);
      }
    }
    if (!o.layer.shapes) o.layer.shapes = [];
    o.layer.shapes.push(o.appendedShape);
    if (o.appendedRecord !== null) {
      const records = o.layer.data?.getRecords?.();
      records?.push(o.appendedRecord);
    }
    o.source.refreshDisplayArcs();
  }

  undo(): void {
    const o = this.opts;
    o.layer.shapes?.pop();
    if (o.appendedRecord !== null) {
      const records = o.layer.data?.getRecords?.();
      records?.pop();
    }
    if (o.geometryType !== 'point' && o.arcs) {
      mapshaper.internal.deleteLastArc(o.arcs);
    }
    o.source.refreshDisplayArcs();
  }
}
