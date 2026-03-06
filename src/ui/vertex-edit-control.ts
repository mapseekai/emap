import mapshaper from 'mapshaper';
import { Control } from './control';
import { Emap, EditVertexShape, EditVertexArcs } from '../map/map';

interface EditableArcs extends EditVertexArcs {
  getVertex2(vertexId: number): [number, number] | null;
  transformPoints?: (cb: (x: number, y: number) => void) => void;
}

interface HoveredFeature {
  source: string;
  layer: string;
  id: number;
  shape: EditVertexShape;
  arcs: EditableArcs;
  geometryType: string;
}

interface VertexOpsInternal {
  findNearestVertices(point: [number, number], shape: EditVertexShape, arcs: EditableArcs): number[];
  snapVerticesToPoint(vertexIds: number[], point: [number, number], arcs: EditableArcs): void;
}

const vertexOps = mapshaper.internal as unknown as VertexOpsInternal;

/** Pixel threshold for vertex hover detection */
const VERTEX_HIT_THRESHOLD = 10;

/**
 * VertexEditControl enables interactive vertex editing with topology awareness.
 * When a shared node is dragged, ALL coincident vertices move together.
 *
 * Uses mapshaper.internal.findNearestVertices to discover topologically-shared
 * vertices, and snapVerticesToPoint to move them all simultaneously.
 *
 * Usage:
 *   map.addControl(new VertexEditControl(), 'top-left');
 */
export class VertexEditControl implements Control {
  private _map: Emap | null = null;
  private _container: HTMLElement | null = null;
  private _btn: HTMLButtonElement | null = null;
  private _active: boolean = false;

  // Hover / drag state
  private _hoveredFeature: HoveredFeature | null = null;
  private _hoverVertexCoords: [number, number] | null = null;
  private _hoverVertexIds: number[] = [];  // ALL vertex indices sharing this topological node
  private _dragging: boolean = false;

  // Bound handlers
  private _onMouseMoveBound: (e: MouseEvent) => void;
  private _onMouseDownBound: (e: MouseEvent) => void;
  private _onMouseUpBound: (e: MouseEvent) => void;
  private _onMoveHandlerBound: () => void;

  constructor() {
    this._onMouseMoveBound = this._onMouseMove.bind(this);
    this._onMouseDownBound = this._onMouseDown.bind(this);
    this._onMouseUpBound = this._onMouseUp.bind(this);
    this._onMoveHandlerBound = this._onMapMove.bind(this);
  }

  onAdd(map: Emap): HTMLElement {
    this._map = map;
    this._container = document.createElement('div');
    this._container.className = 'emap-ctrl emap-ctrl-group';

    this._btn = document.createElement('button');
    this._btn.className = 'emap-ctrl-edit';
    this._btn.type = 'button';
    this._btn.title = 'Edit Vertices';
    this._btn.innerHTML = '<span class="emap-ctrl-icon">✏</span>';
    this._btn.addEventListener('click', () => this._toggle());
    this._container.appendChild(this._btn);

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
    this._map.setEditMode('vertex');

    const container = this._map.getCanvasContainer();
    container.classList.add('emap-edit-active');
    container.addEventListener('mousemove', this._onMouseMoveBound);
    container.addEventListener('mousedown', this._onMouseDownBound);
    window.addEventListener('mouseup', this._onMouseUpBound);
    this._map.on('move', this._onMoveHandlerBound);
  }

  private _deactivate(): void {
    if (!this._map) return;
    this._active = false;
    this._btn?.classList.remove('active');
    this._map.setEditMode('none');
    this._map.clearEditVertexState();
    this._hoveredFeature = null;
    this._hoverVertexCoords = null;
    this._hoverVertexIds = [];
    this._dragging = false;

    const container = this._map.getCanvasContainer();
    container.classList.remove('emap-edit-active');
    container.removeEventListener('mousemove', this._onMouseMoveBound);
    container.removeEventListener('mousedown', this._onMouseDownBound);
    window.removeEventListener('mouseup', this._onMouseUpBound);
    this._map.off('move', this._onMoveHandlerBound);
    this._map.render();
  }

  /** Redraw on map move/zoom (vertices stay fixed to geography) */
  private _onMapMove(): void {
    if (this._hoveredFeature && !this._dragging) {
      this._updateEditState();
      this._map?.render();
    }
  }

  private _onMouseMove(e: MouseEvent): void {
    if (!this._map) return;

    if (this._dragging) {
      this._handleDrag(e);
      return;
    }

    const rect = this._map.getCanvasContainer().getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    // Hit test: find feature under pointer
    const hits = this._map.queryRenderedFeatures([px, py]);
    if (hits.length === 0) {
      this._hoveredFeature = null;
      this._hoverVertexCoords = null;
      this._hoverVertexIds = [];
      this._map.clearEditVertexState();
      this._map.render();
      return;
    }

    const hit = hits[0];
    if (hit.geometryType === 'point') {
      this._hoveredFeature = null;
      this._hoverVertexCoords = null;
      this._hoverVertexIds = [];
      this._map.clearEditVertexState();
      this._map.render();
      return;
    }

    // Resolve source shapes + arcs
    const source = this._map.getSource(hit.source);
    if (!source) return;
    const layers = source.getLayers();
    const arcs = source.getArcs();
    if (!arcs) return;

    let shape: EditVertexShape | null = null;
    for (const layer of layers) {
      if (layer.shapes && layer.shapes[hit.id]) {
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
      geometryType: hit.geometryType
    };

    // Find nearest vertex using topology-aware API
    this._findNearestVertices(shape, arcs, px, py);
    this._updateEditState();
    this._map.render();
  }

  /**
   * Use mapshaper.internal.findNearestVertices to discover ALL vertex indices
   * that share the same topological node (identical coordinates across all arcs).
   */
  private _findNearestVertices(shape: EditVertexShape, arcs: EditableArcs, px: number, py: number): void {
    if (!this._map) return;

    const p = this._map.unproject(px, py);

    // findNearestVertices returns ALL vertex IDs at the same topological node
    const ids: number[] = vertexOps.findNearestVertices(p, shape, arcs);
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
    } else {
      this._hoverVertexCoords = null;
      this._hoverVertexIds = [];
    }
  }

  /** Update the edit vertex state on the map so render() draws vertex dots */
  private _updateEditState(): void {
    if (!this._map || !this._hoveredFeature) return;
    this._map.setEditVertexState({
      shapes: [this._hoveredFeature.shape],
      arcs: this._hoveredFeature.arcs,
      hoverVertex: this._hoverVertexCoords
    });
  }

  private _onMouseDown(e: MouseEvent): void {
    if (!this._hoverVertexCoords || !this._hoveredFeature) return;
    e.preventDefault();
    e.stopPropagation();
    this._dragging = true;
  }

  private _handleDrag(e: MouseEvent): void {
    if (!this._map || !this._hoveredFeature || this._hoverVertexIds.length === 0) return;
    const rect = this._map.getCanvasContainer().getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    // Convert screen coords to data coords
    const dataCoords = this._map.unproject(px, py);
    const arcs = this._hoveredFeature.arcs;

    // Topology-aware: move ALL shared vertices to the new position
    vertexOps.snapVerticesToPoint(
      this._hoverVertexIds,
      [dataCoords[0], dataCoords[1]],
      arcs
    );

    // Update hover coords so highlight follows the pointer
    this._hoverVertexCoords = [dataCoords[0], dataCoords[1]];

    // Update edit state and repaint — vertex dots + data layer on same canvas
    this._updateEditState();
    this._map.render();
  }

  private _onMouseUp(e: MouseEvent): void {
    if (!this._dragging || !this._map || !this._hoveredFeature) return;
    this._dragging = false;

    const rect = this._map.getCanvasContainer().getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const dataCoords = this._map.unproject(px, py);

    const arcs = this._hoveredFeature.arcs;

    // Force arc bounding box recalculation (Mapshaper pattern)
    if (arcs.transformPoints) {
      arcs.transformPoints(function () { });
    }

    // Fire vertex_moved event with topology info
    this._map.fire('vertex_moved', {
      id: this._hoveredFeature.id,
      source: this._hoveredFeature.source,
      layer: this._hoveredFeature.layer,
      vertexIndex: this._hoverVertexIds[0] ?? null,
      vertexIds: this._hoverVertexIds,
      coords: dataCoords
    });

    // Final repaint
    this._map.render();
  }
}
