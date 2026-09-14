import { EventDispatcher } from '../events';
import type { Handler, HandlerResult, NormalizedPointerEvent } from '../handler';
import { resolveMode, type ModifierCombo, type SelectMode } from './select-mode';
import { dedupeRefs } from './select-geometry';
import type { SelectionHandlerHost } from './selection-handler-host';

export interface SelectHandlerOptions {
  /** Restrict selectable layers; default = all visible. */
  layers?: string[];
  source?: string;
  /** Modifier→mode table. Defaults reproduce a sensible click model. */
  modifiers?: Partial<Record<SelectMode, ModifierCombo>>;
}

const CLICK_DEFAULT_MODS: Partial<Record<SelectMode, ModifierCombo>> = {
  replace: 'none',
  add: 'shift',
  toggle: 'shift+alt',
};

/**
 * Named `clickSelect` handler. Acts only on `kind:'click'` (the arbiter
 * synthesizes it from a non-dragging down/up, so it never fights a
 * box/lasso drag). Hit → resolve mode → `Emap.select`; empty click whose
 * resolved mode is `'replace'` clears the selection. Opt-in (disabled by
 * default) so `new Emap()` behavior is unchanged.
 * Stands down while a modal edit mode is active so the editor (split, draw,
 * …) receives the clicks it needs to place vertices.
 */
export class ClickSelectHandler extends EventDispatcher implements Handler<SelectHandlerOptions> {
  readonly name = 'clickSelect';
  private _enabled = false;
  private _opts: SelectHandlerOptions = {};

  constructor(private _map: SelectionHandlerHost) {
    super();
  }

  enable(): void {
    this._enabled = true;
  }
  disable(): void {
    this._enabled = false;
  }
  isEnabled(): boolean {
    return this._enabled;
  }
  setOptions(opts: Partial<SelectHandlerOptions>): void {
    this._opts = { ...this._opts, ...opts };
  }
  getOptions(): Readonly<SelectHandlerOptions> {
    return this._opts;
  }

  handlePointer(ev: NormalizedPointerEvent): HandlerResult {
    if (!this._enabled || ev.kind !== 'click' || ev.button !== 0) return 'passthrough';
    if ((this._map.getEditMode?.() ?? 'none') !== 'none') return 'passthrough';
    const mode = resolveMode(ev.modifiers, this._opts.modifiers ?? CLICK_DEFAULT_MODS);
    const hits = this._map.queryFeatures(
      [ev.point.x, ev.point.y],
      this._opts.layers ? { layers: this._opts.layers } : undefined,
    );
    const refs = dedupeRefs(hits);
    if (refs.length === 0) {
      if (mode === 'replace') this._map.select([], { mode: 'replace' });
      return 'consumed';
    }
    this._map.select(refs, { mode });
    return 'consumed';
  }
}
