import type { EditCommand } from '../edit-command';
import { type ArcCollection, type MapshaperLayer } from '../../types/mapshaper-types';
import type { TopologySource } from '../../source/source';
import { applyAffineToFeatures, MERGE_WINDOW_MS } from './_shared';

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

/**
 * Translate a fixed set of arcs and point shapes by `(dx, dy)` in source-data
 * coordinates. Reverses by negating the offset.
 *
 * Lightweight in-place mutation — no dataset replacement, no copy. Cost is
 * O(vertices in the affected arcs + point coords). The same command class
 * handles point-only, path-only, and mixed selections within one source.
 *
 * Mergeable: consecutive translates of the SAME (source, arcIds,
 * pointFeatures) tuple within `MERGE_WINDOW_MS` accumulate their
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
    applyAffineToFeatures(this.opts, { a: 1, b: 0, c: 0, d: 1, tx: dx, ty: dy });
  }
}
