import type { EditCommand } from '../edit-command';
import type { ArcCollection, MapshaperLayer } from '../../types/mapshaper-types';
import type { TopologySource } from '../../source/source';
import { normalizePointShape } from '../../source/layer-utils';

/** Point-feature reference within a single source. */
export interface TranslatedPointFeature {
  layer: MapshaperLayer;
  featureId: number;
}

export interface FeatureTranslateCommandOptions {
  source: TopologySource;
  /** Shared ArcCollection that owns the path-feature arcs. May be omitted if only point features. */
  arcs?: ArcCollection;
  /** Offset in source-data coordinates. */
  dx: number;
  dy: number;
  /**
   * Unique absolute arc ids (post-`absArcId`) referenced by selected path
   * features in the source. Empty when no path features are selected.
   */
  arcIds: number[];
  /**
   * Selected point features whose `layer.shapes[featureId]` is offset directly.
   * Empty when no point features are selected.
   */
  pointFeatures: TranslatedPointFeature[];
}

/** Time window (ms) for consecutive translate merges. */
const MERGE_WINDOW_MS = 500;

/**
 * Translate a fixed set of arcs and point shapes by `(dx, dy)` in source-data
 * coordinates. Reverses by negating the offset.
 *
 * Lightweight in-place mutation — no dataset replacement, no copy. Cost is
 * O(vertices in the affected arcs + point coords). The same command class
 * handles point-only, path-only, and mixed selections within one source.
 *
 * Mergeable: consecutive translates of the SAME (source, arcIds,
 * pointFeatures) tuple within {@link MERGE_WINDOW_MS} accumulate their
 * deltas into a single entry — useful for arrow-key nudges or any UI
 * that batches `Emap.translateSelected` per keystroke.
 *
 * Known v1 limitation: arcs shared with unselected features are translated
 * once (correctly per the topology model), which means the unselected
 * neighbour's geometry follows along. The proper fix requires cutting
 * shared arcs at the selection boundary first; tracked as a follow-up.
 */
export class FeatureTranslateCommand implements EditCommand {
  readonly label: string;

  private _mergeAt = Date.now();

  constructor(private readonly opts: FeatureTranslateCommandOptions) {
    const n = opts.arcIds.length + opts.pointFeatures.length;
    this.label = `Translate ${n} feature${n === 1 ? '' : 's'}`;
  }

  do(): void {
    this._apply(this.opts.dx, this.opts.dy);
  }

  undo(): void {
    this._apply(-this.opts.dx, -this.opts.dy);
  }

  mergeable(prev: EditCommand): boolean {
    if (!(prev instanceof FeatureTranslateCommand)) return false;
    if (prev.opts.source !== this.opts.source) return false;
    if (Date.now() - prev._mergeAt > MERGE_WINDOW_MS) return false;
    // Same set of arc ids (path features)?
    const a = prev.opts.arcIds;
    const b = this.opts.arcIds;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    // Same set of point features (compared by layer reference + featureId)?
    const pa = prev.opts.pointFeatures;
    const pb = this.opts.pointFeatures;
    if (pa.length !== pb.length) return false;
    for (let i = 0; i < pa.length; i++) {
      if (pa[i].featureId !== pb[i].featureId) return false;
      if (pa[i].layer !== pb[i].layer) return false;
    }
    return true;
  }

  merge(next: EditCommand): void {
    if (!(next instanceof FeatureTranslateCommand)) return;
    // Accumulate offsets — undo subtracts the cumulative; redo re-adds it.
    this.opts.dx += next.opts.dx;
    this.opts.dy += next.opts.dy;
    this._mergeAt = Date.now();
  }

  private _apply(dx: number, dy: number): void {
    const { arcs, arcIds, pointFeatures, source } = this.opts;

    // Path features: walk each arc's vertex range and offset xx/yy in place.
    if (arcs && arcIds.length > 0) {
      const data = arcs.getVertexData?.();
      if (data) {
        const { xx, yy, ii, nn } = data;
        for (const arcId of arcIds) {
          const start = ii[arcId];
          const len = nn[arcId];
          for (let i = start; i < start + len; i++) {
            xx[i] += dx;
            yy[i] += dy;
          }
          arcs.updateArcBounds?.(arcId);
        }
      }
    }

    // Point features: mutate every coordinate pair in the shape array.
    // `normalizePointShape` wraps a legacy bare `[x, y]` in a one-element
    // array, but the inner array is the SAME reference, so the in-place
    // mutation still writes through to the layer's shape storage.
    for (const pf of pointFeatures) {
      const shape = pf.layer.shapes?.[pf.featureId];
      if (!shape) continue;
      for (const coord of normalizePointShape(shape)) {
        if (coord && coord.length >= 2) {
          coord[0] += dx;
          coord[1] += dy;
        }
      }
    }

    source.markDisplayArcsDirty?.();
  }
}
