import type { Handler, HandlerResult, NormalizedPointerEvent } from '../handler';
import type { EditHandlerHost } from './edit-handler-host';
import type { FeatureRef, SplitFeatureOptions } from '../../map/types';
import type { ArcCollection, PathLayer, PathShape } from '../../../shared/types/mapshaper-types';
import type { MutableTopologySource } from '../../../domain/source/source';
import { isPathLayer } from '../../../shared/types/mapshaper-types';
import {
  collectPathShapeArcIds,
  findPathSnapTarget,
  isValidPathArc,
  type PathSnapContext,
} from './path-snap';
import { SketchSession, type SketchSnapTarget } from './sketch-session';

export type { SplitFeatureOptions } from '../../map/types';

const DEFAULT_SNAP_THRESHOLD = 10;
const DEFAULT_OPTIONS: SplitFeatureOptions = {
  cutterType: 'point',
  snapThreshold: DEFAULT_SNAP_THRESHOLD,
};
type SnapTarget = SketchSnapTarget;
type SelectionContext = PathSnapContext & {
  key: string;
  refs: readonly FeatureRef[];
  sourceId: string;
  source: MutableTopologySource;
  layer: PathLayer;
  shapes: readonly PathShape[];
};

/**
 * Interactive cutter sketch that delegates every geometry mutation to `ops.splitSelected`.
 *
 * @example
 * map.splitFeature.setOptions({ cutterType: 'polyline' });
 * map.splitFeature.enable();
 */
export class SplitFeatureHandler implements Handler<SplitFeatureOptions> {
  readonly name = 'splitFeature';
  private _enabled = false;
  private _opts: SplitFeatureOptions;
  private _generation = 0;
  private _submissionGeneration: number | null = null;
  private _selectionKey: string | null = null;
  private _snapContext: SelectionContext | null = null;
  private _session: SketchSession;
  _manager?: { refreshCursor(): void };

  private readonly _onKeyDownBound = (event: KeyboardEvent) => this._session.handleKeyDown(event);
  private readonly _onSelectionChangeBound = () => this._onSelectionChange();
  private readonly _onSourceDataBound = (event: { sourceId?: string }) => {
    if (this._map.getSelection().some((ref) => ref.source === event.sourceId)) {
      this._onSelectionChange();
    }
  };

  constructor(
    private readonly _map: EditHandlerHost,
    options: Partial<SplitFeatureOptions> = {},
  ) {
    this._opts = { ...DEFAULT_OPTIONS, ...options };
    this._session = this._createSession();
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
    this._map.on('selectionchange', this._onSelectionChangeBound);
    this._map.on('data', this._onSourceDataBound);
    this._map.on('crschange', this._onSelectionChangeBound);
    this._manager?.refreshCursor();
  }

  disable(): void {
    if (!this._enabled) return;
    this._generation++;
    this._enabled = false;
    this._session.clear();
    window.removeEventListener('keydown', this._onKeyDownBound);
    this._map.off('selectionchange', this._onSelectionChangeBound);
    this._map.off('data', this._onSourceDataBound);
    this._map.off('crschange', this._onSelectionChangeBound);
    this._map.setEditMode('none');
    this._manager?.refreshCursor();
    this._map.render();
  }

  isEnabled(): boolean {
    return this._enabled;
  }

  setOptions(options: Partial<SplitFeatureOptions>): void {
    this._opts = { ...this._opts, ...options };
    if (!this._enabled) {
      this._session = this._createSession();
      return;
    }
    this._session.clear();
    this._session = this._createSession();
    this._generation++;
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
    if (
      event.kind === 'click' &&
      (event.button !== 0 || this._submissionGeneration === this._generation)
    )
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

  private _quietDisable(): void {
    this._generation++;
    this._enabled = false;
    this._session.clear();
    window.removeEventListener('keydown', this._onKeyDownBound);
    this._map.off('selectionchange', this._onSelectionChangeBound);
    this._map.off('data', this._onSourceDataBound);
    this._map.off('crschange', this._onSelectionChangeBound);
    this._manager?.refreshCursor();
    this._map.render();
  }

  private _onSelectionChange(): void {
    this._generation++;
    this._session.clear();
    const context = this._resolveSelectionContext();
    this._selectionKey = context && this._isContextCompatible(context) ? context.key : null;
    this._map.render();
  }

  private _createSession(): SketchSession {
    return new SketchSession(
      this._map,
      this._opts.cutterType === 'point'
        ? {
            minVertices: 1,
            autoFinishAt: 1,
            canPlace: (snap) => snap !== null,
            resolveSnap: (px, py) =>
              this._snapContext ? this._findSnapTarget(px, py, this._snapContext) : null,
          }
        : {
            minVertices: 2,
            resolveSnap: (px, py) =>
              this._snapContext ? this._findSnapTarget(px, py, this._snapContext) : null,
          },
      (vertices) => void this._submit(vertices),
    );
  }

  private _setSnapContext(context: SelectionContext | null): context is SelectionContext {
    this._snapContext = context && this._hasCurrentSelection(context) ? context : null;
    return this._snapContext !== null;
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
      if (!collectPathShapeArcIds(shape, ref.id, layer.shapes.length, vertexData, arcIds))
        return null;
      shapes.push(shape);
    }
    for (const arcId of arcIds) {
      if (!isValidPathArc(arcId, vertexData)) return null;
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
    return (
      context !== null &&
      this._isContextCompatible(context) &&
      this._selectionKey !== null &&
      this._selectionKey === context.key
    );
  }

  private _isContextCompatible(context: SelectionContext): boolean {
    return this._opts.cutterType !== 'point' || context.layer.geometry_type !== 'polygon';
  }

  private async _submit(vertices: [number, number][]): Promise<void> {
    if (this._submissionGeneration === this._generation || vertices.length === 0) return;
    if (!this._hasCurrentSelection(this._resolveSelectionContext())) {
      this._map.render();
      return;
    }
    const generation = this._generation;
    this._submissionGeneration = generation;
    const cutter =
      this._opts.cutterType === 'point'
        ? { type: 'point' as const, coordinates: vertices[0]! }
        : { type: 'polyline' as const, coordinates: vertices };
    try {
      const result = await this._map.ops.splitSelected({ cutter });
      if (generation === this._generation && !result.ok)
        this._map.fire('error', { error: result.error });
    } finally {
      if (this._submissionGeneration === generation) this._submissionGeneration = null;
      if (generation === this._generation) this._map.render();
    }
  }

  private _findSnapTarget(px: number, py: number, context: SelectionContext): SnapTarget | null {
    const { arcs } = context;
    if (context.layer.geometry_type !== 'polyline' || !arcs.forEachArcSegment) return null;

    const threshold = this._opts.snapThreshold ?? DEFAULT_SNAP_THRESHOLD;
    return findPathSnapTarget(this._map, px, py, threshold, context);
  }
}
