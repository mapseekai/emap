import type { Handler, HandlerResult, NormalizedPointerEvent } from '../handler';
import type { EditVertexShape, EditVertexArcs } from '../../map/types';
import { VertexMoveCommand } from '../../edit/commands/vertex-move';
import { VertexInsertCommand } from '../../edit/commands/vertex-insert';
import { planTopologyNodeDeletion } from '../../edit/commands/vertex-delete';
import { bumpEditVersion, isPathLayer, type ArcCollection } from '../../types/mapshaper-types';
import type { TopologySource } from '../../source/source';
import { getDefaultMapshaperAdapter } from '../../adapter/mapshaper-adapter';
import { getLayerId } from '../../source/layer-utils';
import { isSharedNode } from '../../edit/commands/split-shared-node';
import type { EditHandlerHost } from './edit-handler-host';
import { EMAP_THEME_COLORS } from '../../theme/colors';

interface EditableArcs extends EditVertexArcs {
  getVertex2(vertexId: number): [number, number] | null;
  getShapeIter?(part: number[]): { x: number; y: number; hasNext(): boolean };
  getSimpleShapeBbox?(shapeIds: number[], bbox: number[]): void;
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

interface DetachedNodeSelection {
  source: string;
  layer: string;
  id: number;
  coords: [number, number];
  vertexIds: number[];
}

/** Pixel threshold for vertex hover detection */
const VERTEX_HIT_THRESHOLD = 10;

/** Default `EMAP_THEME_COLORS.selection` fill for the polygon being vertex-edited. */
const DEFAULT_POLYGON_FILL = EMAP_THEME_COLORS.selection;
const CONTEXT_MENU_THEME_PROPERTIES = [
  '--popover',
  '--popover-foreground',
  '--border',
  '--destructive',
  '--accent',
  '--ring',
  '--emap-surface-bg',
  '--emap-popover-foreground',
  '--emap-surface-border',
  '--emap-danger',
  '--emap-hover-bg',
  '--emap-ring',
  '--emap-current-popover',
  '--emap-current-popover-foreground',
  '--emap-current-border',
  '--emap-current-destructive',
  '--emap-current-hover-bg',
  '--emap-current-ring',
  '--emap-radius',
  '--emap-surface-shadow',
  '--emap-font',
] as const;

export interface VertexEditOptions {
  /** Restrict editable hit-testing to these layer ids/names. Default = all visible. */
  layers?: string[];
  /** Polygon hover fill. Default `EMAP_THEME_COLORS.selection`. */
  polygonFillColor?: string;
  /** Pixel threshold for snapping a dragged vertex to another feature. Default 10. */
  snapThreshold?: number;
  /** Snap dragged vertices to other features' existing vertices. Default true. */
  snapToVertex?: boolean;
  /** Snap dragged vertices to other features' edges. Default true. */
  snapToEdge?: boolean;
}

export class VertexEditHandler implements Handler<VertexEditOptions> {
  readonly name = 'vertexEdit';
  private readonly _map: EditHandlerHost;
  private _enabled = false;
  /** Injected by HandlerManager.register (cursor recompute on mode flips). */
  _manager?: { refreshCursor(): void };
  private _polygonFillColor: string | null;
  private _layers: string[] | undefined;

  // Hover / drag state
  private _hoveredFeature: HoveredFeature | null = null;
  private _hoverVertexCoords: [number, number] | null = null;
  private _hoverVertexIds: number[] = []; // ALL vertex indices sharing this topological node
  private _hoverType: 'vertex' | 'interpolated' | null = null;
  private _hoverInsertionId: number = -1; // vertex insertion index for interpolated points
  private _detachedNode: DetachedNodeSelection | null = null;
  private _dragging: boolean = false;
  /** Shapes of neighboring polygons sharing the hovered arc (for shared-edge highlight) */
  private _neighborShapes: EditVertexShape[] = [];
  private _shapeSignatureIds = new WeakMap<object, number>();
  private _nextShapeSignatureId = 1;
  /** Coordinate of the dragged node before mouse-down, captured for VertexMoveCommand. */
  private _dragFromCoords: [number, number] | null = null;
  private _snapThreshold: number;
  private _snapToVertex: boolean;
  private _snapToEdge: boolean;
  private _historyCanRedo = false;

  private _onMapMoveBound = () => this._onMapMove();
  private _onHistoryChangeBound = (state: { canRedo: boolean }) => {
    const traversedHistory = state.canRedo !== this._historyCanRedo;
    this._historyCanRedo = state.canRedo;
    if (!traversedHistory) return;
    this._detachedNode = null;
    this._clearHoverState();
  };
  private _contextMenu: HTMLElement | null = null;
  private _contextMenuTimer: number | NodeJS.Timeout | undefined;
  private _dismissContextMenuBound = () => this._dismissContextMenu();

  constructor(map: EditHandlerHost, opts: VertexEditOptions = {}) {
    this._map = map;
    this._layers = opts.layers;
    this._polygonFillColor =
      opts.polygonFillColor !== undefined ? opts.polygonFillColor : DEFAULT_POLYGON_FILL;
    this._snapThreshold = opts.snapThreshold ?? VERTEX_HIT_THRESHOLD;
    this._snapToVertex = opts.snapToVertex !== false;
    this._snapToEdge = opts.snapToEdge !== false;
  }

  isEnabled(): boolean {
    return this._enabled;
  }

  enable(): void {
    if (this._enabled) return;
    this._enabled = true;
    this._historyCanRedo = this._map.canRedo?.() ?? false;
    this._map.setEditMode('vertex');
    this._map.on('move', this._onMapMoveBound);
    this._map.on('historychange', this._onHistoryChangeBound);
    this._manager?.refreshCursor();
  }

  getCursor(): string | null {
    return this._enabled ? 'crosshair' : null;
  }

  disable(): void {
    if (!this._enabled) return;
    this._dismissContextMenu();
    this._enabled = false;
    this._hoveredFeature = null;
    this._hoverVertexCoords = null;
    this._hoverVertexIds = [];
    this._hoverType = null;
    this._hoverInsertionId = -1;
    this._detachedNode = null;
    this._neighborShapes = [];
    this._dragging = false;
    this._map.setEditMode('none');
    this._map.clearEditVertexState();
    this._map.off('move', this._onMapMoveBound);
    this._map.off('historychange', this._onHistoryChangeBound);
    this._manager?.refreshCursor();
    this._map.render();
  }

  setOptions(o: Partial<VertexEditOptions>): void {
    if (o.layers !== undefined) this._layers = o.layers;
    if (o.polygonFillColor !== undefined) {
      this._polygonFillColor = o.polygonFillColor;
    }
    if (o.snapThreshold !== undefined) this._snapThreshold = o.snapThreshold;
    if (o.snapToVertex !== undefined) this._snapToVertex = o.snapToVertex;
    if (o.snapToEdge !== undefined) this._snapToEdge = o.snapToEdge;
  }

  getOptions(): Readonly<VertexEditOptions> {
    return {
      layers: this._layers,
      polygonFillColor: this._polygonFillColor ?? undefined,
      snapThreshold: this._snapThreshold,
      snapToVertex: this._snapToVertex,
      snapToEdge: this._snapToEdge,
    };
  }

  handlePointer(ev: NormalizedPointerEvent): HandlerResult {
    if (!this._enabled) return 'passthrough';
    const px = ev.point.x,
      py = ev.point.y;
    if (ev.kind === 'move') {
      if (this._dragging) {
        this._handleDrag(px, py);
        return 'exclusive';
      }
      this._onMouseMove(px, py);
      return 'passthrough';
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
   * Right-click handler for topology-node actions.
   * Shared nodes can be deleted as one topological unit or split first so the
   * hovered feature can be edited independently.
   */
  private _onContextMenu(e: MouseEvent): void {
    e.preventDefault(); // always suppress browser default right-click menu
    if (this._dragging) return;
    if (this._hoverType !== 'vertex' || this._hoverVertexIds.length === 0) return;
    if (!this._hoveredFeature) return;

    const hoveredFeature = this._hoveredFeature;
    const vertexCoords: [number, number] | null = this._hoverVertexCoords
      ? [this._hoverVertexCoords[0], this._hoverVertexCoords[1]]
      : null;
    const vertexIds = this._hoverVertexIds.slice();
    const source = this._map.getSource?.(hoveredFeature.source);
    const layer = this._map.layers?.resolve(hoveredFeature.source, hoveredFeature.layer);
    const vertexId = source && layer ? this._findHoveredFeatureVertexId() : null;
    const isShared =
      !this._matchesDetachedNode(hoveredFeature) &&
      !!source &&
      !!layer &&
      vertexId !== null &&
      isSharedNode(
        source as TopologySource,
        layer,
        hoveredFeature.id,
        vertexId,
        source.getLayers(),
      );
    const onDelete = () => {
      this._deleteHoveredVertex(hoveredFeature, vertexIds);
    };
    const onSplit =
      isShared && vertexId !== null && vertexCoords
        ? () => {
            this._splitHoveredNode(hoveredFeature, vertexId, vertexCoords);
          }
        : null;
    this._showContextMenu(e.clientX, e.clientY, onDelete, onSplit);
  }

  private _findHoveredFeatureVertexId(): number | null {
    const feature = this._hoveredFeature;
    if (!feature || this._hoverVertexIds.length === 0) return null;

    const featureArcIds = new Set<number>();
    for (const part of feature.shape) {
      for (const rawArcId of part) {
        featureArcIds.add(rawArcId >= 0 ? rawArcId : ~rawArcId);
      }
    }

    const data = feature.arcs.getVertexData();
    const adapter = getDefaultMapshaperAdapter();
    for (const vertexId of this._hoverVertexIds) {
      if (vertexId < 0 || vertexId >= data.xx.length) continue;
      const arcId = adapter.findArcIdFromVertexId(vertexId, data.ii);
      if (featureArcIds.has(arcId)) return vertexId;
    }
    return null;
  }

  private _splitHoveredNode(
    hoveredFeature: HoveredFeature,
    vertexId: number,
    capturedCoords: [number, number] | null = this._hoverVertexCoords,
  ): void {
    const detachedVertexIds = this._map.editSession.splitSharedNode(
      {
        source: hoveredFeature.source,
        layer: hoveredFeature.layer,
        id: hoveredFeature.id,
      },
      vertexId,
    );
    if (!detachedVertexIds || detachedVertexIds.length === 0) return;
    const layer = this._map.layers.resolve(hoveredFeature.source, hoveredFeature.layer);
    const shape = layer?.shapes?.[hoveredFeature.id];
    if (!shape || !capturedCoords) return;

    hoveredFeature.shape = shape as EditVertexShape;
    this._hoveredFeature = hoveredFeature;
    this._hoverVertexCoords = [capturedCoords[0], capturedCoords[1]];
    this._hoverVertexIds = detachedVertexIds;
    this._detachedNode = {
      source: hoveredFeature.source,
      layer: hoveredFeature.layer,
      id: hoveredFeature.id,
      coords: [capturedCoords[0], capturedCoords[1]],
      vertexIds: detachedVertexIds.slice(),
    };
    this._hoverType = 'vertex';
    this._hoverInsertionId = -1;
    this._neighborShapes = [];
    this._updateEditState();
    this._map.render();
  }

  /** Delete every arc vertex represented by the currently hovered topology node. */
  private _deleteHoveredVertex(
    hoveredFeature: HoveredFeature | null = this._hoveredFeature,
    vertexIds: readonly number[] = this._hoverVertexIds,
  ): void {
    if (!hoveredFeature || vertexIds.length === 0) return;
    const sourceId = hoveredFeature.source;
    const source = this._map.getSource(sourceId);
    if (!source) return;
    const deletion = planTopologyNodeDeletion(
      source as TopologySource,
      vertexIds,
      source.getLayers(),
    );
    if (!deletion) return;

    deletion.command.do();
    this._map.pushCommand(deletion.command);
    this._refreshSourceDisplayArcs(sourceId);
    if (deletion.shapeChanged) {
      this._map._invalidateShapeCachesForSources([sourceId]);
    }
    if (deletion.deletedFeatureCount > 0) {
      this._map.select([], { mode: 'replace' });
    }

    this._hoverVertexCoords = null;
    this._hoverVertexIds = [];
    this._hoverType = null;
    this._hoverInsertionId = -1;
    this._neighborShapes = [];
    this._detachedNode = null;
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
   * Auto-dismissed when user clicks anywhere else. Static appearance lives
   * in `src/ui/controls.css` as `.emap-ctx-menu` / `.emap-ctx-menu-item`
   * and theme values are snapshotted from the map container so the body-level
   * portal retains a local host theme.
   */
  private _showContextMenu(
    x: number,
    y: number,
    onDelete: (() => void) | null,
    onSplit: (() => void) | null = null,
    unavailableText = '共享节点无法删除',
  ): void {
    this._dismissContextMenu();
    document.getElementById('emap-ctx-menu')?.remove();

    const menu = document.createElement('div');
    menu.id = 'emap-ctx-menu';
    menu.className = 'emap-ctx-menu';
    menu.setAttribute('role', 'menu');
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    const themeHost = this._map.getCanvasContainer?.();
    const computed = themeHost?.ownerDocument.defaultView?.getComputedStyle(themeHost);
    for (const property of CONTEXT_MENU_THEME_PROPERTIES) {
      const value = computed?.getPropertyValue(property).trim();
      if (value) menu.style.setProperty(property, value);
    }

    const configureItem = (element: HTMLDivElement, action: (() => void) | null): void => {
      element.setAttribute('role', 'menuitem');
      if (!action) {
        element.tabIndex = -1;
        return;
      }
      element.tabIndex = 0;
      const activate = (event: Event) => {
        event.stopPropagation();
        this._dismissContextMenu();
        action();
      };
      element.addEventListener('click', activate);
      element.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        activate(event);
      });
    };

    const item = document.createElement('div');
    item.className = 'emap-ctx-menu-item';
    if (onDelete) {
      item.textContent = '删除节点';
      configureItem(item, onDelete);
    } else {
      item.classList.add('emap-ctx-menu-item--disabled');
      item.textContent = unavailableText;
      item.setAttribute('aria-disabled', 'true');
      configureItem(item, null);
    }
    menu.appendChild(item);
    if (onSplit) {
      const splitItem = document.createElement('div');
      splitItem.className = 'emap-ctx-menu-item';
      splitItem.textContent = '分离共享节点';
      configureItem(splitItem, onSplit);
      menu.appendChild(splitItem);
    }
    document.body.appendChild(menu);
    this._contextMenu = menu;

    this._contextMenuTimer = globalThis.setTimeout(
      () => document.addEventListener('click', this._dismissContextMenuBound),
      0,
    );
  }

  private _dismissContextMenu(): void {
    clearTimeout(this._contextMenuTimer);
    this._contextMenuTimer = undefined;
    document.removeEventListener('click', this._dismissContextMenuBound);
    this._contextMenu?.remove();
    this._contextMenu = null;
  }

  private _onMouseMove(px: number, py: number): void {
    const previousHoverSignature = this._getHoverSignature();

    // A split node is intentionally pinned to its feature until the pointer
    // leaves the node. Do not depend on feature hit-testing here: coincident
    // boundaries may return only the neighboring feature, or no feature at all.
    const detached = this._detachedNode;
    if (detached) {
      const detachedPoint = this._map.project(detached.coords[0], detached.coords[1]);
      const dx = detachedPoint[0] - px;
      const dy = detachedPoint[1] - py;
      if (dx * dx + dy * dy <= VERTEX_HIT_THRESHOLD * VERTEX_HIT_THRESHOLD) {
        const source = this._map.getSource(detached.source);
        const layer = this._map.layers.resolve(detached.source, detached.layer);
        const shape =
          layer && isPathLayer(layer) && layer.shapes?.[detached.id]
            ? (layer.shapes[detached.id] as EditVertexShape)
            : null;
        const arcs = source?.getArcs() as EditableArcs | undefined;
        if (source && layer && isPathLayer(layer) && shape && arcs) {
          this._hoveredFeature = {
            source: detached.source,
            layer: detached.layer,
            id: detached.id,
            shape,
            arcs,
            geometryType: layer.geometry_type,
            allLayers: source.getLayers() as Array<{ shapes?: EditVertexShape[] }>,
          };
          const detachedIds = this._getDetachedVertexIds(detached.coords, arcs);
          if (detachedIds) {
            this._hoverVertexCoords = [...detached.coords];
            this._hoverVertexIds = detachedIds;
            this._hoverType = 'vertex';
            this._hoverInsertionId = -1;
            this._neighborShapes = [];
            if (this._getHoverSignature() !== previousHoverSignature) {
              this._updateEditState();
              this._map.render();
            }
            return;
          }
        }
      }
    }

    // Hit test: find feature under pointer
    const hits = this._map.queryFeatures(
      [px, py],
      this._layers ? { layers: this._layers } : undefined,
    );
    if (hits.length === 0) {
      if (this._clearHoverState()) {
        this._map.render();
      }
      return;
    }

    const hit = hits[0];
    if (hit.geometryType === 'point') {
      if (this._clearHoverState()) {
        this._map.render();
      }
      return;
    }

    // Resolve source shapes + arcs
    const source = this._map.getSource(hit.source);
    if (!source) return;
    const layers = source.getLayers();
    const arcs = source.getArcs() as EditableArcs | undefined;
    if (!arcs) return;

    const resolvedLayer = this._map.layers.resolve(hit.source, hit.layer);
    const shape =
      resolvedLayer && isPathLayer(resolvedLayer) && resolvedLayer.shapes?.[hit.id]
        ? (resolvedLayer.shapes[hit.id] as EditVertexShape)
        : null;
    if (!shape) return;

    this._hoveredFeature = {
      source: hit.source,
      layer: hit.layer,
      id: hit.id,
      shape,
      arcs,
      geometryType: hit.geometryType,
      allLayers: layers as Array<{ shapes?: EditVertexShape[] }>,
    };

    // Find nearest vertex using topology-aware API;
    // fall back to edge snapping if no vertex is close enough
    this._findNearestVertices(shape, arcs, px, py);
    if (!this._hoverVertexCoords) {
      this._findInterpolatedPoint(shape, arcs, px, py);
    }
    // Find neighbor shapes sharing the hovered arc (for shared-edge highlight)
    this._findNeighborShapes(arcs);
    if (this._getHoverSignature() === previousHoverSignature) {
      return;
    }
    this._updateEditState();
    this._map.render();
  }

  /**
   * Use MapshaperAdapter.findNearestVertices to discover ALL vertex indices
   * that share the same topological node (identical coordinates across all arcs).
   */
  private _findNearestVertices(
    shape: EditVertexShape,
    arcs: EditableArcs,
    px: number,
    py: number,
  ): void {
    if (!this._shapeHasScreenVertexNear(shape, arcs, px, py)) {
      this._hoverVertexCoords = null;
      this._hoverVertexIds = [];
      this._hoverType = null;
      this._hoverInsertionId = -1;
      return;
    }

    const p = this._map.unproject(px, py);

    // findNearestVertices returns ALL vertex IDs at the same topological node
    let ids: number[] = getDefaultMapshaperAdapter().findNearestVertices(
      p,
      shape,
      arcs as unknown as ArcCollection,
    );
    if (!ids || ids.length === 0) {
      this._hoverVertexCoords = null;
      this._hoverVertexIds = [];
      this._hoverType = null;
      this._hoverInsertionId = -1;
      return;
    }

    // Get the coordinates of the first vertex (all share the same coords)
    const vtxCoords = arcs.getVertex2(ids[0]);
    if (!vtxCoords) {
      this._hoverVertexCoords = null;
      this._hoverVertexIds = [];
      this._hoverType = null;
      this._hoverInsertionId = -1;
      return;
    }

    const detachedIds = this._getDetachedVertexIds(vtxCoords, arcs);
    if (detachedIds) ids = detachedIds;

    // Check pixel distance
    const projected = this._map.project(vtxCoords[0], vtxCoords[1]);
    const dist = Math.sqrt(
      (projected[0] - px) * (projected[0] - px) + (projected[1] - py) * (projected[1] - py),
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

  private _shapeHasScreenVertexNear(
    shape: EditVertexShape,
    arcs: EditableArcs,
    px: number,
    py: number,
  ): boolean {
    const thresholdSq = VERTEX_HIT_THRESHOLD * VERTEX_HIT_THRESHOLD;
    const minData = this._map.unproject(px - VERTEX_HIT_THRESHOLD, py - VERTEX_HIT_THRESHOLD);
    const maxData = this._map.unproject(px + VERTEX_HIT_THRESHOLD, py + VERTEX_HIT_THRESHOLD);
    const dataXMin = Math.min(minData[0], maxData[0]);
    const dataYMin = Math.min(minData[1], maxData[1]);
    const dataXMax = Math.max(minData[0], maxData[0]);
    const dataYMax = Math.max(minData[1], maxData[1]);
    const partBbox: number[] = [];

    const vertexIsNear = (x: number, y: number): boolean => {
      const projected = this._map.project(x, y);
      const dx = projected[0] - px;
      const dy = projected[1] - py;
      return dx * dx + dy * dy <= thresholdSq;
    };

    for (const part of shape) {
      if (arcs.getSimpleShapeBbox !== undefined) {
        arcs.getSimpleShapeBbox(part, partBbox);
        if (
          dataXMax < partBbox[0] ||
          dataXMin > partBbox[2] ||
          dataYMax < partBbox[1] ||
          dataYMin > partBbox[3]
        ) {
          continue;
        }
      }

      const shapeIter = arcs.getShapeIter?.(part);
      if (shapeIter) {
        while (shapeIter.hasNext()) {
          if (vertexIsNear(shapeIter.x, shapeIter.y)) return true;
        }
        continue;
      }

      for (const rawArcId of part) {
        const iter = arcs.getArcIter(rawArcId);
        while (iter.hasNext()) {
          if (vertexIsNear(iter.x, iter.y)) return true;
        }
      }
    }

    return false;
  }

  /**
   * Find the closest point along any segment edge (not just vertices).
   * Uses mapshaper's forEachSegmentInShape + findClosestPointOnSeg.
   * Called as fallback when no existing vertex is within hover threshold.
   */
  private _findInterpolatedPoint(
    shape: EditVertexShape,
    arcs: EditableArcs,
    px: number,
    py: number,
  ): void {
    const p = this._map.unproject(px, py);
    let minDist = Infinity;
    let closest: { insertionId: number; point: [number, number] } | null = null;

    const adapter = getDefaultMapshaperAdapter();
    adapter.forEachSegmentInShape(shape, arcs as unknown as ArcCollection, (i, j, xx, yy) => {
      const x1 = xx[i],
        y1 = yy[i];
      const x2 = xx[j],
        y2 = yy[j];
      const p2 = adapter.findClosestPointOnSeg(p[0], p[1], x1, y1, x2, y2, 0);
      const dx = p2[0] - p[0];
      const dy = p2[1] - p[1];
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist) {
        minDist = dist;
        closest = {
          insertionId: (i < j ? i : j) + 1,
          point: [p2[0], p2[1]],
        };
      }
    });

    if (!closest) return;

    // Extract after null guard to avoid TS closure narrowing issue
    const closestResult = closest as { insertionId: number; point: [number, number] };

    // Convert data-space distance to pixel distance
    const projected = this._map.project(closestResult.point[0], closestResult.point[1]);
    const pixelDist = Math.sqrt(
      (projected[0] - px) * (projected[0] - px) + (projected[1] - py) * (projected[1] - py),
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
      arcIdSet.add(
        getDefaultMapshaperAdapter().findArcIdFromVertexId(this._hoverInsertionId - 1, ii),
      );
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
    const allShapes =
      this._neighborShapes.length > 0
        ? [this._hoveredFeature.shape, ...this._neighborShapes]
        : [this._hoveredFeature.shape];
    this._map.setEditVertexState({
      shapes: allShapes,
      arcs: this._hoveredFeature.arcs,
      hoverVertex: this._hoverVertexCoords,
      hoverType: this._hoverType,
      geometryType: geomType,
      polygonFill: geomType === 'polygon' ? this._polygonFillColor : null,
      neighborShapes: this._neighborShapes.length > 0 ? this._neighborShapes : undefined,
    });
  }

  private _clearHoverState(): boolean {
    const hadState =
      this._hoveredFeature !== null ||
      this._hoverVertexCoords !== null ||
      this._hoverVertexIds.length > 0 ||
      this._hoverType !== null ||
      this._hoverInsertionId !== -1 ||
      this._neighborShapes.length > 0;
    if (!hadState) return false;

    this._hoveredFeature = null;
    this._hoverVertexCoords = null;
    this._hoverVertexIds = [];
    this._hoverType = null;
    this._hoverInsertionId = -1;
    this._neighborShapes = [];
    this._map.clearEditVertexState();
    return true;
  }

  private _getHoverSignature(): string {
    if (!this._hoveredFeature) return 'none';
    const vertex = this._hoverVertexCoords
      ? `${this._hoverVertexCoords[0]},${this._hoverVertexCoords[1]}`
      : '';
    const neighborIds = this._neighborShapes
      .map((shape) => this._getShapeSignatureId(shape))
      .join(',');
    return [
      this._hoveredFeature.source,
      this._hoveredFeature.layer,
      this._hoveredFeature.id,
      this._hoveredFeature.geometryType,
      this._getShapeSignatureId(this._hoveredFeature.shape),
      this._hoverType ?? '',
      this._hoverInsertionId,
      this._hoverVertexIds.join(','),
      vertex,
      neighborIds,
    ].join('|');
  }

  private _getShapeSignatureId(shape: EditVertexShape): number {
    let id = this._shapeSignatureIds.get(shape);
    if (id === undefined) {
      id = this._nextShapeSignatureId++;
      this._shapeSignatureIds.set(shape, id);
    }
    return id;
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
    this._map.pushCommand(
      new VertexInsertCommand({
        insertionId,
        point,
        arcs: this._hoveredFeature.arcs as unknown as ArcCollection,
        source: source as TopologySource,
      }),
    );
  }

  private _handleDrag(px: number, py: number): void {
    if (!this._hoveredFeature || this._hoverVertexIds.length === 0) return;

    const dataCoords = this._resolveDragCoords(px, py);
    const arcs = this._hoveredFeature.arcs;

    // Topology-aware: move ALL shared vertices to the new position
    getDefaultMapshaperAdapter().snapVertices(
      this._hoverVertexIds,
      [dataCoords[0], dataCoords[1]],
      arcs as unknown as ArcCollection,
    );

    // Update hover coords so highlight follows the pointer
    this._hoverVertexCoords = [dataCoords[0], dataCoords[1]];
    if (this._detachedNode && this._matchesDetachedNode(this._hoveredFeature)) {
      this._detachedNode.coords = [dataCoords[0], dataCoords[1]];
    }

    // Update edit state and repaint — vertex dots + data layer on same canvas
    this._updateEditState();
    this._map.render();
  }

  private _matchesDetachedNode(
    feature: HoveredFeature,
    coords: [number, number] | null = this._hoverVertexCoords,
  ): boolean {
    const detached = this._detachedNode;
    return !!(
      detached &&
      coords &&
      detached.source === feature.source &&
      detached.layer === feature.layer &&
      detached.id === feature.id &&
      detached.coords[0] === coords[0] &&
      detached.coords[1] === coords[1]
    );
  }

  private _getDetachedVertexIds(coords: [number, number], arcs: EditableArcs): number[] | null {
    const detached = this._detachedNode;
    if (
      !detached ||
      !this._hoveredFeature ||
      !this._matchesDetachedNode(this._hoveredFeature, coords)
    ) {
      return null;
    }
    const data = arcs.getVertexData();
    const valid = detached.vertexIds.every(
      (id) => id < data.xx.length && data.xx[id] === coords[0] && data.yy[id] === coords[1],
    );
    if (!valid) {
      this._detachedNode = null;
      return null;
    }
    return detached.vertexIds.slice();
  }

  private _resolveDragCoords(px: number, py: number): [number, number] {
    return this._findDragSnapTarget(px, py) ?? this._map.unproject(px, py);
  }

  private _findDragSnapTarget(px: number, py: number): [number, number] | null {
    if (!this._hoveredFeature || (!this._snapToVertex && !this._snapToEdge)) return null;

    const source = this._map.getSource?.(this._hoveredFeature.source);
    const layers = source?.getLayers?.();
    const arcs = source?.getArcs?.() as EditableArcs | undefined;
    if (!layers || !arcs) return null;

    const adapter = getDefaultMapshaperAdapter();
    const dataPoint = this._map.unproject(px, py);
    const movingVertices = new Set(this._hoverVertexIds);
    let bestDist = this._snapThreshold;
    let bestCoord: [number, number] | null = null;
    const snapBox: [[number, number], [number, number]] = [
      [px - this._snapThreshold, py - this._snapThreshold],
      [px + this._snapThreshold, py + this._snapThreshold],
    ];
    const snapMinData = this._map.unproject(snapBox[0][0], snapBox[0][1]);
    const snapMaxData = this._map.unproject(snapBox[1][0], snapBox[1][1]);
    const dataXMin = Math.min(snapMinData[0], snapMaxData[0]);
    const dataYMin = Math.min(snapMinData[1], snapMaxData[1]);
    const dataXMax = Math.max(snapMinData[0], snapMaxData[0]);
    const dataYMax = Math.max(snapMinData[1], snapMaxData[1]);
    const partBbox: number[] = [];

    const considerVertex = (
      vertexId: number,
      xx: Float64Array,
      yy: Float64Array,
      projected: [number, number],
    ) => {
      if (!this._snapToVertex || movingVertices.has(vertexId)) return;
      const dist = Math.hypot(projected[0] - px, projected[1] - py);
      if (dist < bestDist) {
        bestDist = dist;
        bestCoord = [xx[vertexId], yy[vertexId]];
      }
    };

    const hits = this._map.queryFeatures(
      snapBox,
      this._layers ? { layers: this._layers } : undefined,
    );
    if (hits.length === 0) return null;

    const layerById = new globalThis.Map<
      string,
      { layer: (typeof layers)[number]; layerId: string }
    >();
    for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
      const layer = layers[layerIndex];
      if (!isPathLayer(layer) || !layer.shapes) continue;
      const layerId = getLayerId(layer, layerIndex);
      layerById.set(layerId, { layer, layerId });
    }

    for (const hit of hits) {
      if (hit.source !== this._hoveredFeature.source) continue;
      if (hit.geometryType === 'point') continue;
      if (hit.layer === this._hoveredFeature.layer && hit.id === this._hoveredFeature.id) continue;
      const entry = layerById.get(hit.layer);
      const shape = entry?.layer.shapes?.[hit.id];
      if (!shape) continue;
      const pathShape = shape as number[][];

      const candidateShape =
        arcs.getSimpleShapeBbox !== undefined
          ? pathShape.filter((part) => {
              arcs.getSimpleShapeBbox!(part, partBbox);
              return !(
                dataXMax < partBbox[0] ||
                dataXMin > partBbox[2] ||
                dataYMax < partBbox[1] ||
                dataYMin > partBbox[3]
              );
            })
          : pathShape;
      if (candidateShape.length === 0) continue;

      adapter.forEachSegmentInShape(
        candidateShape,
        arcs as unknown as ArcCollection,
        (i, j, xx, yy) => {
          const projectedA = this._map.project(xx[i], yy[i]);
          const projectedB = this._map.project(xx[j], yy[j]);
          if (
            Math.max(projectedA[0], projectedB[0]) < snapBox[0][0] ||
            Math.min(projectedA[0], projectedB[0]) > snapBox[1][0] ||
            Math.max(projectedA[1], projectedB[1]) < snapBox[0][1] ||
            Math.min(projectedA[1], projectedB[1]) > snapBox[1][1]
          ) {
            return;
          }

          considerVertex(i, xx, yy, projectedA);
          considerVertex(j, xx, yy, projectedB);

          if (!this._snapToEdge) return;
          const closest = adapter.findClosestPointOnSeg(
            dataPoint[0],
            dataPoint[1],
            xx[i],
            yy[i],
            xx[j],
            yy[j],
            0,
          );
          const projected = this._map.project(closest[0], closest[1]);
          const dist = Math.hypot(projected[0] - px, projected[1] - py);
          if (dist < bestDist) {
            bestDist = dist;
            bestCoord = [closest[0], closest[1]];
          }
        },
      );
    }

    return bestCoord;
  }

  private _finishDrag(px: number, py: number): void {
    if (!this._dragging || !this._hoveredFeature) return;
    this._dragging = false;

    const dataCoords = this._resolveDragCoords(px, py);
    const sourceId = this._hoveredFeature.source;
    const movedVertexIds = this._hoverVertexIds.slice();
    const finishingDetachedNode = this._matchesDetachedNode(this._hoveredFeature);
    if (movedVertexIds.length > 0) {
      getDefaultMapshaperAdapter().snapVertices(
        movedVertexIds,
        [dataCoords[0], dataCoords[1]],
        this._hoveredFeature.arcs as unknown as ArcCollection,
      );
      this._hoverVertexCoords = [dataCoords[0], dataCoords[1]];
      if (finishingDetachedNode && this._detachedNode) {
        this._detachedNode.coords = [dataCoords[0], dataCoords[1]];
      }
    }

    // mapshaper's snapVerticesToPoint already updates the moved arcs' bounds
    // during the drag (see paths/mapshaper-vertex-utils.mjs). Avoid a no-op
    // transformPoints() here: it walks every vertex and rebuilds every arc bbox,
    // which is a visible mouseup pause on large datasets.
    const arcs = this._hoveredFeature.arcs;

    // If the source has a low-detail LOD copy, rebuild it before the final
    // repaint. Deferring this into DisplayArcs.getScaledArcs() moves the O(N)
    // work into renderLayers(), which is visible as a large-dataset render
    // hitch. The no-op transformPoints() above was the avoidable full-bounds
    // rebuild; this LOD refresh keeps the next frame consistent.
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
    const source = this._map.getSource(sourceId);
    if (dragMoved && movedVertexIds.length > 0 && source) {
      this._map.pushCommand(
        new VertexMoveCommand({
          vertexIds: movedVertexIds,
          from: [from[0], from[1]],
          to: [dataCoords[0], dataCoords[1]],
          arcs: arcs as unknown as ArcCollection,
          source: source as TopologySource,
        }),
      );
    }
    this._dragFromCoords = null;

    const coincidentVertexIds = getDefaultMapshaperAdapter().findNearestVertices(
      dataCoords,
      this._hoveredFeature.shape,
      arcs as unknown as ArcCollection,
    );
    if (coincidentVertexIds.length > 0) {
      this._hoverVertexIds = coincidentVertexIds;
    }

    if (finishingDetachedNode && this._detachedNode && source) {
      const layer = this._map.layers.resolve(sourceId, this._hoveredFeature.layer);
      const featureVertexId = this._findHoveredFeatureVertexId();
      if (
        layer &&
        featureVertexId !== null &&
        isSharedNode(
          source as TopologySource,
          layer,
          this._hoveredFeature.id,
          featureVertexId,
          source.getLayers(),
        )
      ) {
        this._detachedNode = null;
      }
    }

    // Fire vertex_moved event with topology info
    this._map.fire('vertex_moved', {
      id: this._hoveredFeature.id,
      source: sourceId,
      layer: this._hoveredFeature.layer,
      vertexIndex: this._hoverVertexIds[0] ?? null,
      vertexIds: this._hoverVertexIds,
      coords: dataCoords,
    });

    // Final repaint
    this._map.render();
  }
}
