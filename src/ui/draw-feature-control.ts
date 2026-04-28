import { Control } from './control';
import { Emap, SnapKind } from '../map/map';
import { getLayerId } from '../source/layer-utils';
import { FeatureCreateCommand } from '../edit/commands/feature-create';
import type { MapshaperLayer, ArcCollection } from '../types/mapshaper-types';

export type DrawGeometryType = 'polygon' | 'polyline' | 'point';

export interface DrawFeatureControlOptions {
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
  /** CSS color for the drawing line (default: '#0078ff') */
  drawColor?: string;
  /** Button icon HTML (default: geometry-specific icon) */
  icon?: string;
}

const DEFAULT_ICONS: Record<DrawGeometryType, string> = {
  polygon: '▢',
  polyline: '╱',
  point: '●',
};

const DEFAULT_TITLES: Record<DrawGeometryType, string> = {
  polygon: 'Draw Polygon',
  polyline: 'Draw Polyline',
  point: 'Draw Point',
};

/** Pixel threshold for vertex snapping */
const DEFAULT_SNAP_THRESHOLD = 10;

/** Pixel threshold for closing a polygon by clicking first vertex */
const CLOSE_THRESHOLD = 12;

export class DrawFeatureControl implements Control {
  private _options: DrawFeatureControlOptions;
  private _map: Emap | null = null;
  private _container: HTMLElement | null = null;
  private _btn: HTMLButtonElement | null = null;
  private _active: boolean = false;

  // Drawing state
  private _vertices: [number, number][] = [];
  private _cursorCoord: [number, number] | null = null;
  private _snapCoord: [number, number] | null = null;
  private _snapKind: SnapKind = null;
  private _snapThreshold: number;

  // Bound handlers
  private _onMouseMoveBound: (e: MouseEvent) => void;
  private _onClickBound: (e: MouseEvent) => void;
  private _onDblClickBound: (e: MouseEvent) => void;
  private _onKeyDownBound: (e: KeyboardEvent) => void;
  private _onMoveHandlerBound: () => void;

  constructor(options: DrawFeatureControlOptions) {
    this._options = options;
    this._snapThreshold = options.snapThreshold ?? DEFAULT_SNAP_THRESHOLD;
    this._onMouseMoveBound = this._onMouseMove.bind(this);
    this._onClickBound = this._onClick.bind(this);
    this._onDblClickBound = this._onDblClick.bind(this);
    this._onKeyDownBound = this._onKeyDown.bind(this);
    this._onMoveHandlerBound = this._onMapMove.bind(this);
  }

  onAdd(map: Emap): HTMLElement {
    this._map = map;
    this._container = document.createElement('div');
    this._container.className = 'emap-ctrl emap-ctrl-group';

    this._btn = document.createElement('button');
    this._btn.className = 'emap-ctrl-draw';
    this._btn.type = 'button';
    this._btn.title = DEFAULT_TITLES[this._options.type];
    this._btn.innerHTML = `<span class="emap-ctrl-icon">${this._options.icon || DEFAULT_ICONS[this._options.type]}</span>`;
    this._btn.addEventListener('click', () => this._toggle());
    this._container.appendChild(this._btn);

    // Deactivate when another edit mode takes over
    map.on('editmodechange', (e: { mode: string }) => {
      if (this._active && e.mode !== 'draw') {
        this._deactivateQuiet();
      }
    });

    return this._container;
  }

  onRemove(): void {
    this._deactivate();
    if (this._container?.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }
    this._map = null;
    this._container = null;
    this._btn = null;
  }

  private _toggle(): void {
    if (this._active) {
      this._deactivate();
    } else {
      this._activate();
    }
  }

  private _activate(): void {
    if (!this._map) return;
    this._active = true;
    this._btn?.classList.add('active');
    this._map.setEditMode('draw');

    const container = this._map.getCanvasContainer();
    container.classList.add('emap-draw-active');
    container.addEventListener('mousemove', this._onMouseMoveBound);
    container.addEventListener('click', this._onClickBound);
    container.addEventListener('dblclick', this._onDblClickBound);
    window.addEventListener('keydown', this._onKeyDownBound);
    this._map.on('move', this._onMoveHandlerBound);
  }

  private _deactivate(): void {
    this._clearDrawState();
    this._deactivateQuiet();
    this._map?.setEditMode('none');
  }

  /** Deactivate UI without firing setEditMode (used when another mode takes over) */
  private _deactivateQuiet(): void {
    if (!this._map) return;
    this._active = false;
    this._btn?.classList.remove('active');

    const container = this._map.getCanvasContainer();
    container.classList.remove('emap-draw-active');
    container.removeEventListener('mousemove', this._onMouseMoveBound);
    container.removeEventListener('click', this._onClickBound);
    container.removeEventListener('dblclick', this._onDblClickBound);
    window.removeEventListener('keydown', this._onKeyDownBound);
    this._map.off('move', this._onMoveHandlerBound);

    this._map.clearEditDrawState();
    this._map.render();
  }

  private _clearDrawState(): void {
    this._vertices = [];
    this._cursorCoord = null;
    this._snapCoord = null;
    this._snapKind = null;
  }

  private _onMapMove(): void {
    if (this._vertices.length > 0) {
      this._updateDrawState();
      this._map?.render();
    }
  }

  private _onMouseMove(e: MouseEvent): void {
    if (!this._map) return;
    const rect = this._map.getCanvasContainer().getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    const dataCoord = this._map.unproject(px, py);
    this._cursorCoord = [dataCoord[0], dataCoord[1]];

    // Snap detection — yields a coordinate AND its kind ('vertex' | 'edge')
    const snap = this._findSnapTarget(px, py);
    this._snapCoord = snap?.coord ?? null;
    this._snapKind = snap?.kind ?? null;

    if (this._vertices.length > 0 || this._snapCoord) {
      this._updateDrawState();
      this._map.render();
    }
  }

  private _onClick(e: MouseEvent): void {
    if (!this._map) return;
    const rect = this._map.getCanvasContainer().getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    const coord: [number, number] = this._snapCoord
      ? [this._snapCoord[0], this._snapCoord[1]]
      : this._map.unproject(px, py);

    if (this._options.type === 'point') {
      this._vertices = [coord];
      this._commitFeature();
      return;
    }

    // For polygon: check if clicking near first vertex to close
    if (this._options.type === 'polygon' && this._vertices.length >= 3) {
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
    if (!this._map) return;
    e.preventDefault();
    e.stopPropagation();

    if (this._options.type === 'point') return;

    if (this._options.type === 'polyline' && this._vertices.length >= 2) {
      this._commitFeature();
    } else if (this._options.type === 'polygon' && this._vertices.length >= 3) {
      this._commitFeature();
    }
  }

  private _onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this._clearDrawState();
      this._map?.clearEditDrawState();
      this._map?.render();
    }
  }

  // ---------------------------------------------------------------------------
  // Snap detection
  // ---------------------------------------------------------------------------

  private _findSnapTarget(
    px: number,
    py: number,
  ): { coord: [number, number]; kind: SnapKind } | null {
    if (!this._map) return null;
    const map = this._map;
    const sources = this._options.snapSources ?? [this._options.source];
    const snapToVertex = this._options.snapToVertex !== false; // default true
    const snapToEdge = this._options.snapToEdge !== false;     // default true

    // Tracked best across every candidate kind. Vertex wins ties because
    // strict-`<` keeps the earlier match — vertex loop runs before edge.
    let bestDist = this._snapThreshold;
    let bestCoord: [number, number] | null = null;
    let bestKind: SnapKind = null;

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
          const projected = map.project(xx[i], yy[i]);
          const dist = Math.hypot(projected[0] - px, projected[1] - py);
          if (dist < bestDist) {
            bestDist = dist;
            bestCoord = [xx[i], yy[i]];
            bestKind = 'vertex';
          }
        }
      }

      if (snapToEdge && arcs.forEachSegment) {
        // Walk every arc segment. forEachSegment yields adjacent vertex
        // index pairs (i, j) within an arc — never crosses arc boundaries,
        // so we don't accidentally treat unrelated arcs as connected.
        arcs.forEachSegment((i: number, j: number, arcXx: Float64Array, arcYy: Float64Array) => {
          const a = map.project(arcXx[i], arcYy[i]);
          const b = map.project(arcXx[j], arcYy[j]);
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
    if (!this._map || this._vertices.length === 0) return;

    const source = this._map.getSource(this._options.source);
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

    if (this._options.type === 'point') {
      appendedShape = [this._vertices[0]];
      layer.shapes.push(appendedShape);
    } else {
      // Polyline or polygon: create new arc
      arcVertices = this._options.type === 'polygon'
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
    this._map.pushCommand(new FeatureCreateCommand({
      geometryType: this._options.type,
      layer,
      source,
      appendedShape,
      appendedRecord,
      arcVertices,
      arcs,
    }));

    const featureId = layer.shapes.length - 1;
    const layerId = getLayerId(layer, layerIndex >= 0 ? layerIndex : 0);

    this._map.fire('feature_created', {
      id: featureId,
      source: this._options.source,
      layer: layerId,
      geometryType: this._options.type,
      properties: {},
    });

    // Clear drawing state and trigger re-render via source data event
    this._clearDrawState();
    this._map.clearEditDrawState();
    source.fire('data');
  }

  private _resolveTargetLayer(layers: MapshaperLayer[]): MapshaperLayer | null {
    if (!layers.length) return null;

    if (this._options.sourceLayer) {
      for (let i = 0; i < layers.length; i++) {
        const lid = getLayerId(layers[i], i);
        if (lid === this._options.sourceLayer) return layers[i];
      }
    }

    // Find first layer matching the geometry type
    const mapshaperType = this._options.type === 'polygon' ? 'polygon'
      : this._options.type === 'polyline' ? 'polyline'
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
    if (!this._map) return;
    this._map.setEditDrawState({
      vertices: [...this._vertices],
      cursorCoord: this._snapCoord || this._cursorCoord,
      snapCoord: this._snapCoord,
      snapKind: this._snapKind,
      geometryType: this._options.type,
      drawColor: this._options.drawColor || '#0078ff',
    });
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
  const ax = a[0], ay = a[1];
  const bx = b[0], by = b[1];
  const px = p[0], py = p[1];
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
