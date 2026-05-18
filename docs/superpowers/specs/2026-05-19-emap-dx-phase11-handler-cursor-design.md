# DX Phase 11 — Per-handler cursor via HandlerManager (design)

> Final item in the emap DX batch (P9 camera + P10 EmapEventMap done &
> pushed at `830aaab`). Accumulates toward 0.3.0. OpenSpec skipped per
> P1–P10 precedent. Rhythm: brainstorm → spec → plan → subagent-driven TDD.

## §0 Problem

The map canvas cursor is essentially unmanaged. The only map-level cursor
today is one live CSS class — `.emap-edit-active` (→ `crosshair`), toggled
by `VertexEditHandler.enable()/disable()` via
`getCanvasContainer().classList.add/remove(...)` (`src/core/handlers/
vertex-edit.ts:72,88`). A sibling rule `.emap-draw-active` exists in
`src/ui/controls.css` but is **dead** — no code ever adds that class, so
draw mode never actually shows a crosshair. `dragPan` has **no** cursor at
all (no `grab`/`grabbing`). Cursor intent is therefore split between dead
CSS, one handler reaching into the DOM, and nothing for panning.

P11 makes each `Handler` declare the cursor it wants for its current
state and lets `HandlerManager` (the existing single pointer-arbiter)
resolve and apply one effective cursor. Single source of truth.

## §1 Architecture

Add an optional method to the `Handler` interface (`src/core/handler.ts`):

```ts
/** The cursor this handler wants for its CURRENT state, or null = no
 *  opinion (fall through to lower-priority handlers / CSS default). */
getCursor?(): string | null;
```

`HandlerManager` (`src/core/handler-manager.ts`) gains a private
`_applyCursor()` that resolves the effective cursor and assigns
`this._element.style.cursor`. Resolution order:

1. If an exclusive gesture is active (`this._exclusive`): that handler's
   `getCursor?.()` wins (so `grabbing` holds through a drag while the
   pointer is moving).
2. Else: the first handler in the existing `PRIORITY` array that is
   registered, enabled, and whose `getCursor?.()` returns a non-null,
   non-empty string.
3. Else: `''` (clears inline cursor → CSS/page default shows through).

A handler with no `getCursor` (or returning `null`) is skipped. The empty
string from step 3 is written only if it differs from the current value
(idempotent; avoids needless style writes).

`_applyCursor()` is called:
- at the end of `_dispatch()` (covers pointer-driven state changes:
  drag start/end → `grab`↔`grabbing`, exclusive acquire/release);
- from a new public `refreshCursor(): void` (covers state changes that
  happen OUTSIDE a pointer event — e.g. `VertexEditHandler.enable()`
  flipping into a mode);
- from `detach()` (resets the element cursor to `''` and is a no-op if
  `_element` is already null).

No new DOM listeners. One `style.cursor` write per dispatch, idempotent.
The dispatch/priority/exclusive logic itself is unchanged — `_applyCursor`
is purely additive (one call appended at the end of `_dispatch`).

Handlers already receive a back-reference to the manager (`register`
sets `(handler)._manager = this`). P11 formalises the part it needs:
handlers that change cursor-relevant state outside a pointer event call
`this._manager?.refreshCursor()`.

## §2 Per-handler `getCursor()` declarations

| Handler | returns | When |
|---|---|---|
| `dragPan` | `'grabbing'` if `this._dragging`, else `'grab'`; `null` if `!this._enabled` | dynamic from the existing `_dragging` flag |
| `boxSelect` | `'crosshair'` (when enabled, else `null`) | |
| `lassoSelect` | `'crosshair'` (when enabled, else `null`) | |
| `drawFeature` | `'crosshair'` (when enabled, else `null`) | revives the previously-dead `.emap-draw-active` intent — an intended fix |
| `vertexEdit` | `'crosshair'` if `this._enabled`, else `null` | preserves the old `.emap-edit-active` crosshair (visual parity) |
| `clickSelect` | `null` (or no `getCursor`) | plain click-select → default arrow; no regression |
| `transformFeature` | `null` (or no `getCursor`) | matches today (no cursor was ever set) — no regression |
| `scrollZoom` | n/a | not in `PRIORITY`, never consulted |

Resolution examples:
- Plain interactive map (`dragPan` enabled only): idle → `grab`; during a
  pan (`_exclusive === dragPan`, `_dragging`) → `grabbing`; after `up` →
  `grab`.
- Draw mode (`drawFeature` enabled, higher `PRIORITY` than `dragPan`):
  `crosshair` (was previously broken — dead CSS rule).
- Vertex edit (`vertexEdit` enabled): `crosshair` (same as before, now via
  the arbiter instead of a DOM class).
- Nothing enabled with an opinion: `''` (default arrow / page CSS).

## §3 Migration — replace the CSS-class mechanism (single source)

- `src/core/handlers/vertex-edit.ts`: delete the two
  `this._map.getCanvasContainer().classList.add/remove('emap-edit-active')`
  calls (lines 72, 88). Add `getCursor(): string | null { return
  this._enabled ? 'crosshair' : null; }`. At the end of `enable()` and
  `disable()` call `this._manager?.refreshCursor()` (state change outside
  a pointer event). The `_manager` back-ref is the one set by
  `HandlerManager.register`; type it via the existing
  `(this as { _manager?: HandlerManager })` shim pattern already used in
  the codebase (no new public coupling).
- `src/core/handlers/drag-pan.ts`, `draw-feature.ts`, `box-select.ts`,
  `lasso-select.ts`: add `getCursor()` per the §2 table. (No
  `refreshCursor()` needed for the pointer-driven ones — `_applyCursor`
  runs at the end of every `_dispatch`; `drawFeature` is mode-toggled like
  vertexEdit so it ALSO calls `this._manager?.refreshCursor()` in its
  enable/disable.)
- `src/ui/controls.css`: delete the now-unreferenced `.emap-edit-active`
  (lines ~117) and dead `.emap-draw-active` (lines ~131) rules.
- `src/core/handlers/vertex-edit.test.ts:145`: the assertion
  `expect(classListAdd).toHaveBeenCalledWith('emap-edit-active')` is
  replaced by asserting `handler.getCursor()` returns `'crosshair'` when
  enabled and `null` when disabled (and, if the test has a manager,
  that `refreshCursor` was invoked). This is the ONLY existing test that
  references the removed class.

No other control or CSS changes. `getCanvasContainer()` stays (still used
elsewhere); only the two `classList` cursor calls are removed.

## §4 Testing & verification

- `src/core/handler-manager.test.ts` (extend): `_applyCursor` resolution
  — (a) exclusive handler's cursor wins mid-gesture and survives pointer
  `move`; (b) priority-order first-non-null when several enabled handlers
  have opinions; (c) all-`null`/none → `style.cursor === ''`; (d)
  `refreshCursor()` recomputes after an out-of-band `enable()`; (e) the
  write is idempotent (no change when the resolved cursor is unchanged);
  (f) `detach()` clears it.
- Per-handler `getCursor()` unit cases: `dragPan` `grab`↔`grabbing`
  (toggle `_dragging`) and `null` when disabled; `boxSelect`/
  `lassoSelect`/`drawFeature`/`vertexEdit` → `'crosshair'` enabled /
  `null` disabled; `clickSelect`/`transformFeature` → `null`.
- `src/core/handlers/vertex-edit.test.ts`: update the one CSS-class
  assertion (see §3); all other vertex-edit assertions unchanged and
  still green.
- Regression: full suite green with no other existing test modified;
  `HandlerManager` dispatch/priority/exclusive behaviour byte-unchanged
  except the single appended `_applyCursor()` call + the new method +
  `refreshCursor()`.
- Gates: `npx tsc --noEmit` exit 0 · `npx vitest run` full suite green
  (report exact counts; new cases added) · `npm run build` exit 0 ·
  `git diff` scope limited to: `src/core/handler.ts` (+optional method),
  `src/core/handler-manager.ts` (`_applyCursor` + `refreshCursor` +
  one call site), the 5 handler files (`getCursor`, vertexEdit/draw also
  `refreshCursor` in enable/disable, vertexEdit minus 2 classList lines),
  `src/ui/controls.css` (−2 rules), `vertex-edit.test.ts` (1 assertion),
  new/extended test files, CHANGELOG.

## §5 Out of scope (YAGNI)

- Feature-hover cursor (`pointer` over a selectable feature) — would
  couple to `feature-query` + P3 delegated feature events; deferred.
- Configurable/themeable cursor strings per handler — handlers return
  fixed strings; a `setOptions({ cursor })` surface is unneeded now.
- Cursor for `transformFeature`/`clickSelect` — intentionally `null` to
  guarantee zero behaviour change vs. today for those handlers.
- Touching `HandlerManager` dispatch/priority/exclusive logic — `_apply
  Cursor` is strictly additive.
