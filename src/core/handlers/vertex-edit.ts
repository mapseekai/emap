import type { Handler, HandlerResult, NormalizedPointerEvent } from '../handler';
import { Emap, EditVertexShape, EditVertexArcs } from '../../map/map';
import { VertexMoveCommand } from '../../edit/commands/vertex-move';
import { VertexInsertCommand } from '../../edit/commands/vertex-insert';
import { VertexDeleteCommand } from '../../edit/commands/vertex-delete';
import { bumpEditVersion, isPathLayer, type ArcCollection } from '../../types/mapshaper-types';
import type { TopologySource } from '../../source/source';
import { getDefaultMapshaperAdapter } from '../../adapter/mapshaper-adapter';

interface EditableArcs extends EditVertexArcs {
  getVertex2(vertexId: number): [number, number] | null;
  getShapeIter?(part: number[]): { x: number; y: number; hasNext(): boolean };
  transformPoints?: (cb: (x: number, y: number) => void) => void;
  getVertexData(): { xx: Float64Array; yy: Float64Array; nn: Int32Array; ii: Int32Array };
}

interface HoveredFeature {
  source: string;
  layer: string;
  id: number;
  shape: EditVertexShape;
  arcs: EditableArcs;
  geometryType: string;
  /** All layers in the source, for neighbor-shape lookup */
  allLayers: Array<{ shapes?: EditVertexShape[] }>;
}

/** Pixel threshold for vertex hover detection */
const VERTEX_HIT_THRESHOLD = 10;

/** Default light grey fill at ~30% opacity, matching mapshaper's hover style */
const DEFAULT_POLYGON_FILL = 'rgba(0,0,0,0.15)';

export interface VertexEditOptions {
  /** Polygon hover fill. Default 'rgba(0,0,0,0.15)'. */
  polygonFillColor?: string;
}

export class VertexEditHandler implements Handler<VertexEditOptions> {
  readonly name = 'vertexEdit';
  private readonly _map: Emap;
  private _enabled = false;
  private _polygonFillColor: string | null;

  // Hover / drag state
  private _hoveredFeature: HoveredFeature | null = null;
  private _hoverVertexCoords: [number, number] | null = null;
  private _hoverVertexIds: number[] = [];  // ALL vertex indices sharing this topological node
  private _hoverType: 'vertex' | 'interpolated' | null = null;
  private _hoverInsertionId: number = -1;  // vertex insertion index for interpolated points
  private _dragging: boolean = false;
  /** Shapes of neighboring polygons sharing the hovered arc (for shared-edge highlight) */
  private _neighborShapes: EditVertexShape[] = [];
  /** Coordinate of the dragged node before mouse-down, captured for VertexMoveCommand. */
  private _dragFromCoords: [number, number] | null = null;

  private _onMapMoveBound = () => this._onMapMove();

  constructor(map: Emap, opts: VertexEditOptions = {}) {
    this._map = map;
    this._polygonFillColor = opts.polygonFillColor !== undefined
      ? opts.polygonFillColor
      : DEFAULT_POLYGON_FILL;
  }

  isEnabled(): boolean { return this._enabled; }

  enable(): void {
    if (this._enabled) return;
    this._enabled = true;
    this._map.setEditMode('vertex');
    this._map.getCanvasContainer().classList.add('emap-edit-active');
    this._map.on('move', this._onMapMoveBound);
  }

  disable(): void {
    if (!this._enabled) return;
    this._enabled = false;
    this._hoveredFeature = null;
    this._hoverVertexCoords = null;
    this._hoverVertexIds = [];
    this._hoverType = null;
    this._hoverInsertionId = -1;
    this._neighborShapes = [];
    this._dragging = false;
    this._map.setEditMode('none');
    this._map.clearEditVertexState();
    this._map.getCanvasContainer().classList.remove('emap-edit-active');
    this._map.off('move', this._onMapMoveBound);
    this._map.render();
  }

  setOptions(o: Partial<VertexEditOptions>): void {
    if (o.polygonFillColor !== undefined) {
      this._polygonFillColor = o.polygonFillColor;
    }
  }

  getOptions(): Readonly<VertexEditOptions> {
    return { polygonFillColor: this._polygonFillColor ?? undefined };
  }

  handlePointer(ev: NormalizedPointerEvent): HandlerResult {
    if (!this._enabled) return 'passthrough';
    const px = ev.point.x, py = ev.point.y;
    if (ev.kind === 'move') {
      if (this._dragging) { this._handleDrag(px, py); return 'exclusive'; }
      this._onMouseMove(px, py); return 'passthrough';
    }
    if (ev.kind === 'down') {
      if (ev.button !== 0) return 'passthrough';
      this._onMouseDown(px, py);
      return this._dragging ? 'exclusive' : 'passthrough';
    }
    if (ev.kind === 'up') {
      if (!this._dragging) return 'passthrough';
      this._finishDrag(px, py);
      return 'passthrough';
    }
    if (ev.kind === 'contextmenu') {
      this._onContextMenu(ev.originalEvent as MouseEvent);
      return 'consumed';
    }
    return 'passthrough';
  }

  /** Redraw on map move/zoom (vertices stay fixed to geography) */
  private _onMapMove(): void {
    if (this._hoveredFeature && !this._dragging) {
      this._updateEditState();
      this._map.render();
    }
  }

  /**
   * Right-click handler: show a context menu to delete the hovered vertex.
   * Guard rules (same as mapshaper):
   *   - Must be hovering a vertex (not an interpolated edge point)
   *   - Not currently dragging
   *   - Vertex must NOT be an arc endpoint (deleting an endpoint breaks topology)
   */
  private _onContextMenu(e: MouseEvent): void {
    e.preventDefault(); // always suppress browser default right-click menu
    if (this._dragging) return;
    if (this._hoverType !== 'vertex' || this._hoverVertexIds.length === 0) return;
    if (!this._hoveredFeature) return;

    const vtxId = this._hoverVertexIds[0];
    const arcs = this._hoveredFeature.arcs;

    // Arc endpoints cannot be deleted — they are shared topology nodes
    if (getDefaultMapshaperAdapter().vertexIsArcEndpoint(vtxId, arcs as unknown as ArcCollection)) return;

    this._showContextMenu(e.clientX, e.clientY, () => {
      this._deleteHoveredVertex();
    });
  }

  /** Delete the currently hovered vertex from the arc collection */
  private _deleteHoveredVertex(): void {
    if (!this._hoveredFeature || this._hoverVertexIds.length === 0) return;
    const arcs = this._hoveredFeature.arcs;
    const vtxId = this._hoverVertexIds[0];
    const sourceId = this._hoveredFeature.source;

    // Snapshot the vertex's coordinate BEFORE deletion so undo can re-insert it.
    const coordsBefore = arcs.getVertex2(vtxId);

    // Delete vertex via the adapter; mapshaper's deleteVertex calls
    // updateVertexData() internally, which rebuilds all arc bounds via
    // initBounds(). No explicit updateArcBounds needed.
    getDefaultMapshaperAdapter().deleteVertex(arcs as unknown as ArcCollection, vtxId);

    // Re-initialize the LOD copy in DisplayArcs since vertex layout changed.
    this._refreshSourceDisplayArcs(sourceId);
    // Live mutation — bump editVersion so the spatial-index cache
    // invalidates and the next hit-test against the (potentially
    // shrunken) bbox reflects the deletion.
    this._bumpSourceEditVersion(sourceId);

    // Push an undoable VertexDeleteCommand
    if (coordsBefore) {
      const source = this._map.getSource(sourceId);
      if (source) {
        this._map.pushCommand(new VertexDeleteCommand({
          vertexIndex: vtxId,
          coords: [coordsBefore[0], coordsBefore[1]],
          arcs: arcs as unknown as ArcCollection,
          source: source as TopologySource,
        }));
      }
    }

    // Clear hover state (the vertex no longer exists)
    this._hoverVertexCoords = null;
    this._hoverVertexIds = [];
    this._hoverType = null;
    this._hoverInsertionId = -1;
    this._neighborShapes = [];
    this._map.clearEditVertexState();
    this._map.render();
  }

  /**
   * Re-initialize the source's DisplayArcs after an arc-mutating edit so that
   * the simplified LOD copy reflects the new vertex layout.
   */
  private _refreshSourceDisplayArcs(sourceId: string): void {
    this._map.getSource(sourceId)?.refreshDisplayArcs();
  }

  /**
   * Bump the dataset's `editVersion` after a live in-place arc mutation.
   * The spatial-index cache in `feature-query` keys on `editVersion`, so
   * this is what tells the next `queryFeatures` call that bboxes may
   * have changed and the index must rebuild. Cheap (a number
   * increment); only the next query pays the actual rebuild cost.
   *
   * The matching command's `do()/undo()` also bump, but those run on
   * undo / redo — not on initial commit, since `pushCommand` skips
   * `do()` per the memento contract.
   */
  private _bumpSourceEditVersion(sourceId: string): void {
    const source = this._map.getSource(sourceId);
    bumpEditVersion(source?.getDataset?.() ?? null);
  }

  /**
   * Show a minimal context menu at (x, y) in viewport coords.
   * Auto-dismissed when user clicks anywhere else.
   */
  private _showContextMenu(x: number, y: number, onDelete: () => void): void {
    // Remove any existing menu
    document.getElementById('emap-ctx-menu')?.remove();

    const menu = document.createElement('div');
    menu.id = 'emap-ctx-menu';
    Object.assign(menu.style, {
      position: 'fixed',
      left: `${x}px`,
      top: `${y}px`,
      background: '#fff',
      border: '1px solid #ccc',
      borderRadius: '4px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
      padding: '4px 0',
      zIndex: '9999',
      minWidth: '120px',
      font: '13px/1.5 system-ui, sans-serif',
    });

    const item = document.createElement('div');
    item.textContent = '删除节点';
    Object.assign(item.style, {
      padding: '6px 16px',
      cursor: 'pointer',
      color: '#d32',
    });
    item.addEventListener('mouseenter', () => { item.style.background = '#f5f5f5'; });
    item.addEventListener('mouseleave', () => { item.style.background = ''; });
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.remove();
      document.removeEventListener('click', dismiss);
      onDelete();
    });
    menu.appendChild(item);
    document.body.appendChild(menu);

    // Dismiss on any click outside
    const dismiss = () => {
      menu.remove();
      document.removeEventListener('click', dismiss);
    };
    // Use setTimeout so this listener doesn't fire immediately from the right-click
    setTimeout(() => document.addEventListener('click', dismiss), 0);
  }

  private _onMouseMove(px: number, py: number): void {
    // Hit test: find feature under pointer
    const hits = this._map.queryFeatures([px, py]);
    if (hits.length === 0) {
      this._hoveredFeature = null;
      this._hoverVertexCoords = null;
      this._hoverVertexIds = [];
      this._hoverType = null;
      this._hoverInsertionId = -1;
      this._neighborShapes = [];
      this._map.clearEditVertexState();
      this._map.render();
      return;
    }

    const hit = hits[0];
    if (hit.geometryType === 'point') {
      this._hoveredFeature = null;
      this._hoverVertexCoords = null;
      this._hoverVertexIds = [];
      this._hoverType = null;
      this._hoverInsertionId = -1;
      this._neighborShapes = [];
      this._map.clearEditVertexState();
      this._map.render();
      return;
    }

    // Resolve source shapes + arcs
    const source = this._map.getSource(hit.source);
    if (!source) return;
    const layers = source.getLayers();
    const arcs = source.getArcs() as EditableArcs | undefined;
    if (!arcs) return;

    let shape: EditVertexShape | null = null;
    for (const layer of layers) {
      if (isPathLayer(layer) && layer.shapes && layer.shapes[hit.id]) {
        shape = layer.shapes[hit.id];
        break;
      }
    }
    if (!shape) return;

    this._hoveredFeature = {
      source: hit.source,
      layer: hit.layer,
      id: hit.id,
      shape,
      arcs,
      geometryType: hit.geometryType,
      allLayers: layers as Array<{ shapes?: EditVertexShape[] }>
    };

    // Find nearest vertex using topology-aware API;
    // fall back to edge snapping if no vertex is close enough
    this._findNearestVertices(shape, arcs, px, py);
    if (!this._hoverVertexCoords) {
      this._findInterpolatedPoint(shape, arcs, px, py);
    }
    // Find neighbor shapes sharing the hovered arc (for shared-edge highlight)
    this._findNeighborShapes(arcs);
    this._updateEditState();
    this._map.render();
  }

  /**
   * Use MapshaperAdapter.findNearestVertices to discover ALL vertex indices
   * that share the same topological node (identical coordinates across all arcs).
   */
  private _findNearestVertices(shape: EditVertexShape, arcs: EditableArcs, px: number, py: number): void {
    const p = this._map.unproject(px, py);

    // findNearestVertices returns ALL vertex IDs at the same topological node
    const ids: number[] = getDefaultMapshaperAdapter().findNearestVertices(
      p,
      shape,
      arcs as unknown as ArcCollection,
    );
    if (!ids || ids.length === 0) {
      this._hoverVertexCoords = null;
      this._hoverVertexIds = [];
      return;
    }

    // Get the coordinates of the first vertex (all share the same coords)
    const vtxCoords = arcs.getVertex2(ids[0]);
    if (!vtxCoords) {
      this._hoverVertexCoords = null;
      this._hoverVertexIds = [];
      return;
    }

    // Check pixel distance
    const projected = this._map.project(vtxCoords[0], vtxCoords[1]);
    const dist = Math.sqrt(
      (projected[0] - px) * (projected[0] - px) +
      (projected[1] - py) * (projected[1] - py)
    );

    if (dist <= VERTEX_HIT_THRESHOLD) {
      this._hoverVertexCoords = [vtxCoords[0], vtxCoords[1]];
      this._hoverVertexIds = ids;
      this._hoverType = 'vertex';
      this._hoverInsertionId = -1;
    } else {
      this._hoverVertexCoords = null;
      this._hoverVertexIds = [];
      this._hoverType = null;
      this._hoverInsertionId = -1;
    }
  }

  /**
   * Find the closest point along any segment edge (not just vertices).
   * Uses mapshaper's forEachSegmentInShape + findClosestPointOnSeg.
   * Called as fallback when no existing vertex is within hover threshold.
   */
  private _findInterpolatedPoint(shape: EditVertexShape, arcs: EditableArcs, px: number, py: number): void {
    const p = this._map.unproject(px, py);
    let minDist = Infinity;
    let closest: { insertionId: number; point: [number, number] } | null = null;

    const adapter = getDefaultMapshaperAdapter();
    adapter.forEachSegmentInShape(shape, arcs as unknown as ArcCollection, (i, j, xx, yy) => {
      const x1 = xx[i], y1 = yy[i];
      const x2 = xx[j], y2 = yy[j];
      const p2 = adapter.findClosestPointOnSeg(p[0], p[1], x1, y1, x2, y2, 0);
      const dx = p2[0] - p[0];
      const dy = p2[1] - p[1];
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist) {
        minDist = dist;
        closest = {
          insertionId: (i < j ? i : j) + 1,
          point: [p2[0], p2[1]]
        };
      }
    });

    if (!closest) return;

    // Extract after null guard to avoid TS closure narrowing issue
    const closestResult = closest as { insertionId: number; point: [number, number] };

    // Convert data-space distance to pixel distance
    const projected = this._map.project(closestResult.point[0], closestResult.point[1]);
    const pixelDist = Math.sqrt(
      (projected[0] - px) * (projected[0] - px) +
      (projected[1] - py) * (projected[1] - py)
    );

    if (pixelDist <= VERTEX_HIT_THRESHOLD) {
      this._hoverVertexCoords = closestResult.point;
      this._hoverVertexIds = [];
      this._hoverType = 'interpolated';
      this._hoverInsertionId = closestResult.insertionId;
    }
  }

  /**
   * Find all shapes (polygons) in the source that share any arc with the hovered vertex/edge.
   * Handles two cases:
   *   - Vertex hover: hoverVertexIds → arcIds via findArcIdFromVertexId
   *   - Edge hover (interpolated): hoverInsertionId - 1 → arcId via findArcIdFromVertexId
   * Only runs when geometry is polygon. Populates _neighborShapes.
   */
  private _findNeighborShapes(arcs: EditableArcs): void {
    this._neighborShapes = [];
    if (!this._hoveredFeature || this._hoveredFeature.geometryType !== 'polygon') return;

    const { ii } = arcs.getVertexData();
    const hoveredShapeId = this._hoveredFeature.id;

    // Build set of arc IDs to check for neighbors
    const arcIdSet = new Set<number>();

    if (this._hoverVertexIds.length > 0) {
      // Vertex hover: map each shared vertex → arc ID
      for (const vtxId of this._hoverVertexIds) {
        arcIdSet.add(getDefaultMapshaperAdapter().findArcIdFromVertexId(vtxId, ii));
      }
    } else if (this._hoverType === 'interpolated' && this._hoverInsertionId > 0) {
      // Edge hover: the vertex at (insertionId - 1) is always on the hovered arc
      arcIdSet.add(getDefaultMapshaperAdapter().findArcIdFromVertexId(this._hoverInsertionId - 1, ii));
    }

    if (arcIdSet.size === 0) return;

    // Scan all layers for shapes containing any of these arc IDs
    const neighborShapes: EditVertexShape[] = [];
    for (const lyr of this._hoveredFeature.allLayers) {
      if (!lyr.shapes) continue;
      for (let shapeIdx = 0; shapeIdx < lyr.shapes.length; shapeIdx++) {
        if (shapeIdx === hoveredShapeId) continue; // skip the hovered shape itself
        const shape = lyr.shapes[shapeIdx];
        if (!shape) continue;
        // Check if this shape contains any of the hovered arc IDs
        let found = false;
        for (const part of shape) {
          for (const rawArcId of part) {
            const absArcId = rawArcId >= 0 ? rawArcId : ~rawArcId;
            if (arcIdSet.has(absArcId)) {
              found = true;
              break;
            }
          }
          if (found) break;
        }
        if (found) neighborShapes.push(shape);
      }
    }
    this._neighborShapes = neighborShapes;
  }


  /** Update the edit vertex state on the map so render() draws vertex dots (and polygon fill) */
  private _updateEditState(): void {
    if (!this._hoveredFeature) return;
    const geomType = this._hoveredFeature.geometryType;
    // Include neighbor shapes in `shapes` so drawVertexDots renders their vertices too
    const allShapes = this._neighborShapes.length > 0
      ? [this._hoveredFeature.shape, ...this._neighborShapes]
      : [this._hoveredFeature.shape];
    this._map.setEditVertexState({
      shapes: allShapes,
      arcs: this._hoveredFeature.arcs,
      hoverVertex: this._hoverVertexCoords,
      hoverType: this._hoverType,
      geometryType: geomType,
      polygonFill: geomType === 'polygon' ? this._polygonFillColor : null,
      neighborShapes: this._neighborShapes.length > 0 ? this._neighborShapes : undefined
    });
  }

  private _onMouseDown(_px: number, _py: number): void {
    if (!this._hoverVertexCoords || !this._hoveredFeature) return;

    // Insert a new vertex when dragging from an interpolated edge point.
    // The insertion is itself an undoable step — push a VertexInsertCommand
    // before the drag begins, so undo first reverses the drag, then the insert.
    if (this._hoverType === 'interpolated' && this._hoverInsertionId >= 0) {
      const arcs = this._hoveredFeature.arcs;
      const point: [number, number] = [this._hoverVertexCoords[0], this._hoverVertexCoords[1]];
      getDefaultMapshaperAdapter().insertVertex(
        arcs as unknown as ArcCollection,
        this._hoverInsertionId,
        point,
      );
      this._hoverVertexIds = [this._hoverInsertionId];
      this._hoverType = 'vertex';
      // Live mutation — bump editVersion so feature-query's spatial-index
      // cache rebuilds on the next hit-test against the post-edit bbox.
      // The matching VertexInsertCommand bumps too on undo/redo, but its
      // .do() is never invoked (pushCommand is memento-style); without
      // this bump the index cache key wouldn't change and the new vertex
      // wouldn't be hit-testable in any newly-covered area.
      this._bumpSourceEditVersion(this._hoveredFeature.source);

      this._pushVertexInsertCommand(this._hoverInsertionId, point);
    }

    // Capture the pre-drag coordinate so mouseup can record a VertexMoveCommand.
    this._dragFromCoords = this._hoverVertexCoords
      ? [this._hoverVertexCoords[0], this._hoverVertexCoords[1]]
      : null;
    this._dragging = true;
  }

  private _pushVertexInsertCommand(insertionId: number, point: [number, number]): void {
    if (!this._hoveredFeature) return;
    const source = this._map.getSource(this._hoveredFeature.source);
    if (!source) return;
    this._map.pushCommand(new VertexInsertCommand({
      insertionId,
      point,
      arcs: this._hoveredFeature.arcs as unknown as ArcCollection,
      source: source as TopologySource,
    }));
  }

  private _handleDrag(px: number, py: number): void {
    if (!this._hoveredFeature || this._hoverVertexIds.length === 0) return;

    // Convert screen coords to data coords
    const dataCoords = this._map.unproject(px, py);
    const arcs = this._hoveredFeature.arcs;

    // Topology-aware: move ALL shared vertices to the new position
    getDefaultMapshaperAdapter().snapVertices(
      this._hoverVertexIds,
      [dataCoords[0], dataCoords[1]],
      arcs as unknown as ArcCollection,
    );

    // Update hover coords so highlight follows the pointer
    this._hoverVertexCoords = [dataCoords[0], dataCoords[1]];

    // Update edit state and repaint — vertex dots + data layer on same canvas
    this._updateEditState();
    this._map.render();
  }

  private _finishDrag(px: number, py: number): void {
    if (!this._dragging || !this._hoveredFeature) return;
    this._dragging = false;

    const dataCoords = this._map.unproject(px, py);
    const sourceId = this._hoveredFeature.source;

    // mapshaper's snapVerticesToPoint already updates per-arc bounds during the
    // drag (see paths/mapshaper-vertex-utils.mjs). transformPoints with a no-op
    // forces a full bounds rebuild to recover from any direct vertex mutations
    // that bypassed the canonical helper.
    const arcs = this._hoveredFeature.arcs;
    if (arcs.transformPoints) {
      arcs.transformPoints(function () { });
    }

    // If the source has a low-detail LOD copy, regenerate it so the filtered
    // arcs reflect the new vertex positions.
    this._refreshSourceDisplayArcs(sourceId);
    // The live drag in `_handleDrag` has been mutating arcs in place
    // every frame without bumping editVersion; the spatial-index cache
    // is therefore stale against the new bboxes. Bump now so the next
    // hover hit-test sees the post-drag bbox — without this, dragging
    // a vertex outward expands the polygon visually but the new area
    // is invisible to `queryFeatures` until the next shape-count or
    // arc-count change.
    this._bumpSourceEditVersion(sourceId);

    // Push an undoable VertexMoveCommand if the drag actually moved the node.
    // (A click-without-drag returns the same coord and is not worth recording.)
    const from = this._dragFromCoords;
    const dragMoved = from && (from[0] !== dataCoords[0] || from[1] !== dataCoords[1]);
    if (dragMoved && this._hoverVertexIds.length > 0) {
      const source = this._map.getSource(sourceId);
      if (source) {
        this._map.pushCommand(new VertexMoveCommand({
          vertexIds: [...this._hoverVertexIds],
          from: [from[0], from[1]],
          to: [dataCoords[0], dataCoords[1]],
          arcs: arcs as unknown as ArcCollection,
          source: source as TopologySource,
        }));
      }
    }
    this._dragFromCoords = null;

    // Fire vertex_moved event with topology info
    this._map.fire('vertex_moved', {
      id: this._hoveredFeature.id,
      source: sourceId,
      layer: this._hoveredFeature.layer,
      vertexIndex: this._hoverVertexIds[0] ?? null,
      vertexIds: this._hoverVertexIds,
      coords: dataCoords
    });

    // Final repaint
    this._map.render();
  }
}
