# Per-handler Cursor via HandlerManager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each `Handler` declares the cursor it wants for its current state via an optional `getCursor()`, and `HandlerManager` resolves one effective cursor (exclusive-gesture > priority-order > default) and writes it to the attached element — replacing the ad-hoc CSS-class cursor mechanism.

**Architecture:** Add optional `getCursor?(): string | null` to the `Handler` interface. `HandlerManager` gets `_applyCursor()` (called once at the end of every dispatch via an extract-and-wrap of `_dispatch`) plus a public `refreshCursor()` for out-of-band state changes. Handlers reach the manager through the existing `_manager` back-ref using a structural type (no import → no cycle). The old `.emap-edit-active`/`.emap-draw-active` CSS is removed.

**Tech Stack:** TypeScript 5 (strict), Vitest 1.x (jsdom), Rollup. Spec: `docs/superpowers/specs/2026-05-19-emap-dx-phase11-handler-cursor-design.md`.

**Conventions:** No `Co-Authored-By` trailers. Plain `git` only (no `-c core.hooksPath`, no `--no-verify`). OpenSpec skipped (P1–P10 precedent). `package.json` stays `0.2.0`. Ignore GitNexus/Rust-skills hook output.

**Baseline:** full suite **1145 passed (68 files)**; `npx tsc --noEmit` exit 0; `npm run build` exit 0. Work on `master` (authorized; push when the user asks).

**Key facts (verified):**
- `Handler` interface ends at `src/core/handler.ts:37` (last member `handlePointer`).
- `HandlerManager._dispatch` is `src/core/handler-manager.ts` lines ~107-126 with THREE early returns; `detach()` ends ~line 79; `register` sets `(handler as unknown as { _manager?: HandlerManager })._manager = this;`.
- `dragPan`: `private _enabled = true; private _dragging = false;` (drag-pan.ts:20-21).
- `boxSelect`/`lassoSelect`: `private _enabled = false;`, `enable()`/`disable()` set it.
- `drawFeature`: `private _enabled = false;`; `enable()` (line 79), `disable()` (90), `_quietDisable()` (101) all flip `_enabled`.
- `vertexEdit`: `enable()` adds `.emap-edit-active` (vertex-edit.ts:72), `disable()` removes it (vertex-edit.ts:88).
- `src/core/handlers/vertex-edit.test.ts:145` asserts `expect(classListAdd).toHaveBeenCalledWith('emap-edit-active')` — the ONLY test referencing the class.
- `src/ui/controls.css`: `.emap-edit-active { cursor: crosshair; }` (lines 117-119) and `.emap-draw-active { cursor: crosshair; }` (lines 131-133).

---

### Task 1: Handler.getCursor + HandlerManager arbitration

**Files:**
- Modify: `src/core/handler.ts` (interface, after `handlePointer`)
- Modify: `src/core/handler-manager.ts` (extract `_dispatch` → wrap; add `_applyCursor`, `refreshCursor`; clear in `detach`)
- Test: `src/core/handler-manager.test.ts` (extend)

- [ ] **Step 1: Write the failing tests** — append to `src/core/handler-manager.test.ts`

First read the top of `src/core/handler-manager.test.ts` to match its existing import style and any stub-handler helper. Then add this `describe` block (it builds its own minimal stub handlers; adjust ONLY the import path of `HandlerManager` if the existing file imports it differently):

```ts
describe('HandlerManager cursor arbitration (DX P11)', () => {
  function stub(name: string, cursor: string | null, enabled = true) {
    return {
      name,
      _enabled: enabled,
      enable() { this._enabled = true; },
      disable() { this._enabled = false; },
      isEnabled() { return this._enabled; },
      setOptions() {},
      getOptions() { return {}; },
      handlePointer() { return 'passthrough' as const; },
      getCursor() { return this._enabled ? cursor : null; },
    };
  }
  function el(): HTMLElement {
    return document.createElement('div');
  }

  it('writes the highest-priority enabled non-null cursor to the element', () => {
    const m = new HandlerManager();
    const e = el();
    m.register(stub('dragPan', 'grab') as any);
    m.register(stub('drawFeature', 'crosshair') as any);
    m.attach(e);
    m.refreshCursor();
    // drawFeature has higher PRIORITY than dragPan → crosshair wins
    expect(e.style.cursor).toBe('crosshair');
  });

  it('falls through null cursors to a lower-priority handler', () => {
    const m = new HandlerManager();
    const e = el();
    m.register(stub('drawFeature', null) as any);
    m.register(stub('dragPan', 'grab') as any);
    m.attach(e);
    m.refreshCursor();
    expect(e.style.cursor).toBe('grab');
  });

  it('clears the cursor when no enabled handler has an opinion', () => {
    const m = new HandlerManager();
    const e = el();
    e.style.cursor = 'grab';
    m.register(stub('dragPan', null) as any);
    m.attach(e);
    m.refreshCursor();
    expect(e.style.cursor).toBe('');
  });

  it('refreshCursor recomputes after an out-of-band disable', () => {
    const m = new HandlerManager();
    const e = el();
    const dp = stub('dragPan', 'grab');
    m.register(dp as any);
    m.attach(e);
    m.refreshCursor();
    expect(e.style.cursor).toBe('grab');
    dp.disable();
    m.refreshCursor();
    expect(e.style.cursor).toBe('');
  });

  it('detach() resets the element cursor and is safe with no element', () => {
    const m = new HandlerManager();
    const e = el();
    e.style.cursor = 'crosshair';
    m.register(stub('dragPan', 'grab') as any);
    m.attach(e);
    m.detach();
    expect(e.style.cursor).toBe('');
    expect(() => m.detach()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the new tests — verify they FAIL**

Run: `npx vitest run src/core/handler-manager.test.ts 2>&1 | tail -8`
Expected: FAIL — `refreshCursor` is not a function / `e.style.cursor` stays unset. Confirm RED before implementing.

- [ ] **Step 3: Add `getCursor` to the `Handler` interface**

In `src/core/handler.ts`, find:

```ts
  /** Process one normalized event; report whether it was consumed. */
  handlePointer(ev: NormalizedPointerEvent): HandlerResult;
}
```

Replace with:

```ts
  /** Process one normalized event; report whether it was consumed. */
  handlePointer(ev: NormalizedPointerEvent): HandlerResult;
  /**
   * CSS cursor this handler wants for its CURRENT state, or `null` =
   * no opinion (HandlerManager falls through to lower-priority handlers,
   * then the page/CSS default). Optional — absent ⇒ no opinion.
   */
  getCursor?(): string | null;
}
```

Do NOT modify the `isHandler` runtime guard (getCursor is optional; the guard must not require it).

- [ ] **Step 4: Extract-and-wrap `_dispatch`, add `_applyCursor` + `refreshCursor`**

In `src/core/handler-manager.ts`, find the entire current method:

```ts
  private _dispatch(ev: NormalizedPointerEvent): void {
    if (this._pointerSink) {
      if (ev.kind === 'click' || (ev.kind === 'move' && !this._exclusive)) {
        this._pointerSink(ev);
      }
    }
    if (this._exclusive && (ev.kind === 'move' || ev.kind === 'up')) {
      const r = this._exclusive.handlePointer(ev);
      if (r !== 'exclusive') this._exclusive = null;
      return;
    }
    for (const h of this._orderedEnabled()) {
      const r = h.handlePointer(ev);
      if (r === 'exclusive') { this._exclusive = h; return; }
      if (r === 'consumed') return;
    }
  }
}
```

Replace with (rename body to `_dispatchInner`, wrap so `_applyCursor` runs on every path; add the two new methods; close the class):

```ts
  private _dispatch(ev: NormalizedPointerEvent): void {
    this._dispatchInner(ev);
    this._applyCursor();
  }

  private _dispatchInner(ev: NormalizedPointerEvent): void {
    if (this._pointerSink) {
      if (ev.kind === 'click' || (ev.kind === 'move' && !this._exclusive)) {
        this._pointerSink(ev);
      }
    }
    if (this._exclusive && (ev.kind === 'move' || ev.kind === 'up')) {
      const r = this._exclusive.handlePointer(ev);
      if (r !== 'exclusive') this._exclusive = null;
      return;
    }
    for (const h of this._orderedEnabled()) {
      const r = h.handlePointer(ev);
      if (r === 'exclusive') { this._exclusive = h; return; }
      if (r === 'consumed') return;
    }
  }

  /**
   * Resolve the effective cursor and write it to the attached element.
   * Order: active exclusive handler's cursor → first enabled handler in
   * PRIORITY with a non-empty cursor → '' (clear → CSS/page default).
   * Idempotent: only writes when the value changes.
   */
  private _applyCursor(): void {
    if (!this._element) return;
    let next: string | null = null;
    const ex = this._exclusive;
    if (ex && ex.isEnabled()) {
      next = ex.getCursor?.() ?? null;
    }
    if (!next) {
      for (const h of this._orderedEnabled()) {
        const c = h.getCursor?.();
        if (c) { next = c; break; }
      }
    }
    const value = next ?? '';
    if (this._element.style.cursor !== value) {
      this._element.style.cursor = value;
    }
  }

  /**
   * Recompute the effective cursor. Call after a handler changes
   * cursor-relevant state OUTSIDE a pointer event (e.g. enable()/disable()
   * flipping a mode). No-op when not attached.
   */
  refreshCursor(): void {
    this._applyCursor();
  }
}
```

- [ ] **Step 5: Clear the cursor in `detach()`**

In `src/core/handler-manager.ts`, find the end of `detach()`:

```ts
    this._element = null;
    this._exclusive = null;
    this._pointerSink = null;
  }
```

Replace with (reset the element cursor BEFORE nulling the ref):

```ts
    this._element.style.cursor = '';
    this._element = null;
    this._exclusive = null;
    this._pointerSink = null;
  }
```

Note: `detach()` already early-returns `if (!this._element) return;` at its top, so `this._element` is guaranteed non-null here — the second `detach()` call in the test hits that guard and is a safe no-op.

- [ ] **Step 6: Run the new tests — verify they PASS**

Run: `npx vitest run src/core/handler-manager.test.ts 2>&1 | tail -8`
Expected: PASS (all cursor cases + all pre-existing handler-manager tests still green).

- [ ] **Step 7: Typecheck + full suite**

Run: `npx tsc --noEmit` → exit 0.
Run: `npx vitest run 2>&1 | tail -3` → all pass; report exact counts (baseline 1145 + new cursor cases).

- [ ] **Step 8: Commit**

```bash
git add src/core/handler.ts src/core/handler-manager.ts src/core/handler-manager.test.ts
git commit -m "feat(core): Handler.getCursor + HandlerManager cursor arbitration (DX P11)"
```

---

### Task 2: getCursor for dragPan / boxSelect / lassoSelect / drawFeature

**Files:**
- Modify: `src/core/handlers/drag-pan.ts`, `box-select.ts`, `lasso-select.ts`, `draw-feature.ts`
- Test: `src/core/handlers/drag-pan.test.ts` (extend); `src/core/handlers/draw-feature.test.ts` (extend)

- [ ] **Step 1: Write failing tests**

Append to `src/core/handlers/drag-pan.test.ts` (match its existing import of `DragPanHandler` / construction pattern — read the file top first):

```ts
describe('DragPanHandler.getCursor (DX P11)', () => {
  it('returns grab when enabled & idle, grabbing while dragging, null when disabled', () => {
    const h = new DragPanHandler();
    expect(h.getCursor()).toBe('grab');
    // simulate a primary-button down to start a drag
    h.handlePointer({ kind: 'down', point: { x: 0, y: 0 }, button: 0,
      modifiers: { shift: false, ctrl: false, alt: false, meta: false },
      originalEvent: new Event('pointerdown') } as any);
    expect(h.getCursor()).toBe('grabbing');
    h.disable();
    expect(h.getCursor()).toBeNull();
  });
});
```

Append to `src/core/handlers/draw-feature.test.ts` (read its existing setup/mocks first; reuse them):

```ts
describe('DrawFeatureHandler.getCursor (DX P11)', () => {
  it('returns crosshair when enabled, null when disabled', () => {
    // Build the handler exactly as the other tests in this file do
    // (same map mock + setOptions({ source, type })). Reuse the file's
    // existing factory/mocks rather than constructing a new mock here.
    const h = makeHandler(); // <- use this file's existing helper/pattern
    expect(h.getCursor()).toBeNull();          // not enabled yet
    h.setOptions({ source: 'src', type: 'point' } as any);
    h.enable();
    expect(h.getCursor()).toBe('crosshair');
    h.disable();
    expect(h.getCursor()).toBeNull();
  });
});
```

If `draw-feature.test.ts` has no reusable helper, mirror the construction used by the nearest existing `it()` in that file verbatim (same mocks) instead of inventing new ones.

- [ ] **Step 2: Run — verify FAIL**

Run: `npx vitest run src/core/handlers/drag-pan.test.ts src/core/handlers/draw-feature.test.ts 2>&1 | tail -8`
Expected: FAIL — `getCursor is not a function`.

- [ ] **Step 3: Add `getCursor` to `dragPan`**

In `src/core/handlers/drag-pan.ts`, find:

```ts
  getOptions(): Readonly<DragPanOptions> { return this._opts; }
```

Add immediately after it:

```ts
  getCursor(): string | null {
    if (!this._enabled) return null;
    return this._dragging ? 'grabbing' : 'grab';
  }
```

- [ ] **Step 4: Add `getCursor` to `boxSelect`**

In `src/core/handlers/box-select.ts`, find:

```ts
  getOptions(): Readonly<BoxSelectHandlerOptions> { return this._opts; }
```

Add immediately after it:

```ts
  getCursor(): string | null {
    return this._enabled ? 'crosshair' : null;
  }
```

- [ ] **Step 5: Add `getCursor` to `lassoSelect`**

In `src/core/handlers/lasso-select.ts`, find:

```ts
  getOptions(): Readonly<LassoSelectHandlerOptions> { return this._opts; }
```

Add immediately after it:

```ts
  getCursor(): string | null {
    return this._enabled ? 'crosshair' : null;
  }
```

- [ ] **Step 6: Add `getCursor` to `drawFeature` + refreshCursor on mode flips**

In `src/core/handlers/draw-feature.ts`, find:

```ts
  getOptions(): Readonly<DrawFeatureOptions> {
```

Add immediately ABOVE that line (so it sits beside the other accessors):

```ts
  getCursor(): string | null {
    return this._enabled ? 'crosshair' : null;
  }

```

Then add a manager-refresh after each `_enabled` flip. In `enable()`, find the end:

```ts
    this._enabled = true;
    this._map.setEditMode('draw');
    window.addEventListener('keydown', this._onKeyDownBound);
    this._map.on('move', this._onMapMoveBound);
  }
```

Replace with:

```ts
    this._enabled = true;
    this._map.setEditMode('draw');
    window.addEventListener('keydown', this._onKeyDownBound);
    this._map.on('move', this._onMapMoveBound);
    (this as { _manager?: { refreshCursor(): void } })._manager?.refreshCursor();
  }
```

In `disable()`, find:

```ts
    this._enabled = false;
    this._clearDrawState();
    window.removeEventListener('keydown', this._onKeyDownBound);
    this._map.off('move', this._onMapMoveBound);
    this._map.setEditMode('none');
    this._map.clearEditDrawState();
    this._map.render();
```

Replace with:

```ts
    this._enabled = false;
    this._clearDrawState();
    window.removeEventListener('keydown', this._onKeyDownBound);
    this._map.off('move', this._onMapMoveBound);
    this._map.setEditMode('none');
    this._map.clearEditDrawState();
    (this as { _manager?: { refreshCursor(): void } })._manager?.refreshCursor();
    this._map.render();
```

In `_quietDisable()`, find:

```ts
  private _quietDisable(): void {
    this._enabled = false;
    window.removeEventListener('keydown', this._onKeyDownBound);
    this._map.off('move', this._onMapMoveBound);
    this._map.clearEditDrawState();
    this._map.render();
  }
```

Replace with:

```ts
  private _quietDisable(): void {
    this._enabled = false;
    window.removeEventListener('keydown', this._onKeyDownBound);
    this._map.off('move', this._onMapMoveBound);
    this._map.clearEditDrawState();
    (this as { _manager?: { refreshCursor(): void } })._manager?.refreshCursor();
    this._map.render();
  }
```

(The structural `{ _manager?: { refreshCursor(): void } }` cast avoids importing `HandlerManager` into a handler — no import cycle. `_manager` is set by `HandlerManager.register`; it is `undefined` in unit tests with no manager, so `?.` makes the call a safe no-op there.)

- [ ] **Step 7: Run the targeted tests — verify PASS**

Run: `npx vitest run src/core/handlers/drag-pan.test.ts src/core/handlers/draw-feature.test.ts src/core/handlers/box-select.test.ts src/core/handlers/lasso-select.test.ts 2>&1 | tail -8`
Expected: PASS (new getCursor cases + all pre-existing handler tests).

- [ ] **Step 8: Typecheck + full suite**

Run: `npx tsc --noEmit` → exit 0.
Run: `npx vitest run 2>&1 | tail -3` → all pass; report exact counts.

- [ ] **Step 9: Commit**

```bash
git add src/core/handlers/drag-pan.ts src/core/handlers/box-select.ts src/core/handlers/lasso-select.ts src/core/handlers/draw-feature.ts src/core/handlers/drag-pan.test.ts src/core/handlers/draw-feature.test.ts
git commit -m "feat(handlers): grab/grabbing + crosshair getCursor (DX P11)"
```

---

### Task 3: vertexEdit migration + CSS removal + CHANGELOG + final gate

**Files:**
- Modify: `src/core/handlers/vertex-edit.ts` (remove 2 classList lines; add getCursor; refreshCursor in enable/disable)
- Modify: `src/core/handlers/vertex-edit.test.ts` (replace the `emap-edit-active` assertion)
- Modify: `src/ui/controls.css` (remove 2 rules)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update the vertex-edit test (RED for the new behavior)**

In `src/core/handlers/vertex-edit.test.ts`, find:

```ts
    expect(handler.isEnabled()).toBe(true);
    expect(setEditModeSpy).toHaveBeenCalledWith('vertex');
    expect(onSpy).toHaveBeenCalledWith('move', expect.any(Function));
    expect(classListAdd).toHaveBeenCalledWith('emap-edit-active');
  });
```

Replace with (drop the CSS-class assertion; assert the new cursor contract instead):

```ts
    expect(handler.isEnabled()).toBe(true);
    expect(setEditModeSpy).toHaveBeenCalledWith('vertex');
    expect(onSpy).toHaveBeenCalledWith('move', expect.any(Function));
    expect(handler.getCursor()).toBe('crosshair');
  });
```

- [ ] **Step 2: Run — verify the updated test FAILS**

Run: `npx vitest run src/core/handlers/vertex-edit.test.ts 2>&1 | tail -8`
Expected: FAIL — `handler.getCursor is not a function`.

- [ ] **Step 3: Migrate `vertexEdit`**

In `src/core/handlers/vertex-edit.ts`, find `enable()`:

```ts
  enable(): void {
    if (this._enabled) return;
    this._enabled = true;
    this._map.setEditMode('vertex');
    this._map.getCanvasContainer().classList.add('emap-edit-active');
    this._map.on('move', this._onMapMoveBound);
  }
```

Replace with:

```ts
  enable(): void {
    if (this._enabled) return;
    this._enabled = true;
    this._map.setEditMode('vertex');
    this._map.on('move', this._onMapMoveBound);
    (this as { _manager?: { refreshCursor(): void } })._manager?.refreshCursor();
  }

  getCursor(): string | null {
    return this._enabled ? 'crosshair' : null;
  }
```

Then find `disable()`:

```ts
    this._map.setEditMode('none');
    this._map.clearEditVertexState();
    this._map.getCanvasContainer().classList.remove('emap-edit-active');
    this._map.off('move', this._onMapMoveBound);
    this._map.render();
```

Replace with:

```ts
    this._map.setEditMode('none');
    this._map.clearEditVertexState();
    this._map.off('move', this._onMapMoveBound);
    (this as { _manager?: { refreshCursor(): void } })._manager?.refreshCursor();
    this._map.render();
```

(Both `classList.add('emap-edit-active')` and `classList.remove('emap-edit-active')` are deleted. `getCanvasContainer()` itself stays — it is used elsewhere in the file; only the two cursor classList calls are removed. Confirm with `grep -n "emap-edit-active" src/core/handlers/vertex-edit.ts` returning nothing after the edit.)

- [ ] **Step 4: Run the vertex-edit test — verify PASS**

Run: `npx vitest run src/core/handlers/vertex-edit.test.ts 2>&1 | tail -8`
Expected: PASS (the updated assertion + all other vertex-edit cases; the `disable()` test that mocked `classList.remove` still passes because `getCanvasContainer` is no longer called for the class — verify that test does not separately assert `classList.remove('emap-edit-active')`; if it does, drop that one assertion line the same way as Step 1).

- [ ] **Step 5: Remove the dead CSS rules**

In `src/ui/controls.css`, find and DELETE these two rule blocks entirely:

```css
.emap-edit-active {
  cursor: crosshair;
}
```

and

```css
.emap-draw-active {
  cursor: crosshair;
}
```

Leave the surrounding `.emap-ctrl-edit` / `.emap-ctrl-draw` / `.emap-ctrl-edit.active` / `.emap-ctrl-draw.active` rules and the `/* Draw Feature Controls */` comment untouched. After editing, `grep -n "emap-edit-active\|emap-draw-active" src/` must return ZERO matches (no code or CSS references remain).

- [ ] **Step 6: Add the CHANGELOG entry**

In `CHANGELOG.md`, find the `## [Unreleased]` → `### Added` section and the most recent `- DX Phase 10 (toward 0.3.0): …` bullet. Insert immediately AFTER it (same plain `- DX Phase N (toward 0.3.0): …` house style — match the surrounding bullets, NOT bold):

```markdown
- DX Phase 11 (toward 0.3.0): per-handler cursor — each `Handler` may
  implement `getCursor(): string | null`; `HandlerManager` arbitrates one
  effective cursor (active gesture > priority order > default) and writes
  it to the map element via `refreshCursor()` / on every dispatch. Adds
  the previously-absent `grab`/`grabbing` pan cursors and the draw
  crosshair (the old `.emap-draw-active` CSS rule was dead); the ad-hoc
  `.emap-edit-active`/`.emap-draw-active` CSS-class mechanism is removed
  (single source of truth). No dispatch/priority behaviour change.
```

- [ ] **Step 7: Final verification gate** — run each, report exact output:

- `grep -rn "emap-edit-active\|emap-draw-active" src` → ZERO matches
- `npx tsc --noEmit` → exit 0
- `npx vitest run 2>&1 | tail -3` → all pass; report exact counts (baseline 1145 + Task 1 + Task 2 + Task 3 new cases; the vertex-edit assertion was swapped not added)
- `npm run build 2>&1 | tail -2` → artifacts created, exit 0
- `git diff --stat 830aaab -- src/` → only: `src/core/handler.ts`, `src/core/handler-manager.ts`, `src/core/handler-manager.test.ts`, the 5 handler files, their 3 touched test files, `src/ui/controls.css`. No unrelated file.

- [ ] **Step 8: Commit**

```bash
git add src/core/handlers/vertex-edit.ts src/core/handlers/vertex-edit.test.ts src/ui/controls.css CHANGELOG.md
git commit -m "feat(handlers): vertexEdit cursor via arbiter; drop CSS-class mechanism (DX P11)"
```

---

## Self-Review

**1. Spec coverage:**
- §1 (interface `getCursor?`, `_applyCursor` resolution exclusive>priority>'', `refreshCursor`, call at end of dispatch + detach clear, no new listeners, idempotent) → Task 1 (Steps 3-5) + tests Step 1.
- §2 per-handler table (dragPan grab/grabbing/null, box/lasso/draw/vertex crosshair, clickSelect/transformFeature null = no `getCursor`) → Task 2 (dragPan/box/lasso/draw) + Task 3 (vertexEdit); clickSelect/transformFeature deliberately get NO `getCursor` (no task touches them — correct, that IS the spec).
- §3 migration (remove 2 vertexEdit classList lines, getCursor, refreshCursor in enable/disable, remove 2 CSS rules, update the 1 test) → Task 3.
- §4 testing (manager resolution cases incl. idempotent + detach + refreshCursor; per-handler getCursor; regression; gates) → Task 1 Step 1, Task 2 Step 1, Task 3 Steps 1/4/7.
- §5 out-of-scope respected: no feature-hover cursor, no themeable strings, clickSelect/transformFeature untouched, dispatch logic preserved (pure extract-and-wrap).

**2. Placeholder scan:** No TBD/TODO. Every code step shows full before/after. The draw-feature.test.ts step explicitly instructs reusing the file's existing mock/helper rather than inventing one — a concrete instruction (the only safe option without hard-coding that file's private mock shape here), not a placeholder. Commands have expected outcomes.

**3. Type consistency:** `getCursor(): string | null` signature is identical across the interface (Task 1) and all five handlers (Tasks 2-3). `refreshCursor(): void` matches between `HandlerManager` (Task 1) and every structural `{ _manager?: { refreshCursor(): void } }` call site (Tasks 2-3). `_applyCursor`/`_dispatchInner` are private and only referenced within `handler-manager.ts`. `PRIORITY` ordering (drawFeature/vertexEdit before dragPan) is the existing array — the crosshair-over-grab resolution example in the spec depends on it and is consistent.
