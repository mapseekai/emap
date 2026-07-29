import type { EditMode } from '../map/edit-state-store';
import type { HistoryStateSnapshot } from '../edit/edit-history';
import type { FeatureRef } from '../map/types';
import type { ValidatorResult } from '../validation/validator';
import type { FeatureEvent } from './feature-event-dispatcher';
import type { PointerMoveEvent } from './pointer-event-dispatcher';

/**
 * Camera lifecycle payload (P9). `zoom` is `log2(scale)` — meaningful for
 * WebMercator, otherwise the documented log2 convention. `originalEvent`
 * is `null` for programmatic camera moves.
 */
export interface CameraEvent {
  center: [number, number];
  zoom: number;
  originalEvent: MouseEvent | null;
}

/**
 * Typed payloads for every event emitted ON the `Emap` instance (P10).
 * Scoped to `this.fire(…)` in `src/map/map.ts` + the camera lifecycle
 * wired through the camera host. Handler-internal events (`pan`,
 * `panstart`, `mousewheel*`) and sub-dispatcher events (`tick`, `change`,
 * `workerjob*`, source `dataloading`) are intentionally excluded — they
 * are not delivered via `map.on`.
 *
 * This is an `interface` (not a `type`) so consumers can augment it:
 *
 * ```ts
 * declare module '@mapseekai/emap' {
 *   interface EmapEventMap { myCustomEvent: { detail: string } }
 * }
 * ```
 */
export interface EmapEventMap {
  // Camera lifecycle (P9) — always a full CameraEvent
  movestart: CameraEvent;
  moveend: CameraEvent;
  zoomstart: CameraEvent;
  zoom: CameraEvent;
  zoomend: CameraEvent;
  // Fired BOTH bare (viewport pan / wheel → this.fire('move')) AND as a
  // full CameraEvent (camera) → every field optional (truthful union).
  move: Partial<CameraEvent>;

  // Lifecycle / data
  // No payload. `Record<never, never>` (not `Record<string, never>`) so the
  // keyed-overload intersection `{ type: K } & EmapEventMap[K]` stays valid:
  // a `[string]: never` index signature would reject the `{ type }` object
  // that `EventDispatcher.fire` produces for a no-arg event.
  crschange: Record<never, never>;
  resize: Record<never, never>;
  data: { sourceId?: string; reason?: 'edit' | 'load' | 'replace' | 'reproject' };
  editmodechange: { mode: EditMode };
  error: { error: Error };
  // Fired bare AND with a snapshot → Partial.
  historychange: Partial<HistoryStateSnapshot>;
  selectionchange: { selected: FeatureRef[]; added: FeatureRef[]; removed: FeatureRef[] };
  validationfailed: { results: ValidatorResult[]; label: string };

  // Delegated pointer / feature events (P3/P8). These are routed through
  // Emap.on/off/once overloads rather than EventDispatcher.fire(), but they
  // are still public Emap events and belong in the integration event map.
  mousemove: PointerMoveEvent;
  'feature:click': FeatureEvent;
  'feature:hover': FeatureEvent;
  'feature:enter': FeatureEvent;
  'feature:leave': FeatureEvent;
}
