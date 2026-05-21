# DX Phase 12 — Examples modernization (design)

> Switch `box-select.html` / `lasso-select.html` from the deprecated-feeling
> `addControl(new BoxSelectControl())` boilerplate to the P2c handler-direct
> API (`map.boxSelect.enable()` / `map.lassoSelect.enable()`) — the simpler
> recommended path for files whose purpose is to teach the *behaviour*.
> Accumulates toward 0.3.0. OpenSpec skipped per P1–P11 + P2c + P4 + P12
> precedent. Rhythm: brainstorm → spec → plan → subagent-driven TDD.

## §0 Problem

`test/examples/box-select.html` and `test/examples/lasso-select.html`
demonstrate box/lasso selection by adding the legacy Control instances
(`new BoxSelectControl()`, `new LassoSelectControl()`). After P2c those
controls are thin shells over the named handlers — both paths work
identically. The file *names* read like "this is HOW to use box/lasso
select"; the simpler, recommended path is the handler-direct one-liner
`map.boxSelect.enable()`. The Control surface is the right answer when
you want a *toolbar button*, but these example files don't render one —
they just want the behaviour on.

The five "click-to-select" examples (`attribute-editing.html`,
`attribute-expressions.html`, `feature-attributes.html`,
`feature-selection.html`, `merge-selected.html`) were considered for
migration to `map.on('feature:click', …)` and deliberately **excluded**:
`feature:click` fires only when a feature is hit, with no native "miss"
event. Each of the 5 files has a meaningful miss branch (informational
text for three, functional click-on-empty-to-deselect for two). Any
modern variant that preserves the miss UX is *more* code than the legacy
DOM-listener pattern — defeating "更加简单". A native `map.on('click', …)`
event surface would unlock that migration; that's a separate phase, not
P12.

Three other candidates were also dismissed: `feature-translate.html` /
`feature-rotate-scale.html` are already on `map.transformFeature` (P7);
`undo-redo.html` / `draw-snap-edge.html` / `export-roundtrip.html` use
their controls *inside an `EditToolbar`* (the Control IS the toolbar
button there — replacing with manual buttons would be MORE code);
`rebuild-topology.html` uses `map.on('click', e => map.queryFeatures(
e.point, { radius: 6 }))` whose `radius` semantics `feature:click` cannot
preserve. The remaining 30+ ops examples (clip/dissolve/buffer/…) have
no legacy interaction pattern.

## §1 Scope — 2 files modernized

| File | Change |
|---|---|
| `test/examples/box-select.html` | Replace `addControl(new BoxSelectControl())` with `map.boxSelect.enable()`; drop the `BoxSelectControl` from the `emap` destructured import; add a one-line comment pointing at `BoxSelectControl` as the toolbar-button alternative. |
| `test/examples/lasso-select.html` | Replace both `addControl(new BoxSelectControl())` / `addControl(new LassoSelectControl())` with `map.boxSelect.enable()` / `map.lassoSelect.enable()`; rewrite the box↔lasso toggle as a `try { disable other; enable this } catch (err) { status }` block so the handler's mutual-exclusivity throw surfaces visibly (P2c-decided behaviour); drop both Control imports; add the same alternative comment. |

No file is deleted; no file is added; no `src/` code change.

## §2 `box-select.html` recipe

Before:
```js
const { Emap, TopologySource, NavigationControl, HistoryControl, BoxSelectControl } = emap;
// …
map.addControl(new NavigationControl(), 'top-left');
map.addControl(new HistoryControl(), 'top-left');
map.addControl(new BoxSelectControl());
```

After:
```js
const { Emap, TopologySource, NavigationControl, HistoryControl } = emap;
// …
map.addControl(new NavigationControl(), 'top-left');
map.addControl(new HistoryControl(), 'top-left');
// Activate shift+drag box selection via the named handler.
// Alternative: `map.addControl(new BoxSelectControl())` for a toolbar-button surface.
map.boxSelect.enable();
```

The existing `map.on('selectionchange', refreshSelected)` listener + the
selection-counter UI are unchanged — the named handler fires
`selectionchange` byte-identically to the Control.

## §3 `lasso-select.html` recipe

Before — two Controls plus a toggle that swaps `.disable()` / `.enable()`
on whichever pair of objects the user toggled:
```js
const { Emap, TopologySource, NavigationControl, HistoryControl,
        BoxSelectControl, LassoSelectControl } = emap;
const boxSelect = new BoxSelectControl();
const lassoSelect = new LassoSelectControl();
map.addControl(boxSelect);
map.addControl(lassoSelect);
// … toggle UI calls boxSelect.enable()/disable() and lassoSelect.enable()/disable()
```

After:
```js
const { Emap, TopologySource, NavigationControl, HistoryControl } = emap;
// …
// Alternative for toolbar-button surfaces:
//   map.addControl(new BoxSelectControl()) / new LassoSelectControl()
function switchTo(which /* 'box' | 'lasso' */) {
  try {
    if (which === 'box')   { map.lassoSelect.disable(); map.boxSelect.enable(); }
    else                   { map.boxSelect.disable();   map.lassoSelect.enable(); }
    statusEl.textContent = '';
  } catch (err) {
    statusEl.textContent = err.message;  // mutual-exclusivity throw, surfaced
  }
}
```

The existing two UI buttons keep their click-handlers; only the activation
plumbing inside changes. The `statusEl` (a small `<div>` already present
in the file, or added if missing) shows the mutual-exclusivity error if
the handler throws. Default activation (initial state) calls
`switchTo('box')`.

## §4 Verification

Static HTML — no Vitest coverage. Gates:
- `npx tsc --noEmit` exit 0 (unchanged; HTML not type-checked; zero
  `src/` changes).
- `npx vitest run` full suite still green at the post-P4 count (`1147 / 68`).
- `npm run build` exit 0.
- `grep -nE "new BoxSelectControl\\(\\)|new LassoSelectControl\\(\\)"
  test/examples/box-select.html test/examples/lasso-select.html`
  returns ZERO matches (controls removed from the runtime code; the
  comment-only reference in the alternative-recipe note is fine because
  the grep pattern requires the literal `()` call).
- Manual browser sanity: each file opens without console errors; box and
  lasso selection still work; `lasso-select.html`'s toggle UI flips
  between the two without uncaught exceptions.

## §5 Out of scope (YAGNI)

- The 5 click-to-select files (see §0 for the analysis) — deferred until
  a native `map.on('click', …)` event lands or a different design.
- The 3 toolbar files (`undo-redo`, `draw-snap-edge`, `export-roundtrip`)
  — Control-in-toolbar is the right pattern there.
- The already-modern files (`feature-translate`, `feature-rotate-scale`,
  `rebuild-topology`).
- No `src/` code change, no documentation change, no CHANGELOG entry
  (example-only touch-up; CHANGELOG bullets are reserved for library-API
  changes per existing convention).
- No new examples added or removed.
