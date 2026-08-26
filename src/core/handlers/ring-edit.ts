import type { Handler, HandlerResult, NormalizedPointerEvent } from '../handler';
import type { OpResult } from '../../map/op-result';
import type { EditHandlerHost } from './edit-handler-host';
import type { FeatureRef } from '../../map/types';
import type { ArcCollection, ArcVertexData, PathLayer, PathShape } from '../../types/mapshaper-types';
import { isPathLayer } from '../../types/mapshaper-types';
import { SketchSession, type SketchSnapTarget } from './sketch-session';

export interface RingEditOptions {
  mode?: 'add' | 'delete';
  snapThreshold?: number;
}

const DEFAULT_OPTIONS: Required<Pick<RingEditOptions, 'mode'>> = { mode: 'add' };
const DEFAULT_SNAP_THRESHOLD = 10;

type SelectionContext = {
  key: string;
  ref: FeatureRef;
  layer: PathLayer;
  arcs: ArcCollection | null;
};

/** Interactive interior-ring editor delegated to `ops.addRing` and `ops.deleteRing`. */
export class RingEditHandler implements Handler<RingEditOptions> {
  readonly name = 'ringEdit';
  private _enabled = false;
  private _opts: RingEditOptions;
  private _generation = 0;
  private _submissionGeneration: number | null = null;
  private _selectionKey: string | null = null;
  private _snapContext: SelectionContext | null = null;
  private _session: SketchSession;
  _manager?: { refreshCursor(): void };

  private readonly _onKeyDownBound = (event: KeyboardEvent) => this._session.handleKeyDown(event);
  private readonly _onSelectionChangeBound = () => this._onSelectionChange();

  constructor(private readonly _map: EditHandlerHost, options: RingEditOptions = {}) {
    this._opts = { ...DEFAULT_OPTIONS, ...options };
    this._session = this._createSession();
    this._map.on('editmodechange', (event: { mode: string }) => {
      if (event.mode !== 'ring' && this._enabled) this._quietDisable();
    });
  }

  enable(): void {
    if (this._enabled) return;
    const context = this._resolveSelectionContext();
    if (!context) throw new Error('ringEdit: selection must contain exactly one polygon feature');
    this._selectionKey = context.key;
    this._generation++;
    this._enabled = true;
    this._map.setEditMode('ring');
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

  setOptions(options: Partial<RingEditOptions>): void {
    const modeChanged = options.mode !== undefined && options.mode !== this._opts.mode;
    this._opts = { ...this._opts, ...options };
    if (!this._enabled) {
      this._session = this._createSession();
      return;
    }
    if (!modeChanged) return;
    this._generation++;
    this._session.clear();
    this._session = this._createSession();
    this._map.render();
  }

  getOptions(): Readonly<RingEditOptions> {
    return { ...this._opts };
  }

  getCursor(): string | null {
    return this._enabled ? 'crosshair' : null;
  }

  handlePointer(event: NormalizedPointerEvent): HandlerResult {
    if (!this._enabled) return 'passthrough';
    if (event.kind === 'click' && (event.button !== 0 || this._submissionGeneration === this._generation))
      return 'passthrough';
    const context = this._resolveSelectionContext();
    if (!context || !this._isCurrentSelection(context)) {
      this._session.clear();
      this._map.render();
      return event.kind === 'click' ? 'consumed' : 'passthrough';
    }
    if (this._opts.mode === 'delete') {
      if (event.kind !== 'click') return 'passthrough';
      void this._submit(() => this._map.ops.deleteRing({ point: this._map.unproject(event.point.x, event.point.y) }));
      return 'consumed';
    }
    this._snapContext = context;
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
    this._selectionKey = context?.key ?? null;
    this._map.render();
  }

  private _createSession(): SketchSession {
    return new SketchSession(
      this._map,
      {
        minVertices: 3,
        closeRing: true,
        resolveSnap: (px, py) =>
          this._snapContext ? this._findSnapTarget(px, py, this._snapContext) : null,
      },
      (vertices) => void this._submit(() => this._map.ops.addRing({ ring: vertices })),
    );
  }

  private _resolveSelectionContext(): SelectionContext | null {
    const selected = this._map.getSelection();
    if (!Array.isArray(selected) || selected.length !== 1 || !(0 in selected)) return null;
    const ref = selected[0];
    if (
      !ref ||
      typeof ref.source !== 'string' ||
      typeof ref.layer !== 'string' ||
      !Number.isInteger(ref.id) ||
      ref.id < 0
    )
      return null;
    const layer = this._map.layers.resolve(ref.source, ref.layer);
    if (!layer || !isPathLayer(layer) || layer.geometry_type !== 'polygon' || !layer.shapes) return null;
    const shape = layer.shapes[ref.id];
    if (!this._isPathShape(shape)) return null;
    const arcs = this._map.getSource(ref.source)?.getArcs() as ArcCollection | undefined;
    return { key: JSON.stringify([ref.source, ref.layer, ref.id]), ref, layer, arcs: arcs ?? null };
  }

  private _isPathShape(shape: unknown): shape is PathShape {
    return Array.isArray(shape) && shape.length > 0 && shape.every((part) => Array.isArray(part) && part.length > 0);
  }

  private _isCurrentSelection(context: SelectionContext): boolean {
    return this._selectionKey !== null && this._selectionKey === context.key;
  }


  private async _submit(operation: () => Promise<OpResult<void>>): Promise<void> {
    if (this._submissionGeneration === this._generation) return;
    const context = this._resolveSelectionContext();
    if (!context || !this._isCurrentSelection(context)) {
      this._map.render();
      return;
    }
    const generation = this._generation;
    this._submissionGeneration = generation;
    try {
      const result = await operation();
      if (generation === this._generation && !result.ok) this._map.fire('error', { error: result.error });
    } finally {
      if (this._submissionGeneration === generation) this._submissionGeneration = null;
      if (generation === this._generation) this._map.render();
    }
  }

  private _findSnapTarget(px: number, py: number, context: SelectionContext): SketchSnapTarget | null {
    const vertexData = context.arcs?.getVertexData?.() as ArcVertexData | undefined;
    if (!vertexData) return null;
    const threshold = this._opts.snapThreshold ?? DEFAULT_SNAP_THRESHOLD;
    let bestDistance = threshold;
    let best: SketchSnapTarget | null = null;
    for (const part of context.layer.shapes![context.ref.id]!) {
      for (const rawArcId of part) {
        const arcId = rawArcId < 0 ? -rawArcId - 1 : rawArcId;
        const start = vertexData.ii[arcId];
        const count = vertexData.nn[arcId];
        if (!Number.isInteger(start) || !Number.isInteger(count)) continue;
        for (let index = start; index < start + count; index++) {
          const coord = [vertexData.xx[index]!, vertexData.yy[index]!] as [number, number];
          const projected = this._map.project(coord[0], coord[1]);
          const distance = Math.hypot(projected[0] - px, projected[1] - py);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = { coord, kind: 'vertex' };
          }
        }
      }
    }
    return best;
  }
}
