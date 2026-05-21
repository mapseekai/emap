import type { Handler, HandlerResult, NormalizedPointerEvent } from '../handler';
import type { Emap } from '../../map/map';
import type {
  DragSessionOptions,
  FeatureTranslateSession,
  FeatureAffineSession,
} from '../../map/types';
import { rotateMatrix, scaleMatrix } from '../../edit/commands/feature-affine';

export interface TransformFeatureOptions {
  /** Active transform. Default 'translate'. */
  mode?: 'translate' | 'rotate' | 'scale';
  /** Forwarded to begin*Session (e.g. { splitSharedArcs }). */
  session?: DragSessionOptions;
}

/**
 * Named `transformFeature` handler. Modal (`enable()`→`setEditMode
 * ('transform')`). On pointerdown over an **already-selected** feature it
 * opens the matching editSession (selection itself is delegated to the
 * modifier-aware `clickSelect`/`boxSelect`); pointermove streams the
 * per-frame delta (translate dx/dy, or rotate/scale matrix vs the session
 * origin); pointerup commits (one undo entry); Escape cancels. Absorbs the
 * boilerplate previously hand-wired in the transform examples.
 */
export class TransformFeatureHandler implements Handler<TransformFeatureOptions> {
  readonly name = 'transformFeature';
  private _enabled = false;
  private _opts: TransformFeatureOptions = {};
  private _translate: FeatureTranslateSession | null = null;
  private _affine: FeatureAffineSession | null = null;
  private _lastMap: [number, number] | null = null;
  private _hoveringSelected = false;
  /** Injected by HandlerManager.register (cursor recompute on mode flips). */
  _manager?: { refreshCursor(): void };
  // Affine reference state: (re)initialized at every affine-mode pointerdown
  // (see handlePointer 'down'); only read while `_affine` is non-null, so the
  // numeric defaults below are never observed. Kept numeric (not null) because
  // the ported example math assigns them unconditionally on down.
  private _prevAngle = 0;
  private _prevDist = 1;
  private _onKeyDownBound = (e: KeyboardEvent) => this._onKeyDown(e);

  constructor(private _map: Emap) {
    this._map.on('editmodechange', (e: { mode: string }) => {
      if (e.mode !== 'transform' && this._enabled) this._quietDisable();
    });
  }

  private get _mode(): 'translate' | 'rotate' | 'scale' {
    return this._opts.mode ?? 'translate';
  }

  enable(): void {
    if (this._enabled) return;
    this._enabled = true;
    this._map.setEditMode('transform');
    window.addEventListener('keydown', this._onKeyDownBound);
    this._manager?.refreshCursor();
  }

  disable(): void {
    if (!this._enabled) return;
    this._enabled = false;
    this._cancelSession();
    this._hoveringSelected = false;
    window.removeEventListener('keydown', this._onKeyDownBound);
    this._map.setEditMode('none');
    this._manager?.refreshCursor();
    this._map.render();
  }

  private _quietDisable(): void {
    this._enabled = false;
    this._cancelSession();
    this._hoveringSelected = false;
    window.removeEventListener('keydown', this._onKeyDownBound);
    this._manager?.refreshCursor();
    this._map.render();
  }

  isEnabled(): boolean {
    return this._enabled;
  }

  setOptions(o: Partial<TransformFeatureOptions>): void {
    this._opts = { ...this._opts, ...o };
  }

  getOptions(): Readonly<TransformFeatureOptions> {
    return this._opts;
  }

  getCursor(): string | null {
    if (!this._enabled) return null;
    if (this._translate) return 'move';
    if (this._mode === 'translate' && this._hoveringSelected) return 'move';
    return null;
  }

  private _cancelSession(): void {
    if (this._translate) {
      this._translate.cancel();
      this._translate = null;
    }
    if (this._affine) {
      this._affine.cancel();
      this._affine = null;
    }
    this._lastMap = null;
  }

  private _onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && (this._translate || this._affine)) this._cancelSession();
  }

  handlePointer(ev: NormalizedPointerEvent): HandlerResult {
    if (!this._enabled) return 'passthrough';

    if (ev.kind === 'down') {
      if (ev.button !== 0) return 'passthrough';
      const hits = this._map.queryFeatures([ev.point.x, ev.point.y]);
      if (this._mode === 'translate') this._hoveringSelected = hits.length > 0;
      // Option A (spec §15.11): transformFeature only drags an ALREADY-
      // selected feature and owns no selection logic. No hit, or a hit
      // that is not already selected → passthrough so the modifier-aware
      // clickSelect/boxSelect own selection (click=replace, shift+click=
      // add, click-empty=clear). The user selects first, then press-drags
      // to move the whole selection. A down on any feature still switches the
      // cursor to `move`; clickSelect will complete the actual selection on
      // the following click event.
      if (!hits.length || !this._map.isSelected(hits[0])) return 'passthrough';
      const cur = this._map.unproject(ev.point.x, ev.point.y);
      if (this._mode === 'translate') {
        this._translate = this._map.editSession.beginTranslateSession(this._opts.session);
        if (!this._translate) return 'passthrough';
        this._lastMap = cur;
      } else {
        // beginAffineSession(origin?, opts?) — first arg is the pivot
        // (the examples pass NONE → bbox-centroid default). Pass
        // `undefined` for origin to keep that default while still
        // forwarding the optional session options.
        this._affine = this._map.editSession.beginAffineSession(undefined, this._opts.session);
        if (!this._affine) return 'passthrough';
        const [ox, oy] = this._affine.origin;
        this._prevAngle = Math.atan2(cur[1] - oy, cur[0] - ox);
        this._prevDist = Math.hypot(cur[0] - ox, cur[1] - oy) || 1;
      }
      return 'exclusive';
    }

    if (ev.kind === 'move') {
      if (!this._translate && !this._affine) {
        const hits = this._map.queryFeatures([ev.point.x, ev.point.y]);
        this._hoveringSelected = hits.some((hit) => this._map.isSelected(hit));
        return 'passthrough';
      }
      const cur = this._map.unproject(ev.point.x, ev.point.y);
      if (this._translate) {
        if (this._lastMap)
          this._translate.move(cur[0] - this._lastMap[0], cur[1] - this._lastMap[1]);
        this._lastMap = cur;
      } else if (this._affine) {
        const [ox, oy] = this._affine.origin;
        if (this._mode === 'rotate') {
          const ang = Math.atan2(cur[1] - oy, cur[0] - ox);
          const delta = ang - this._prevAngle;
          if (delta !== 0) this._affine.applyDelta(rotateMatrix(delta, ox, oy));
          this._prevAngle = ang;
        } else {
          const dist = Math.hypot(cur[0] - ox, cur[1] - oy) || 1;
          const factor = dist / this._prevDist;
          if (factor !== 1) this._affine.applyDelta(scaleMatrix(factor, factor, ox, oy));
          this._prevDist = dist;
        }
      }
      return 'exclusive';
    }

    if (ev.kind === 'up') {
      if (!this._translate && !this._affine) return 'passthrough';
      if (this._translate) {
        this._translate.commit();
        this._translate = null;
      }
      if (this._affine) {
        this._affine.commit();
        this._affine = null;
      }
      this._lastMap = null;
      this._hoveringSelected = false;
      return 'passthrough';
    }

    return 'passthrough';
  }
}
