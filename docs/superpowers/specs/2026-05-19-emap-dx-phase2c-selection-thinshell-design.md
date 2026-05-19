# DX Phase 2c — Selection-control thin-shell + type consolidation (design)

> Deferred-from-2b cleanup, run after the P9–P11 batch (all pushed at
> `9a02ea7`). Accumulates toward 0.3.0. OpenSpec skipped per P1–P11
> precedent. Rhythm: brainstorm → spec → plan → subagent-driven TDD.

## §0 Problem

DX Phase 2b introduced the named selection handlers `map.boxSelect` /
`map.lassoSelect` / `map.clickSelect`, built to reproduce the legacy
`BoxSelectControl` / `LassoSelectControl` behavior **exactly**. But the two
controls were left as-is: `src/ui/box-select-control.ts` (236 lines) and
`src/ui/lasso-select-control.ts` (258 lines) still own their own
`mousedown`/`mousemove`/`mouseup` listeners, rubber-band overlay / SVG,
hit-test, and `select()` call — ~490 lines duplicating what
`BoxSelectHandler` / `LassoSelectHandler` now do. Same deferred-thin-shell
debt P5/P6/P7 cleared for vertex/draw/transform controls.

Selection types are also duplicated: `SelectMode` is declared identically in
`core/handlers/select-mode.ts` and `map/selection.ts`; `BoxSelectStyle` in
`ui/box-select-control.ts` and `core/handlers/box-select.ts`; and the lasso
style exists as two *different* public types — `LassoStyle` (3 fields,
`core/handlers/lasso-select.ts`, exported at `index.ts:203`) and
`LassoSelectStyle` (4 fields incl. `strokeDasharray`,
`ui/lasso-select-control.ts`, exported at `index.ts:316`).

P2c thin-shells both controls over the P2b handlers and consolidates the
duplicated types — with byte-identical public API and visual behavior.

## §1 Architecture

Rewrite `src/ui/box-select-control.ts` and `src/ui/lasso-select-control.ts`
as thin `Control` shells (the P5/P6/P7 pattern). Emap already constructs and
registers the handlers and exposes them via public getters
`get boxSelect()` / `get lassoSelect()` (`src/map/map.ts:1012-1016`).

Thin-shell contract (per control):
- `constructor(options?: <Box|Lasso>SelectControlOptions)` — store options
  (unchanged signature).
- `onAdd(map): HTMLElement` — `this._handler = map.boxSelect` (resp.
  `map.lassoSelect`); `this._handler.setOptions(mapOptions(this._options))`;
  if the control is enabled, `this._handler.enable()`; create and return the
  0×0 anchor element (same className `emap-ctrl emap-box-select-anchor` /
  lasso equivalent).
- `enable()` / `disable()` / `isEnabled()` — proxy to the handler
  (`enable()` propagates the handler's mutual-exclusivity `throw`).
- `onRemove()` — `this._handler?.disable()`; remove the anchor; null refs.
  Does NOT destroy the handler (Emap owns its lifecycle).

The handler owns the overlay/SVG (same `.emap-box-select` /
`.emap-lasso-select` classNames), the pointer listeners (via the P2a
arbiter), hit-test, and `select()`. The control no longer touches
`getCanvasContainer`, `mousedown`, `queryFeatures`, or `select`.

`mapOptions()` (per control): `{ layers, style, dragThreshold }` for box;
`{ layers, style, dragThreshold, includeIntersecting }` for lasso —
forwarded verbatim to the handler's `setOptions`.

## §2 Type consolidation (one declaration each; public paths preserved)

| Type | Duplicated at | Canonical | Re-export shim |
|---|---|---|---|
| `SelectMode` | `core/handlers/select-mode.ts:4` + `map/selection.ts:4` (identical) | `core/handlers/select-mode.ts` (leaf — only imports `type PointerModifiers`) | `map/selection.ts`: `export type { SelectMode } from '../core/handlers/select-mode';` (replaces local decl). `index.ts:86` (`from './map/selection'`) and `map.ts`/click-select imports unchanged. |
| `BoxSelectStyle` | `ui/box-select-control.ts:6` (JSDoc) + `core/handlers/box-select.ts:8` (terse, same shape) | `core/handlers/box-select.ts` (carry the JSDoc over) | `ui/box-select-control.ts`: `export type { BoxSelectStyle } from '../core/handlers/box-select';`. `index.ts:310` path unchanged. |
| `LassoSelectStyle` (4-field) / `LassoStyle` (3-field) | control `LassoSelectStyle` (`{stroke?,strokeWidth?,fill?,strokeDasharray?}`) vs handler `LassoStyle` (`{stroke?,strokeWidth?,fill?}`) | `core/handlers/lasso-select.ts`: canonical `LassoSelectStyle` = the **4-field superset**; add `export type LassoStyle = LassoSelectStyle;` (alias) | control: `export type { LassoSelectStyle } from '../core/handlers/lasso-select';`. `index.ts:203` still exports `LassoStyle` (now alias); `index.ts:316` exports `LassoSelectStyle`. Both public names resolve. |
| `DrawGeometryType` | single decl `core/handlers/draw-feature.ts:7`, re-exported via draw-feature-control | already single — **no change** | n/a (listed in the batch ask but not actually duplicated; called out to bound scope) |

**One deliberate, additive change:** `LassoStyle` widens 3→4 optional
fields (gains `strokeDasharray?`). Structurally back-compat (optional; every
existing value still valid) and required for the thin-shell to keep the
legacy dashed lasso. All other consolidations are pure type-only re-export
shims — zero structural change, no new runtime cycle (the existing
type-only `selection.ts → ./map` cycle is unaffected; `select-mode.ts`
stays a leaf).

## §3 Behavioral-parity invariants (locked by tests)

The P2b handlers were written to reproduce the legacy controls exactly;
P2c verifies and pins:
- **Modifier→mode:** legacy `_modeFromEvent` (`alt`→`toggle`,
  `ctrl|meta`→`add`, else `replace`) ≡ handler
  `{replace:'none',add:'ctrl',toggle:'alt'}` via `resolveMode` after
  stripping the `shift` activator.
- **Activation:** shift+drag (`dragActivator` default `'shift'`);
  `dragThreshold` default `4` (control and handler agree).
- **Options mapping:** control `layers`→handler `layers`; `style`→handler
  `style`; lasso `includeIntersecting` (default `true`)→handler
  `includeIntersecting`; lasso `style.strokeDasharray`→handler.
- **DOM:** overlay/SVG classNames `.emap-box-select` / `.emap-lasso-select`
  unchanged (handler-created); control returns the same 0×0 anchor element
  + className so `addControl` placement is unchanged.
- **Lasso dash:** `LassoSelectHandler._ensureSvg` extended with
  `poly.setAttribute('stroke-dasharray', s.strokeDasharray ?? '4 3')` —
  restores the legacy default dashed look (handler currently sets only
  fill/stroke/stroke-width).
- **Mutual exclusivity:** thin-shell `enable()` propagates the handler's
  `throw` when the sibling handler is enabled (decided: keep the throw).

## §4 Testing & verification

- `src/ui/box-select-control.test.ts` / `lasso-select-control.test.ts`:
  the current tests drive the control's *own* mousedown listeners and
  assert `map.queryFeatures`/`map.select` — that drag behavior now belongs
  to the handler (already covered by `box-select.test.ts` /
  `lasso-select.test.ts`). Rewrite these to assert **delegation** against
  a stub handler: `onAdd` calls `handler.setOptions(mapped)` +
  `handler.enable()`; `control.enable/disable/isEnabled` ⇄ handler;
  `onRemove` disables handler + removes anchor; constructor options
  forwarded; mutual-exclusivity throw surfaces through `control.enable()`.
- New parity tests: modifier→mode equivalence (legacy table vs
  `resolveMode`); `LassoSelectHandler` applies `stroke-dasharray` (default
  `'4 3'`, overridable).
- Type consolidation: a `tsc`-checked `*.test-d.ts` asserting every public
  path still resolves — `SelectMode` from `@/map/selection`,
  `BoxSelectStyle` from box-select-control, `LassoStyle` **and**
  `LassoSelectStyle` — and that `LassoStyle` now structurally accepts
  `strokeDasharray?`.
- Gates: `npx tsc --noEmit` exit 0 · full suite green (report exact
  counts; control tests rewritten, handler/parity/type-d added) ·
  `npm run build` exit 0 · the `box-select`/`lasso-select` example HTMLs
  still function · P1–P11 sources + the P2a arbiter untouched.

## §5 Out of scope (YAGNI)

- No `ClickSelectControl` — none exists; `clickSelect` stays handler-only
  (the P7 transform recipe already drives it without a control).
- `DrawGeometryType` — already single-source; untouched.
- No arbiter / dispatch / priority change.
- No behavior change beyond clearing the deferred-2b duplication and the
  one additive `strokeDasharray` parity restoration.
- No new public API surface; existing class names, option shapes, and
  every exported type path are byte-identical (the `LassoStyle` widening
  is additive-only).
