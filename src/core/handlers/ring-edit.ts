import type { Handler, HandlerResult, NormalizedPointerEvent } from '../handler';
import type { OpResult } from '../../map/op-result';
import type { EditHandlerHost } from './edit-handler-host';
import { SketchSession, type SketchSnapTarget } from './sketch-session';
import {
  findVertexSnapTarget,
  resolvePathSelectionContext,
  type SnapSelectionContext,
} from './selection-snap';

export interface RingEditOptions {
  mode?: 'add' | 'delete' | 'fill';
  snapThreshold?: number;
}

const DEFAULT_OPTIONS: Required<Pick<RingEditOptions, 'mode'>> = { mode: 'add' };
const DEFAULT_SNAP_THRESHOLD = 10;

/**
 * Interactive interior-ring editor delegated to `ops.addRing` and
 * `ops.deleteRing`. Selection is not required: holes are added to the polygon
 * containing the sketch, and clicking inside a hole deletes it.
 */
export class RingEditHandler implements Handler<RingEditOptions> {
  readonly name = 'ringEdit';
  private _enabled = false;
  private _opts: RingEditOptions;
  private _generation = 0;
  private _submissionGeneration: number | null = null;
  private _snapContext: SnapSelectionContext | null = null;
  private _session: SketchSession;
  _manager?: { refreshCursor(): void };

  private readonly _onKeyDownBound = (event: KeyboardEvent) => this._session.handleKeyDown(event);

  constructor(
    private readonly _map: EditHandlerHost,
    options: RingEditOptions = {},
  ) {
    this._opts = { ...DEFAULT_OPTIONS, ...options };
    this._session = this._createSession();
    this._map.on('editmodechange', (event: { mode: string }) => {
      if (event.mode !== 'ring' && this._enabled) this._quietDisable();
    });
  }

  enable(): void {
    if (this._enabled) return;
    this._generation++;
    this._enabled = true;
    this._map.setEditMode('ring');
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
    if (
      event.kind === 'click' &&
      (event.button !== 0 || this._submissionGeneration === this._generation)
    )
      return 'passthrough';
    if (this._opts.mode === 'delete') {
      if (event.kind !== 'click') return 'passthrough';
      void this._submit(() =>
        this._map.ops.deleteRing({ point: this._map.unproject(event.point.x, event.point.y) }),
      );
      return 'consumed';
    }
    if (this._opts.mode === 'fill') {
      if (event.kind !== 'click') return 'passthrough';
      void this._submit(() =>
        this._map.ops.fillRing({ point: this._map.unproject(event.point.x, event.point.y) }),
      );
      return 'consumed';
    }
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
        minVertices: 3,
        closeRing: true,
        resolveSnap: (px, py) =>
          this._snapContext ? this._findSnapTarget(px, py, this._snapContext) : null,
      },
      (vertices) => void this._submit(() => this._map.ops.addRing({ ring: vertices })),
    );
  }

  private _resolveSelectionContext(): SnapSelectionContext | null {
    return resolvePathSelectionContext(this._map, ['polygon']);
  }

  private async _submit(operation: () => Promise<OpResult<void>>): Promise<void> {
    if (this._submissionGeneration === this._generation) return;
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
