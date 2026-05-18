# DX Phase 10 — Typed `EmapEventMap` (design)

> Part of the emap DX batch (P9 Camera API done & pushed at `fb0a43c`).
> Accumulates toward 0.3.0. OpenSpec skipped per P1–P9 precedent.
> Rhythm: brainstorm → spec → plan → subagent-driven TDD execution.

## §0 Problem

`Emap` extends `EventDispatcher` and exposes hand-written overloads for two
special cases — `'mousemove'` (→ `PointerMoveEvent`, P8) and `feature:*`
(→ `FeatureEvent`, optional filter, P3) — plus a generic escape-hatch
overload `on<T = Record<string, unknown>>(type: string, listener)`. Every
other event the map emits (~14 distinct names: the P9 camera lifecycle,
`move`, `data`, `error`, `selectionchange`, `historychange`,
`editmodechange`, `crschange`, `resize`, `validationfailed`) is delivered
through the **untyped** generic overload. Consumers get **no event-name
autocomplete and no payload inference** for the bread-and-butter events;
`map.on('moveend', e => e.center)` types `e` as `{ type: string } &
Record<string, unknown>` and `e.center` is `unknown`.

P10 adds a typed `EmapEventMap` so known events autocomplete and infer their
payloads, while preserving the existing special overloads and the
arbitrary-name escape hatch.

## §1 Architecture

New file `src/core/event-map.ts` exports `interface EmapEventMap` and
`interface CameraEvent`. `EventDispatcher` (`src/core/events.ts`) is **not
touched** — it stays string-based at runtime. `Emap` gains ONE keyed
`on`/`off`/`once` overload each, bound to `keyof EmapEventMap`, inserted
**after** the `mousemove`/`feature:*` bespoke overloads and **before** the
generic `on<T>(type: string, …)` fallback. Overload order is significant:
TypeScript resolves to the first structurally-matching overload (the same
lesson that placed the P8 `'mousemove'` literal ahead of the generic
string form). The `on`/`off`/`once` **implementation bodies are
byte-unchanged** — P10 is a compile-time-only addition. `src/index.ts`
exports `EmapEventMap` and `CameraEvent`.

## §2 `EmapEventMap` members

Scoped strictly to events fired **on the `Emap` instance** — `this.fire(…)`
in `src/map/map.ts` plus the camera lifecycle wired through the camera host
(`fire: (type, e) => this.fire(type, e)`, `map.ts`). Handler-internal
events (`pan`/`panstart`/`panend`/`mousewheel*` on `DragPanHandler` /
`ScrollZoomHandler`) and sub-dispatcher events (`tick`/`change` on `Tween`,
`workerjob*` on the worker pool, `dataloading`/`error` on `TopologySource`)
are intentionally **excluded** — they are not delivered via `map.on`.

```ts
// src/core/event-map.ts
import type { EditMode } from '../map/edit-state-store';
import type { HistoryStateSnapshot } from '../edit/edit-history';
import type { FeatureRef } from '../map/map';
import type { ValidatorResult } from '../validation/registry';

/** Camera lifecycle payload (P9). `zoom` = log2(scale): WebMercator-
 *  meaningful, otherwise the documented log2 convention. */
export interface CameraEvent {
  center: [number, number];
  zoom: number;
  originalEvent: MouseEvent | null;
}

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
  crschange: Record<string, never>; // no payload
  resize: Record<string, never>; // no payload
  data: { sourceId?: string; reason?: 'edit' | 'load' | 'replace' | 'reproject' };
  editmodechange: { mode: EditMode }; // 'none'|'vertex'|'draw'|'transform'
  error: { error: Error };
  // Fired bare (this.fire('historychange')) AND with a snapshot
  // (this.fire('historychange', snap)) → Partial.
  historychange: Partial<HistoryStateSnapshot>;
  selectionchange: { selected: FeatureRef[]; added: FeatureRef[]; removed: FeatureRef[] };
  validationfailed: { results: ValidatorResult[]; label: string };
}
```

14 members. Audited emit sites (authoritative):

| Event | Emit site(s) | Payload rationale |
|---|---|---|
| `movestart`/`moveend`/`zoomstart`/`zoom`/`zoomend` | `camera.ts` `_host.fire(…)` → `this.fire` | always `_payload(state)` = `{center,zoom,originalEvent:null}` |
| `move` | `camera.ts` (full) **and** `viewport.onViewChange = () => this.fire('move')`, `_attachEventListeners` pan/wheel (bare) | `Partial<CameraEvent>` |
| `crschange` | `map.ts:584,959,974` bare | no payload |
| `data` | `map.ts:587` `{sourceId:id, ...e}`, `map.ts:975` `{reason:'reproject'}` | stable keys typed; source-event passthrough not over-promised |
| `editmodechange` | `map.ts:192` `{mode: change.current.mode}` | `EditMode` |
| `error` | `map.ts:368,1707` + `ops/*`,`_runner` via `host.fire` | `{error: Error}` |
| `historychange` | `map.ts:743` bare, `map.ts:1582` `snap` | `Partial<HistoryStateSnapshot>` |
| `resize` | `map.ts:1220` bare | no payload |
| `selectionchange` | `map.ts:1342` | `{selected,added,removed: FeatureRef[]}` |
| `validationfailed` | `map.ts:1603` | `{results: ValidatorResult[], label: string}` |

## §3 Overload mechanics, escape hatch & back-compat

Per `on` (mirror for `off`, `once` — `once`/`off` keep their existing
bespoke + generic overloads, the keyed one slots in the same position):

```ts
// 1. bespoke literal — UNCHANGED (P8)
on(type: 'mousemove', listener: (e: PointerMoveEvent) => void): this;
// 2. NEW — typed known events (autocomplete + payload inference)
on<K extends keyof EmapEventMap>(
  type: K,
  listener: (e: { type: K } & EmapEventMap[K]) => void,
): this;
// 3. generic escape hatch — UNCHANGED (custom/app events still compile)
on<T = Record<string, unknown>>(type: string, listener: EventListener<T>): this;
// 4. feature-event forms — UNCHANGED (P3)
on(type: string, listener: (e: FeatureEvent) => void): this;
on(type: string, filter: FeatureEventFilter, listener: (e: FeatureEvent) => void): this;
```

- **Escape hatch (Q1 = open):** unknown names fall through overload 2 to
  overload 3 and still compile as today (`T = Record<string, unknown>`).
  No behavioral/back-compat break.
- **Augmentable:** `EmapEventMap` is an `interface`, so a consumer may
  `declare module '@zwishing/emap' { interface EmapEventMap { myEvent: {…} } }`
  and get autocomplete on their own events through the same surface.
- **No collision:** `feature:*` names are not keys of `EmapEventMap`;
  overloads 4/5 remain last and unchanged. `mousemove` is a key-less
  literal handled by overload 1 before the keyed form.
- **Runtime byte-unchanged:** the `on/off/once` *implementation* signatures
  and bodies in `map.ts` and all of `EventDispatcher` are untouched.

## §4 Testing & verification

Compile-time-only change → primary tests are type-level.

- **`src/core/event-map.test-d.ts`** — type assertions, checked by the
  existing strict `tsc --noEmit` gate (tsconfig `include: ["src"]`,
  `exclude: ["**/*.test.ts","**/*.test.tsx"]` — `*.test-d.ts` is NOT
  excluded, so it participates in the typecheck; vitest globs `*.test.ts`
  so it is NOT executed as a runtime test). Assertions:
  - `map.on('moveend', e => e)` → `e.center` is `[number, number]`,
    `e.zoom` is `number`, `e.type` is `'moveend'`.
  - `map.on('error', e => e.error)` → `Error`.
  - `map.on('move', e => e)` → `e.center` is `[number, number] | undefined`
    (Partial).
  - `// @ts-expect-error` — `map.on('moveend', e => e.nope)` (bad property).
  - `map.on('totallyCustom', e => e)` still compiles (escape hatch).
  - `declare module` augmentation adds a key that then infers.
  - Same matrix for `off` and `once`.
- **`src/core/event-map.test.ts`** — 1–2 runtime sanity cases
  (`map.on('selectionchange', cb)` then triggering a selection actually
  invokes `cb` with the payload) to lock the wiring; proves the keyed
  overload routes to the unchanged `super.on` path.
- **Non-regression:** the full existing suite (1142) stays green with
  **zero modifications to any existing test**; `map.test.ts` and all
  P1–P9 sources byte-identical except the additive overloads + the new
  files + `src/index.ts` export line + CHANGELOG.

**Gates:** `npx tsc --noEmit` exit 0 · full suite green (1142 + new) ·
`npm run build` exit 0 · `git diff` shows only: `src/core/event-map.ts`
(new), `src/core/event-map.test-d.ts` (new), `src/core/event-map.test.ts`
(new), additive overloads in `src/map/map.ts`, one export line in
`src/index.ts`, CHANGELOG entry.

## §5 Out of scope (YAGNI)

- Typing `fire()` for type-safe emit (Approach C) — touches ~24 internal
  call sites, high regression risk, zero consumer-facing DX gain.
- Closing the union (Approach B) — rejected by Q1 (escape hatch required).
- Folding `mousemove`/`feature:*` into `EmapEventMap` (Q3) — kept bespoke;
  the feature filter 3-arg form and separate dispatcher make unification
  risky for no gain.
- Re-typing handler-internal / sub-dispatcher events — not delivered via
  `map.on`, not part of the public surface.
