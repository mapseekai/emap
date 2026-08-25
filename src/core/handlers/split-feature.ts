import type { Handler, HandlerResult, NormalizedPointerEvent } from '../handler';
import type { EditHandlerHost } from './edit-handler-host';
import type { FeatureRef, SnapKind, SplitFeatureOptions } from '../../map/types';
import type { ArcCollection, ArcVertexData, PathShape } from '../../types/mapshaper-types';
import { isPathLayer } from '../../types/mapshaper-types';
import { projectPointOnSegment } from './draw-feature';
import { EMAP_THEME_COLORS } from '../../theme/colors';

export type { SplitFeatureOptions } from '../../map/types';

const DEFAULT_SNAP_THRESHOLD = 10;
const DEFAULT_OPTIONS: SplitFeatureOptions = { cutterType: 'point', snapThreshold: DEFAULT_SNAP_THRESHOLD };
type SnapTarget = { coord: [number, number]; kind: SnapKind };

/** Interactive cutter sketch that delegates every geometry mutation to `ops.splitSelected`. */
export class SplitFeatureHandler implements Handler<SplitFeatureOptions> {
  readonly name = 'splitFeature';
  private _enabled = false;
  private _opts: SplitFeatureOptions;
  private _vertices: [number, number][] = [];
  private _cursorCoord: [number, number] | null = null;
  private _snapCoord: [number, number] | null = null;
  private _snapKind: SnapKind = null;
  private _generation = 0;
  private _submissionGeneration: number | null = null;
  private _selectionKey: string | null = null;
  private _overlayPublished = false;
  _manager?: { refreshCursor(): void };

  private readonly _onKeyDownBound = (event: KeyboardEvent) => this._onKeyDown(event);
  private readonly _onMapMoveBound = () => this._refreshOverlay();
  private readonly _onSelectionChangeBound = () => this._onSelectionChange();

  constructor(private readonly _map: EditHandlerHost, options: Partial<SplitFeatureOptions> = {}) {
    this._opts = { ...DEFAULT_OPTIONS, ...options };
    this._map.on('editmodechange', (event: { mode: string }) => {
      if (event.mode !== 'split' && this._enabled) this._quietDisable();
    });
  }

  enable(): void {
    if (this._enabled) return;
    this._validateSelection();
    this._selectionKey = this._selectionKeyFor(this._map.getSelection());
    this._generation++;
    this._enabled = true;
    this._map.setEditMode('split');
    window.addEventListener('keydown', this._onKeyDownBound);
    this._map.on('move', this._onMapMoveBound);
    this._map.on('selectionchange', this._onSelectionChangeBound);
    this._manager?.refreshCursor();
  }

  disable(): void {
    if (!this._enabled) return;
    this._generation++;
    this._enabled = false;
    this._clearSketch();
    window.removeEventListener('keydown', this._onKeyDownBound);
    this._map.off('move', this._onMapMoveBound);
    this._map.off('selectionchange', this._onSelectionChangeBound);
    this._map.setEditMode('none');
    this._manager?.refreshCursor();
    this._map.render();
  }

  isEnabled(): boolean {
    return this._enabled;
  }

  setOptions(options: Partial<SplitFeatureOptions>): void {
    this._opts = { ...this._opts, ...options };
    if (!this._enabled) return;
    this._generation++;
    this._clearSketch();
    const selected = this._map.getSelection();
    this._selectionKey = this._isSelectionValid(selected) ? this._selectionKeyFor(selected) : null;
  }

  getOptions(): Readonly<SplitFeatureOptions> {
    return { ...this._opts };
  }

  getCursor(): string | null {
    return this._enabled ? 'crosshair' : null;
  }

  handlePointer(event: NormalizedPointerEvent): HandlerResult {
    if (!this._enabled) return 'passthrough';
    if (event.kind === 'move') {
      this._updateCursor(event.point.x, event.point.y);
      return 'passthrough';
    }
    if (event.kind === 'click') {
      if (event.button !== 0 || this._submissionGeneration === this._generation) return 'passthrough';
      this._placeVertex(event.point.x, event.point.y);
      return 'consumed';
    }
    if (event.kind === 'contextmenu') {
      event.originalEvent.preventDefault();
      if (this._submissionGeneration === this._generation) return 'consumed';
      if (this._opts.cutterType === 'polyline' && this._vertices.length >= 2) void this._submit();
      else {
        this._clearSketch();
        this._map.render();
      }
      return 'consumed';
    }
    return 'passthrough';
  }

  private _quietDisable(): void {
    this._generation++;
    this._enabled = false;
    this._clearSketch();
    window.removeEventListener('keydown', this._onKeyDownBound);
    this._map.off('move', this._onMapMoveBound);
    this._map.off('selectionchange', this._onSelectionChangeBound);
    this._manager?.refreshCursor();
    this._map.render();
  }

  private _onSelectionChange(): void {
    this._generation++;
    this._clearSketch();
    const selected = this._map.getSelection();
    this._selectionKey = this._isSelectionValid(selected) ? this._selectionKeyFor(selected) : null;
    this._map.render();
  }

  private _validateSelection(): void {
    const selected = this._map.getSelection();
    if (selected.length === 0) throw new Error('splitFeature: select features before enabling');
    const first = selected[0];
    if (selected.some((ref) => ref.source !== first.source || ref.layer !== first.layer)) {
      throw new Error('splitFeature: selection must belong to one source layer');
    }
    const layer = this._map.layers.resolve(first.source, first.layer);
    if (!layer || !isPathLayer(layer)) throw new Error('splitFeature: selection must have path geometry');
    if (this._opts.cutterType === 'point' && layer.geometry_type === 'polygon') {
      throw new Error('splitFeature: point cutter cannot split polygon selection');
    }
    if (!this._isSelectionValid(selected)) throw new Error('splitFeature: selection has invalid feature geometry');
  }

  private _isSelectionValid(selected: readonly FeatureRef[]): boolean {
    if (selected.length === 0) return false;
    const first = selected[0];
    if (selected.some((ref) => ref.source !== first.source || ref.layer !== first.layer)) return false;
    const layer = this._map.layers.resolve(first.source, first.layer);
    if (!layer || !isPathLayer(layer) || !layer.shapes) return false;
    if (this._opts.cutterType === 'point' && layer.geometry_type === 'polygon') return false;
    const arcs = this._map.getSource(first.source)?.getArcs() as ArcCollection | undefined;
    const vertexData = arcs?.getVertexData?.();
    if (!vertexData) return false;
    const shapes = layer.shapes;
    return selected.every((ref) => this._isValidPathShape(shapes[ref.id], ref.id, shapes.length, vertexData));
  }

  private _isValidPathShape(
    shape: unknown,
    id: number,
    shapeCount: number,
    vertexData: ArcVertexData,
  ): boolean {
    if (!Number.isInteger(id) || id < 0 || id >= shapeCount || !Array.isArray(shape) || shape.length === 0) return false;
    return shape.every((part) => {
      if (!Array.isArray(part) || part.length === 0) return false;
      return part.every((raw) => {
        if (!Number.isSafeInteger(raw)) return false;
        const arcId = raw < 0 ? -raw - 1 : raw;
        if (arcId < 0 || arcId >= vertexData.nn.length) return false;
        const start = vertexData.ii[arcId];
        const count = vertexData.nn[arcId];
        if (!Number.isInteger(start) || !Number.isInteger(count) || count < 2) return false;
        if (start < 0 || start + count > vertexData.xx.length || vertexData.yy.length < start + count) return false;
        for (let index = start; index < start + count; index++) {
          if (!Number.isFinite(vertexData.xx[index]) || !Number.isFinite(vertexData.yy[index])) return false;
        }
        return true;
      });
    });
  }

  private _selectionKeyFor(selected: readonly FeatureRef[]): string {
    return JSON.stringify([...new Set(selected.map((ref) => JSON.stringify([ref.source, ref.layer, ref.id])))].sort());
  }

  private _hasCurrentSelection(): boolean {
    const selected = this._map.getSelection();
    return this._selectionKey !== null && this._selectionKey === this._selectionKeyFor(selected) && this._isSelectionValid(selected);
  }

  private _updateCursor(px: number, py: number): void {
    if (!this._hasCurrentSelection()) {
      this._clearSketch();
      this._map.render();
      return;
    }
    const cursor = this._map.unproject(px, py);
    this._cursorCoord = [cursor[0], cursor[1]];
    const snap = this._findSnapTarget(px, py);
    this._snapCoord = snap?.coord ?? null;
    this._snapKind = snap?.kind ?? null;
    this._refreshOverlay();
  }

  private _placeVertex(px: number, py: number): void {
    if (!this._hasCurrentSelection()) {
      this._clearSketch();
      this._map.render();
      return;
    }
    if (this._opts.cutterType === 'point' && !this._snapCoord) return;
    const coord = this._snapCoord ?? this._map.unproject(px, py);
    this._vertices.push([coord[0], coord[1]]);
    if (this._opts.cutterType === 'point') void this._submit();
    else this._refreshOverlay();
  }

  private async _submit(): Promise<void> {
    if (this._submissionGeneration === this._generation || this._vertices.length === 0) return;
    if (!this._hasCurrentSelection()) {
      this._clearSketch();
      this._map.render();
      return;
    }
    const generation = this._generation;
    this._submissionGeneration = generation;
    const cutter =
      this._opts.cutterType === 'point'
        ? { type: 'point' as const, coordinates: this._vertices[0] }
        : { type: 'polyline' as const, coordinates: this._vertices.slice() };
    try {
      const result = await this._map.ops.splitSelected({ cutter });
      if (generation === this._generation && !result.ok) this._map.fire('error', { error: result.error });
    } finally {
      if (this._submissionGeneration === generation) this._submissionGeneration = null;
      if (generation === this._generation) {
        this._clearSketch();
        this._map.render();
      }
    }
  }

  private _onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || this._submissionGeneration === this._generation) return;
    this._clearSketch();
    this._map.render();
  }

  private _refreshOverlay(): void {
    if (this._vertices.length === 0 && !this._snapCoord) {
      if (this._overlayPublished) {
        this._overlayPublished = false;
        this._map.clearEditDrawState();
        this._map.render();
      }
      return;
    }
    this._overlayPublished = true;
    this._map.setEditDrawState({
      vertices: this._vertices.slice(),
      cursorCoord: this._snapCoord ?? this._cursorCoord,
      snapCoord: this._snapCoord,
      snapKind: this._snapKind,
      geometryType: 'polyline',
      drawColor: EMAP_THEME_COLORS.primary,
    });
    this._map.render();
  }

  private _clearSketch(): void {
    this._vertices = [];
    this._cursorCoord = null;
    this._snapCoord = null;
    this._snapKind = null;
    this._overlayPublished = false;
    this._map.clearEditDrawState();
  }

  private _findSnapTarget(px: number, py: number): SnapTarget | null {
    if (!this._hasCurrentSelection()) return null;
    const selected = this._map.getSelection();
    const first = selected[0];
    const layer = this._map.layers.resolve(first.source, first.layer);
    const source = this._map.getSource(first.source);
    const arcs = source?.getArcs() as ArcCollection | undefined;
    if (!layer || layer.geometry_type !== 'polyline' || !layer.shapes || !arcs?.forEachArcSegment) return null;

    const threshold = this._opts.snapThreshold ?? DEFAULT_SNAP_THRESHOLD;
    const c0 = this._map.unproject(px - threshold, py - threshold);
    const c1 = this._map.unproject(px + threshold, py + threshold);
    const minX = Math.min(c0[0], c1[0]);
    const maxX = Math.max(c0[0], c1[0]);
    const minY = Math.min(c0[1], c1[1]);
    const maxY = Math.max(c0[1], c1[1]);
    let bestDistance = threshold;
    let best: SnapTarget | null = null;
    const arcIds = new Set<number>();

    for (const ref of selected) {
      const shape = layer.shapes[ref.id];
      if (!shape) continue;
      for (const part of shape as PathShape) {
        for (const signedArcId of part) arcIds.add(signedArcId < 0 ? -signedArcId - 1 : signedArcId);
      }
    }
    for (const arcId of arcIds) {
      arcs.forEachArcSegment(arcId, (i, j, xx, yy) => {
        const ax = xx[i];
        const ay = yy[i];
        const bx = xx[j];
        const by = yy[j];
        if (Math.max(ax, bx) < minX || Math.min(ax, bx) > maxX || Math.max(ay, by) < minY || Math.min(ay, by) > maxY) return;
        const projected = projectPointOnSegment([px, py], this._map.project(ax, ay), this._map.project(bx, by));
        if (projected.dist >= bestDistance) return;
        bestDistance = projected.dist;
        best = { coord: this._map.unproject(projected.point[0], projected.point[1]), kind: 'edge' };
      });
    }
    return best;
  }
}
