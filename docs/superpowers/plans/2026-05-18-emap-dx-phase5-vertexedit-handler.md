# emap DX Phase 5 — `vertexEdit` Handler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all `VertexEditControl` interaction/geometry/undo logic into an arbiter-driven `VertexEditHandler` (`map.vertexEdit`), thin-shell the control, with **zero behavior change**. Design of record: `docs/superpowers/specs/2026-05-18-emap-dx-phase5-vertexedit-handler-design.md` (§11).

**Architecture:** Add a `'contextmenu'` kind to the arbiter (`NormalizedPointerEvent` + a `HandlerManager` contextmenu listener routed through the normal priority loop — not the P3 sink, not the exclusive branch). `VertexEditHandler` ports the control's state + private methods **verbatim**, with ONE mechanical substitution: the control derives element-local px/py via `getBoundingClientRect()`+`clientX/clientY`; the handler instead reads `ev.point.{x,y}` (already element-local from `_norm`). `enable()` calls `map.setEditMode('vertex')` (keeps the existing `editmode→dragPan.disable()` + `editmodechange`); priority `['lassoSelect','boxSelect','clickSelect','vertexEdit','dragPan']`. `VertexEditControl` becomes a button-only thin shell. White-box tests move to the handler test file (same assertions, retargeted construction).

**Tech Stack:** TypeScript 5 (strict), Vitest 1.x (jsdom), Rollup.

## Design Decisions (challenge these in review)

1. **`contextmenu` is a discrete action event** — dispatched through the priority loop like `click` (NOT fed to the P3 `_pointerSink`, NOT subject to the exclusive-lock branch). Every existing handler falls through to `return 'passthrough'` for it (verified) → zero regression.
2. **Modal mechanism preserved.** `enable()` → `map.setEditMode('vertex')`; `disable()` → `setEditMode('none')` + `clearEditVertexState()` + `render()`. The existing `map.ts:181` editmode→dragPan toggle + `editmodechange` event is untouched. The handler does NOT use `consumed`/`exclusive` to block pan (edit-mode already disables `dragPan`).
3. **Verbatim port + one coordinate substitution.** Every moved method keeps its name, body, and logic. The ONLY allowed change per method: replace
   ```ts
   const rect = this._map.getCanvasContainer().getBoundingClientRect();
   const px = e.clientX - rect.left;
   const py = e.clientY - rect.top;
   ```
   (and the `_eventToContainerPx`-style equivalents) with `const px = ev.point.x; const py = ev.point.y;`, and `this._map` (was `Emap | null`, set in `onAdd`) becomes a non-null `Emap` from the constructor. No other logic edits. If a port needs any other change to compile/pass, STOP — that is a design gap, report it.
4. **Method seams preserved for moved tests.** `vertex-edit-control.test.ts` is white-box (`Reflect` on `_hoverVertexIds`/`_hoveredFeature`/`_map`; calls `_handleDrag`/`_onMouseUp`). The handler keeps those EXACT private names. `_onMouseUp(e: MouseEvent)`'s body is split: a `_finishDrag(px: number, py: number)` private holds the verbatim post-rect logic; `handlePointer` (`up`) computes `px,py` from `ev.point` and calls `_finishDrag`. The moved test calls `_finishDrag` (or keeps calling `_onMouseUp` if the seam keeps that name — see Task 2) with the same asserted effects.
5. **Disabled by default.** `new Emap()` registers `vertexEdit` disabled. The only new always-on cost is one `contextmenu` element listener that every handler ignores while `vertexEdit` is disabled (and `setEditMode` is never entered).
6. **No new public surface beyond `map.vertexEdit`.** `VertexEditControl` class / constructor options / button DOM+classes / `editmodechange` / undo commands / `vertex_moved` payload all byte-identical.

---

## File Structure

- Modify `src/core/handler.ts` — add `'contextmenu'` to `NormalizedPointerEvent['kind']`.
- Modify `src/core/handler-manager.ts` — `attach`/`detach` a `contextmenu` element listener; `_dispatch` routes it via the priority loop (Task 1).
- Modify `src/core/handler-manager.test.ts` — contextmenu normalize/dispatch tests.
- Create `src/core/handlers/vertex-edit.ts` — `VertexEditHandler` (verbatim port).
- Create `src/core/handlers/vertex-edit.test.ts` — the MOVED white-box cases (retargeted) + new handler-specific cases.
- Modify `src/ui/vertex-edit-control.ts` — thin shell (button only).
- Modify `src/ui/vertex-edit-control.test.ts` — remove the moved white-box cases; keep/scope it to a NEW thin-shell behavior test.
- Modify `src/map/map.ts` — construct + register `VertexEditHandler`; `get vertexEdit()`; PRIORITY array (in `handler-manager.ts`, see Task 4) extended; the control no longer self-wires.
- Modify `src/index.ts` — export `VertexEditHandler` + `VertexEditOptions`.
- Modify `CHANGELOG.md`.

---

### Task 1: arbiter gains `contextmenu` kind

**Files:**
- Modify: `src/core/handler.ts`, `src/core/handler-manager.ts`
- Test: `src/core/handler-manager.test.ts`

- [ ] **Step 1: Write the failing test**

Append a NEW describe to `src/core/handler-manager.test.ts` (file already has `// @vitest-environment jsdom`):

```ts
describe('HandlerManager contextmenu kind', () => {
  function recordHandler() {
    const calls: any[] = [];
    return { calls, h: { name: 'dragPan', enable() {}, disable() {}, isEnabled: () => true,
      setOptions() {}, getOptions: () => ({}),
      handlePointer: (e: any) => { calls.push(e.kind); return 'passthrough' as const; } } };
  }
  function el() {
    const e = document.createElement('div');
    e.getBoundingClientRect = () => ({ left: 5, top: 7, width: 0, height: 0, right: 0, bottom: 0, x: 5, y: 7, toJSON() {} }) as any;
    return e;
  }

  it('normalizes a contextmenu DOM event and dispatches it through the priority loop', () => {
    const { h, calls } = recordHandler();
    const m = new HandlerManager();
    m.register(h);
    const element = el();
    m.attach(element);
    element.dispatchEvent(new MouseEvent('contextmenu', { clientX: 25, clientY: 27, button: 2, cancelable: true }));
    expect(calls).toEqual(['contextmenu']);
    m.detach();
  });

  it('contextmenu is NOT fed to the P3 pointer sink', () => {
    const { h } = recordHandler();
    const m = new HandlerManager();
    m.register(h);
    const sink: string[] = [];
    m.setPointerSink((e) => sink.push(e.kind));
    const element = el();
    m.attach(element);
    element.dispatchEvent(new MouseEvent('contextmenu', { clientX: 1, clientY: 1, button: 2 }));
    expect(sink).toEqual([]); // sink only gets click + non-gesture move
    m.detach();
  });

  it('detach() removes the contextmenu listener', () => {
    const { h, calls } = recordHandler();
    const m = new HandlerManager();
    m.register(h);
    const element = el();
    m.attach(element);
    m.detach();
    element.dispatchEvent(new MouseEvent('contextmenu', { clientX: 1, clientY: 1, button: 2 }));
    expect(calls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/handler-manager.test.ts -t "contextmenu kind"`
Expected: FAIL — contextmenu not dispatched.

- [ ] **Step 3: Implement**

(a) `src/core/handler.ts`: change the `kind` union to add `'contextmenu'`:
```ts
  kind: 'down' | 'move' | 'up' | 'wheel' | 'click' | 'contextmenu';
```

(b) `src/core/handler-manager.ts`: add a bound contextmenu handler field next to the existing `_onClick`:
```ts
  private _onContextMenu = (e: MouseEvent) => this._dispatch(this._norm(e, 'contextmenu'));
```
In `attach(element)`, after the existing `element.addEventListener('click', this._onClick);`:
```ts
    element.addEventListener('contextmenu', this._onContextMenu);
```
In `detach()`, alongside the existing `removeEventListener('click', this._onClick)`:
```ts
    this._element?.removeEventListener('contextmenu', this._onContextMenu);
```
(Match the EXACT existing add/remove pattern in this file — mirror how `click` is wired, including the `_element` null-guard style already used in `detach`.)

`_dispatch` needs NO change: `contextmenu` is neither `'click'` nor `'move'` so it skips the P3 sink block (decision #1); it is neither `'move'` nor `'up'` so it skips the exclusive branch; it flows into the priority `for` loop exactly like `down`. Confirm by reading `_dispatch` — do not edit it unless the existing structure would mis-route `contextmenu` (it must not).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/handler-manager.test.ts`
Expected: PASS (existing + 3 new).

- [ ] **Step 5: GATE**

Run: `npx tsc --noEmit` (exit 0) AND `npx vitest run` (full suite green; P1/P2a/P2b/P3 handler suites unaffected — adding a kind must not break any handler since all fall through to passthrough).

- [ ] **Step 6: Commit**

```bash
git add src/core/handler.ts src/core/handler-manager.ts src/core/handler-manager.test.ts
git commit -m "feat(core): arbiter contextmenu event kind (DX P5)"
```

---

### Task 2: `VertexEditHandler` (verbatim port) + move white-box tests

**Files:**
- Create: `src/core/handlers/vertex-edit.ts`
- Create: `src/core/handlers/vertex-edit.test.ts`

This is a **verbatim port** of `src/ui/vertex-edit-control.ts`'s logic into a `Handler`. No logic redesign. Read the source file fully first.

- [ ] **Step 1: Create the handler**

Create `src/core/handlers/vertex-edit.ts` with class `VertexEditHandler implements Handler<VertexEditOptions>`:

- **Imports/helpers MOVED verbatim** from `vertex-edit-control.ts`: the module-level `const VERTEX_HIT_THRESHOLD = 10;`, `const DEFAULT_POLYGON_FILL = 'rgba(0,0,0,0.15)';`, the local interfaces `HoveredFeature`, `EditableArcs` (and any other module-local types/interfaces it declares), and the imports for `VertexMoveCommand`/`VertexInsertCommand`/`VertexDeleteCommand`/`getDefaultMapshaperAdapter`/`ArcCollection`/`TopologySource`/`EditVertexShape`/`EditVertexArcs`/`Emap`. Fix relative paths for the new location `src/core/handlers/` (e.g. `../../edit/commands/vertex-move`, `../../adapter/mapshaper-adapter`, `../../map/map`, `../../types/mapshaper-types` — verify each against the originals).
- **Public option type**:
  ```ts
  export interface VertexEditOptions {
    /** Polygon hover fill. Default 'rgba(0,0,0,0.15)'. */
    polygonFillColor?: string;
  }
  ```
- **State fields MOVED verbatim** (same names) from the control: `_hoveredFeature`, `_hoverVertexCoords`, `_hoverVertexIds`, `_hoverType`, `_hoverInsertionId`, `_dragging`, `_neighborShapes`, `_dragFromCoords`, `_polygonFillColor`. Replace the control's `_map: Emap | null` with `private readonly _map: Emap` set from the constructor. Drop the control-only fields (`_container`, `_btn`, `_active`, `*Bound` function refs).
- **Constructor**: `constructor(map: Emap, opts: VertexEditOptions = {})` → `this._map = map; this._polygonFillColor = opts.polygonFillColor ?? DEFAULT_POLYGON_FILL;` plus an `_onMapMoveBound = () => this._onMapMove();` (used by enable/disable for the `map.on('move')` re-render, ported from the control's `_onMoveHandlerBound`/`_onMapMove`).
- **Handler interface**:
  - `readonly name = 'vertexEdit';`
  - `private _enabled = false;` `isEnabled()` returns it.
  - `enable()`: if already enabled return; `this._enabled = true; this._map.setEditMode('vertex'); this._map.on('move', this._onMapMoveBound);` (port of `_activate` minus the button/DOM-listener lines — the arbiter now feeds events; the `emap-edit-active` container class is NOT added here because that was a control concern; **decision: keep it** — add the class via `this._map.getCanvasContainer().classList.add('emap-edit-active')` and remove it in `disable()` so the visual/theme hook is byte-identical to today).
  - `disable()`: if not enabled return; port of `_deactivate` minus button: `this._enabled = false;` reset all `_hover*`/`_neighborShapes`/`_dragging` state exactly as `_deactivate` does; `this._map.setEditMode('none'); this._map.clearEditVertexState(); this._map.getCanvasContainer().classList.remove('emap-edit-active'); this._map.off('move', this._onMapMoveBound); this._map.render();`
  - `setOptions(o: Partial<VertexEditOptions>)`: merge; if `polygonFillColor` provided update `_polygonFillColor` (immutable-merge style consistent with other handlers).
  - `getOptions(): Readonly<VertexEditOptions>` → `{ polygonFillColor: this._polygonFillColor }`.
  - `handlePointer(ev: NormalizedPointerEvent): HandlerResult`:
    ```
    if (!this._enabled) return 'passthrough';
    const px = ev.point.x, py = ev.point.y;
    switch (ev.kind):
      'move':
        if (this._dragging) { <verbatim _handleDrag body, using px,py instead of rect math>; return 'exclusive'; }
        else { <verbatim _onMouseMove body, using px,py>; return 'passthrough'; }
      'down':
        if (ev.button !== 0) return 'passthrough';
        <verbatim _onMouseDown body, using px,py>;
        return this._dragging ? 'exclusive' : 'passthrough';
      'up':
        if (!this._dragging) return 'passthrough';
        this._finishDrag(px, py);   // see seam below
        return 'passthrough';
      'contextmenu':
        (ev.originalEvent as MouseEvent).preventDefault();   // mirrors control's e.preventDefault()
        <verbatim _onContextMenu body MINUS its leading e.preventDefault() (already done) and using ev for clientX/clientY: pass (ev.originalEvent as MouseEvent).clientX/clientY into _showContextMenu exactly as before>;
        return 'consumed';
      default: return 'passthrough';
    ```
  - **Seam (decision #4):** keep method `_onMouseUp` renamed to `_finishDrag(px: number, py: number)` containing the VERBATIM body of the control's `_onMouseUp` from the line after its `const rect/px/py` computation onward (those three lines deleted; the rest unchanged, it already uses `px`/`py`). The moved test (Step 2) calls `_finishDrag(px, py)`.
- **Private methods MOVED verbatim** (same names, same bodies, only the rect→`ev.point` substitution where they computed px/py from a `MouseEvent`; methods that already receive `px,py` as params change NOTHING): `_onMouseMove` (becomes the move-not-dragging branch body; if you keep it as a method it takes `(px:number,py:number)`), `_handleDrag` (the drag-move branch; keep as `_handleDrag(px:number,py:number)`), `_onMouseDown` (`_onMouseDown(px:number,py:number)`), `_onContextMenu` (adapt signature to take the `MouseEvent` from `ev.originalEvent`), `_finishDrag` (ex-`_onMouseUp`), `_onMapMove`, `_deleteHoveredVertex`, `_showContextMenu`, `_refreshSourceDisplayArcs`, `_bumpSourceEditVersion`, `_findNearestVertices`, `_findInterpolatedPoint`, `_findNeighborShapes`, `_updateEditState`, `_pushVertexInsertCommand`. Keep their exact names so the moved white-box tests bind. All `this._map!.` / `this._map?.` become `this._map.` (non-null).

> IMPORTANT: This is a port, not a rewrite. If any method cannot be moved with ONLY the documented px/py + non-null-`_map` substitution (e.g. it referenced `this._btn`/`this._active`/`this._container`), STOP and report BLOCKED with the method + the exact extra coupling — do not invent logic.

- [ ] **Step 2: Move the white-box tests + add handler cases**

Create `src/core/handlers/vertex-edit.test.ts`. MOVE every `it(...)` from `src/ui/vertex-edit-control.test.ts` verbatim, with these mechanical retargets only:
- `import { VertexEditControl } from './vertex-edit-control';` → `import { VertexEditHandler } from './vertex-edit';`
- `new VertexEditControl()` → `new VertexEditHandler(mapMock as any)` (the tests `setPrivate(control,'_map',mapMock)` afterwards; with the ctor taking the map you may pass `mapMock` directly AND keep the `setPrivate(..., '_map', ...)` line — it just re-sets the same field; leave the test body otherwise unchanged).
- Calls `callPrivate(control, '_onMouseUp', e)` → `callPrivate(handler, '_finishDrag', px, py)` where `px,py` are the element-local coords the test's mock `getBoundingClientRect` (`{left:10,top:20}`) + the event `clientX/clientY` would have produced (compute the constants and inline them, so the assertion inputs are unchanged). Calls to `_handleDrag`/other moved privates: keep the same name; if the original passed a `MouseEvent`, pass the equivalent `(px,py)` constants instead. Keep ALL assertions and the `mapshaper.internal` spy setup byte-identical.
ADD 2 handler-only cases: `enable()` calls `setEditMode('vertex')` + `map.on('move',…)` (spy); `disable()` calls `setEditMode('none')` + `clearEditVertexState()` + resets `_dragging`.

- [ ] **Step 3: Run + GATE**

Run: `npx vitest run src/core/handlers/vertex-edit.test.ts` → all moved + new pass.
Then `npx tsc --noEmit` (exit 0) AND `npx vitest run` (full suite — `vertex-edit-control.test.ts` still references the OLD cases and will FAIL until Task 3 removes them; that is expected at THIS task boundary ONLY IF you cannot land Task 2 green. To keep every commit green, DELETE the moved `it` blocks from `src/ui/vertex-edit-control.test.ts` IN THIS TASK as part of the move (leave the file with only its imports + an empty/▢ describe or the soon-to-be thin-shell cases stub), so the suite is green at Task 2's commit. Net test count: moved (unchanged) + 2 new handler cases.).

- [ ] **Step 4: Commit**

```bash
git add src/core/handlers/vertex-edit.ts src/core/handlers/vertex-edit.test.ts src/ui/vertex-edit-control.test.ts
git commit -m "feat(core): VertexEditHandler — verbatim port of vertex-edit logic (DX P5)"
```

---

### Task 3: thin-shell `VertexEditControl`

**Files:**
- Modify: `src/ui/vertex-edit-control.ts`
- Modify: `src/ui/vertex-edit-control.test.ts`

- [ ] **Step 1: Write the failing test**

Replace the (now stub) `src/ui/vertex-edit-control.test.ts` body with a thin-shell behavior test:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { VertexEditControl } from './vertex-edit-control';

function fakeMap() {
  let enabled = false;
  const ve = { isEnabled: () => enabled, enable: vi.fn(() => { enabled = true; }),
    disable: vi.fn(() => { enabled = false; }), setOptions: vi.fn() };
  return { vertexEdit: ve,
    getCanvasContainer: () => document.createElement('div') } as any;
}

describe('VertexEditControl (thin shell)', () => {
  it('onAdd renders a button; click toggles map.vertexEdit', () => {
    const map = fakeMap();
    const c = new VertexEditControl();
    const root = c.onAdd(map);
    const btn = root.querySelector('button') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click();
    expect(map.vertexEdit.enable).toHaveBeenCalledTimes(1);
    expect(btn.classList.contains('active')).toBe(true);
    btn.click();
    expect(map.vertexEdit.disable).toHaveBeenCalledTimes(1);
    expect(btn.classList.contains('active')).toBe(false);
  });

  it('forwards constructor polygonFillColor to map.vertexEdit.setOptions on add', () => {
    const map = fakeMap();
    const c = new VertexEditControl({ polygonFillColor: 'rgba(1,2,3,0.4)' });
    c.onAdd(map);
    expect(map.vertexEdit.setOptions).toHaveBeenCalledWith({ polygonFillColor: 'rgba(1,2,3,0.4)' });
  });

  it('onRemove disables if active and detaches', () => {
    const map = fakeMap();
    const c = new VertexEditControl();
    const root = c.onAdd(map);
    (root.querySelector('button') as HTMLButtonElement).click(); // active
    c.onRemove();
    expect(map.vertexEdit.disable).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/ui/vertex-edit-control.test.ts`
Expected: FAIL — control still has the old logic / no `setOptions` forward.

- [ ] **Step 3: Rewrite the control as a thin shell**

Replace `src/ui/vertex-edit-control.ts` with a button-only `Control` (mirror the P2b `BoxSelectControl` thin-shell pattern). Keep EXACT public surface: `export class VertexEditControl implements Control`, `export interface VertexEditControlOptions { polygonFillColor?: string }`, the same `onAdd` button markup/classes (`emap-ctrl emap-ctrl-group`, button `emap-ctrl-edit`, title `Edit Vertices`, innerHTML `<span class="emap-ctrl-icon">✏</span>`), `onRemove`. Behavior:
```ts
import type { Control } from './control';
import type { Emap } from '../map/map';

export interface VertexEditControlOptions {
  /** Polygon hover fill, forwarded to map.vertexEdit. Default unchanged. */
  polygonFillColor?: string;
}

export class VertexEditControl implements Control {
  private _map: Emap | null = null;
  private _container: HTMLElement | null = null;
  private _btn: HTMLButtonElement | null = null;
  private _opts: VertexEditControlOptions;

  constructor(options: VertexEditControlOptions = {}) { this._opts = options; }

  onAdd(map: Emap): HTMLElement {
    this._map = map;
    if (this._opts.polygonFillColor !== undefined) {
      map.vertexEdit.setOptions({ polygonFillColor: this._opts.polygonFillColor });
    }
    this._container = document.createElement('div');
    this._container.className = 'emap-ctrl emap-ctrl-group';
    this._btn = document.createElement('button');
    this._btn.className = 'emap-ctrl-edit';
    this._btn.type = 'button';
    this._btn.title = 'Edit Vertices';
    this._btn.innerHTML = '<span class="emap-ctrl-icon">✏</span>';
    this._btn.addEventListener('click', () => this._toggle());
    this._container.appendChild(this._btn);
    return this._container;
  }

  onRemove(): void {
    if (this._map && this._map.vertexEdit.isEnabled()) this._map.vertexEdit.disable();
    if (this._container?.parentNode) this._container.parentNode.removeChild(this._container);
    this._map = null;
    this._container = null;
    this._btn = null;
  }

  private _toggle(): void {
    if (!this._map) return;
    const ve = this._map.vertexEdit;
    if (ve.isEnabled()) { ve.disable(); this._btn?.classList.remove('active'); }
    else { ve.enable(); this._btn?.classList.add('active'); }
  }
}
```
(`map.vertexEdit` is the getter added in Task 4; if Task 4 isn't merged yet, the `Emap` type already declares it once Task 4's getter exists — sequence Task 3 BEFORE Task 4 only if the type compiles; otherwise do Task 4 first. Recommended order: Task 4 then Task 3, OR land both before running the cross-file GATE. Pick the order that keeps each commit's `tsc` green; if Task 3 alone won't typecheck without the getter, do Task 4 first and swap their commit order — note this in the commit.)

- [ ] **Step 4: Run + GATE**

`npx vitest run src/ui/vertex-edit-control.test.ts` → 3 pass. `npx tsc --noEmit` exit 0. `npx vitest run` full suite green. `npm run build` exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/ui/vertex-edit-control.ts src/ui/vertex-edit-control.test.ts
git commit -m "refactor(ui): VertexEditControl thin shell over map.vertexEdit (DX P5)"
```

---

### Task 4: wire `VertexEditHandler` into Emap + priority + exports

**Files:**
- Modify: `src/core/handler-manager.ts` (PRIORITY array), `src/map/map.ts`, `src/index.ts`
- Test: `src/map/handler-registry.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the existing top `describe` of `src/map/handler-registry.test.ts` (reuse its `container()` + canvas-2d `beforeAll`):

```ts
  it('exposes a disabled-by-default vertexEdit handler', () => {
    const map = new Emap({ container: container() });
    expect(map.vertexEdit.name).toBe('vertexEdit');
    expect(map.vertexEdit.isEnabled()).toBe(false);
  });

  it('vertexEdit.enable() enters vertex edit mode (editmodechange) and disables dragPan', () => {
    const map = new Emap({ container: container() });
    const modes: string[] = [];
    map.on('editmodechange', (e: any) => modes.push(e.mode));
    map.vertexEdit.enable();
    expect(map.getEditMode()).toBe('vertex');
    expect(map.dragPan.isEnabled()).toBe(false);
    map.vertexEdit.disable();
    expect(map.getEditMode()).toBe('none');
    expect(map.dragPan.isEnabled()).toBe(true);
    expect(modes).toEqual(['vertex', 'none']);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/map/handler-registry.test.ts -t "vertexEdit"`
Expected: FAIL — `map.vertexEdit` undefined.

- [ ] **Step 3: Implement**

(a) `src/core/handler-manager.ts`: extend the `PRIORITY` array to
```ts
const PRIORITY = ['lassoSelect', 'boxSelect', 'clickSelect', 'vertexEdit', 'dragPan'] as const;
```
(insert `'vertexEdit'` before `'dragPan'`; do not reorder the rest).

(b) `src/map/map.ts`:
- Import: `import { VertexEditHandler, type VertexEditOptions } from '../core/handlers/vertex-edit';`
- Field: `private _vertexEdit!: VertexEditHandler;`
- Construct + register AFTER the P2b selection handlers' `register` calls and BEFORE `this._handlers.attach(this._canvasContainer);`:
  ```ts
  this._vertexEdit = new VertexEditHandler(this);
  this._handlers.register(this._vertexEdit);
  ```
- Getter near `get dragPan()`:
  ```ts
  get vertexEdit(): Handler<VertexEditOptions> { return this._vertexEdit; }
  ```
- The existing `editmodechange`→`dragPan` toggle at `map.ts:181` is UNCHANGED — `vertexEdit.enable()` calls `setEditMode('vertex')` which already triggers it. Do not duplicate that logic.

(c) `src/index.ts`: after the P2b/P3 handler exports:
```ts
export { VertexEditHandler } from './core/handlers/vertex-edit';
export type { VertexEditOptions } from './core/handlers/vertex-edit';
```

- [ ] **Step 4: Run + GATE**

`npx vitest run src/map/handler-registry.test.ts` → existing + 2 new pass. `npx tsc --noEmit` exit 0. `npx vitest run` full suite. `npm run build` exit 0. **`src/map/map.test.ts` edit-mode/pan/zoom suites byte-identical** (vertexEdit disabled by default ⇒ default dispatch unchanged; the only edit-mode path is via the unchanged `setEditMode`). If any map.test edit/pan/zoom case regresses → STOP, BLOCKED.

- [ ] **Step 5: Commit**

```bash
git add src/core/handler-manager.ts src/map/map.ts src/index.ts src/map/handler-registry.test.ts
git commit -m "feat(map): expose map.vertexEdit handler; priority slot (DX P5)"
```

---

### Task 5: CHANGELOG

**Files:** Modify `CHANGELOG.md` (`[Unreleased]` → existing `### Added`).

- [ ] **Step 1: Add after the Phase-3 bullet**

```markdown
- DX Phase 5 (toward 0.3.0): vertex editing is now the arbiter-driven
  `map.vertexEdit` handler (`enable/disable/isEnabled/setOptions/
  getOptions`), consistent with the other handlers — usable without
  `addControl`. The arbiter gained a `contextmenu` event kind (right-click
  vertex delete). `VertexEditControl` is now a button-only thin shell over
  `map.vertexEdit`; its public class, constructor options, button DOM,
  `editmodechange`/edit-mode behavior, undo commands, and the
  `vertex_moved` event are byte-identical. Disabled by default →
  `new Emap()` behavior unchanged. (P4 will migrate the context-menu
  inline styles to CSS tokens.)
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: CHANGELOG for DX Phase 5 vertexEdit handler"
```

---

## Self-Review

**1. Spec coverage (§11):** §11.2 modal mechanism preserved → Task 2 `enable/disable` call `setEditMode`; Task 4 leaves `map.ts:181` untouched; Task 4 test asserts `editmodechange`+dragPan toggle. §11.3 contextmenu kind → Task 1 (`handler.ts` union + `HandlerManager` listener + priority-loop routing, not sink/exclusive) with regression-safety test. §11.4 handlePointer mapping → Task 2 switch with verbatim-ported bodies + the `_finishDrag` seam. §11.5 thin-shell control, byte-identical public surface → Task 3 (same class/options/button markup/classes). §11.6 `VertexEditOptions` = `{polygonFillColor?}` → Task 2 type + Task 3 forwarding. §11.7 back-compat invariants → Tasks 2/3/4 keep commands/events/`editmodechange`/`vertex_moved`/menu element; default disabled → Task 4 test. §11.8 white-box tests MOVED (not "byte-identical") → Task 2 Step 2 explicit move + retarget, Task 3 new thin-shell test. §11.9 phasing/independent → 5 tasks, each commit green. Every §11 requirement mapped.

**2. Placeholder scan:** No TBD/TODO. The "port verbatim from `vertex-edit-control.ts`" instructions reference exact member names + the single documented coordinate substitution + the explicit STOP-if-other-coupling rule — a faithful move instruction (the code exists; the GATE = moved white-box assertions unchanged + `map.test.ts` edit suites byte-identical), the same pattern accepted in P2b Task 2. No method body is hand-waved: each named method moves unchanged except the one rect→`ev.point` rule.

**3. Type consistency:** `NormalizedPointerEvent['kind']` gains `'contextmenu'` once (Task 1), consumed by `VertexEditHandler.handlePointer` (Task 2) and tolerated (passthrough) by all P1/P2b handlers (verified). `Handler<VertexEditOptions>` matches the P1 interface; `VertexEditOptions` defined once (Task 2), forwarded by the control (Task 3), exported (Task 4). `map.vertexEdit` getter returns `Handler<VertexEditOptions>` (Task 4) — Task 3's control uses only `isEnabled/enable/disable/setOptions` from that interface (all present). `PRIORITY` extended consistently in `handler-manager.ts` (Task 4) with `'vertexEdit'` matching `VertexEditHandler.name` (Task 2). The `_finishDrag(px,py)` seam name is consistent between Task 2's handler and Task 2 Step 2's moved test. Task-order note (Task 3 ↔ Task 4 typecheck dependency on the `vertexEdit` getter) is called out explicitly with a resolution.

Plan is internally consistent and scoped to one shippable unit: a verbatim relocation of vertex-edit into an arbiter handler with zero behavior change, the control reduced to a byte-identical-behaving thin shell, and the white-box tests honestly relocated rather than falsely claimed unchanged.
