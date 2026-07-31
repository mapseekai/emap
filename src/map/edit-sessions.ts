// Edit-session methods (translate/affine cursor-drag, rotate, scale).
// Composed onto Emap as `emap.editSession`.

import { CompositeCommand } from '../edit/commands/composite';
import {
  FeatureTranslateCommand,
  type TranslatedPointFeature,
} from '../edit/commands/feature-translate';
import {
  FeatureAffineCommand,
  type AffineMatrix,
  rotateMatrix,
  scaleMatrix,
  composeMatrix,
  invertMatrix,
  IDENTITY_MATRIX,
} from '../edit/commands/feature-affine';
import { SplitSharedArcsCommand, planSharedArcSplit } from '../edit/commands/split-shared-arcs';
import { SplitSharedNodeCommand, planSharedNodeSplit } from '../edit/commands/split-shared-node';
import type { EditCommand } from '../edit/edit-command';
import type { MutableTopologySource } from '../source/source';
import type { MapshaperLayer } from '../types/mapshaper-types';
import { normalizePointShape } from '../source/layer-utils';
import type { EmapHostInternal } from './emap-host';
import { Err, OK, type OpResult } from './op-result';
import type {
  DragSessionOptions,
  FeatureAffineSession,
  FeatureRef,
  FeatureTranslateSession,
} from './types';

/**
 * Selection-editing manager. Owned by Emap and exposed as `emap.editSession`.
 * Provides translate / rotate / scale operations on the current selection
 * plus the live "drag" sessions (see {@link FeatureTranslateSession}).
 */
export class EditSessions {
  constructor(private _emap: EmapHostInternal) {}

  splitSharedNode(ref: FeatureRef, vertexId: number): number[] | null {
    const source = this._emap._sources.get(ref.source);
    const layer = this._emap.layers.resolve(ref.source, ref.layer);
    if (!source || !layer) return null;
    const plan = planSharedNodeSplit(
      source,
      layer,
      ref.id,
      vertexId,
      source.getLayers() as MapshaperLayer[],
    );
    if (!plan) return null;

    if (plan.appendedArcs.length > 0) {
      const command = new SplitSharedNodeCommand(plan);
      command.do();
      this._emap._history.push(command);
      this._emap._fireHistoryChange();
      this._emap._invalidateShapeCachesForSources([ref.source]);
      this._emap._scheduleRender();
    }
    return plan.detachedVertexIds.slice();
  }

  translateSelected(dx: number, dy: number): OpResult {
    if (dx === 0 && dy === 0) return Err.validation('offset', 'dx and dy are both 0 (no-op)');
    const refs = this._emap._selection.getAll();
    if (refs.length === 0) return Err.validation('selection', 'selection is empty');

    // Group selection by source, collecting unique abs-arc-ids (for path
    // features) and (layer, featureId) pairs (for point features).
    const bySource = new globalThis.Map<
      string,
      {
        arcIdSet: Set<number>;
        pointFeatures: TranslatedPointFeature[];
      }
    >();

    for (const ref of refs) {
      const layer = this._emap.layers.resolve(ref.source, ref.layer);
      if (!layer?.shapes) continue;
      const shape = layer.shapes[ref.id];
      if (!shape) continue;

      let bucket = bySource.get(ref.source);
      if (!bucket) {
        bucket = { arcIdSet: new Set<number>(), pointFeatures: [] };
        bySource.set(ref.source, bucket);
      }

      if (layer.geometry_type === 'point') {
        bucket.pointFeatures.push({ layer, featureId: ref.id });
      } else {
        // Path feature: shape is a list of parts, each part is a list of
        // signed arc ids. Negative ids encode reversed direction; abs them.
        const pathShape = shape as import('../types/mapshaper-types').PathShape;
        for (const part of pathShape) {
          if (!Array.isArray(part)) continue;
          for (const rawArcId of part) {
            if (typeof rawArcId !== 'number') continue;
            bucket.arcIdSet.add(rawArcId >= 0 ? rawArcId : ~rawArcId);
          }
        }
      }
    }

    if (bySource.size === 0)
      return Err.validation('selection', 'no resolvable layers in selection');

    const children: EditCommand[] = [];
    const editedSourceIds: string[] = [];
    for (const [sourceId, bucket] of bySource) {
      const source = this._emap._sources.get(sourceId);
      if (!source) continue;
      if (bucket.arcIdSet.size === 0 && bucket.pointFeatures.length === 0) continue;

      const cmd = new FeatureTranslateCommand({
        source,
        arcs: source.getArcs(),
        dx,
        dy,
        arcIds: Array.from(bucket.arcIdSet),
        pointFeatures: bucket.pointFeatures,
      });
      cmd.do();
      children.push(cmd);
      editedSourceIds.push(sourceId);
    }

    if (children.length === 0) return Err.validation('selection', 'every resolved layer was empty');

    const pushed: EditCommand =
      children.length === 1
        ? children[0]
        : new CompositeCommand(children, `Translate ${refs.length} features`);
    this._emap._history.push(pushed);
    this._emap._fireHistoryChange();
    this._emap._clearSpatialIndexesForSources(editedSourceIds);
    this._emap._scheduleRender();
    return OK;
  }

  /**
   * Begin a translate "drag session" against the current selection.
   *
   * The session lets a UI animate a translate (e.g. follow the cursor)
   * without spamming the undo stack with one entry per mousemove. Geometry
   * mutates on every `move(dx, dy)`; only `commit()` pushes a single
   * cumulative `FeatureTranslateCommand` (or `CompositeCommand`) to history.
   * `cancel()` rolls the geometry back to the pre-session state and
   * pushes nothing.
   *
   * Returns `null` when the selection is empty. The session captures the
   * selection at start time — concurrent edits to the selection during
   * a drag are intentionally ignored.
   */
  /**
   * Shared scaffolding for translate/affine sessions: groups the active
   * selection by source into buckets of `(arcIds, pointFeatures)`, and
   * (when `splitShared` is true) duplicates any arc shared with an
   * unselected feature so the drag doesn't drag the neighbour along.
   *
   * Returns `null` for an empty / fully-resolved-empty selection. The
   * returned `splitCmds` have already been `do()`-applied; the caller
   * must push them onto a composite at commit and call `undo()` on
   * cancel.
   */
  _buildSelectionBuckets(splitShared: boolean): {
    buckets: Array<{
      sourceId: string;
      source: MutableTopologySource;
      arcIds: number[];
      pointFeatures: TranslatedPointFeature[];
    }>;
    splitCmds: SplitSharedArcsCommand[];
  } | null {
    type Bucket = {
      sourceId: string;
      source: MutableTopologySource;
      arcIds: number[];
      pointFeatures: TranslatedPointFeature[];
      pathFeatures: Array<{ layer: MapshaperLayer; featureId: number }>;
    };

    const refs = this._emap._selection.getAll();
    if (refs.length === 0) return null;

    // First pass: classify selected refs into path / point per source.
    // We DON'T compute arcIds yet — those need to wait until after the
    // optional shared-arc split rewrites the shapes.
    const bySource = new globalThis.Map<string, Bucket>();
    for (const ref of refs) {
      const layer = this._emap.layers.resolve(ref.source, ref.layer);
      if (!layer?.shapes) continue;
      const shape = layer.shapes[ref.id];
      if (!shape) continue;
      const source = this._emap._sources.get(ref.source);
      if (!source) continue;

      let bucket = bySource.get(ref.source);
      if (!bucket) {
        bucket = {
          sourceId: ref.source,
          source,
          arcIds: [],
          pointFeatures: [],
          pathFeatures: [],
        };
        bySource.set(ref.source, bucket);
      }

      if (layer.geometry_type === 'point') {
        bucket.pointFeatures.push({ layer, featureId: ref.id });
      } else {
        bucket.pathFeatures.push({ layer, featureId: ref.id });
      }
    }

    if (bySource.size === 0) return null;

    // Optional shared-arc split per source. Plan reads the dataset's
    // layers, the command's `do()` appends new arcs and rewrites the
    // selected features' shape arrays in place.
    const splitCmds: SplitSharedArcsCommand[] = [];
    if (splitShared) {
      for (const bucket of bySource.values()) {
        if (bucket.pathFeatures.length === 0) continue;
        const plan = planSharedArcSplit(
          bucket.source,
          bucket.pathFeatures,
          bucket.source.getLayers() as MapshaperLayer[],
        );
        if (!plan) continue;
        const cmd = new SplitSharedArcsCommand(plan);
        cmd.do();
        splitCmds.push(cmd);
        // Splitting appended new arcs onto the ArcCollection — the
        // line-layer arc-flag cache is sized for the OLD arc count and
        // will mis-treat the new ids as "not in this layer", silently
        // dropping the duplicated boundaries from the line render.
        this._emap._invalidateShapeCachesForSources([bucket.sourceId]);
      }
    }

    // Second pass: now compute arcIds from the (possibly rewritten) shapes.
    // pathFeatures are pre-filtered to non-point layers, so the shape is a
    // PathShape (list of parts of signed arc ids).
    for (const bucket of bySource.values()) {
      const seen = new Set<number>();
      for (const pf of bucket.pathFeatures) {
        const shape = pf.layer.shapes?.[pf.featureId] as
          | import('../types/mapshaper-types').PathShape
          | null
          | undefined;
        if (!shape) continue;
        for (const part of shape) {
          if (!Array.isArray(part)) continue;
          for (const raw of part) {
            if (typeof raw !== 'number') continue;
            const abs = raw >= 0 ? raw : ~raw;
            if (!seen.has(abs)) {
              seen.add(abs);
              bucket.arcIds.push(abs);
            }
          }
        }
      }
    }

    const buckets = Array.from(bySource.values()).map((b) => ({
      sourceId: b.sourceId,
      source: b.source,
      arcIds: b.arcIds,
      pointFeatures: b.pointFeatures,
    }));
    return { buckets, splitCmds };
  }

  beginTranslateSession(opts?: DragSessionOptions): FeatureTranslateSession | null {
    const built = this._buildSelectionBuckets(opts?.splitSharedArcs !== false);
    if (!built) return null;
    const { buckets, splitCmds } = built;
    let accumDx = 0;
    let accumDy = 0;
    let closed = false;

    const applyStep = (dx: number, dy: number) => {
      for (const b of buckets) {
        if (b.arcIds.length === 0 && b.pointFeatures.length === 0) continue;
        new FeatureTranslateCommand({
          source: b.source,
          arcs: b.source.getArcs(),
          dx,
          dy,
          arcIds: b.arcIds,
          pointFeatures: b.pointFeatures,
        }).do();
      }
    };

    return {
      move: (dx: number, dy: number) => {
        if (closed) return;
        if (dx === 0 && dy === 0) return;
        applyStep(dx, dy);
        accumDx += dx;
        accumDy += dy;
        this._emap._scheduleRender();
      },
      commit: (): boolean => {
        if (closed) return false;
        closed = true;
        const moved = !(accumDx === 0 && accumDy === 0);
        // If the user opened a session, didn't drag, and committed: roll
        // any split-shared-arcs work back. Splitting alone with no visible
        // movement isn't worth a history entry.
        if (!moved) {
          for (let i = splitCmds.length - 1; i >= 0; i--) splitCmds[i].undo();
          if (splitCmds.length > 0) this._emap._scheduleRender();
          return false;
        }
        // Geometry already moved by `move()` calls; build one cumulative
        // command and push it WITHOUT calling `.do()` — the post-do state
        // is already live. `undo` will subtract the cumulative offset,
        // `redo` re-applies it.
        const translateChildren: EditCommand[] = buckets.map(
          (b: any) =>
            new FeatureTranslateCommand({
              source: b.source,
              arcs: b.source.getArcs(),
              dx: accumDx,
              dy: accumDy,
              arcIds: b.arcIds,
              pointFeatures: b.pointFeatures,
            }),
        );
        const total = buckets.reduce(
          (n: number, b: any) => n + b.arcIds.length + b.pointFeatures.length,
          0,
        );
        // Splits go FIRST in the composite so undo runs translate.undo()
        // (subtract offset on the duplicated arcs) before split.undo()
        // (truncate duplicates + restore original shape refs).
        const children: EditCommand[] = [...splitCmds, ...translateChildren];
        const pushed: EditCommand =
          children.length === 1
            ? children[0]
            : new CompositeCommand(children, `Translate ${total} features`);
        this._emap._history.push(pushed);
        this._emap._fireHistoryChange();
        // `_invalidateShapeCachesForSources` covers both the arc-flag cache
        // (relevant when a split appended new arcs) and the spatial index.
        this._emap._invalidateShapeCachesForSources(buckets.map((b: any) => b.sourceId));
        this._emap._scheduleRender();
        return true;
      },
      cancel: () => {
        if (closed) return;
        closed = true;
        // Reverse the translate first (on duplicated arcs), then reverse
        // the splits in LIFO order — each undo sees the state its do() left.
        if (accumDx !== 0 || accumDy !== 0) applyStep(-accumDx, -accumDy);
        for (let i = splitCmds.length - 1; i >= 0; i--) splitCmds[i].undo();
        accumDx = 0;
        accumDy = 0;
        if (splitCmds.length > 0) {
          this._emap._invalidateShapeCachesForSources(buckets.map((b: any) => b.sourceId));
        }
        this._emap._scheduleRender();
      },
      getAccumulated: (): [number, number] => [accumDx, accumDy],
    };
  }

  /**
   * Begin a rotate / scale / arbitrary-affine "drag session" against the
   * current selection. Same one-history-entry-per-drag semantics as
   * {@link beginTranslateSession}, but the per-frame delta is an arbitrary
   * affine matrix (typically `rotateMatrix(theta, ox, oy)` or
   * `scaleMatrix(sx, sy, ox, oy)` with the session's `origin`).
   *
   * The pivot is captured at session start: pass `origin` explicitly or let
   * it default to the selection bbox centroid. Subsequent matrices should
   * use the same pivot; otherwise the cumulative composed matrix on commit
   * won't match the visually applied sequence.
   */
  beginAffineSession(
    this: any,
    origin?: [number, number],
    opts?: DragSessionOptions,
  ): FeatureAffineSession | null {
    const built = this._buildSelectionBuckets(opts?.splitSharedArcs !== false);
    if (!built) return null;
    const { buckets, splitCmds } = built;

    // Pivot. Same default as `_applyAffineToSelection`: bbox centroid of
    // every vertex the transform will touch.
    let ox: number;
    let oy: number;
    if (origin) {
      [ox, oy] = origin;
    } else {
      const centroidInput = new globalThis.Map<
        string,
        { arcIdSet: Set<number>; pointFeatures: TranslatedPointFeature[] }
      >();
      for (const b of buckets) {
        centroidInput.set(b.sourceId, {
          arcIdSet: new Set(b.arcIds),
          pointFeatures: b.pointFeatures,
        });
      }
      const centroid = this._computeSelectionCentroid(centroidInput);
      if (!centroid) {
        // Roll back any speculative split before bailing out.
        for (let i = splitCmds.length - 1; i >= 0; i--) splitCmds[i].undo();
        return null;
      }
      [ox, oy] = centroid;
    }
    if (!Number.isFinite(ox) || !Number.isFinite(oy)) {
      for (let i = splitCmds.length - 1; i >= 0; i--) splitCmds[i].undo();
      return null;
    }
    const pivot: [number, number] = [ox, oy];

    let cumulative: AffineMatrix = { ...IDENTITY_MATRIX };
    let closed = false;

    const isIdentity = (m: AffineMatrix): boolean =>
      m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.tx === 0 && m.ty === 0;

    const applyMatrix = (matrix: AffineMatrix) => {
      for (const b of buckets) {
        if (b.arcIds.length === 0 && b.pointFeatures.length === 0) continue;
        new FeatureAffineCommand({
          source: b.source,
          arcs: b.source.getArcs(),
          matrix,
          arcIds: b.arcIds,
          pointFeatures: b.pointFeatures,
        }).do();
      }
    };

    return {
      origin: pivot,
      applyDelta: (matrix: AffineMatrix) => {
        if (closed) return;
        if (isIdentity(matrix)) return;
        applyMatrix(matrix);
        // Cumulative is "delta · cumulative" — newer transforms apply
        // after older ones, matching the visual sequence above.
        cumulative = composeMatrix(matrix, cumulative);
        this._emap._scheduleRender();
      },
      commit: (label?: string): boolean => {
        if (closed) return false;
        closed = true;
        if (isIdentity(cumulative)) {
          // No movement — undo any speculative split so we don't pollute
          // the dataset with orphan duplicated arcs and a pointless entry.
          for (let i = splitCmds.length - 1; i >= 0; i--) splitCmds[i].undo();
          if (splitCmds.length > 0) this._emap._scheduleRender();
          return false;
        }
        const totalFeatures = buckets.reduce(
          (n: number, b: any) => n + b.arcIds.length + b.pointFeatures.length,
          0,
        );
        const affineChildren: EditCommand[] = buckets.map(
          (b: any) =>
            new FeatureAffineCommand({
              source: b.source,
              arcs: b.source.getArcs(),
              matrix: cumulative,
              arcIds: b.arcIds,
              pointFeatures: b.pointFeatures,
              label,
            }),
        );
        // Splits FIRST so undo runs affine.undo() (apply matrix^-1 on the
        // duplicated arcs) before split.undo() (truncate + restore shapes).
        const children: EditCommand[] = [...splitCmds, ...affineChildren];
        const pushed: EditCommand =
          children.length === 1
            ? children[0]
            : new CompositeCommand(
                children,
                label ?? `Transform ${totalFeatures} feature${totalFeatures === 1 ? '' : 's'}`,
              );
        this._emap._history.push(pushed);
        this._emap._fireHistoryChange();
        // `_invalidateShapeCachesForSources` covers both the arc-flag cache
        // (relevant when a split appended new arcs) and the spatial index.
        this._emap._invalidateShapeCachesForSources(buckets.map((b: any) => b.sourceId));
        this._emap._scheduleRender();
        return true;
      },
      cancel: () => {
        if (closed) return;
        closed = true;
        // Reverse the affine first, then the splits in LIFO order.
        if (!isIdentity(cumulative)) applyMatrix(invertMatrix(cumulative));
        for (let i = splitCmds.length - 1; i >= 0; i--) splitCmds[i].undo();
        cumulative = { ...IDENTITY_MATRIX };
        if (splitCmds.length > 0) {
          this._emap._invalidateShapeCachesForSources(buckets.map((b: any) => b.sourceId));
        }
        this._emap._scheduleRender();
      },
      getCumulative: (): AffineMatrix => ({ ...cumulative }),
    };
  }

  /**
   * Rotate every selected feature around `origin` by `angleDegrees`.
   * Default `origin` is the bbox centroid of the affected vertices.
   *
   * Lightweight in-place transform on the same path as `translateSelected`:
   * not a history barrier, selection survives, multi-source selections wrap
   * in a `CompositeCommand`. Returns `false` for empty selection or zero
   * angle.
   */
  rotateSelected(angleDegrees: number, origin?: [number, number]): OpResult {
    if (angleDegrees === 0) return Err.validation('angleDegrees', 'angle is 0 (no-op)');
    const angleRad = (angleDegrees * Math.PI) / 180;
    return this._applyAffineToSelection(
      (ox: number, oy: number) => rotateMatrix(angleRad, ox, oy),
      origin,
      (n: number) => `Rotate ${n} feature${n === 1 ? '' : 's'}`,
    );
  }

  /**
   * Scale every selected feature by `(sx, sy)` around `origin`.
   * `sy` defaults to `sx` (uniform scale). Default `origin` is the bbox
   * centroid of the affected vertices.
   */
  scaleSelected(sx: number, sy?: number, origin?: [number, number]): OpResult {
    const sX = sx;
    const sY = sy ?? sx;
    if (sX === 1 && sY === 1) return Err.validation('scale', 'sx and sy are both 1 (no-op)');
    return this._applyAffineToSelection(
      (ox: number, oy: number) => scaleMatrix(sX, sY, ox, oy),
      origin,
      (n: number) => `Scale ${n} feature${n === 1 ? '' : 's'}`,
    );
  }

  /**
   * Shared scaffolding for rotate / scale: walks the current selection,
   * groups by source, computes the bbox centroid (when no origin supplied),
   * builds one `FeatureAffineCommand` per source, and pushes either the
   * single command or a `CompositeCommand` wrapping all sources.
   */
  _applyAffineToSelection(
    this: any,
    matrixForOrigin: (ox: number, oy: number) => AffineMatrix,
    origin: [number, number] | undefined,
    labelFor: (totalFeatures: number) => string,
  ): OpResult {
    const refs = this._emap._selection.getAll();
    if (refs.length === 0) return Err.validation('selection', 'selection is empty');

    const bySource = new globalThis.Map<
      string,
      {
        arcIdSet: Set<number>;
        pointFeatures: TranslatedPointFeature[];
      }
    >();

    for (const ref of refs) {
      const layer = this._emap.layers.resolve(ref.source, ref.layer);
      if (!layer?.shapes) continue;
      const shape = layer.shapes[ref.id];
      if (!shape) continue;

      let bucket = bySource.get(ref.source);
      if (!bucket) {
        bucket = { arcIdSet: new Set<number>(), pointFeatures: [] };
        bySource.set(ref.source, bucket);
      }

      if (layer.geometry_type === 'point') {
        bucket.pointFeatures.push({ layer, featureId: ref.id });
      } else {
        // Non-point layers: shape is a PathShape (parts of signed arc ids).
        const pathShape = shape as import('../types/mapshaper-types').PathShape;
        for (const part of pathShape) {
          if (!Array.isArray(part)) continue;
          for (const rawArcId of part) {
            if (typeof rawArcId !== 'number') continue;
            bucket.arcIdSet.add(rawArcId >= 0 ? rawArcId : ~rawArcId);
          }
        }
      }
    }

    if (bySource.size === 0) {
      return Err.validation('selection', 'no resolvable layers in selection');
    }

    // Default origin = bbox centroid of every vertex the transform will
    // touch. Picked once and reused across all per-source commands so
    // multi-source selections rotate / scale around a single shared pivot.
    let ox: number;
    let oy: number;
    if (origin) {
      ox = origin[0];
      oy = origin[1];
    } else {
      const centroid = this._computeSelectionCentroid(bySource);
      if (!centroid) {
        return Err.validation('origin', 'no vertices in selection; cannot compute centroid');
      }
      [ox, oy] = centroid;
    }

    if (!Number.isFinite(ox) || !Number.isFinite(oy)) {
      return Err.validation('origin', 'computed origin is not finite');
    }

    const matrix = matrixForOrigin(ox, oy);

    const children: EditCommand[] = [];
    const editedSourceIds: string[] = [];
    for (const [sourceId, bucket] of bySource) {
      const source = this._emap._sources.get(sourceId);
      if (!source) continue;
      if (bucket.arcIdSet.size === 0 && bucket.pointFeatures.length === 0) continue;

      const cmd = new FeatureAffineCommand({
        source,
        arcs: source.getArcs(),
        matrix,
        arcIds: Array.from(bucket.arcIdSet),
        pointFeatures: bucket.pointFeatures,
      });
      cmd.do();
      children.push(cmd);
      editedSourceIds.push(sourceId);
    }

    if (children.length === 0) {
      return Err.validation('selection', 'every resolved layer was empty');
    }

    const pushed: EditCommand =
      children.length === 1 ? children[0] : new CompositeCommand(children, labelFor(refs.length));
    this._emap._history.push(pushed);
    this._emap._fireHistoryChange();
    this._emap._clearSpatialIndexesForSources(editedSourceIds);
    this._emap._scheduleRender();
    return OK;
  }

  /**
   * Compute the bbox centroid of every vertex the bySource buckets reference
   * (across path-feature arcs and point-feature shapes). Returns `null` when
   * no vertex was found (e.g., empty arcs).
   */
  _computeSelectionCentroid(
    this: any,
    bySource: globalThis.Map<
      string,
      { arcIdSet: Set<number>; pointFeatures: TranslatedPointFeature[] }
    >,
  ): [number, number] | null {
    let xmin = Infinity,
      ymin = Infinity;
    let xmax = -Infinity,
      ymax = -Infinity;
    let any = false;

    for (const [sourceId, bucket] of bySource) {
      const source = this._emap._sources.get(sourceId);
      if (!source) continue;

      // Path features: walk the affected arcs' xx/yy slices.
      const arcs = source.getArcs();
      const data = arcs?.getVertexData?.();
      if (data && bucket.arcIdSet.size > 0) {
        const { xx, yy, ii, nn } = data;
        for (const arcId of bucket.arcIdSet) {
          const start = ii[arcId];
          const len = nn[arcId];
          for (let i = start; i < start + len; i++) {
            const x = xx[i];
            const y = yy[i];
            if (x < xmin) xmin = x;
            if (x > xmax) xmax = x;
            if (y < ymin) ymin = y;
            if (y > ymax) ymax = y;
            any = true;
          }
        }
      }

      // Point features: walk each shape's coords.
      for (const pf of bucket.pointFeatures) {
        const shape = pf.layer.shapes?.[pf.featureId];
        if (!shape) continue;
        for (const coord of normalizePointShape(shape)) {
          if (!coord || coord.length < 2) continue;
          const x = coord[0];
          const y = coord[1];
          if (x < xmin) xmin = x;
          if (x > xmax) xmax = x;
          if (y < ymin) ymin = y;
          if (y > ymax) ymax = y;
          any = true;
        }
      }
    }

    if (!any) return null;
    return [(xmin + xmax) / 2, (ymin + ymax) / 2];
  }
}
