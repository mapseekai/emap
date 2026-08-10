import type { Handler, HandlerResult, NormalizedPointerEvent } from '../handler';
import type { SnapKind } from '../../map/types';
import { getLayerId } from '../../source/layer-utils';
import { FeatureCreateCommand } from '../../edit/commands/feature-create';
import type { MapshaperLayer, ArcCollection } from '../../types/mapshaper-types';
import type { EditHandlerHost } from './edit-handler-host';
import { EMAP_THEME_COLORS } from '../../theme/colors';

export type DrawGeometryType = 'polygon' | 'polyline' | 'point';

export interface DrawFeatureOptions {
  /** Target source ID where new features will be added */
  source: string;
  /** Target layer name within the source (optional, defaults to first matching geometry layer) */
  sourceLayer?: string;
  /** Geometry type to draw */
  type: DrawGeometryType;
  /** Pixel threshold for vertex snapping (default: 10) */
  snapThreshold?: number;
  /**
   * Sources to snap against. Defaults to `[options.source]` so the existing
   * single-source behaviour is preserved when omitted. Pass `['a', 'b']` to
   * also snap onto another source (e.g. drawing in source A while tracing
   * along reference data in source B).
   */
  snapSources?: string[];
  /** Enable vertex snap (default `true`). */
  snapToVertex?: boolean;
  /**
   * Enable edge snap — perpendicular projection onto an arc segment
   * (default `true`). Disable to restrict snap to existing vertices only.
   */
  snapToEdge?: boolean;
  /** CSS color for the drawing line (default: `EMAP_THEME_COLORS.primary`) */
  drawColor?: string;
}

/** Pixel threshold for vertex snapping */
const DEFAULT_SNAP_THRESHOLD = 10;

/** Pixel threshold for closing a polygon by clicking first vertex */
const CLOSE_THRESHOLD = 12;

export class DrawFeatureHandler implements Handler<DrawFeatureOptions> {
  readonly name = 'drawFeature';
  private readonly _map: EditHandlerHost;
  private _enabled = false;
  private _opts: DrawFeatureOptions;
  /** Injected by HandlerManager.register (cursor recompute on mode flips). */
  _manager?: { refreshCursor(): void };

  // Drawing state
  private _vertices: [number, number][] = [];
  private _cursorCoord: [number, number] | null = null;
  private _snapCoord: [number, number] | null = null;
  private _snapKind: SnapKind = null;
  private _snapThreshold: number;

  private _onMapMoveBound = () => this._onMapMove();
  private _onKeyDownBound = (e: KeyboardEvent) => this._onKeyDown(e);

  constructor(map: EditHandlerHost, opts?: Partial<DrawFeatureOptions>) {
    this._map = map;
    this._opts = { ...(opts ?? {}) } as DrawFeatureOptions;
    this._snapThreshold = this._opts.snapThreshold ?? DEFAULT_SNAP_THRESHOLD;

    this._map.on('editmodechange', (e: { mode: string }) => {
      if (e.mode !== 'draw' && this._enabled) this._quietDisable();
    });
  }

  isEnabled(): boolean {
    return this._enabled;
  }

  setOptions(o: Partial<DrawFeatureOptions>): void {
    this._opts = { ...this._opts, ...o };
    if (o.snapThreshold !== undefined) this._snapThreshold = o.snapThreshold;
  }

  getCursor(): string | null {
    return this._enabled ? 'crosshair' : null;
  }

  getOptions(): Readonly<DrawFeatureOptions> {
    return { ...this._opts };
  }

  enable(): void {
    if (this._enabled) return;
    if (!this._opts.source || !this._opts.type) {
      throw new Error('drawFeature: source+type required; call setOptions({source,type}) first');
    }
    this._enabled = true;
    this._map.setEditMode('draw');
    window.addEventListener('keydown', this._onKeyDownBound);
    this._map.on('move', this._onMapMoveBound);
    this._manager?.refreshCursor();
  }

  disable(): void {
    if (!this._enabled) return;
    this._enabled = false;
    this._clearDrawState();
    window.removeEventListener('keydown', this._onKeyDownBound);
    this._map.off('move', this._onMapMoveBound);
    this._map.setEditMode('none');
    this._map.clearEditDrawState();
    this._manager?.refreshCursor();
    this._map.render();
  }

  private _quietDisable(): void {
    this._enabled = false;
    window.removeEventListener('keydown', this._onKeyDownBound);
    this._map.off('move', this._onMapMoveBound);
    this._map.clearEditDrawState();
    this._manager?.refreshCursor();
    this._map.render();
  }

  handlePointer(ev: NormalizedPointerEvent): HandlerResult {
    if (!this._enabled) return 'passthrough';
    const px = ev.point.x,
      py = ev.point.y;
    if (ev.kind === 'move') {
      this._onMouseMove(px, py);
      return 'passthrough';
    }
    if (ev.kind === 'click') {
      if (ev.button !== 0) return 'passthrough';
      this._onClick(px, py);
      return 'consumed';
    }
    if (ev.kind === 'dblclick') {
      this._onDblClick(ev.originalEvent as MouseEvent);
      return 'consumed';
    }
    return 'passthrough';
  }

  private _onMapMove(): void {
    if (this._vertices.length > 0) {
      this._updateDrawState();
      this._map.render();
    }
  }

  private _onMouseMove(px: number, py: number): void {
    const dataCoord = this._map.unproject(px, py);
    this._cursorCoord = [dataCoord[0], dataCoord[1]];

    // Snap detection — yields a coordinate AND its kind ('vertex' | 'edge')
    const hadSnap = this._snapCoord !== null;
    const snap = this._findSnapTarget(px, py);
    this._snapCoord = snap?.coord ?? null;
    this._snapKind = snap?.kind ?? null;

    if (this._vertices.length > 0 || this._snapCoord || hadSnap) {
      this._updateDrawState();
      this._map.render();
    }
  }

  private _onClick(px: number, py: number): void {
    const coord: [number, number] = this._snapCoord
      ? [this._snapCoord[0], this._snapCoord[1]]
      : this._map.unproject(px, py);

    if (this._opts.type === 'point') {
      this._vertices = [coord];
      this._commitFeature();
      return;
    }

    // For polygon: check if clicking near first vertex to close
    if (this._opts.type === 'polygon' && this._vertices.length >= 3) {
      const firstVtx = this._vertices[0];
      const firstPx = this._map.project(firstVtx[0], firstVtx[1]);
      const dist = Math.hypot(firstPx[0] - px, firstPx[1] - py);
      if (dist <= CLOSE_THRESHOLD) {
        this._commitFeature();
        return;
      }
    }

    this._vertices.push(coord);
    this._updateDrawState();
    this._map.render();
  }

  private _onDblClick(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();

    if (this._opts.type === 'point') return;

    if (this._opts.type === 'polyline' && this._vertices.length >= 2) {
      this._commitFeature();
    } else if (this._opts.type === 'polygon' && this._vertices.length >= 3) {
      this._commitFeature();
    }
  }

  private _onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this._clearDrawState();
      this._map.clearEditDrawState();
      this._map.render();
    }
  }

  // ---------------------------------------------------------------------------
  // Snap detection
  // ---------------------------------------------------------------------------

  private _findSnapTarget(
    px: number,
    py: number,
  ): { coord: [number, number]; kind: SnapKind } | null {
    const map = this._map;
    const sources = this._opts.snapSources ?? [this._opts.source];
    const snapToVertex = this._opts.snapToVertex !== false; // default true
    const snapToEdge = this._opts.snapToEdge !== false; // default true

    // Tracked best across every candidate kind. Vertex wins ties because
    // strict-`<` keeps the earlier match — vertex loop runs before edge.
    let bestDist = this._snapThreshold;
    let bestCoord: [number, number] | null = null;
    let bestKind: SnapKind = null;

    // Build a world-space bbox of size +/-snapThreshold around the cursor so the
    // inner loops can reject the 99% of vertices/segments that can't possibly
    // win, without paying for project()/hypot() on each. Unproject two
    // opposite corners and take min/max; this handles Y-flip and non-uniform
    // scaling safely.
    const T = this._snapThreshold;
    const c0 = map.unproject(px - T, py - T);
    const c1 = map.unproject(px + T, py + T);
    const wMinX = Math.min(c0[0], c1[0]);
    const wMaxX = Math.max(c0[0], c1[0]);
    const wMinY = Math.min(c0[1], c1[1]);
    const wMaxY = Math.max(c0[1], c1[1]);

    for (const sourceId of sources) {
      const src = map.getSource(sourceId);
      if (!src) continue;
      const arcs = src.getArcs() as ArcCollection | undefined;
      if (!arcs?.getVertexData) continue;
      const vd = arcs.getVertexData();
      if (!vd) continue;
      const xx = vd.xx;
      const yy = vd.yy;

      if (snapToVertex) {
        for (let i = 0; i < xx.length; i++) {
          const x = xx[i];
          const y = yy[i];
          if (x < wMinX || x > wMaxX || y < wMinY || y > wMaxY) continue;
          const projected = map.project(x, y);
          const dist = Math.hypot(projected[0] - px, projected[1] - py);
          if (dist < bestDist) {
            bestDist = dist;
            bestCoord = [x, y];
            bestKind = 'vertex';
          }
        }
      }

      if (snapToEdge && arcs.forEachSegment) {
        // Walk every arc segment. forEachSegment yields adjacent vertex
        // index pairs (i, j) within an arc — never crosses arc boundaries,
        // so we don't accidentally treat unrelated arcs as connected.
        arcs.forEachSegment((i: number, j: number, arcXx: Float64Array, arcYy: Float64Array) => {
          const ax = arcXx[i],
            ay = arcYy[i];
          const bx = arcXx[j],
            by = arcYy[j];
          // Segment AABB vs cursor bbox; reject if disjoint.
          const sMinX = ax < bx ? ax : bx;
          const sMaxX = ax < bx ? bx : ax;
          const sMinY = ay < by ? ay : by;
          const sMaxY = ay < by ? by : ay;
          if (sMaxX < wMinX || sMinX > wMaxX || sMaxY < wMinY || sMinY > wMaxY) return;
          const a = map.project(ax, ay);
          const b = map.project(bx, by);
          const r = projectPointOnSegment([px, py], a, b);
          if (r.dist < bestDist) {
            bestDist = r.dist;
            // Convert pixel-space closest point back to map coords.
            bestCoord = map.unproject(r.point[0], r.point[1]);
            bestKind = 'edge';
          }
        });
      }
    }

    // Snap to already-placed vertices in the in-progress drawing. Always
    // treated as 'vertex' regardless of the snapToEdge setting.
    if (snapToVertex) {
      for (const v of this._vertices) {
        const projected = map.project(v[0], v[1]);
        const dist = Math.hypot(projected[0] - px, projected[1] - py);
        if (dist < bestDist) {
          bestDist = dist;
          bestCoord = [v[0], v[1]];
          bestKind = 'vertex';
        }
      }
    }

    if (!bestCoord) return null;
    return { coord: bestCoord, kind: bestKind };
  }

  // ---------------------------------------------------------------------------
  // Commit feature to source
  // ---------------------------------------------------------------------------

  private _commitFeature(): void {
    if (this._vertices.length === 0) return;

    const source = this._map.getSource(this._opts.source);
    if (!source) return;

    const dataset = source.getDataset();
    if (!dataset) return;

    const layer = this._resolveTargetLayer(dataset.layers);
    if (!layer) return;
    const layerIndex = dataset.layers.indexOf(layer);

    if (!layer.shapes) {
      layer.shapes = [];
    }

    let appendedShape: any[];
    let arcVertices: [number, number][] | undefined;
    let arcs: ArcCollection | undefined;

    if (this._opts.type === 'point') {
      appendedShape = [this._vertices[0]];
      layer.shapes.push(appendedShape);
    } else {
      // Polyline or polygon: create new arc
      arcVertices =
        this._opts.type === 'polygon'
          ? [...this._vertices, this._vertices[0]]
          : [...this._vertices];

      arcs = dataset.arcs;
      if (!arcs) {
        // Should not happen for topology sources with data, but guard
        return;
      }

      const newArcId = this._appendArc(arcs, arcVertices);
      appendedShape = [[newArcId]];
      layer.shapes.push(appendedShape);
    }

    // Add empty record to data table
    let appendedRecord: Record<string, unknown> | null = null;
    if (layer.data) {
      const records = layer.data.getRecords?.();
      if (records) {
        appendedRecord = {};
        records.push(appendedRecord);
      }
    }

    // Re-initialize display arcs for LOD so the filtered copy includes the new arc
    source.refreshDisplayArcs();

    // Record the creation as an undoable step.
    this._map.pushCommand(
      new FeatureCreateCommand({
        geometryType: this._opts.type,
        layer,
        source,
        appendedShape,
        appendedRecord,
        arcVertices,
        arcs,
      }),
    );

    const featureId = layer.shapes.length - 1;
    const layerId = getLayerId(layer, layerIndex >= 0 ? layerIndex : 0);

    this._map.fire('feature_created', {
      id: featureId,
      source: this._opts.source,
      layer: layerId,
      geometryType: this._opts.type,
      properties: {},
    });

    // Clear drawing state and trigger re-render via source data event
    this._clearDrawState();
    this._map.clearEditDrawState();
    source.fire('data', { reason: 'edit' });
  }

  private _resolveTargetLayer(layers: MapshaperLayer[]): MapshaperLayer | null {
    if (!layers.length) return null;

    if (this._opts.sourceLayer) {
      for (let i = 0; i < layers.length; i++) {
        const lid = getLayerId(layers[i], i);
        if (lid === this._opts.sourceLayer) return layers[i];
      }
    }

    // Find first layer matching the geometry type
    const mapshaperType =
      this._opts.type === 'polygon'
        ? 'polygon'
        : this._opts.type === 'polyline'
          ? 'polyline'
          : 'point';
    for (const layer of layers) {
      if (layer.geometry_type === mapshaperType) return layer;
    }

    // Fallback to first layer
    return layers[0];
  }

  private _appendArc(arcs: ArcCollection, vertices: [number, number][]): number {
    const vd = (arcs as any).getVertexData();
    const oldXX: Float64Array = vd.xx;
    const oldYY: Float64Array = vd.yy;
    const oldNN: Uint32Array | Int32Array = vd.nn;
    const oldZZ: Float64Array | null = vd.zz;
    const oldPointCount = oldXX.length;
    const oldArcCount = oldNN.length;
    const newPointCount = vertices.length;

    const newXX = new Float64Array(oldPointCount + newPointCount);
    const newYY = new Float64Array(oldPointCount + newPointCount);
    const newNN = new Int32Array(oldArcCount + 1);

    newXX.set(oldXX);
    newYY.set(oldYY);
    newNN.set(oldNN);

    for (let i = 0; i < newPointCount; i++) {
      newXX[oldPointCount + i] = vertices[i][0];
      newYY[oldPointCount + i] = vertices[i][1];
    }
    newNN[oldArcCount] = newPointCount;

    // zz array (simplification thresholds) — fill with Infinity (always visible)
    let newZZ: Float64Array | null = null;
    if (oldZZ) {
      newZZ = new Float64Array(oldPointCount + newPointCount);
      newZZ.set(oldZZ);
      for (let i = 0; i < newPointCount; i++) {
        newZZ[oldPointCount + i] = Infinity;
      }
    }

    (arcs as any).updateVertexData(newNN, newXX, newYY, newZZ);

    return oldArcCount;
  }

  // ---------------------------------------------------------------------------
  // Draw state for rendering
  // ---------------------------------------------------------------------------

  private _updateDrawState(): void {
    this._map.setEditDrawState({
      vertices: [...this._vertices],
      cursorCoord: this._snapCoord || this._cursorCoord,
      snapCoord: this._snapCoord,
      snapKind: this._snapKind,
      geometryType: this._opts.type,
      drawColor: this._opts.drawColor || EMAP_THEME_COLORS.primary,
    });
  }

  private _clearDrawState(): void {
    this._vertices = [];
    this._cursorCoord = null;
    this._snapCoord = null;
    this._snapKind = null;
  }
}

// ---------------------------------------------------------------------------
// Module-private geometry helper, exported for unit tests.
// ---------------------------------------------------------------------------

/**
 * Closest point on segment `[a, b]` to point `p`, all in 2-D pixel space.
 * Parameter `t = ((p-a)·(b-a)) / |b-a|²` is clamped to `[0, 1]` so the
 * returned point is always on the segment (not its infinite line). For a
 * zero-length segment, returns endpoint `a` and `dist(p, a)`.
 */
export function projectPointOnSegment(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): { point: [number, number]; dist: number } {
  const ax = a[0],
    ay = a[1];
  const bx = b[0],
    by = b[1];
  const px = p[0],
    py = p[1];
  const abx = bx - ax;
  const aby = by - ay;
  const ab2 = abx * abx + aby * aby;
  if (ab2 === 0) {
    // Degenerate segment — both endpoints collapse to a single point.
    const dx = px - ax;
    const dy = py - ay;
    return { point: [ax, ay], dist: Math.hypot(dx, dy) };
  }
  const apx = px - ax;
  const apy = py - ay;
  let t = (apx * abx + apy * aby) / ab2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  return { point: [cx, cy], dist: Math.hypot(px - cx, py - cy) };
}
