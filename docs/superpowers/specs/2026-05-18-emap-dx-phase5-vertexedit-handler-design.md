# emap DX Phase 5 — `vertexEdit` Handler Design

> **Status:** Approved (brainstorm artifact). Extends the master design
> `2026-05-17-emap-maplibre-dx-design.md` with a new section §11 (phase P5).
> vertexEdit was NOT in the master spec; this doc is its design of record.
> Next: writing-plans → subagent-driven execution. Release policy unchanged
> (accumulate toward 0.3.0; `package.json` stays `0.2.0`).

## 11. `vertexEdit` becomes an arbiter-driven handler

### 11.1 Problem & Goal

`VertexEditControl` (`src/ui/vertex-edit-control.ts`) owns four DOM listeners
(`mousemove`/`mousedown`/`contextmenu` on the canvas container, `mouseup` on
`window`) plus a `map.on('move')` re-render subscription, and is the only
interaction not routed through the Phase-2a `HandlerManager` arbiter. Goal:
move all of its interaction / geometry / undo logic into a named
`VertexEditHandler` (`map.vertexEdit`, `Handler<VertexEditOptions>`), making
it consistent with `dragPan` / `scrollZoom` / the P2b selection handlers and
the P3 event sink — usable without `addControl`, single arbitration path —
**with zero behavior change**.

### 11.2 Modal coordination (existing mechanism preserved)

vertex editing is modal. Today entering it disables pan and notifies apps:
`map.ts:181` — on `editmodechange`, `change.current.mode === 'none' ?
dragPan.enable() : dragPan.disable()` and `fire('editmodechange', …)`.

Decision (user-approved): **keep this mechanism unchanged.**
- `map.vertexEdit.enable()` → `map.setEditMode('vertex')` (preserves the
  existing `editmode→dragPan.disable()` + `editmodechange` event; any
  third-party listener and the `EditStateStore` linkage keep working).
- `map.vertexEdit.disable()` → `map.setEditMode('none')` +
  `map.clearEditVertexState()` + `map.render()`.
- The handler does not itself fight pan via `consumed`/`exclusive` to block
  panning — `dragPan` is already disabled by the edit-mode toggle while
  editing. Arbiter priority is only about vertexEdit owning its drag.

### 11.3 Core change: arbiter gains a `contextmenu` event kind

Right-click vertex-delete needs a contextmenu event; `NormalizedPointerEvent`
currently has only `down|move|up|wheel|click`.

Decision (user-approved): **extend the arbiter** (most unified, reusable).
- `src/core/handler.ts`: add `'contextmenu'` to
  `NormalizedPointerEvent['kind']`.
- `HandlerManager.attach(element)`: add an `element` `contextmenu` listener
  → `_norm(e, 'contextmenu')` → `_dispatch`; `detach()` removes it
  symmetrically (sits alongside the existing `pointerdown`/`click`
  element-listeners + `window` move/up).
- `_dispatch`: `contextmenu` goes through the normal priority loop (NOT the
  P3 passive sink, NOT the exclusive-lock branch — it is a discrete action
  event, like `click`). The P3 `_pointerSink` is fed only `click` +
  non-gesture `move` (unchanged); `contextmenu` is not sunk.
- Regression safety (verified): every existing handler
  (`dragPan`/`scrollZoom`/`clickSelect`/`boxSelect`/`lassoSelect`) ends its
  `handlePointer` with a fall-through `return 'passthrough'`, so an
  unrecognized `contextmenu` kind is a no-op for all of them. `scrollZoom`
  is unconditional passthrough. Zero regression.
- `_norm` is already generic over `kind`; no change needed. `originalEvent`
  stays typed `Event` (a `MouseEvent` at runtime for contextmenu).

### 11.4 `VertexEditHandler` — `handlePointer` mapping (line-equivalent to today)

`map.vertexEdit` implements `Handler<VertexEditOptions>`, disabled by
default. Construction takes the `Emap` instance (like the P2b selection
handlers) for `queryFeatures`/`getSource`/`project`/`unproject`/`pushCommand`
/`setEditVertexState`/`clearEditVertexState`/`setEditMode`/`render`/adapter.

| Event (state) | Behavior (verbatim port of the control's logic) | Result |
|---|---|---|
| `enable()` | `setEditMode('vertex')`; `map.on('move', _onViewMove)` (re-render on viewport change) | — |
| `disable()` | if dragging → cancel; `map.off('move', …)`; `setEditMode('none')`; `clearEditVertexState()`; `render()` | — |
| `move` (not dragging) | find nearest vertex / interpolated edge point; `setEditVertexState(...)` to highlight; (port `_onMouseMove`/`_findNearestVertices`/`_findInterpolatedPoint`/`_findNeighborShapes`/`_updateEditState`) | `passthrough` |
| `down` (button 0, hit vertex OR interpolated edge) | if interpolated: insert vertex + `pushCommand(VertexInsertCommand)` then promote to vertex drag; record drag-from coords; start drag (port `_onMouseDown`) | `exclusive` |
| `down` (button 0, no hit) | nothing | `passthrough` |
| `move` (dragging) | move shared vertices, refresh LOD, repaint (port `_handleDrag`) | `exclusive` |
| `up` (dragging) | if actually moved → `pushCommand(VertexMoveCommand)`; fire `vertex_moved`; end drag (port `_onMouseUp`) | `passthrough` |
| `contextmenu` (not dragging, hit vertex, not an arc endpoint) | `originalEvent.preventDefault()`; show delete context menu → on confirm `deleteVertex` + `pushCommand(VertexDeleteCommand)` (port `_onContextMenu`/`_deleteHoveredVertex`/`_showContextMenu`) | `consumed` |
| `contextmenu` (otherwise) | `originalEvent.preventDefault()` only (suppress browser menu, as today) | `consumed` |
| `disable()` mid-drag | cancel gesture, `clearEditVertexState()` | — |

Priority array becomes
`['lassoSelect','boxSelect','clickSelect','vertexEdit','dragPan']` —
`vertexEdit` after the selectors, before `dragPan`. (In practice editing and
selection are not enabled together, and `dragPan` is already off via
edit-mode; priority just guarantees vertexEdit owns its exclusive drag.)

The context-menu DOM element stays appended to `_canvasContainer` (as today,
id `emap-ctx-menu`); its inline styling is untouched here (theme-token
migration is §6/P4 scope, not P5).

### 11.5 Controls become thin shells

`VertexEditControl` (public `Control`, **interface + constructor options +
button DOM/classes + behavior byte-identical**):

| Before | After |
|---|---|
| 4 DOM listeners + all hover/drag/insert/delete/contextmenu/geometry/undo logic | Renders the toggle button only; click → `map.vertexEdit.enable()/disable()`; `active` CSS state subscribes to handler enabled-state |

Mirrors the P2b decision for `BoxSelectControl`/`LassoSelectControl`. The
control no longer calls `setEditMode` directly — it calls
`map.vertexEdit.enable()`, which calls `setEditMode` internally, so the
externally observable sequence (`editmodechange`, button `active` class,
overlay) is identical.

### 11.6 Options

```ts
interface VertexEditOptions {
  /** Polygon hover fill. Default 'rgba(0,0,0,0.15)' (today's DEFAULT_POLYGON_FILL). */
  polygonFillColor?: string;
}
```
Exactly the surface of today's `VertexEditControlOptions`; the thin-shell
control forwards its constructor option to `map.vertexEdit.setOptions(...)`.

### 11.7 Public surface / back-compat invariants

- New: `map.vertexEdit` (`Handler<VertexEditOptions>` getter), exported
  `VertexEditHandler` + `VertexEditOptions` from `src/index.ts`.
- Unchanged byte-for-byte: `VertexEditControl` class, its constructor
  options, button markup/classes, `setEditMode`/`getEditMode`,
  `editmodechange` event, `EditStateStore` linkage, the
  `VertexMove/Insert/Delete` undo commands and their coalescing, the
  `vertex_moved` event payload, `setEditVertexState`/`clearEditVertexState`
  render path, the `emap-ctx-menu` element.
- Default `new Emap()` behavior unchanged: `vertexEdit` is disabled by
  default; the only new always-on cost is one `contextmenu` element
  listener whose event every existing handler ignores (passthrough) and
  which does nothing when `vertexEdit` is disabled.

### 11.8 Testing strategy

- `VertexEditHandler` unit tests (stub `Emap`): move-hover highlights;
  down-on-vertex → exclusive + drag; down-on-interpolated → insert command
  then drag; up after real move → move command + `vertex_moved`;
  contextmenu on vertex → delete command; contextmenu on arc endpoint →
  no delete (preventDefault only); `disable()` mid-drag cancels.
- `HandlerManager` unit test: `contextmenu` is normalized + dispatched
  through the priority loop (not the sink, not exclusive); a registered
  passthrough handler sees it; existing P1/P2a/P2b/P3 tests unaffected.
- `vertex-edit-control.test.ts` is **white-box** (uses `Reflect` to set
  private state `_hoverVertexIds`/`_hoveredFeature`/`_map` and invoke
  private methods `_handleDrag`/`_onMouseUp` directly). After thin-shell
  those internals live on `VertexEditHandler`, not the control. Decision:
  **move** these white-box cases verbatim into the handler's test file,
  re-pointing `new VertexEditControl()` → `new VertexEditHandler(stubMap)`
  and keeping the SAME private names (the port preserves method seams:
  `_handleDrag`, `_onMouseUp`/`_finishDrag`, `_hoverVertexIds`, …), so the
  assertions are unchanged — only the construction target changes. The
  thin-shell control gets a NEW small behavior test (button click →
  `map.vertexEdit.enable()/disable()`; `active` class tracks handler
  state). Net test count unchanged (cases moved, not added/removed) plus
  the new thin-shell control test. This mirrors the P2b Task-2 geometry
  test move.
- Gate: `tsc --noEmit` 0, full `vitest run` green, `npm run build` 0,
  `map.test.ts` edit-mode/pan/zoom suites byte-identical.

### 11.9 Phasing

P5, independently testable / PR-able, after P3 (done). Own implementation
plan via writing-plans; subagent-driven execution + two-stage review. P6
(`drawFeature`) and the remaining P2c/P4 are separate, unaffected.

## 12. OpenSpec note

Per `CLAUDE.md` this is a new capability + public-surface addition that
normally warrants an OpenSpec proposal. Consistent with P1–P3, the user has
elected to skip OpenSpec and proceed brainstorm-doc → writing-plans
directly.
