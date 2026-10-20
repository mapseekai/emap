import type { Handler, HandlerResult, NormalizedPointerEvent } from '../handler';
import type { EditHandlerHost } from './edit-handler-host';
import type { ArcCollection } from '../../../shared/types/mapshaper-types';
import { isPathLayer } from '../../../shared/types/mapshaper-types';
import {
  collectPathShapeArcIds,
  findPathSnapTarget,
  isValidPathArc,
  type PathSnapContext,
} from './path-snap';
import { SketchSession, type SketchSnapTarget } from './sketch-session';
import type { EditMode } from '../../map/edit-state-store';
import type { OpResult } from '../../map/op-result';

export interface ReshapeFeatureOptions {
  snapThreshold?: number;
}

const DEFAULT_SNAP_THRESHOLD = 10;

/**
 * Interactive reshape-line sketch delegated to `ops.reshapeSelected`.
 * Selection is not required: the line reshapes every feature it contacts.
 */
export class ReshapeFeatureHandler implements Handler<ReshapeFeatureOptions> {
  readonly name: string = 'reshapeFeature';
  protected readonly _editMode: EditMode = 'reshape';
  private _enabled = false;
  private _opts: ReshapeFeatureOptions;
  private _generation = 0;
  private _submissionGeneration: number | null = null;
  private _snapContext: PathSnapContext | null = null;
  private _session: SketchSession;
  _manager?: { refreshCursor(): void };

  private readonly _onKeyDownBound = (event: KeyboardEvent) => this._session.handleKeyDown(event);

  constructor(
    protected readonly _map: EditHandlerHost,
    options: ReshapeFeatureOptions = {},
  ) {
    this._opts = { ...options };
    this._session = this._createSession();
    this._map.on('editmodechange', (event: { mode: string }) => {
      if (event.mode !== this._editMode && this._enabled) this._quietDisable();
    });
  }

  enable(): void {
    if (this._enabled) return;
    this._generation++;
    this._enabled = true;
    this._map.setEditMode(this._editMode);
    window.addEventListener('keydown', this._onKeyDownBound);
    this._manager?.refreshCursor();
  }

  disable(): void {
    if (!this._enabled) return;
    this._generation++;
    this._enabled = false;
    this._session.clear();
    window.removeEventListener('keydown', this._onKeyDownBound);
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
  }

  getOptions(): Readonly<ReshapeFeatureOptions> {
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
    if (event.kind === 'move' || event.kind === 'click')
      this._snapContext = this._resolveSelectionContext();
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
    this._manager?.refreshCursor();
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

  private _resolveSelectionContext(): PathSnapContext | null {
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

    const arcIds = new Set<number>();
    for (const ref of selected) {
      const shape = layer.shapes[ref.id];
      if (!collectPathShapeArcIds(shape, ref.id, layer.shapes.length, vertexData, arcIds))
        return null;
    }
    for (const arcId of arcIds) {
      if (!isValidPathArc(arcId, vertexData)) return null;
    }
    return { arcs, vertexData, arcIds: [...arcIds] };
  }

  protected _execute(vertices: [number, number][]): Promise<OpResult<unknown>> {
    return this._map.ops.reshapeSelected({ line: vertices });
  }

  private async _submit(vertices: [number, number][]): Promise<void> {
    if (this._submissionGeneration === this._generation || vertices.length === 0) return;
    const generation = this._generation;
    this._submissionGeneration = generation;
    try {
      const result = await this._execute(vertices);
      if (generation === this._generation && !result.ok)
        this._map.fire('error', { error: result.error });
    } finally {
      if (this._submissionGeneration === generation) this._submissionGeneration = null;
      if (generation === this._generation) this._map.render();
    }
  }

  private _findSnapTarget(
    px: number,
    py: number,
    context: PathSnapContext,
  ): SketchSnapTarget | null {
    const threshold = this._opts.snapThreshold ?? DEFAULT_SNAP_THRESHOLD;
    return findPathSnapTarget(this._map, px, py, threshold, context);
  }
}
