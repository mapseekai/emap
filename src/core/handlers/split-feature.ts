import type { Handler, HandlerResult, NormalizedPointerEvent } from '../handler';
import type { EditHandlerHost } from './edit-handler-host';
import type { FeatureRef, SnapKind, SplitFeatureOptions } from '../../map/types';
import type { ArcCollection, ArcVertexData, PathLayer, PathShape } from '../../types/mapshaper-types';
import type { MutableTopologySource } from '../../source/source';
import { isPathLayer } from '../../types/mapshaper-types';
import { projectPointOnSegment } from './draw-feature';
import { EMAP_THEME_COLORS } from '../../theme/colors';

export type { SplitFeatureOptions } from '../../map/types';

const DEFAULT_SNAP_THRESHOLD = 10;
const DEFAULT_OPTIONS: SplitFeatureOptions = { cutterType: 'point', snapThreshold: DEFAULT_SNAP_THRESHOLD };
type SnapTarget = { coord: [number, number]; kind: SnapKind };
type SelectionContext = {
  key: string;
  refs: readonly FeatureRef[];
  sourceId: string;
  source: MutableTopologySource;
  layer: PathLayer;
  arcs: ArcCollection;
  shapes: readonly PathShape[];
  arcIds: readonly number[];
};

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
    const context = this._resolveSelectionContext();
    if (!context) throw new Error('splitFeature: selection has invalid feature geometry');
    this._validateSelection(context);
    this._selectionKey = context.key;
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
    const context = this._resolveSelectionContext();
    this._selectionKey = context && this._isContextCompatible(context) ? context.key : null;
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
    const context = this._resolveSelectionContext();
    this._selectionKey = context && this._isContextCompatible(context) ? context.key : null;
    this._map.render();
  }

  private _validateSelection(context: SelectionContext): void {
    if (this._opts.cutterType === 'point' && context.layer.geometry_type === 'polygon') {
      throw new Error('splitFeature: point cutter cannot split polygon selection');
    }
  }

  private _resolveSelectionContext(): SelectionContext | null {
    const selected = this._map.getSelection();
    if (!Array.isArray(selected) || selected.length === 0) return null;

    let sourceId: string | null = null;
    let layerId: string | null = null;
    for (let index = 0; index < selected.length; index++) {
      if (!(index in selected)) return null;
      const ref = selected[index];
      if (
        !ref ||
        typeof ref.source !== 'string' ||
        typeof ref.layer !== 'string' ||
        !Number.isInteger(ref.id) ||
        ref.id < 0
      ) {
        return null;
      }
      if (sourceId === null) {
        sourceId = ref.source;
        layerId = ref.layer;
      } else if (ref.source !== sourceId || ref.layer !== layerId) {
        return null;
      }
    }
    const layer = this._map.layers.resolve(sourceId!, layerId!);
    if (!layer || !isPathLayer(layer) || !layer.shapes) return null;
    const source = this._map.getSource(sourceId!);
    const arcs = source?.getArcs() as ArcCollection | undefined;
    const vertexData = arcs?.getVertexData?.();
    if (!source || !arcs || !vertexData) return null;

    const shapes: PathShape[] = [];
    const arcIds = new Set<number>();
    for (let index = 0; index < selected.length; index++) {
      const ref = selected[index];
      const shape = layer.shapes[ref.id];
      if (!this._collectPathShape(shape, ref.id, layer.shapes.length, vertexData, arcIds)) return null;
      shapes.push(shape);
    }
    for (const arcId of arcIds) {
      if (!this._isValidArc(arcId, vertexData)) return null;
    }
    return {
      key: this._selectionKeyFor(selected),
      refs: selected,
      layer,
      arcs,
      sourceId: sourceId!,
      source,
      shapes,
      arcIds: [...arcIds],
    };
  }

  private _collectPathShape(
    shape: unknown,
    id: number,
    shapeCount: number,
    vertexData: ArcVertexData,
    arcIds: Set<number>,
  ): shape is PathShape {
    if (!Number.isInteger(id) || id < 0 || id >= shapeCount || !Array.isArray(shape) || shape.length === 0) return false;
    for (let partIndex = 0; partIndex < shape.length; partIndex++) {
      if (!(partIndex in shape)) return false;
      const part = shape[partIndex];
      if (!Array.isArray(part) || part.length === 0) return false;
      for (let arcIndex = 0; arcIndex < part.length; arcIndex++) {
        if (!(arcIndex in part)) return false;
        const raw = part[arcIndex];
        if (!Number.isSafeInteger(raw)) return false;
        const arcId = raw < 0 ? -raw - 1 : raw;
        if (arcId < 0 || arcId >= vertexData.nn.length) return false;
        arcIds.add(arcId);
      }
    }
    return true;
  }

  private _isValidArc(arcId: number, vertexData: ArcVertexData): boolean {
    const start = vertexData.ii[arcId];
    const count = vertexData.nn[arcId];
    if (!Number.isInteger(start) || !Number.isInteger(count) || count < 2) return false;
    if (start < 0 || start + count > vertexData.xx.length || vertexData.yy.length < start + count) return false;
    for (let index = start; index < start + count; index++) {
      if (!Number.isFinite(vertexData.xx[index]) || !Number.isFinite(vertexData.yy[index])) return false;
    }
    return true;
  }

  private _selectionKeyFor(selected: readonly FeatureRef[]): string {
    const keys: string[] = [];
    for (let index = 0; index < selected.length; index++) {
      if (!(index in selected)) return '';
      const ref = selected[index];
      if (!ref) return '';
      keys.push(JSON.stringify([ref.source, ref.layer, ref.id]));
    }
    return JSON.stringify([...new Set(keys)].sort());
  }

  private _hasCurrentSelection(context: SelectionContext | null): context is SelectionContext {
    return context !== null && this._isContextCompatible(context) && this._selectionKey !== null && this._selectionKey === context.key;
  }

  private _isContextCompatible(context: SelectionContext): boolean {
    return this._opts.cutterType !== 'point' || context.layer.geometry_type !== 'polygon';
  }

  private _updateCursor(px: number, py: number): void {
    const context = this._resolveSelectionContext();
    if (!this._hasCurrentSelection(context)) {
      this._clearSketch();
      this._map.render();
      return;
    }
    const cursor = this._map.unproject(px, py);
    this._cursorCoord = [cursor[0], cursor[1]];
    const snap = this._findSnapTarget(px, py, context);
    this._snapCoord = snap?.coord ?? null;
    this._snapKind = snap?.kind ?? null;
    this._refreshOverlay();
  }

  private _placeVertex(px: number, py: number): void {
    if (!this._hasCurrentSelection(this._resolveSelectionContext())) {
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
    if (!this._hasCurrentSelection(this._resolveSelectionContext())) {
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

  private _findSnapTarget(px: number, py: number, context: SelectionContext): SnapTarget | null {
    const { arcs } = context;
    if (context.layer.geometry_type !== 'polyline' || !arcs.forEachArcSegment) return null;

    const threshold = this._opts.snapThreshold ?? DEFAULT_SNAP_THRESHOLD;
    const c0 = this._map.unproject(px - threshold, py - threshold);
    const c1 = this._map.unproject(px + threshold, py + threshold);
    const minX = Math.min(c0[0], c1[0]);
    const maxX = Math.max(c0[0], c1[0]);
    const minY = Math.min(c0[1], c1[1]);
    const maxY = Math.max(c0[1], c1[1]);
    let bestDistance = threshold;
    let best: SnapTarget | null = null;

    for (const arcId of context.arcIds) {
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
