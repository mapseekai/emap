import type { NormalizedPointerEvent } from './handler';
import type { FeatureRef } from '../map/types';
import type { Feature } from '../map/feature-accessor';
import { sameFeatureIdentity } from '../map/structured-keys';

/** Restrict which features a `feature:*` listener hears. Omitted = all visible. */
export interface FeatureEventFilter {
  source?: string;
  layers?: string[];
}

export interface FeatureEvent {
  type: string;
  feature: Feature;
  ref: FeatureRef;
  point: { x: number; y: number };
  lngLat: [number, number];
  modifiers: { shift: boolean; ctrl: boolean; alt: boolean; meta: boolean };
  /** The DOM event that produced this (typed `Event`; it is a PointerEvent/MouseEvent at runtime). */
  originalEvent: Event;
}

type Cb = (e: FeatureEvent) => void;
type Entry = { filter?: FeatureEventFilter; cb: Cb; once?: boolean };

/** Minimal surface the dispatcher needs from Emap (keeps it unit-testable). */
export interface FeatureEventMapHost {
  queryFeatures(
    geom: [number, number],
    opts?: { layers?: string[] },
  ): Array<{ source: string; layer: string; id: number }>;
  unproject(x: number, y: number): [number, number];
  features: { get(ref: FeatureRef): Feature | null };
}

const TYPES = ['feature:click', 'feature:hover', 'feature:enter', 'feature:leave'] as const;
type FType = (typeof TYPES)[number];

function isFeatureType(t: string): t is FType {
  return (TYPES as readonly string[]).includes(t);
}
function matches(filter: FeatureEventFilter | undefined, ref: FeatureRef): boolean {
  if (!filter) return true;
  if (filter.source && filter.source !== ref.source) return false;
  if (filter.layers && !filter.layers.includes(ref.layer)) return false;
  return true;
}

/**
 * Delegated feature-event registry + enter/leave/hover state machine.
 * Fed normalized pointer events by `HandlerManager`'s sink (click + non-
 * gesture move). Reuses `host.queryFeatures` (existing FeatureQuery/LOD
 * path) — no new hit-test. Decoupled from selection.
 */
export class FeatureEventDispatcher {
  private _reg: Record<FType, Entry[]> = {
    'feature:click': [],
    'feature:hover': [],
    'feature:enter': [],
    'feature:leave': [],
  };
  private _lastRef: FeatureRef | null = null;
  private _onChange?: () => void;

  constructor(private _host: FeatureEventMapHost) {}

  /** Install a callback invoked whenever the registry changes (on/off/once auto-fire). */
  setOnChange(fn: () => void): void {
    this._onChange = fn;
  }

  hasListeners(): boolean {
    return TYPES.some((t) => this._reg[t].length > 0);
  }

  /** `on(type, filter, cb)` or `on(type, cb)`. Non-feature types are rejected (Emap routes them). */
  on(type: string, filter: FeatureEventFilter | undefined, cb: Cb): void {
    if (!isFeatureType(type)) return;
    this._reg[type].push({ filter, cb });
    this._onChange?.();
  }

  /** Register a one-time listener. Cancellable via `off(type, cb)` using the original `cb`. */
  once(type: string, filter: FeatureEventFilter | undefined, cb: Cb): void {
    if (!isFeatureType(type)) return;
    this._reg[type].push({ filter, cb, once: true });
    this._onChange?.();
  }

  off(type: string, cb: Cb): void {
    if (!isFeatureType(type)) return;
    this._reg[type] = this._reg[type].filter((entry) => entry.cb !== cb);
    if (!this.hasListeners()) this._clearHoverState();
    this._onChange?.();
  }

  private _clearHoverState(): void {
    this._lastRef = null;
  }

  /** Topmost hit at a point, restricted to the union of all registered filters' layers. */
  private _hit(x: number, y: number, types: readonly FType[]): FeatureRef | null {
    const entries = types.flatMap((type) => this._reg[type]);
    let layers: string[] | undefined = [];
    for (const entry of entries) {
      if (!entry.filter?.layers) {
        layers = undefined;
        break;
      }
      layers.push(...entry.filter.layers);
    }
    const hits = this._host.queryFeatures([x, y], layers && layers.length ? { layers } : undefined);
    for (const hit of hits) {
      const ref = { source: hit.source, layer: hit.layer, id: hit.id };
      if (entries.some((entry) => matches(entry.filter, ref))) return ref;
    }
    return null;
  }

  private _emit(type: FType, ref: FeatureRef, ev: NormalizedPointerEvent): void {
    const entries = [...this._reg[type]];
    if (entries.length === 0) return;
    let built: FeatureEvent | null = null;
    for (const e of entries) {
      if (!matches(e.filter, ref)) continue;
      if (!built) {
        const feature = this._host.features.get(ref);
        if (!feature) return;
        built = {
          type,
          feature,
          ref,
          point: { x: ev.point.x, y: ev.point.y },
          lngLat: this._host.unproject(ev.point.x, ev.point.y),
          modifiers: { ...ev.modifiers },
          originalEvent: ev.originalEvent,
        };
      }
      if (e.once) {
        const index = this._reg[type].indexOf(e);
        if (index !== -1) {
          this._reg[type].splice(index, 1);
          if (!this.hasListeners()) this._clearHoverState();
          this._onChange?.();
        }
      }
      e.cb(built);
    }
  }

  dispatch(ev: NormalizedPointerEvent): void {
    if (!this.hasListeners()) return;
    if (ev.kind === 'click') {
      const ref = this._hit(ev.point.x, ev.point.y, ['feature:click']);
      if (ref) this._emit('feature:click', ref, ev);
      return;
    }
    if (ev.kind !== 'move') return;
    const ref = this._hit(ev.point.x, ev.point.y, [
      'feature:hover',
      'feature:enter',
      'feature:leave',
    ]);
    if (!sameFeatureIdentity(ref, this._lastRef)) {
      if (this._lastRef) this._emit('feature:leave', this._lastRef, ev);
      if (ref) this._emit('feature:enter', ref, ev);
      this._lastRef = ref;
    }
    if (ref) this._emit('feature:hover', ref, ev);
  }
}
