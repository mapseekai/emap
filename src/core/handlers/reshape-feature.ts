import type { Handler, HandlerResult, NormalizedPointerEvent } from '../handler';
import type { EditHandlerHost } from './edit-handler-host';
import type { FeatureRef } from '../../map/types';
import type {
  ArcCollection,
  ArcVertexData,
  PathLayer,
  PathShape,
} from '../../types/mapshaper-types';
import type { MutableTopologySource } from '../../source/source';
import { isPathLayer } from '../../types/mapshaper-types';
import { projectPointOnSegment } from './draw-feature';
import { SketchSession, type SketchSnapTarget } from './sketch-session';

export interface ReshapeFeatureOptions {
  snapThreshold?: number;
}

const DEFAULT_SNAP_THRESHOLD = 10;
type SelectionContext = {
  key: string;
  refs: readonly FeatureRef[];
  sourceId: string;
  source: MutableTopologySource;
  layer: PathLayer;
  arcs: ArcCollection;
  vertexData: ArcVertexData;
  shapes: readonly PathShape[];
  arcIds: readonly number[];
};

/** Interactive reshape-line sketch delegated to `ops.reshapeSelected`. */
export class ReshapeFeatureHandler implements Handler<ReshapeFeatureOptions> {
  readonly name = 'reshapeFeature';
  private _enabled = false;
  private _opts: ReshapeFeatureOptions;
  private _generation = 0;
  private _submissionGeneration: number | null = null;
  private _selectionKey: string | null = null;
  private _snapContext: SelectionContext | null = null;
  private _session: SketchSession;
  _manager?: { refreshCursor(): void };

  private readonly _onKeyDownBound = (event: KeyboardEvent) => this._session.handleKeyDown(event);
  private readonly _onSelectionChangeBound = () => this._onSelectionChange();

  constructor(private readonly _map: EditHandlerHost, options: ReshapeFeatureOptions = {}) {
    this._opts = { ...options };
    this._session = this._createSession();
    this._map.on('editmodechange', (event: { mode: string }) => {
      if (event.mode !== 'reshape' && this._enabled) this._quietDisable();
    });
  }

  enable(): void {
    if (this._enabled) return;
    const context = this._resolveSelectionContext();
    if (!context) throw new Error('reshapeFeature: selection has invalid feature geometry');
    this._selectionKey = context.key;
    this._generation++;
    this._enabled = true;
    this._map.setEditMode('reshape');
    window.addEventListener('keydown', this._onKeyDownBound);
    this._map.on('selectionchange', this._onSelectionChangeBound);
    this._manager?.refreshCursor();
  }

  disable(): void {
    if (!this._enabled) return;
    this._generation++;
    this._enabled = false;
    this._session.clear();
    window.removeEventListener('keydown', this._onKeyDownBound);
    this._map.off('selectionchange', this._onSelectionChangeBound);
    this._map.setEditMode('none');
    this._manager?.refreshCursor();
    this._map.render();
  }

  isEnabled(): boolean {
    return this._enabled;
  }

  setOptions(options: Partial<ReshapeFeatureOptions>): void {
    this._opts = { ...this._opts, ...options };
    if (!this._enabled) {
      this._session = this._createSession();
      return;
    }
    this._session.clear();
    this._session = this._createSession();
    this._generation++;
    const context = this._resolveSelectionContext();
    this._selectionKey = context && this._isCurrentSelection(context) ? context.key : null;
  }

  getOptions(): Readonly<ReshapeFeatureOptions> {
    return { ...this._opts };
  }

  getCursor(): string | null {
    return this._enabled ? 'crosshair' : null;
  }

  handlePointer(event: NormalizedPointerEvent): HandlerResult {
    if (!this._enabled) return 'passthrough';
    if (event.kind === 'click' && (event.button !== 0 || this._submissionGeneration === this._generation))
      return 'passthrough';
    if (
      (event.kind === 'move' || event.kind === 'click') &&
      !this._setSnapContext(this._resolveSelectionContext())
    ) {
      this._session.clear();
      this._map.render();
      return event.kind === 'click' ? 'consumed' : 'passthrough';
    }
    try {
      if (event.kind === 'contextmenu' && this._submissionGeneration === this._generation) {
        event.originalEvent.preventDefault();
        return 'consumed';
      }
      return this._session.handlePointer(event);
    } finally {
      this._snapContext = null;
    }
  }

  dispose(): void {
    this.disable();
  }

  private _quietDisable(): void {
    this._generation++;
    this._enabled = false;
    this._session.clear();
    window.removeEventListener('keydown', this._onKeyDownBound);
    this._map.off('selectionchange', this._onSelectionChangeBound);
    this._manager?.refreshCursor();
    this._map.render();
  }

  private _onSelectionChange(): void {
    this._generation++;
    this._session.clear();
    const context = this._resolveSelectionContext();
    this._selectionKey = context && this._isCurrentSelection(context) ? context.key : null;
    this._map.render();
  }

  private _createSession(): SketchSession {
    return new SketchSession(
      this._map,
      {
        minVertices: 2,
        resolveSnap: (px, py) =>
          this._snapContext ? this._findSnapTarget(px, py, this._snapContext) : null,
      },
      (vertices) => void this._submit(vertices),
    );
  }

  private _setSnapContext(context: SelectionContext | null): context is SelectionContext {
    this._snapContext = context && this._isCurrentSelection(context) ? context : null;
    return this._snapContext !== null;
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
      )
        return null;
      if (sourceId === null) {
        sourceId = ref.source;
        layerId = ref.layer;
      } else if (ref.source !== sourceId || ref.layer !== layerId) return null;
    }
    const layer = this._map.layers.resolve(sourceId!, layerId!);
    if (!layer || !isPathLayer(layer) || !layer.shapes) return null;
    const source = this._map.getSource(sourceId!);
    const arcs = source?.getArcs() as ArcCollection | undefined;
    const vertexData = arcs?.getVertexData?.();
    if (!source || !arcs || !vertexData) return null;

    const shapes: PathShape[] = [];
    const arcIds = new Set<number>();
    for (const ref of selected) {
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
      vertexData,
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
    if (!Number.isInteger(id) || id < 0 || id >= shapeCount || !Array.isArray(shape) || shape.length === 0)
      return false;
    for (const part of shape) {
      if (!Array.isArray(part) || part.length === 0) return false;
      for (const raw of part) {
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
    if (start < 0 || start + count > vertexData.xx.length || vertexData.yy.length < start + count)
      return false;
    for (let index = start; index < start + count; index++) {
      if (!Number.isFinite(vertexData.xx[index]) || !Number.isFinite(vertexData.yy[index])) return false;
    }
    return true;
  }

  private _selectionKeyFor(selected: readonly FeatureRef[]): string {
    return JSON.stringify(
      [...new Set(selected.map((ref) => JSON.stringify([ref.source, ref.layer, ref.id])))].sort(),
    );
  }

  private _isCurrentSelection(context: SelectionContext): boolean {
    return this._selectionKey !== null && this._selectionKey === context.key;
  }

  private async _submit(vertices: [number, number][]): Promise<void> {
    if (this._submissionGeneration === this._generation || vertices.length === 0) return;
    const context = this._resolveSelectionContext();
    if (!context || !this._isCurrentSelection(context)) {
      this._map.render();
      return;
    }
    const generation = this._generation;
    this._submissionGeneration = generation;
    try {
      const result = await this._map.ops.reshapeSelected({ line: vertices });
      if (generation === this._generation && !result.ok) this._map.fire('error', { error: result.error });
    } finally {
      if (this._submissionGeneration === generation) this._submissionGeneration = null;
      if (generation === this._generation) this._map.render();
    }
  }

  private _findSnapTarget(px: number, py: number, context: SelectionContext): SketchSnapTarget | null {
    const threshold = this._opts.snapThreshold ?? DEFAULT_SNAP_THRESHOLD;
    const c0 = this._map.unproject(px - threshold, py - threshold);
    const c1 = this._map.unproject(px + threshold, py + threshold);
    const minX = Math.min(c0[0], c1[0]);
    const maxX = Math.max(c0[0], c1[0]);
    const minY = Math.min(c0[1], c1[1]);
    const maxY = Math.max(c0[1], c1[1]);
    let bestDistance = threshold;
    let best: SketchSnapTarget | null = null;
    const { vertexData } = context;
    for (const arcId of context.arcIds) {
      const start = vertexData.ii[arcId]!;
      const count = vertexData.nn[arcId]!;
      for (let index = start; index < start + count; index++) {
        const coord = [vertexData.xx[index]!, vertexData.yy[index]!] as [number, number];
        if (coord[0] < minX || coord[0] > maxX || coord[1] < minY || coord[1] > maxY) continue;
        const projected = this._map.project(coord[0], coord[1]);
        const distance = Math.hypot(projected[0] - px, projected[1] - py);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { coord, kind: 'vertex' };
        }
      }
    }
    if (!context.arcs.forEachArcSegment) return best;
    for (const arcId of context.arcIds) {
      context.arcs.forEachArcSegment(arcId, (i, j, xx, yy) => {
        const ax = xx[i];
        const ay = yy[i];
        const bx = xx[j];
        const by = yy[j];
        if (
          Math.max(ax, bx) < minX ||
          Math.min(ax, bx) > maxX ||
          Math.max(ay, by) < minY ||
          Math.min(ay, by) > maxY
        )
          return;
        const projected = projectPointOnSegment(
          [px, py],
          this._map.project(ax, ay),
          this._map.project(bx, by),
        );
        if (projected.dist >= bestDistance) return;
        bestDistance = projected.dist;
        best = { coord: this._map.unproject(projected.point[0], projected.point[1]), kind: 'edge' };
      });
    }
    return best;
  }
}
