import type { Handler, HandlerResult, NormalizedPointerEvent } from '../handler';
import type { OpResult } from '../../map/op-result';
import type { EditHandlerHost } from './edit-handler-host';
import { SketchSession, type SketchSnapTarget } from './sketch-session';
import {
  findVertexSnapTarget,
  resolvePathSelectionContext,
  type SnapSelectionContext,
} from './selection-snap';

export interface PartEditOptions {
  mode?: 'add' | 'delete';
  snapThreshold?: number;
}

const DEFAULT_OPTIONS: Required<Pick<PartEditOptions, 'mode'>> = { mode: 'add' };
const DEFAULT_SNAP_THRESHOLD = 10;


/**
 * Interactive path-part editor delegated to `ops.addPart` and
 * `ops.deletePart`. Add mode requires exactly one selected path feature;
 * delete mode is selection-free — clicking a part deletes it (and deleting a
 * feature's last part removes the feature).
 */
export class PartEditHandler implements Handler<PartEditOptions> {
  readonly name = 'partEdit';
  private _enabled = false;
  private _opts: PartEditOptions;
  private _generation = 0;
  private _submissionGeneration: number | null = null;
  private _selectionKey: string | null = null;
  private _snapContext: SnapSelectionContext | null = null;
  private _session: SketchSession | null = null;
  _manager?: { refreshCursor(): void };

  private readonly _onKeyDownBound = (event: KeyboardEvent) => this._session?.handleKeyDown(event);
  private readonly _onSelectionChangeBound = () => this._onSelectionChange();

  constructor(
    private readonly _map: EditHandlerHost,
    options: PartEditOptions = {},
  ) {
    const { snapThreshold, ...rest } = options;
    this._opts = {
      ...DEFAULT_OPTIONS,
      ...rest,
      ...(typeof snapThreshold === 'number' && Number.isFinite(snapThreshold) && snapThreshold >= 0
        ? { snapThreshold }
        : {}),
    };
    this._map.on('editmodechange', (event: { mode: string }) => {
      if (event.mode !== 'part' && this._enabled) this._quietDisable();
    });
  }

  enable(): void {
    if (this._enabled) return;
    if (this._opts.mode === 'add') {
      const context = this._resolveSelectionContext();
      if (!context) throw new Error('partEdit: selection must contain exactly one path feature');
      this._selectionKey = context.key;
      this._generation++;
      this._session = this._createSession(context);
    }
    this._enabled = true;
    this._map.setEditMode('part');
    window.addEventListener('keydown', this._onKeyDownBound);
    this._map.on('selectionchange', this._onSelectionChangeBound);
    this._manager?.refreshCursor();
  }

  disable(): void {
    if (!this._enabled) return;
    this._generation++;
    this._enabled = false;
    this._session?.clear();
    window.removeEventListener('keydown', this._onKeyDownBound);
    this._map.off('selectionchange', this._onSelectionChangeBound);
    this._map.setEditMode('none');
    this._manager?.refreshCursor();
    this._map.render();
  }

  isEnabled(): boolean {
    return this._enabled;
  }

  setOptions(options: Partial<PartEditOptions>): void {
    const modeChanged = options.mode !== undefined && options.mode !== this._opts.mode;
    const { snapThreshold, ...rest } = options;
    this._opts = {
      ...this._opts,
      ...rest,
      ...(snapThreshold === undefined
        ? {}
        : typeof snapThreshold === 'number' && Number.isFinite(snapThreshold) && snapThreshold >= 0
          ? { snapThreshold }
          : { snapThreshold: DEFAULT_SNAP_THRESHOLD }),
    };
    if (!this._enabled) {
      this._session = null;
      return;
    }
    if (!modeChanged) return;
    this._generation++;
    this._session?.clear();
    this._session = null;
    if (this._opts.mode === 'add') {
      const context = this._resolveSelectionContext();
      this._selectionKey = context?.key ?? null;
      this._session = context ? this._createSession(context) : null;
    }
    this._map.render();
  }

  getOptions(): Readonly<PartEditOptions> {
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
    if (this._opts.mode === 'delete') {
      if (event.kind !== 'click') return 'passthrough';
      const point = this._map.unproject(event.point.x, event.point.y);
      const threshold = this._opts.snapThreshold ?? DEFAULT_SNAP_THRESHOLD;
      const offset = this._map.unproject(event.point.x + threshold, event.point.y);
      const tolerance = Math.hypot(offset[0] - point[0], offset[1] - point[1]);
      void this._submit(() => this._map.ops.deletePart({ point, tolerance }));
      return 'consumed';
    }
    const context = this._resolveSelectionContext();
    if (!context || !this._isCurrentSelection(context)) {
      this._session?.clear();
      this._map.render();
      return event.kind === 'click' ? 'consumed' : 'passthrough';
    }
    this._snapContext = context;
    try {
      if (event.kind === 'contextmenu' && this._submissionGeneration === this._generation) {
        event.originalEvent.preventDefault();
        return 'consumed';
      }
      const session = this._session;
      return session ? session.handlePointer(event) : 'passthrough';
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
    this._session?.clear();
    window.removeEventListener('keydown', this._onKeyDownBound);
    this._map.off('selectionchange', this._onSelectionChangeBound);
    this._manager?.refreshCursor();
    this._map.render();
  }

  private _onSelectionChange(): void {
    if (this._opts.mode !== 'add') return;
    this._generation++;
    this._session?.clear();
    const context = this._resolveSelectionContext();
    this._selectionKey = context?.key ?? null;
    this._session = this._opts.mode === 'add' && context ? this._createSession(context) : null;
    this._map.render();
  }

  private _createSession(
    context: SnapSelectionContext | null = this._resolveSelectionContext(),
  ): SketchSession {
    const polygon = context?.layer.geometry_type !== 'polyline';
    return new SketchSession(
      this._map,
      {
        minVertices: polygon ? 3 : 2,
        ...(polygon ? { closeRing: true } : {}),
        resolveSnap: (px, py) =>
          this._snapContext ? this._findSnapTarget(px, py, this._snapContext) : null,
      },
      (vertices) => void this._submit(() => this._map.ops.addPart({ coordinates: vertices })),
    );
  }

  private _resolveSelectionContext(): SnapSelectionContext | null {
    return resolvePathSelectionContext(this._map, ['polygon', 'polyline']);
  }

  private _isCurrentSelection(context: SnapSelectionContext): boolean {
    return this._selectionKey !== null && this._selectionKey === context.key;
  }

  private async _submit(operation: () => Promise<OpResult<void>>): Promise<void> {
    if (this._submissionGeneration === this._generation) return;
    if (this._opts.mode === 'add') {
      const context = this._resolveSelectionContext();
      if (!context || !this._isCurrentSelection(context)) {
        this._map.render();
        return;
      }
    }
    const generation = this._generation;
    this._submissionGeneration = generation;
    try {
      const result = await operation();
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
    context: SnapSelectionContext,
  ): SketchSnapTarget | null {
    return findVertexSnapTarget(
      this._map,
      px,
      py,
      this._opts.snapThreshold ?? DEFAULT_SNAP_THRESHOLD,
      context,
    );
  }
}
