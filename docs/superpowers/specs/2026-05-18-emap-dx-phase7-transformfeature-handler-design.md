# emap DX Phase 7 — `transformFeature` Handler Design

> **Status:** Approved (brainstorm artifact). Extends the master design
> `2026-05-17-emap-maplibre-dx-design.md` with a new section §15 (phase P7).
> transformFeature was NOT in the master spec; this doc is its design of
> record. Mirrors the P5/P6 pattern. Next: writing-plans → subagent-driven
> execution. Release policy unchanged (accumulate toward 0.3.0;
> `package.json` stays `0.2.0`).

## 15. `transformFeature` becomes an arbiter-driven handler

### 15.1 Problem & Goal

Feature transform (translate / rotate / scale) is a complete **headless
engine capability** today via `map.editSession` (`EditSessions`):
`translateSelected`/`rotateSelected`/`scaleSelected` (one-shot) and the
drag sessions `beginTranslateSession()` → `FeatureTranslateSession
{ move(dx,dy), commit(): boolean, cancel() }` /
`beginAffineSession(...)` → `FeatureAffineSession
{ origin:[ox,oy], applyDelta(matrix), commit(label?): boolean, cancel() }`,
with undo via `FeatureTranslateCommand`/`FeatureAffineCommand`. But unlike
pan/zoom/select/vertexEdit/drawFeature there is **no built-in interaction
handler and no UI control** — every consumer hand-wires pointer→session
boilerplate (see `test/examples/feature-translate.html` and
`feature-rotate-scale.html`, ~60 lines of mousedown/move/up + origin/angle/
scale-factor math each). Goal: absorb that boilerplate into a named
`TransformFeatureHandler` (`map.transformFeature`,
`Handler<TransformFeatureOptions>`) consistent with the other handlers.

### 15.2 Modal coordination — new `EditMode 'transform'` (user-approved)

Decision: `transformFeature` is **modal** like `vertexEdit`/`drawFeature`
(NOT the per-gesture non-modal pattern the current examples use — this is a
deliberate UX change; the examples are updated in §15.7 to enable/disable
the mode).

Core change (the P7 analogue of P5's `contextmenu` / P6's `dblclick`): add
`'transform'` to `EditMode` in `src/map/edit-state-store.ts:8`
(`'none' | 'vertex' | 'draw' | 'transform'`). This is the ONLY core/shared
edit. Verified safe — everything downstream works for free:
- `EditStateStore.setMode`: only special-cases `'vertex'`/`'draw'` (drops
  their sub-state); `'transform'` cleanly drops both and needs no
  transform-specific edit-state (the session object holds transform state).
  No exhaustive switch anywhere on `EditMode` would break.
- `map.ts:185` `editmodechange` callback: `mode === 'none' ?
  dragPan.enable() : dragPan.disable()` → `'transform'` auto-disables pan
  and fires `editmodechange({mode:'transform'})`. The modal pan-disable +
  cross-mode behavior is inherited, no new code.
- `setEditMode`/`getEditMode` are pass-throughs.

- `transformFeature.enable()` → `map.setEditMode('transform')` (inherits
  pan-disable + `editmodechange`); add the handler-owned `window keydown`
  listener (§15.4).
- `transformFeature.disable()` → cancel any live session;
  `map.setEditMode('none')`; remove keydown; `map.render()`.
- **Cross-mode auto-deactivate (same as P6):** the handler subscribes
  `map.on('editmodechange')` in its constructor; when `e.mode !==
  'transform'` AND `this.isEnabled()` → `_quietDisable()` (cancel session +
  remove keydown, WITHOUT calling `setEditMode` again). Recursion guard:
  `_enabled=false` is set before any `setEditMode`, so the re-entrant
  `editmodechange('none')` self-no-ops. Enabling `vertexEdit`/`drawFeature`
  (which call `setEditMode('vertex'|'draw')`) thus cross-deactivates
  `transformFeature`, and vice-versa, identically to the P5↔P6 relationship.

### 15.3 No new pointer event kind

`transformFeature` uses only `down`/`move`/`up` (already in
`NormalizedPointerEvent`). Unlike P5 (`contextmenu`) / P6 (`dblclick`) no
arbiter event-kind addition is needed.

### 15.4 `TransformFeatureHandler` — `handlePointer` mapping

`map.transformFeature` implements `Handler<TransformFeatureOptions>`,
disabled by default, constructed with the `Emap` instance. It holds the
active session (`FeatureTranslateSession | FeatureAffineSession | null`) and
the per-gesture reference state (last map-coord for translate; last
angle/distance vs `origin` for rotate/scale — the math currently inlined in
`feature-rotate-scale.html` moves INTO the handler).

| Event (state) | Behavior | Result |
|---|---|---|
| `enable()` | `setEditMode('transform')`; `window.addEventListener('keydown', _onKeyDownBound)` | — |
| `disable()` | if session → `session.cancel()`; `setEditMode('none')`; remove keydown; `render()` | — |
| `editmodechange` (mode≠'transform' & enabled) | `_quietDisable` (cancel session + remove keydown; NO setEditMode) | — |
| `down` (button 0, `getEditMode()` is/becomes 'transform'); hit-test `map.queryFeatures(point)` | if a feature is hit: if it's not in the current selection → `map.select([hit], { mode: 'replace' })`; then begin the session for the active `mode` (`beginTranslateSession()` for `'translate'`, else `beginAffineSession()`); record reference (start map-coord, or start angle/dist vs `session.origin`). If session created → **exclusive** | hit → `exclusive`; miss → `passthrough` |
| `move` (session active) | `'translate'`: `session.move(curMapX - lastX, curMapY - lastY)`, update last. `'rotate'`: `session.applyDelta(rotateMatrix(curAngle - prevAngle, ox, oy))`. `'scale'`: `session.applyDelta(scaleMatrix(curDist/prevDist, curDist/prevDist, ox, oy))`. Update refs. (verbatim port of the example math; `ox,oy` from `session.origin`, mapped via `map.unproject`/`map.project` exactly as the example does) | `exclusive` |
| `up` (session active) | `session.commit()`; clear session/refs | `passthrough` |
| `down` miss / `move`/`up` no session | nothing | `passthrough` |
| key `Escape` (handler-owned listener) | if session → `session.cancel()`; clear | — |

`mode` returns `'exclusive'` only while a session is live; otherwise
`passthrough`, so a missed down still lets lower-priority handlers run
(though pan is disabled in transform mode anyway — this keeps the contract
clean and lets `clickSelect`, if enabled, still select on a missed click).

Priority array:
`['lassoSelect','boxSelect','clickSelect','transformFeature','drawFeature','vertexEdit','dragPan']`.
The modal edit handlers are mutually exclusive via `editMode`; relative
order is immaterial — `transformFeature` is placed before `drawFeature`/
`vertexEdit` for stable, readable ordering, and above `dragPan` so its
exclusive drag wins (pan is disabled by editmode anyway; the priority slot
is the seam, consistent with P5/P6).

### 15.5 Options

```ts
interface TransformFeatureOptions {
  /** Active transform. Default 'translate'. */
  mode?: 'translate' | 'rotate' | 'scale';
  /**
   * Forwarded to begin*Session — e.g. `{ splitSharedArcs }`. Defaults
   * preserve the existing session behavior when omitted.
   */
  session?: DragSessionOptions;
}
```
`mode` is read at `down`-time (a session is per-gesture: begin on `down`,
commit/cancel on `up`/`Escape`), so switching `mode` between gestures is
trivial and needs no mid-session handling. `DragSessionOptions` is the
existing exported type.

### 15.6 No control to thin-shell — purely additive

There is **no existing `TransformControl`** (the two examples are raw
boilerplate, not a built-in control). P7 is purely additive: a new
`map.transformFeature` handler + exports (`TransformFeatureHandler`,
`TransformFeatureOptions`). Zero back-compat risk (nothing to preserve).
The headless `map.editSession` API is **unchanged** — `transformFeature`
is a thin arbiter-driven *consumer* of it, not a replacement; apps that
prefer driving sessions directly keep doing so. A `TransformControl`
(mode-switch button group) is explicitly **out of scope** (a possible later
phase).

### 15.7 Examples updated

`test/examples/feature-translate.html` and `feature-rotate-scale.html` are
rewritten to the canonical recipe — `map.transformFeature.setOptions({mode});
map.transformFeature.enable()` + a tiny mode switcher for the rotate/scale
demo — deleting the hand-wired mousedown/move/up + angle/scale math (now in
the handler). This both dogfoods the handler and is the migration doc.

### 15.8 Back-compat invariants

- New: `map.transformFeature` (`Handler<TransformFeatureOptions>` getter),
  exported `TransformFeatureHandler` + `TransformFeatureOptions`.
- `EditMode` gains `'transform'` — additive union literal; no existing
  `'none'|'vertex'|'draw'` behavior changes (verified §15.2).
- `map.editSession` (`EditSessions`) + `FeatureTranslate/AffineSession`,
  `FeatureTranslate/AffineCommand`, `rotateMatrix`/`scaleMatrix`/
  `AffineMatrix` — **byte-identical**, untouched.
- Default `new Emap()` unchanged: `transformFeature` disabled by default;
  no new always-on listeners (it adds no arbiter event kind; its keydown
  listener is added only on `enable()`); the editmode→dragPan toggle is
  unchanged and only ever sees `'transform'` when a consumer opts in.
- `vertexEdit`/`drawFeature`/selection/pan/zoom behavior unchanged;
  `map.test.ts` edit-mode/pan/zoom byte-identical (a disabled handler never
  dispatches; `'transform'` mode is never entered unless opted in).

### 15.9 Testing strategy

- `TransformFeatureHandler` unit tests (stub `Emap` exposing
  `queryFeatures`/`select`/`getEditMode`/`setEditMode`/`unproject`/
  `project`/`editSession.beginTranslateSession`/`beginAffineSession`/
  `render`/`on`): `enable()` → `setEditMode('transform')` + keydown added;
  `disable()` → session cancelled + `setEditMode('none')` + keydown removed;
  `down` hit → select(replace if unselected) + begin session + `'exclusive'`;
  `down` miss → `'passthrough'`, no session; `move` translate → `session.move`
  with correct delta; `move` rotate/scale → `applyDelta` with the expected
  `rotateMatrix`/`scaleMatrix` (spy the session); `up` → `commit`; `Escape`
  → `cancel`; cross-mode `editmodechange` → `_quietDisable` (session
  cancelled, no re-`setEditMode`, recursion-guarded).
- `EditMode` extension: an `edit-state-store` test asserting
  `setMode('transform')` drops `vertex`/`draw` sub-state and fires one
  change; `map.ts` `editmodechange('transform')` disables `dragPan` &
  re-enables on `'none'` (handler-registry e2e).
- Examples compile/run against the new API (manual playground note; the
  rewrite is itself the doc).
- Gate: `tsc --noEmit` 0, full `vitest run` green, `npm run build` 0,
  `map.test.ts` + P1–P6 byte-identical.

### 15.10 Phasing

P7, independently testable / PR-able, after P6 (done). Own implementation
plan via writing-plans; subagent-driven execution + two-stage review. The
remaining P2c (selection controls thin-shell + `SelectMode`/`BoxSelectStyle`/
`DrawGeometryType` type consolidation) and P4 (CSS variables) are separate,
unaffected. A `TransformControl` is a possible future phase, out of scope.

## 15.11 Revision — Option A: select/transform separation (supersedes §15.4 down-row & §15.7)

> **Status:** Approved (post-ship revision, user-approved 2026-05-18).
> Reason: the as-shipped §15.4 coupled "select" into transformFeature's
> `down` (replace-select the hit, then open a session), with NO modifier
> awareness. This breaks the real-GIS workflow *click→select, shift+click→
> add, press-drag a selected feature→move the whole selection*: a `down`
> over any feature replace-clobbered a multi-selection and ignored `shift`,
> and the modal `'exclusive'`-on-down prevented the modifier-aware
> `clickSelect` from ever doing add-select. This is the Mapbox GL Draw
> `simple_select` / QGIS / Felt convention.

**Decision (Option A):** transformFeature **only drags an already-selected
feature**; it owns *no* selection logic. Selection (replace / `shift`=add /
click-empty=clear) is delegated to the modifier-aware `clickSelect` (and
`boxSelect`/`lassoSelect`), exactly as P2b/§15.4 Decision #4 always
intended — now actually realized.

- **`down` (button 0) new behavior:** hit-test `map.queryFeatures(point)`.
  If there is **no hit OR the top hit is NOT already selected** →
  `'passthrough'` (no `select`, no session — selection is clickSelect's
  job; `select first, then press-drag to move`). If the top hit **is
  already selected** → begin the session for the active `mode` and return
  `'exclusive'`. The `map.select(...)` call is **removed entirely** from
  the handler. `move`/`up`/`Escape` unchanged.
- This supersedes the §15.4 `down` row and the post-ship §15.4
  conditional-select fix (commit `412d847`) — that conditional is replaced
  by "no select; passthrough unless already selected".
- **Canonical recipe (supersedes §15.7):** the examples enable **both**
  `map.clickSelect.enable()` (default mods `{replace:'none', add:'shift'}`
  → click=replace, shift+click=add, click-empty=clear) **and**
  `map.transformFeature.enable()` (+ the rotate/scale mode switcher). The
  hand-wired empty-space-click-clear / select wiring is removed — clickSelect
  owns it. `clickSelect` is non-modal (no `setEditMode`), so it coexists
  with transform mode and is not cross-deactivated by `editmodechange`.
- **Coexistence is sound:** for `down`, `clickSelect` only handles
  `kind:'click'` → `'passthrough'`, so transformFeature still decides the
  press-drag; the native `click` (a no-drag tap) is later dispatched to the
  higher-priority `clickSelect` which performs the modifier-resolved
  select. An empty / unselected-feature `down` → transformFeature
  `'passthrough'`; pan is disabled by transform mode anyway; the trailing
  click → clickSelect select/clear. No new arbiter change; PRIORITY
  unchanged.
- **Deferred enhancement (out of this revision):** an ArcGIS-style
  "no-modifier `down` on an *unselected* feature → replace-select **and**
  move in the same gesture" convenience may be added later behind an
  option; `shift`/`ctrl` `down` must always remain selection-only (no
  drag). Not in scope now (pure Option A only).
- **Back-compat:** still disabled by default; `map.editSession` byte-
  identical; no new always-on listener; no new arbiter event kind; default
  `new Emap()` unchanged. The only behavior change is *within* an opted-in
  `transformFeature` session and is the intended fix.

## 16. OpenSpec note

Per `CLAUDE.md` this is a new capability + public-surface addition + a
shared-type (`EditMode`) extension normally warranting an OpenSpec
proposal. Consistent with P1–P6, the user has elected to skip OpenSpec and
proceed brainstorm-doc → writing-plans directly.
