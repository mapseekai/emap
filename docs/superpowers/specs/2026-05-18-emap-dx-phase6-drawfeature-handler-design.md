# emap DX Phase 6 — `drawFeature` Handler Design

> **Status:** Approved (brainstorm artifact). Extends the master design
> `2026-05-17-emap-maplibre-dx-design.md` with a new section §13 (phase P6).
> drawFeature was NOT in the master spec; this doc is its design of record.
> Mirrors the P5 (`vertexEdit`) pattern. Next: writing-plans →
> subagent-driven execution. Release policy unchanged (accumulate toward
> 0.3.0; `package.json` stays `0.2.0`).

## 13. `drawFeature` becomes an arbiter-driven handler

### 13.1 Problem & Goal

`DrawFeatureControl` (`src/ui/draw-feature-control.ts`, 545 lines) owns four
DOM listeners (`mousemove`/`click`/`dblclick` on the canvas container,
`keydown` on `window`) + a `map.on('move')` re-render + a `map.on(
'editmodechange')` auto-deactivate, and is (with the now-ported vertexEdit)
the last interaction outside the Phase-2a arbiter. Goal: move all of its
drawing / snapping / commit / undo logic into a named `DrawFeatureHandler`
(`map.drawFeature`, `Handler<DrawFeatureOptions>`) — consistent with the
other handlers, usable without `addControl` — **with zero behavior change**.

### 13.2 Arbiter gains a `dblclick` event kind

`drawFeature` finishes a polyline/polygon on double-click. `dblclick` is
pointer-shaped (point + button + modifiers) and reusable, so it joins the
arbiter exactly like P5's `contextmenu`:
- `src/core/handler.ts`: add `'dblclick'` to `NormalizedPointerEvent['kind']`.
- `HandlerManager.attach(element)`: add an `element` `dblclick` listener →
  `_norm(e, 'dblclick')` → `_dispatch`; `detach()` removes it symmetrically.
- `_dispatch`: `dblclick` flows through the normal priority loop (NOT the
  P3 sink — it is not `click`/`move`; NOT the exclusive branch — not
  `move`/`up`), like `click`/`contextmenu`.
- Regression safety: every existing handler (`dragPan`/`scrollZoom`/
  `clickSelect`/`boxSelect`/`lassoSelect`/`vertexEdit`) falls through to
  `return 'passthrough'` for an unrecognized kind. Zero regression.

### 13.3 Keyboard is handler-owned, NOT arbitrated

`keydown` (Escape = cancel current draw) is a global, non-spatial input —
arbitrating it through a pointer manager is the wrong abstraction. Decision
(user-approved): `DrawFeatureHandler` adds its own `window` `keydown`
listener in `enable()` and removes it in `disable()` (scoped to the active
window only), exactly as the control does today. This mirrors the precedent
of `scrollZoom` owning its own wheel listener (P2a) — pointer gestures go
through the arbiter; non-pointer input does not.

### 13.4 Configuration gate

`map.drawFeature` exists from `Emap` construction, but `source` + `type` are
unset (unlike `vertexEdit`, whose options are all optional). Decision
(user-approved): `enable()` throws a validation-style `Error` if `source`
OR `type` is unset:
`drawFeature: source+type required; call setOptions({source,type}) first`.
Explicit failure over silent no-op (consistent with the P2b box/lasso
conflict-rule philosophy). The thin-shell control forwards its **required**
constructor options via `setOptions(...)` in `onAdd` BEFORE any `enable()`,
so the control path never hits the throw.

### 13.5 Modal coordination (existing mechanism preserved)

- `enable()` (after the §13.4 gate passes) → `map.setEditMode('draw')`
  (preserves the existing `map.ts:181` `editmode→dragPan.disable()` +
  `editmodechange` event); add the `window keydown` listener (§13.3);
  `map.on('move', _onMapMove)`.
- `disable()` → reset draw state; `map.setEditMode('none')`;
  `map.clearEditDrawState()`; remove keydown + `map.off('move')`;
  `map.render()`.
- **Cross-mode auto-deactivate (preserved):** the handler subscribes
  `map.on('editmodechange')`; when `e.mode !== 'draw'` AND
  `this.isEnabled()` → quiet-disable (port of the control's
  `_deactivateQuiet`: tear down state/listeners WITHOUT calling
  `setEditMode` again). Recursion guard: `disable()` itself calls
  `setEditMode('none')` which fires `editmodechange('none')`; the
  `isEnabled()` check (already false by then) prevents re-entry. This keeps
  "enabling `vertexEdit` deactivates `drawFeature`" working identically.

### 13.6 `DrawFeatureHandler` — `handlePointer` mapping (line-equivalent)

`map.drawFeature` implements `Handler<DrawFeatureOptions>`, disabled by
default, constructed with the `Emap` instance.

| Event (state) | Behavior (verbatim port of the control's logic) | Result |
|---|---|---|
| `enable()` | §13.4 gate; `setEditMode('draw')`; `window.addEventListener('keydown', _onKeyDownBound)`; `map.on('move', _onMapMoveBound)` | — |
| `disable()` | reset `_vertices`/`_cursorCoord`/`_snap*`; `setEditMode('none')`; `clearEditDrawState()`; remove keydown; `map.off('move')`; `render()` | — |
| `editmodechange` (mode≠'draw' & enabled) | quiet-disable (port `_deactivateQuiet`) | — |
| `move` | rubber-band preview + snap detection; `setEditDrawState(...)`/`render` (port `_onMouseMove`, px/py from `ev.point`) | `passthrough` |
| `click` | add vertex / `point`-mode immediate commit / `polygon` click-first-vertex close (port `_onClick`) | `consumed` |
| `dblclick` | `polyline` (≥2) / `polygon` (≥3) → commit (port `_onDblClick`) | `consumed` |
| `down` / `up` | nothing (drawing has no drag gesture) | `passthrough` |
| key `Escape` (handler-owned listener) | cancel current draw (port `_onKeyDown`) | — |
| commit | `pushCommand(new FeatureCreateCommand(...))` + `map.fire('feature_created', …)` + `source.fire('data', { reason: 'edit' })` (verbatim) | — |

Same single coordinate substitution as P5: methods that derived element-
local px/py via `getBoundingClientRect()`+`clientX/Y` instead read
`ev.point.{x,y}`; `this._map` becomes a non-null `Emap` from the
constructor. No other logic edits.

Priority array:
`['lassoSelect','boxSelect','clickSelect','drawFeature','vertexEdit','dragPan']`.
The modal edit handlers (`drawFeature`/`vertexEdit`) are mutually exclusive
via `editMode`, so their relative order is immaterial; `drawFeature` is
placed before `vertexEdit` for a stable, readable ordering. `click`/
`dblclick` return `'consumed'` so a coincidentally-enabled `clickSelect`
cannot double-fire while drawing.

### 13.7 Options & thin-shell control

```ts
interface DrawFeatureOptions {
  source: string;                 // required (enable() throws if unset)
  sourceLayer?: string;
  type: DrawGeometryType;         // 'polygon' | 'polyline' | 'point'; required
  snapThreshold?: number;
  snapSources?: string[];
  snapToVertex?: boolean;
  snapToEdge?: boolean;
  drawColor?: string;
}
```
= today's `DrawFeatureControlOptions` **minus `icon`** (button-only concern,
stays on the control). `DrawGeometryType` is re-exported from the handler.

`DrawFeatureControl` becomes a button-only thin shell (mirrors P5 /
`BoxSelectControl`), public surface byte-identical:
- `onAdd`: forward all constructor options except `icon` via
  `map.drawFeature.setOptions({...})`; render the same button (icon/title
  per `DEFAULT_ICONS`/`DEFAULT_TITLES` or the `icon` option), click →
  `map.drawFeature.enable()/disable()`; keep the `editmodechange`-driven
  `active`-class sync (when the handler deactivates via cross-mode, the
  button must un-press — the control subscribes `editmodechange` and
  reflects `map.drawFeature.isEnabled()`).
- `onRemove`: disable if active; detach.
- Unchanged byte-for-byte: `DrawFeatureControl` class, `DrawFeatureControlOptions`
  (incl. `icon`), `DrawGeometryType`, button DOM/icon/title, the
  `FeatureCreateCommand` + its coalescing, the `feature_created` event
  payload, the `source.fire('data',{reason:'edit'})` emission, the
  cross-mode auto-deactivate behavior.
- Default `new Emap()` unchanged: `drawFeature` disabled + unconfigured; the
  only new always-on cost is one `dblclick` element listener every handler
  ignores while `drawFeature` is disabled.

### 13.8 Testing strategy

`src/ui/draw-feature-control.test.ts` (590 lines, 24 `it`s) is **white-box**
(`Reflect` `setPrivate`/`callPrivate`/`getPrivate` on `_map`/`_active`/
`_vertices` and private methods `_onClick`/`_findSnapTarget`/…). After
thin-shell those internals live on `DrawFeatureHandler`. Decision (same as
P5 §11.8): **move** the white-box cases verbatim into the handler's test
file, retargeting only `new DrawFeatureControl(opts)` →
`new DrawFeatureHandler(map, opts)` (or `setPrivate(handler,'_enabled',true)`
where the test set `_active`), keeping the SAME private method/state names
(the port preserves seams: `_onClick`, `_onDblClick`, `_findSnapTarget`,
`_vertices`, `_map`, …) so assertions are unchanged — only construction/the
`_active`→`_enabled` rename. The thin-shell control gets a NEW small
behavior test (button click → `map.drawFeature.enable()/disable()`;
`setOptions` forwarded; `editmodechange` un-presses the button). Net test
count unchanged (cases moved) + the new thin-shell test.

Additional: `HandlerManager` `dblclick` normalize/dispatch test (priority
loop, not sink/exclusive, detach removes it, existing handlers passthrough);
`enable()`-without-config throws; `editmodechange` cross-mode auto-deactivate
unit test. Gate: `tsc --noEmit` 0, full `vitest run` green, `npm run build`
0, `map.test.ts` edit-mode/pan/zoom byte-identical.

### 13.9 Phasing

P6, independently testable / PR-able, after P5 (done). Own implementation
plan via writing-plans; subagent-driven execution + two-stage review. The
remaining P2c (selection controls thin-shell + `SelectMode`/`BoxSelectStyle`
type consolidation) and P4 (CSS variables) are separate, unaffected.

## 14. OpenSpec note

Per `CLAUDE.md` this is a new capability + public-surface addition normally
warranting an OpenSpec proposal. Consistent with P1–P5, the user has elected
to skip OpenSpec and proceed brainstorm-doc → writing-plans directly.
