# emap — Unified MapLibre-style Interaction & Theming DX (0.3.0)

- **Status:** Approved design (brainstormed 2026-05-17), pending implementation plan
- **Target release:** 0.3.0 (breaking)
- **Scope:** Architectural spine only — named interaction handlers + delegated
  feature events + CSS-variable theme. Out of scope (separate follow-ups):
  `addGeoJSON` sugar, UI-state snapshot, operation-progress events.

## 1. Problem & Goals

A third-party integrator analysis (2026-05-17) found the consumer-facing DX
gaps are almost all in the "last mile" convenience layer, while the imperative
core (`select()`, `queryFeatures()`, ops, events) is solid. Three root causes,
each currently forcing consumers to fork or reach into private internals:

1. **Styling:** `controls.css` has zero CSS variables; all colors/sizes
   hardcoded; `!important` on active states; `SimplifyControl` uses inline
   `cssText` + inline form HTML that CSS selectors cannot reach. Theming /
   dark mode / brand color all require forking or post-render DOM hacks.
2. **Selection interaction:** modifier→mode mapping hardcoded in a private
   `_modeFromEvent()`; box/lasso selection only enableable via `addControl`;
   no built-in click-to-select (every example re-implements the same
   `canvasContainer` click → `queryFeatures` → `select` boilerplate);
   `MapOptions.interactive` is all-or-nothing.
3. **Ergonomics:** no feature-level events (`feature:click`/`hover`); no
   selective interaction toggles (must hack `(map as any)._mouseWheel`).

**Goal:** one unified mental model — MapLibre's: every interaction is a
same-shaped handler object on the map; feature events are delegated; theming
is CSS custom properties. This single律 collapses "disable wheel keep pan",
"custom modifiers", "third-party custom interaction", "theme", and
"click-to-select" onto one `{enable/disable/options}` + event + token surface.

**Non-goals:** `map.addGeoJSON()` sugar, full UI-state snapshot, operation
progress events (independent conveniences, tracked separately, not part of
this architecture).

## 2. Approach

Chosen: **Full MapLibre Handler Registry** (over flat-options or hybrid
alternatives). The user selected breaking / all-at-once. This is the only
option that delivers a single unified mental model and does not leave a
"must break again later" debt. It also incidentally fixes the fragile
implicit pointer arbitration (`drag-pan-handler.ts:61` special-casing
`e.shiftKey`).

## 3. Core Architecture — Handler interface + HandlerManager

New `src/core/handler.ts`:

```ts
interface Handler<Opts = unknown> {
  readonly name: string;                 // 'dragPan' | 'scrollZoom' | 'clickSelect' | …
  enable(): void;
  disable(): void;
  isEnabled(): boolean;
  setOptions(opts: Partial<Opts>): void;
  getOptions(): Readonly<Opts>;
  handlePointer(ev: NormalizedPointerEvent): HandlerResult;
}
type HandlerResult = 'passthrough' | 'consumed' | 'exclusive';
```

New `src/core/handler-manager.ts` — the single pointer arbitration layer:

- Installs ONE set of DOM listeners on `_canvasContainer`
  (pointerdown/move/up, wheel, click), normalizing to
  `NormalizedPointerEvent` `{ point, lngLat, modifiers:{shift,ctrl,alt,meta},
  button, originalEvent }`.
- Feeds the event to enabled handlers in fixed priority order until one
  returns `consumed`/`exclusive`. `exclusive` (e.g. mid box-select drag)
  locks subsequent move/up to that handler until the gesture ends.
- Replaces the current `drag-pan-handler.ts:61` hardcoded `e.shiftKey`
  special-case: arbitration is by priority + modifier match, not by
  "who special-cases whom".

Priority (high→low): `lassoSelect` / `boxSelect` (exclusive while
gesturing) → `clickSelect` (click, no drag) → `dragPan` → `scrollZoom`.
Mutual exclusion guaranteed by "only one handler can be in an exclusive
gesture at a time".

Exposure on `Emap`: `map.dragPan`, `map.scrollZoom`, `map.clickSelect`,
`map.boxSelect`, `map.lassoSelect` are read-only `Handler` instances;
`HandlerManager` is private `_handlers`. Handlers emit semantic intent only
(selectIntent, panBy) via existing `EventDispatcher.fire` and the imperative
`Emap` API (`select()`, viewport pan/zoom) — handlers never touch
`_dataset`/`_painter`.

## 4. Selection handlers + controls become thin shells

New `src/core/handlers/`:

```ts
type SelectMode = 'replace' | 'add' | 'toggle';
type ModifierCombo = 'none' | 'shift' | 'ctrl' | 'alt' | 'meta'
                   | 'shift+ctrl' | 'shift+alt' | 'ctrl+alt';

interface SelectHandlerOptions {
  layers?: string[];                 // restrict selectable layers; default = all
  source?: string;
  modifiers?: Partial<Record<SelectMode, ModifierCombo>>;
}
// Defaults (identical to current hardcoded behavior → no behavior change):
//   { replace: 'none', add: 'shift', toggle: 'shift+alt' }
```

- `clickSelect`: click hit → resolve mode from `modifiers` → `Emap.select()`;
  empty click with mode=replace → clear selection.
- `boxSelect`: drag a rectangle (`dragThreshold` default 4px), on release
  `queryFeatures(bbox)` → `select(mode)`. Extra option
  `dragActivator?: ModifierCombo` (default `'shift'`, since unmodified drag
  is pan).
- `lassoSelect`: like box, plus `includeIntersecting` (default true);
  `dragActivator` default `'shift'`.
- Shared pure `resolveMode(modifiers, table)` (unit-testable) used by all
  three — eliminates the duplicated private `_modeFromEvent()`.

`dragActivator` vs `modifiers` composition (box/lasso): `dragActivator` is
the gate — the drag-select gesture only starts if its combo is held at
pointerdown (default `'shift'`, so unmodified drag stays pan). `modifiers`
then maps the keys held at gesture *end* to the `SelectMode`. With the
defaults this reproduces today's behavior exactly: `shift`+drag → activate,
held shift alone → mode `replace`; `shift+alt` → mode `toggle`. For
`clickSelect` there is no `dragActivator` (clicks need no gesture gate);
only `modifiers` applies, and its `replace:'none'` default means a plain
click selects-and-replaces.

Conflict rule: `boxSelect` and `lassoSelect` cannot both be enabled (both
consume `shift+drag`); `enable()` throws a validation-style error if the
other is already enabled (explicit, not silent). `clickSelect` may coexist
with either box selector (click vs drag disambiguated by the arbitration
layer).

Controls become thin shells (`src/ui/`, internal rewrite; **public
`Control` interface and constructor options unchanged**):

| Control | Post-refactor responsibility |
|---|---|
| `BoxSelectControl` | Render a toggle button only; click = `map.boxSelect.enable()/disable()`; active state subscribes to handler state. No selection logic (moved to `boxSelect` handler). |
| `LassoSelectControl` | Same → `map.lassoSelect`. |
| `NavigationControl` | Unchanged (already a thin shell over `map.zoomIn()` — reference template). |

The drag-visual overlay (currently inline-styled at
`box-select-control.ts:75`) moves into the handler with the logic; DOM still
in `_canvasContainer`; classes `.emap-box-select` / `.emap-lasso-select`
retained as theme hooks (§6).

Consumer wins: "selection without a button" → just
`map.boxSelect.enable()`, no addControl; "custom button reusing logic" →
own control calling `map.boxSelect`; "change modifiers" →
`map.clickSelect.setOptions({ modifiers:{ add:'ctrl' } })`, no forking a
private method.

## 5. Delegated feature event dispatcher

New events via existing `EventDispatcher` (no parallel system):

```ts
map.on('feature:click', { source?, layers? }, (e: FeatureEvent) => {})
map.on('feature:hover', { source?, layers? }, (e) => {})   // continuous while over a feature
map.on('feature:enter', { source?, layers? }, (e) => {})   // entered a feature
map.on('feature:leave', { source?, layers? }, (e) => {})   // left a feature

interface FeatureEvent {
  type: string;
  feature: Feature;          // from existing FeatureAccessor; properties Object.freeze'd
  ref: FeatureRef;           // { source, layer, id }
  point: { x: number; y: number };
  lngLat: [number, number];
  modifiers: { shift: boolean; ctrl: boolean; alt: boolean; meta: boolean };
  originalEvent: PointerEvent;
}
```

New `src/core/feature-event-dispatcher.ts`:

- Fed normalized pointer events by `HandlerManager`; hit-test **reuses
  existing `FeatureQuery`** (Flatbush spatial index, same path as
  `map.ts:queryFeatures`) — no new hit-test logic.
- Listener registry filtered by `{source?, layers?}`; one hit query per
  event dispatched to matching filters. Zero cost when no listeners
  registered (same shape as the validators "one size check when none
  registered" pattern).
- `enter`/`leave`/`hover` maintain a "last hit ref" state machine: on move,
  diff previous vs current hit → fire leave(old)/enter(new)/hover(current).
- Decoupled from selection / clickSelect: `feature:click` is pure
  notification, does not mutate selection; `clickSelect` is an independent
  chain. Consumers may use only events for a custom selection UI, only
  clickSelect, or both.
- Cooperates with existing `HighlightManager` but does not auto-highlight
  (single responsibility); docs give the canonical recipe
  `map.on('feature:enter', …, e => map.setHighlightedFeatures([e.ref]))`,
  eliminating the manual mousemove-poll + manual highlight-sync boilerplate.
- `off`/`once` reuse `EventDispatcher`; `map.off('feature:click', fn)`
  removes by listener reference; the filter object is stored alongside the
  listener (no need to re-pass on `off`).
- Big datasets: hit-test goes through `FeatureQuery`'s LOD index, same as
  existing `queryFeatures` — no new perf path, no regression.

## 6. CSS-variable theme layer + SimplifyControl de-inline

`src/ui/controls.css` gains a `:root` token block; every hardcoded
color/size/shadow/radius literal is replaced with
`var(--emap-*, <original>)` (original value as fallback → **default
appearance unchanged**):

```css
:root {
  --emap-color-primary:     #0078ff;
  --emap-color-surface:     #fff;
  --emap-color-surface-alt: #f2f2f2;
  --emap-color-text:        #222;
  --emap-color-border:      rgba(0,0,0,.1);
  --emap-shadow:            0 1px 4px rgba(0,0,0,.3);
  --emap-radius:            4px;
  --emap-ctrl-size:         30px;
  --emap-font:              14px/1.4 system-ui, sans-serif;
  --emap-z-ctrl:            10;
}
```

- Consumers theme by overriding variables (no specificity war), globally on
  `:root` or scoped to an ancestor. Dark mode = one variable override set,
  no second stylesheet.
- Remove `!important` (e.g. `.emap-ctrl-edit.active`): with variables the
  specificity is controllable and `!important` both unneeded and blocks
  overrides.
- `SimplifyControl` de-inline (`src/ui/simplify-control.ts:102-136`): delete
  inline `cssText` and per-element inline styles; introduce structured
  classes `.emap-simplify-popup`, `.emap-simplify-row`,
  `.emap-simplify-actions`, `.emap-simplify-field` in `controls.css`
  consuming the same `--emap-*` tokens. DOM structure, behavior, and public
  API unchanged — purely a style-reachability fix.
- All controls gain a constructor `className?: string` (currently only
  Nav/Status/History) attached to the root element for instance-level hooks.
- CSS injection unchanged (`rollup postcss inject:true` + standalone
  `dist/emap.css`). No JS theme API (`setTheme()`) — CSS variables are the
  web standard, SSR/no-JS friendly; YAGNI.

## 7. Breaking migration + MapOptions

`src/map/types.ts`:

```ts
interface MapOptions {
  container: string | HTMLElement;
  // REMOVED: interactive?: boolean
  dragPan?:     boolean;                          // default true
  scrollZoom?:  boolean;                          // default true
  clickSelect?: boolean | SelectHandlerOptions;   // default false
  boxSelect?:   boolean | SelectHandlerOptions;   // default false
  lassoSelect?: boolean | SelectHandlerOptions;   // default false
  // worker / expressionPolicy etc. unchanged
}
```

- `interactive` removed (breaking). Migration: `interactive:false` →
  `{ dragPan:false, scrollZoom:false }`. CHANGELOG/migration guide gives the
  one-line mapping.
- Selection handlers default `false` is a **deliberate behavior-preservation
  choice**: previously no addControl meant no box/click selection; not
  enabling explicitly keeps that, avoiding a silent "selection appeared
  after upgrade" break. Docs and all examples demonstrate explicit
  `clickSelect:true`.

BREAKING list (→ 0.3.0, CHANGELOG `BREAKING`):

1. `MapOptions.interactive` removed → named handler toggles.
2. `BoxSelectControl`/`LassoSelectControl` internally rewritten as thin
   shells; **public `Control` interface and constructor options preserved**
   (`new BoxSelectControl()` still works), but their "own selection logic"
   semantics move to `map.boxSelect`. Docs: prefer `map.boxSelect`; controls
   are button sugar.
3. Selection modifiers now configurable (defaults equal old hardcoded → no
   default behavior change).
4. CSS `!important` removed, SimplifyControl switched to classes — consumers
   who overrode those inline/`!important` styles must adjust (migration
   guide lists affected selectors).
5. Private `_modeFromEvent` / `DragPanHandler` shift special-case deleted —
   affects only code that reached into privates (unsupported).

`src/index.ts` new exports: `Handler` interface, `HandlerManager` (type),
`SelectMode`/`ModifierCombo`/`SelectHandlerOptions`, `FeatureEvent`.

## 8. Testing strategy

Vitest, existing jsdom + mapshaper-stub patterns:

- Unit: `resolveMode(modifiers, table)` full combinations; `HandlerManager`
  arbitration priority + exclusive lock; each handler
  enable/disable/setOptions.
- Integration: `FeatureEventDispatcher` enter/leave/hover state machine
  (synthetic pointer sequences); `feature:click` filter by source/layers.
- Regression: `box/lassoSelect` via the handler path produces
  `selectionchange` payloads byte-identical to the old controls (guards
  against behavior drift).
- Reuse the `setdata-addsource-ordering.test.ts` bare-Emap + real
  TopologySource pattern for end-to-end.
- Maintain current 998 green + added coverage; `bundle-self-contained`
  unaffected.

## 9. Implementation phasing (for writing-plans to split)

All within 0.3.0; each phase independently testable / separately PR-able:

- **P1** HandlerManager + arbitration + migrate dragPan/scrollZoom (no
  behavior change — pure refactor groundwork).
- **P2** Three selection handlers + controls thin-shelled.
- **P3** Feature event dispatcher.
- **P4** CSS variables + SimplifyControl de-inline + `className` on all
  controls.

## 10. OpenSpec note

Per `CLAUDE.md`, this is a new capability + breaking change and normally
warrants an OpenSpec proposal under `openspec/changes/`. This design doc is
the brainstorm artifact; the OpenSpec proposal (proposal.md / tasks.md /
spec deltas) should be derived from it before implementation if the project
keeps the OpenSpec gate for 0.3.0.
