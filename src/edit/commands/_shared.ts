import {
  bumpAttributeVersion,
  bumpEditVersion,
  type ArcCollection,
  type ArcVertexData,
} from '../../types/mapshaper-types';
import type { MapshaperLayer } from '../../types/mapshaper-types';
import { asMutableTopologySource, type TopologySource } from '../../source/source';
import { normalizePointShape } from '../../source/layer-utils';
import type { FeatureRef } from '../../map/types';
import type { Selection, SelectionDiff, SelectionSnapshot } from '../../map/selection';

export function findArcIdForVertex(vertexId: number, data: ArcVertexData): number {
  let low = 0;
  let high = data.ii.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const start = data.ii[mid];
    const end = start + data.nn[mid];
    if (vertexId < start) high = mid - 1;
    else if (vertexId >= end) low = mid + 1;
    else return mid;
  }
  return -1;
}

export function markSourceChanged(source: TopologySource): void {
  const mutableSource = asMutableTopologySource(source);
  mutableSource.markDisplayArcsDirty?.();
  bumpEditVersion(mutableSource.getDataset?.());
}

/** Records-only change: invalidates style resolution, not spatial indexes. */
export function markAttributesChanged(source: TopologySource): void {
  bumpAttributeVersion(asMutableTopologySource(source).getDataset?.());
}

/** Feature count/membership change: geometry AND attribute invalidation. */
export function markShapeCountChanged(source: TopologySource): void {
  markSourceChanged(source);
  markAttributesChanged(source);
}

/** Time window (ms) during which two consecutive merges still coalesce. */
export const MERGE_WINDOW_MS = 500;

/** Fixed target set shared by the in-place geometry-mutation commands. */
export interface AffineFeatureTarget {
  source: TopologySource;
  /** Shared ArcCollection for path features. Omit for point-only commands. */
  arcs?: ArcCollection;
  /** Unique abs-arc-ids referenced by selected path features. */
  arcIds: number[];
  /** Selected point features whose shapes are offset directly. */
  pointFeatures: { layer: MapshaperLayer; featureId: number }[];
}

/** 2x3 affine matrix in SVG/Canvas convention. */
export interface AffineMatrixLike {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

/**
 * Apply an affine transform to a fixed set of arcs and point shapes in
 * place: O(touched-vertices), no dataset replacement, no copy.
 *
 * `normalizePointShape` wraps a legacy bare `[x, y]` in a one-element
 * array, but the inner array is the SAME reference, so the in-place
 * mutation still writes through to the layer's shape storage.
 */
export function applyAffineToFeatures(target: AffineFeatureTarget, m: AffineMatrixLike): void {
  const { arcs, arcIds, pointFeatures, source } = target;
  if (arcs && arcIds.length > 0) {
    const data = arcs.getVertexData?.();
    if (data) {
      const { xx, yy, ii, nn } = data;
      for (const arcId of arcIds) {
        const start = ii[arcId];
        const len = nn[arcId];
        for (let i = start; i < start + len; i++) {
          const x = xx[i];
          const y = yy[i];
          xx[i] = m.a * x + m.c * y + m.tx;
          yy[i] = m.b * x + m.d * y + m.ty;
        }
        arcs.updateArcBounds?.(arcId);
      }
    }
  }
  for (const pf of pointFeatures) {
    const shape = pf.layer.shapes?.[pf.featureId];
    if (!shape) continue;
    for (const coord of normalizePointShape(shape)) {
      if (coord && coord.length >= 2) {
        const x = coord[0];
        const y = coord[1];
        coord[0] = m.a * x + m.c * y + m.tx;
        coord[1] = m.b * x + m.d * y + m.ty;
      }
    }
  }
  markSourceChanged(source);
}

/**
 * The pending-selection-diff contract shared by the selection-aware
 * commands: do() applies the after-selection, undo() restores the
 * before-selection, publish() fires `data` and forwards a changed diff.
 * Both snapshots are cloned — caller arrays may be reused or mutated
 * after construction.
 */
export class SelectionDiffTracker {
  private _pending: SelectionDiff | null = null;
  private readonly _opts: {
    source: TopologySource;
    selection: Selection;
    beforeSelection: SelectionSnapshot;
    afterSelection: FeatureRef[];
    publishSelection: (diff: SelectionDiff) => void;
  };

  constructor(opts: {
    source: TopologySource;
    selection: Selection;
    beforeSelection: SelectionSnapshot;
    afterSelection: FeatureRef[];
    publishSelection: (diff: SelectionDiff) => void;
  }) {
    this._opts = {
      ...opts,
      beforeSelection: new Set(opts.beforeSelection),
      afterSelection: opts.afterSelection.map((ref) => ({ ...ref })),
    };
  }

  applyAfter(): void {
    this._pending = this._opts.selection.apply(this._opts.afterSelection, 'replace');
  }

  restoreBefore(): void {
    this._pending = this._opts.selection.restore(this._opts.beforeSelection);
  }

  publish(reason: 'replace' | 'edit'): void {
    this._opts.source.fire?.('data', { reason });
    if (this._pending?.changed) this._opts.publishSelection(this._pending);
    this._pending = null;
  }
}

/** Fail loudly when a bypassing append/truncate broke the command's arc-count invariant. */
export function assertArcCount(
  label: string,
  arcs: ArcCollection,
  expected: number,
  phase: 'do' | 'undo',
): void {
  if (arcs.size() !== expected) {
    throw new Error(`${label}: expected ${expected} arcs before ${phase}(), found ${arcs.size()}`);
  }
}
