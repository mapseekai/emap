# emap DX Phase 6 — `drawFeature` Handler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all `DrawFeatureControl` drawing/snap/commit/undo logic into an arbiter-driven `DrawFeatureHandler` (`map.drawFeature`), thin-shell the control, **zero behavior change**. Design of record: `docs/superpowers/specs/2026-05-18-emap-dx-phase6-drawfeature-handler-design.md` (§13). Mirrors the P5 (`vertexEdit`) execution pattern exactly.

**Architecture:** Add a `'dblclick'` kind to the arbiter (`NormalizedPointerEvent` + a `HandlerManager` dblclick listener through the priority loop — not P3 sink, not exclusive). `DrawFeatureHandler` ports the control's state + private methods **verbatim** with ONE mechanical substitution (rect→`ev.point` px/py; `_map` non-null). Keyboard (`Escape`) stays a handler-owned `window` listener (not arbitrated). `enable()` throws if `source`/`type` unset. `enable()` → `setEditMode('draw')` (keeps the existing `editmode→dragPan` toggle); a constructor-time `editmodechange` subscription quiet-deactivates on cross-mode (recursion-guarded by `isEnabled()`). Priority `['lassoSelect','boxSelect','clickSelect','drawFeature','vertexEdit','dragPan']`. `DrawFeatureControl` → button-only thin shell. White-box tests move to the handler test file (retargeted, same as P5).

**Tech Stack:** TypeScript 5 (strict), Vitest 1.x (jsdom), Rollup.

**Execution order:** T1 → T2 → **T4 → T3** (T3 thin-shell needs T4's `map.drawFeature` getter to typecheck) → T5.

## Design Decisions (challenge these in review)

1. **`dblclick` = discrete action event** through the priority loop (NOT the P3 `_pointerSink`, NOT the exclusive-lock branch), like `click`/`contextmenu`. All existing handlers fall through to `'passthrough'` for it (verified pattern) → zero regression.
2. **Keyboard handler-owned.** `window keydown` added in `enable()`, removed in `disable()`/quiet-deactivate. Not arbitrated (non-spatial input; same precedent as `scrollZoom` owning wheel).
3. **Config gate.** `enable()` throws `Error('drawFeature: source+type required; call setOptions({source,type}) first')` when `_opts.source`/`_opts.type` is unset. Thin-shell control forwards required ctor opts via `setOptions` in `onAdd` before any enable, so the control path never throws.
4. **Verbatim port + one coord substitution** (identical rule to P5): the ONLY per-method change allowed is replacing `const rect = this._map.getCanvasContainer().getBoundingClientRect(); const px = e.clientX - rect.left; const py = e.clientY - rect.top;` with `const px = ev.point.x; const py = ev.point.y;`, and `this._map` (was `Emap | null`) → non-null `Emap` from the constructor. Methods that already take `(px,py)` (e.g. `_findSnapTarget`) change NOTHING. Module-level pure helper `projectPointOnSegment` moves verbatim (stays exported for its direct test). If any method needs another change, STOP and report BLOCKED with the method + extra coupling — no invented logic.
5. **Cross-mode auto-deactivate, recursion-guarded.** Constructor subscribes `this._map.on('editmodechange', e => { if (e.mode !== 'draw' && this.isEnabled()) this._quietDisable(); })`. `disable()`/`_quietDisable` set `_enabled=false` BEFORE `setEditMode('none')`, so the re-entrant `editmodechange('none')` sees `isEnabled()===false` and no-ops. Preserves "enabling vertexEdit deactivates drawFeature".
6. **`click`/`dblclick` return `'consumed'`** (when enabled) so a coincidentally-enabled `clickSelect` can't double-fire while drawing. `move` returns `'passthrough'` (preview only, never an exclusive gesture). `down`/`up` `'passthrough'`.
7. **Disabled + unconfigured by default.** `new Emap()` builds `DrawFeatureHandler` disabled with empty opts; only new always-on cost is one `dblclick` element listener every handler ignores while disabled.
8. **`DrawFeatureOptions` = `DrawFeatureControlOptions` minus `icon`** (button concern stays on the control). `DrawGeometryType` re-exported from the handler.

---

## File Structure

- Modify `src/core/handler.ts` — add `'dblclick'` to `NormalizedPointerEvent['kind']`.
- Modify `src/core/handler-manager.ts` — `attach`/`detach` a `dblclick` element listener; `_dispatch` routes it via priority loop (Task 1); PRIORITY array gains `'drawFeature'` (Task 4).
- Modify `src/core/handler-manager.test.ts` — dblclick normalize/dispatch tests.
- Create `src/core/handlers/draw-feature.ts` — `DrawFeatureHandler` + `DrawFeatureOptions` + `DrawGeometryType` + the moved `projectPointOnSegment` helper.
- Create `src/core/handlers/draw-feature.test.ts` — the MOVED white-box cases (retargeted) + new handler cases.
- Modify `src/ui/draw-feature-control.ts` — thin shell (button only, forwards opts).
- Modify `src/ui/draw-feature-control.test.ts` — remove moved cases; NEW thin-shell behavior test.
- Modify `src/map/map.ts` — construct + register `DrawFeatureHandler`; `get drawFeature()`.
- Modify `src/index.ts` — export `DrawFeatureHandler` + `DrawFeatureOptions` + `DrawGeometryType`.
- Modify `CHANGELOG.md`.

---

### Task 1: arbiter gains `dblclick` kind

**Files:** Modify `src/core/handler.ts`, `src/core/handler-manager.ts`; Test `src/core/handler-manager.test.ts`.

- [ ] **Step 1: Write the failing test**

Append a NEW describe to `src/core/handler-manager.test.ts` (file has `// @vitest-environment jsdom`):

```ts
describe('HandlerManager dblclick kind', () => {
  function recordHandler() {
    const calls: any[] = [];
    return { calls, h: { name: 'dragPan', enable() {}, disable() {}, isEnabled: () => true,
      setOptions() {}, getOptions: () => ({}),
      handlePointer: (e: any) => { calls.push(e.kind); return 'passthrough' as const; } } };
  }
  function el() {
    const e = document.createElement('div');
    e.getBoundingClientRect = () => ({ left: 4, top: 6, width: 0, height: 0, right: 0, bottom: 0, x: 4, y: 6, toJSON() {} }) as any;
    return e;
  }

  it('normalizes a dblclick DOM event and dispatches via the priority loop', () => {
    const { h, calls } = recordHandler();
    const m = new HandlerManager();
    m.register(h);
    const element = el();
    m.attach(element);
    element.dispatchEvent(new MouseEvent('dblclick', { clientX: 24, clientY: 26, button: 0 }));
    expect(calls).toEqual(['dblclick']);
    m.detach();
  });

  it('dblclick is NOT fed to the P3 pointer sink', () => {
    const { h } = recordHandler();
    const m = new HandlerManager();
    m.register(h);
    const sink: string[] = [];
    m.setPointerSink((e) => sink.push(e.kind));
    const element = el();
    m.attach(element);
    element.dispatchEvent(new MouseEvent('dblclick', { clientX: 1, clientY: 1, button: 0 }));
    expect(sink).toEqual([]);
    m.detach();
  });

  it('detach() removes the dblclick listener', () => {
    const { h, calls } = recordHandler();
    const m = new HandlerManager();
    m.register(h);
    const element = el();
    m.attach(element);
    m.detach();
    element.dispatchEvent(new MouseEvent('dblclick', { clientX: 1, clientY: 1, button: 0 }));
    expect(calls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/core/handler-manager.test.ts -t "dblclick kind"` → FAIL.

- [ ] **Step 3: Implement**

(a) `src/core/handler.ts`: change the kind union to add `'dblclick'`:
```ts
  kind: 'down' | 'move' | 'up' | 'wheel' | 'click' | 'contextmenu' | 'dblclick';
```
(b) `src/core/handler-manager.ts`: add a bound field next to `_onContextMenu`:
```ts
  private _onDblClick = (e: MouseEvent) => this._dispatch(this._norm(e, 'dblclick'));
```
In `attach`, right after the `contextmenu` listener line:
```ts
  element.addEventListener('dblclick', this._onDblClick);
```
In `detach`, right after the `contextmenu` remove line (match the exact guarded `_element?.removeEventListener` pattern used for `contextmenu`):
```ts
  this._element?.removeEventListener('dblclick', this._onDblClick);
```
Do NOT modify `_dispatch`/`_norm`. Read `_dispatch` and CONFIRM `dblclick` skips the P3 sink (not `click`/`move`) and the exclusive branch (not `move`/`up`) and reaches the priority loop. If it does not, STOP/BLOCKED (do not edit `_dispatch` unless it genuinely mis-routes — it should not).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/core/handler-manager.test.ts` → existing + 3 new PASS.

- [ ] **Step 5: GATE**

`npx tsc --noEmit` exit 0 AND `npx vitest run` full suite green (P1/P2a/P2b/P3/P5 unaffected — all passthrough on unknown kind; verify count). Ignore stale-LSP "Cannot find module" noise.

- [ ] **Step 6: Commit**

```bash
git add src/core/handler.ts src/core/handler-manager.ts src/core/handler-manager.test.ts
git commit -m "feat(core): arbiter dblclick event kind (DX P6)"
```

---

### Task 2: `DrawFeatureHandler` (verbatim port) + move white-box tests

**Files:** Create `src/core/handlers/draw-feature.ts`, `src/core/handlers/draw-feature.test.ts`; Modify `src/ui/draw-feature-control.test.ts`.

This is a **verbatim port** of `src/ui/draw-feature-control.ts` (read it fully first; also read `src/ui/draw-feature-control.test.ts` and `src/core/handlers/vertex-edit.ts` for the established P5 handler shape).

- [ ] **Step 1: Create the handler**

`src/core/handlers/draw-feature.ts`, class `DrawFeatureHandler implements Handler<DrawFeatureOptions>`:

- MOVE verbatim from the control: module consts/icons-titles maps ONLY if used by the handler logic (NOTE: `DEFAULT_ICONS`/`DEFAULT_TITLES` are button concerns — they stay in the control unless a handler method references them; if `_commitFeature`/snap logic needs `DEFAULT_SNAP_THRESHOLD`/`CLOSE_THRESHOLD`, move those), the module-level pure helper **`projectPointOnSegment`** (keep `export`ed — its test calls it directly), the `SnapKind` type and any module-local interfaces, and the imports for `FeatureCreateCommand`/adapter/`ArcCollection`/`MapshaperLayer`/`Emap`/`DrawGeometryType`. Fix relative paths for `src/core/handlers/` (`../../edit/commands/...`, `../../map/map`, `../../types/mapshaper-types`, etc. — verify each).
- `export type DrawGeometryType = 'polygon' | 'polyline' | 'point';` (move from control).
- `export interface DrawFeatureOptions { source: string; sourceLayer?: string; type: DrawGeometryType; snapThreshold?: number; snapSources?: string[]; snapToVertex?: boolean; snapToEdge?: boolean; drawColor?: string }` (= `DrawFeatureControlOptions` minus `icon`).
- State fields moved verbatim (same names): `_vertices`, `_cursorCoord`, `_snapCoord`, `_snapKind`, `_snapThreshold`. Replace control-only `_container`/`_btn`/`_active`/`*Bound` with: `private readonly _map: Emap`, `private _enabled = false`, `private _opts: DrawFeatureOptions` (default `{} as any` — gate enforces required at enable), `private _onMapMoveBound = () => this._onMapMove();`, `private _onKeyDownBound = (e: KeyboardEvent) => this._onKeyDown(e);`.
- `constructor(map: Emap, opts?: Partial<DrawFeatureOptions>)`: `this._map = map; this._opts = { ...(opts ?? {}) } as DrawFeatureOptions; this._snapThreshold = this._opts.snapThreshold ?? DEFAULT_SNAP_THRESHOLD;` then subscribe cross-mode auto-deactivate: `this._map.on('editmodechange', (e: { mode: string }) => { if (e.mode !== 'draw' && this._enabled) this._quietDisable(); });`
- Handler interface:
  - `readonly name = 'drawFeature';` `isEnabled() { return this._enabled; }`
  - `setOptions(o: Partial<DrawFeatureOptions>)`: `this._opts = { ...this._opts, ...o }; if (o.snapThreshold !== undefined) this._snapThreshold = o.snapThreshold;`
  - `getOptions(): Readonly<DrawFeatureOptions>` → `{ ...this._opts }`.
  - `enable()`: if `_enabled` return; **gate**: `if (!this._opts.source || !this._opts.type) throw new Error('drawFeature: source+type required; call setOptions({source,type}) first');` then `this._enabled = true; this._map.setEditMode('draw'); window.addEventListener('keydown', this._onKeyDownBound); this._map.on('move', this._onMapMoveBound);` (port of `_activate` minus button/DOM-mouse listeners — the arbiter feeds pointer events).
  - `disable()`: if `!_enabled` return; `this._enabled = false;` then the verbatim body of the control's `_deactivate` MINUS button/DOM-mouse listener teardown, KEEPING: port `_clearDrawState()` body; `window.removeEventListener('keydown', this._onKeyDownBound)`; `this._map.off('move', this._onMapMoveBound)`; `this._map.setEditMode('none'); this._map.clearEditDrawState(); this._map.render();`
  - `private _quietDisable()`: `this._enabled = false;` + the same teardown as `disable()` EXCEPT do NOT call `setEditMode('none')` (port of `_deactivateQuiet`: clear state/listeners, `clearEditDrawState()`, `render()`, no setEditMode). (Order: set `_enabled=false` first so the `editmodechange` guard in the ctor subscription is already false.)
  - `handlePointer(ev: NormalizedPointerEvent): HandlerResult`:
    ```
    if (!this._enabled) return 'passthrough';
    const px = ev.point.x, py = ev.point.y;
    if (ev.kind === 'move') { this._onMouseMove(px, py); return 'passthrough'; }
    if (ev.kind === 'click') { if (ev.button !== 0) return 'passthrough'; this._onClick(px, py); return 'consumed'; }
    if (ev.kind === 'dblclick') { this._onDblClick(px, py); return 'consumed'; }
    return 'passthrough';
    ```
- Moved private methods (same names; verbatim bodies; ONLY the rect→px/py + non-null `_map` substitution where they computed coords from a `MouseEvent`; methods already taking `(px,py)` unchanged): `_onMapMove`, `_onMouseMove(px,py)`, `_onClick(px,py)`, `_onDblClick(px,py)`, `_onKeyDown(e: KeyboardEvent)` (verbatim — handles `Escape`; it uses `_clearDrawState`), `_clearDrawState`, `_findSnapTarget(px,py)` (UNCHANGED — already takes px,py), `_commitFeature`, `_resolveTargetLayer`, `_appendArc`, `_updateDrawState`. Keep EXACT names so the moved white-box tests bind.

> IMPORTANT: port, not rewrite. If any method needs a change beyond the documented substitution (e.g. referenced `_btn`/`_active`/`_container`), STOP and report BLOCKED with the method + extra coupling. Do not invent logic.

- [ ] **Step 2: Move the white-box tests + add handler cases**

Create `src/core/handlers/draw-feature.test.ts`. MOVE every `it(...)` + `describe(...)` + the `setPrivate`/`getPrivate`/`callPrivate` helpers + any fixtures/mock-map builders from `src/ui/draw-feature-control.test.ts` VERBATIM, with ONLY these retargets:
- import `{ DrawFeatureHandler } from './draw-feature'` (and `projectPointOnSegment` from `./draw-feature` if the `describe('projectPointOnSegment')` block imports it; verify how the original imports it and keep that working from the new location).
- `new DrawFeatureControl(opts)` → `new DrawFeatureHandler(mapMock as any, opts)`; if a test does `setPrivate(x,'_map',mapMock)` keep it (re-sets same field); rename the local var consistently.
- `setPrivate(control, '_active', true)` → `setPrivate(handler, '_enabled', true)` (the handler's enabled flag; `_active` no longer exists).
- `callPrivate(control, '_onClick', {clientX,clientY,...})` / `'_onDblClick'` → `callPrivate(handler, '_onClick', PX, PY)` / `'_onDblClick', PX, PY` where `PX/PY` are the element-local coords the test's mock `getBoundingClientRect` + the event clientX/clientY produced — compute & inline the literals so asserted inputs are unchanged. `callPrivate(_, '_findSnapTarget', px, py)` UNCHANGED (already px,py). `projectPointOnSegment` cases UNCHANGED (module fn). Keep ALL assertions byte-identical.
ADD handler-only cases: (a) `enable()` WITHOUT source/type → throws the exact gate message; (b) `enable()` after `setOptions({source,type})` → `mapMock.setEditMode('draw')` called + `isEnabled()` true; (c) `disable()` → `setEditMode('none')` + `clearEditDrawState()` + `isEnabled()` false; (d) firing a fake `editmodechange` with `mode:'vertex'` while enabled → handler quiet-disables (`isEnabled()` false, `setEditMode` NOT called again).
In `src/ui/draw-feature-control.test.ts`: DELETE the moved blocks (and now-unused imports/helpers) so the suite stays GREEN at this commit — leave it minimal (imports trimmed + a single `it.skip` or empty describe) until Task 3 replaces it.

- [ ] **Step 3: Run + GATE**

`npx vitest run src/core/handlers/draw-feature.test.ts` all pass. `npx tsc --noEmit` exit 0. `npx vitest run` full suite green (count = baseline − removed-from-old + moved-into-new + new handler cases; report exact). `npm run build` exit 0. `map.test.ts` unaffected. Port non-allowed-change → STOP/BLOCKED with method+coupling.

- [ ] **Step 4: Commit**

```bash
git add src/core/handlers/draw-feature.ts src/core/handlers/draw-feature.test.ts src/ui/draw-feature-control.test.ts
git commit -m "feat(core): DrawFeatureHandler — verbatim port of draw-feature logic (DX P6)"
```

---

### Task 4: wire `DrawFeatureHandler` into Emap + priority + exports

**Files:** Modify `src/core/handler-manager.ts`, `src/map/map.ts`, `src/index.ts`; Test `src/map/handler-registry.test.ts`.

- [ ] **Step 1: Write the failing test**

Append inside the existing top `describe` of `src/map/handler-registry.test.ts` (reuse `container()` + canvas-2d `beforeAll`):

```ts
  it('exposes a disabled-by-default drawFeature handler', () => {
    const map = new Emap({ container: container() });
    expect(map.drawFeature.name).toBe('drawFeature');
    expect(map.drawFeature.isEnabled()).toBe(false);
  });

  it('drawFeature.enable() without source/type throws; configured enters draw mode', () => {
    const map = new Emap({ container: container() });
    expect(() => map.drawFeature.enable()).toThrow(/source\+type required/i);
    map.drawFeature.setOptions({ source: 's', type: 'polygon' });
    map.drawFeature.enable();
    expect(map.getEditMode()).toBe('draw');
    expect(map.dragPan.isEnabled()).toBe(false);
    map.drawFeature.disable();
    expect(map.getEditMode()).toBe('none');
    expect(map.dragPan.isEnabled()).toBe(true);
  });

  it('enabling vertexEdit cross-deactivates an active drawFeature', () => {
    const map = new Emap({ container: container() });
    map.drawFeature.setOptions({ source: 's', type: 'polygon' });
    map.drawFeature.enable();
    map.vertexEdit.enable();              // setEditMode('vertex') → editmodechange
    expect(map.drawFeature.isEnabled()).toBe(false);
    expect(map.getEditMode()).toBe('vertex');
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/map/handler-registry.test.ts -t "drawFeature"` → FAIL (`map.drawFeature` undefined).

- [ ] **Step 3: Implement**

(a) `src/core/handler-manager.ts`: change PRIORITY to
```ts
const PRIORITY = ['lassoSelect', 'boxSelect', 'clickSelect', 'drawFeature', 'vertexEdit', 'dragPan'] as const;
```
(insert `'drawFeature'` before `'vertexEdit'`; do not reorder others).
(b) `src/map/map.ts`:
- Import: `import { DrawFeatureHandler, type DrawFeatureOptions } from '../core/handlers/draw-feature';`
- Field: `private _drawFeature!: DrawFeatureHandler;`
- Construct + register AFTER `this._handlers.register(this._vertexEdit);` and BEFORE `this._handlers.attach(this._canvasContainer);`:
  ```ts
  this._drawFeature = new DrawFeatureHandler(this);
  this._handlers.register(this._drawFeature);
  ```
- Getter near `get vertexEdit()`:
  ```ts
  get drawFeature(): Handler<DrawFeatureOptions> { return this._drawFeature; }
  ```
- Do NOT touch the `editmodechange`/`dragPan` toggle (~line 181).
(c) `src/index.ts` after the P5 vertexEdit exports:
```ts
export { DrawFeatureHandler } from './core/handlers/draw-feature';
export type { DrawFeatureOptions, DrawGeometryType } from './core/handlers/draw-feature';
```

- [ ] **Step 4: Run + GATE**

`npx vitest run src/map/handler-registry.test.ts` → existing + 3 new pass. `npx tsc --noEmit` exit 0. `npx vitest run` full suite. `npm run build` exit 0. **`src/map/map.test.ts` edit-mode/pan/zoom + all P1–P5 suites byte-identical** (drawFeature disabled by default). Regression → STOP/BLOCKED.

- [ ] **Step 5: Commit**

```bash
git add src/core/handler-manager.ts src/map/map.ts src/index.ts src/map/handler-registry.test.ts
git commit -m "feat(map): expose map.drawFeature handler; priority slot (DX P6)"
```

---

### Task 3: thin-shell `DrawFeatureControl`

**Files:** Modify `src/ui/draw-feature-control.ts`, `src/ui/draw-feature-control.test.ts`.

- [ ] **Step 1: Write the failing test**

Replace the (stub) `src/ui/draw-feature-control.test.ts` with:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { DrawFeatureControl } from './draw-feature-control';

function fakeMap() {
  let enabled = false;
  let modeCb: ((e: { mode: string }) => void) | null = null;
  const df = { isEnabled: () => enabled, enable: vi.fn(() => { enabled = true; }),
    disable: vi.fn(() => { enabled = false; }), setOptions: vi.fn() };
  return {
    drawFeature: df,
    getCanvasContainer: () => document.createElement('div'),
    on: (t: string, cb: any) => { if (t === 'editmodechange') modeCb = cb; },
    _fireMode: (m: string) => modeCb?.({ mode: m }),
  } as any;
}

describe('DrawFeatureControl (thin shell)', () => {
  it('onAdd forwards options (minus icon) to map.drawFeature.setOptions and renders a button', () => {
    const map = fakeMap();
    const c = new DrawFeatureControl({ source: 's', type: 'polygon', snapThreshold: 7, icon: '★' });
    const root = c.onAdd(map);
    expect(map.drawFeature.setOptions).toHaveBeenCalledWith(
      expect.objectContaining({ source: 's', type: 'polygon', snapThreshold: 7 }));
    expect(map.drawFeature.setOptions.mock.calls[0][0]).not.toHaveProperty('icon');
    const btn = root.querySelector('button') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click();
    expect(map.drawFeature.enable).toHaveBeenCalledTimes(1);
    expect(btn.classList.contains('active')).toBe(true);
    btn.click();
    expect(map.drawFeature.disable).toHaveBeenCalledTimes(1);
    expect(btn.classList.contains('active')).toBe(false);
  });

  it('cross-mode editmodechange un-presses the button', () => {
    const map = fakeMap();
    const c = new DrawFeatureControl({ source: 's', type: 'polygon' });
    const root = c.onAdd(map);
    const btn = root.querySelector('button') as HTMLButtonElement;
    btn.click(); // active
    expect(btn.classList.contains('active')).toBe(true);
    map._fireMode('vertex'); // another mode took over
    expect(btn.classList.contains('active')).toBe(false);
  });

  it('onRemove disables if active', () => {
    const map = fakeMap();
    const c = new DrawFeatureControl({ source: 's', type: 'point' });
    const root = c.onAdd(map);
    (root.querySelector('button') as HTMLButtonElement).click();
    c.onRemove();
    expect(map.drawFeature.disable).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/ui/draw-feature-control.test.ts` → FAIL.

- [ ] **Step 3: Rewrite the control as a thin shell**

Replace `src/ui/draw-feature-control.ts` entirely. Keep EXACT public surface: `export type DrawGeometryType` (re-export from the handler: `export type { DrawGeometryType } from '../core/handlers/draw-feature';`), `export interface DrawFeatureControlOptions` (UNCHANGED — still includes `icon`, `source`, `type`, snap*, `drawColor`, `sourceLayer`), `export class DrawFeatureControl implements Control`. Behavior:

```ts
import type { Control } from './control';
import type { Emap } from '../map/map';
import type { DrawFeatureOptions, DrawGeometryType } from '../core/handlers/draw-feature';

export type { DrawGeometryType } from '../core/handlers/draw-feature';

export interface DrawFeatureControlOptions extends DrawFeatureOptions {
  /** Button icon: string (textContent) or a prebuilt Node. */
  icon?: string | Node;
}

const DEFAULT_ICONS: Record<DrawGeometryType, string> = { polygon: '▢', polyline: '╱', point: '●' };
const DEFAULT_TITLES: Record<DrawGeometryType, string> = { polygon: 'Draw Polygon', polyline: 'Draw Polyline', point: 'Draw Point' };

export class DrawFeatureControl implements Control {
  private _opts: DrawFeatureControlOptions;
  private _map: Emap | null = null;
  private _container: HTMLElement | null = null;
  private _btn: HTMLButtonElement | null = null;

  constructor(options: DrawFeatureControlOptions) { this._opts = options; }

  onAdd(map: Emap): HTMLElement {
    this._map = map;
    const { icon, ...handlerOpts } = this._opts;
    map.drawFeature.setOptions(handlerOpts);

    this._container = document.createElement('div');
    this._container.className = 'emap-ctrl emap-ctrl-group';
    this._btn = document.createElement('button');
    this._btn.className = 'emap-ctrl-draw';
    this._btn.type = 'button';
    this._btn.title = DEFAULT_TITLES[this._opts.type];
    if (icon instanceof Node) this._btn.appendChild(icon);
    else this._btn.textContent = typeof icon === 'string' ? icon : DEFAULT_ICONS[this._opts.type];
    this._btn.addEventListener('click', () => this._toggle());
    this._container.appendChild(this._btn);

    map.on('editmodechange', (e: { mode: string }) => {
      if (e.mode !== 'draw') this._btn?.classList.remove('active');
    });
    return this._container;
  }

  onRemove(): void {
    if (this._map && this._map.drawFeature.isEnabled()) this._map.drawFeature.disable();
    if (this._container?.parentNode) this._container.parentNode.removeChild(this._container);
    this._map = null; this._container = null; this._btn = null;
  }

  private _toggle(): void {
    if (!this._map) return;
    const df = this._map.drawFeature;
    if (df.isEnabled()) { df.disable(); this._btn?.classList.remove('active'); }
    else { df.enable(); this._btn?.classList.add('active'); }
  }
}
```
> Verify against the ORIGINAL control: button `className`, exact `DEFAULT_ICONS`/`DEFAULT_TITLES` values, and the icon-as-Node-vs-string rule must be byte-identical to the pre-P6 control (read `git show master:src/ui/draw-feature-control.ts` for the precise button markup/class and icon handling; reproduce EXACTLY — if the original used a different button class or title source, match it, do not guess).

- [ ] **Step 4: Run + GATE**

`npx vitest run src/ui/draw-feature-control.test.ts` → 3 pass. `npx tsc --noEmit` exit 0. `npx vitest run` full suite green. `npm run build` exit 0. P1–P5 + `map.test.ts` green. Dangling importer of a removed control export → STOP/BLOCKED (public exports `DrawFeatureControl`/`DrawFeatureControlOptions`/`DrawGeometryType` retained).

- [ ] **Step 5: Commit**

```bash
git add src/ui/draw-feature-control.ts src/ui/draw-feature-control.test.ts
git commit -m "refactor(ui): DrawFeatureControl thin shell over map.drawFeature (DX P6)"
```

---

### Task 5: CHANGELOG

**Files:** Modify `CHANGELOG.md` (`[Unreleased]` → existing `### Added`).

- [ ] **Step 1: Add after the Phase-5 bullet**

```markdown
- DX Phase 6 (toward 0.3.0): feature drawing is now the arbiter-driven
  `map.drawFeature` handler (`enable/disable/isEnabled/setOptions/
  getOptions`) — usable without `addControl`. The arbiter gained a
  `dblclick` event kind (finish polyline/polygon); `Escape`-to-cancel is a
  handler-owned key listener. `enable()` throws if `source`/`type` are
  unset. `DrawFeatureControl` is now a button-only thin shell over
  `map.drawFeature`; its public class, constructor options (incl. `icon`),
  button DOM, `feature_created` event, `FeatureCreateCommand`, and the
  cross-mode auto-deactivate are byte-identical. Disabled (and
  unconfigured) by default → `new Emap()` behavior unchanged.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: CHANGELOG for DX Phase 6 drawFeature handler"
```

---

## Self-Review

**1. Spec coverage (§13):** §13.2 dblclick kind → Task 1 (union + listener + priority-loop routing, sink/exclusive-excluded, detach symmetric) + regression test. §13.3 keyboard handler-owned → Task 2 `enable/disable` add/remove `window keydown`; not in the arbiter. §13.4 config gate → Task 2 `enable()` throw + Task 4 test asserts the throw. §13.5 modal + cross-mode auto-deactivate w/ recursion guard → Task 2 ctor `editmodechange` subscription + `_quietDisable` (sets `_enabled=false` first); Task 4 leaves `map.ts:181` untouched; Task 4 test asserts vertexEdit cross-deactivates drawFeature. §13.6 handlePointer mapping (move/click/dblclick/down/up + commit) → Task 2 switch + verbatim ports; priority array → Task 4. §13.7 `DrawFeatureOptions` = ctrl opts − icon, `DrawGeometryType` re-exported, thin-shell byte-identical surface → Task 3 (icon retained on control, `{icon, ...handlerOpts}` forward, button markup matched to original). §13.8 white-box tests MOVED + retargeted (`_active`→`_enabled`, event-arg→px/py), new thin-shell test, dblclick/gate/cross-mode unit tests → Task 2 Step 2 + Task 3 Step 1 + Task 1/4 tests. §13.9 phasing/independent → 5 tasks, each commit green, T1→T2→T4→T3→T5. Every §13 requirement mapped.

**2. Placeholder scan:** No TBD/TODO. "Port verbatim" references exact member names + the single coord substitution + the explicit STOP-if-other-coupling rule (P5-proven pattern; GATE = moved white-box assertions unchanged + `map.test.ts` byte-identical). Task 3 includes a "match the ORIGINAL button markup via `git show master:`" instruction so the thin-shell button is reproduced exactly rather than guessed.

**3. Type consistency:** `'dblclick'` added once to `NormalizedPointerEvent['kind']` (Task 1), consumed by `DrawFeatureHandler.handlePointer` (Task 2), passthrough-tolerated by all other handlers (verified pattern). `DrawFeatureOptions` defined once (Task 2), `DrawFeatureControlOptions extends DrawFeatureOptions` adding only `icon` (Task 3) — keeps the control's public option shape a superset, byte-compatible. `DrawGeometryType` defined in the handler (Task 2), re-exported by the control (Task 3) and `index.ts` (Task 4) — single source. `map.drawFeature` getter returns `Handler<DrawFeatureOptions>` (Task 4); the thin-shell control uses only `isEnabled/enable/disable/setOptions` (all on the interface). `PRIORITY` gains `'drawFeature'` (Task 4) matching `DrawFeatureHandler.name` (Task 2). The `_enabled` flag (handler) is the retarget of the test's old `_active` (Task 2 Step 2), consistently applied. Recursion guard ordering (`_enabled=false` before `setEditMode('none')`) is stated in both `disable()` and `_quietDisable` (Task 2) and matches the ctor subscription's `isEnabled()` check.

Plan is internally consistent and scoped to one shippable unit: a verbatim relocation of draw-feature into an arbiter handler with zero behavior change, the control reduced to a byte-identical-behaving thin shell, white-box tests honestly relocated.
