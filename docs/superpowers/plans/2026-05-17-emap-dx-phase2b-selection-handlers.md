# emap DX Phase 2b — Selection Handlers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three named, opt-in selection handlers — `clickSelect`, `boxSelect`, `lassoSelect` — driven by the Phase-2a pointer arbiter, sharing one pure `resolveMode` and one pure selection-geometry module, exposed as `map.clickSelect` / `map.boxSelect` / `map.lassoSelect` (`Handler` instances). The existing `BoxSelectControl` / `LassoSelectControl` keep working unchanged (their internal logic is re-pointed at the shared geometry module but their behavior is byte-identical) — gutting them to thin shells is **P2c, out of scope here**.

**Architecture:** The shift-vs-pan special case the design spec §3 calls out is now owned by the arbiter: `boxSelect`/`lassoSelect` sit ABOVE `dragPan` in `HandlerManager`'s fixed `PRIORITY` array (already `['lassoSelect','boxSelect','clickSelect','dragPan']` since P2a). On `shift`+pointerdown an enabled box/lasso handler returns `'exclusive'` and captures the gesture before `dragPan` sees it; with no selection handler enabled, `dragPan.skipShiftDrag` (default `true`, unchanged) keeps shift+drag a pan no-op exactly as today. `clickSelect` acts only on `kind:'click'`. All three call the existing imperative `Emap.queryFeatures` / `Emap.select` — handlers never touch selection internals.

**Tech Stack:** TypeScript 5 (strict), Vitest 1.x (jsdom), Rollup.

## Design Decisions (challenge these in review)

1. **`resolveMode` composition = strip-activator-then-match** (user-confirmed). `resolveMode(modifiers, table, activator?)` removes the `activator` combo's keys from the held `PointerModifiers`, serializes the remaining held keys to a canonical combo string, and returns the `SelectMode` whose `table` entry equals it; default `'replace'` if none match. box/lasso default `table = { replace:'none', add:'ctrl', toggle:'alt' }` with `activator='shift'` → reproduces today's `box-select-control.ts:229` exactly (shift→replace, shift+ctrl→add, shift+alt→toggle). `clickSelect` has **no** activator, default `table = { replace:'none', add:'shift', toggle:'shift+alt' }`.
2. **`skipShiftDrag` left intact, default `true`.** Removing it would make shift+drag pan when no selection handler is enabled — a default-path behavior change, violating the project's standing invariant. The special case is *retired by routing* (arbiter priority), not by deleting the option. Revisit only if a future phase enables a selector by default (none planned).
3. **Selectors are opt-in, disabled by default.** `new Emap()` registers them disabled, so default behavior is unchanged and there is no double-select against an `addControl`'d legacy control (the control only runs when added; the handler only runs when `.enable()`d).
4. **box vs lasso mutual exclusion is explicit.** `boxSelect.enable()` throws if `lassoSelect` is enabled and vice-versa (both consume `shift`+drag). `clickSelect` coexists with either (click vs drag disambiguated by the arbiter: click never starts an exclusive gesture). The check reads the sibling via a back-reference set by `HandlerManager.register` — see Task 6.
5. **Shared geometry module, not duplication.** The pure helpers currently private to `lasso-select-control.ts` (`pointInPolygon`, `featureMatchesLasso`, `resolveFeatureShape`, path/point helpers) and `dedupeRefs`/`pathBBox` move verbatim to `src/core/handlers/select-geometry.ts`. The two legacy controls re-import from there (one-line import change, zero logic change) so both paths stay DRY and identical until P2c deletes the control logic.
6. **Overlay DOM stays in `_canvasContainer`**, classes `.emap-box-select` / `.emap-lasso-select` retained (theme hooks for §6). The handler creates/owns the overlay on first `enable()` (the arbiter owns input; the handler owns only its visual).
7. **No `lngLat` on `NormalizedPointerEvent`.** The actual P2a type carries `point` (element-local px) only. Hit-testing uses `Emap.queryFeatures([x,y])` / `([[x1,y1],[x2,y2]])`, which already operate in container px — no projection needed for click/box; lasso reuses the existing `map.project`-based polygon refinement via the shared module.

---

## File Structure

- Create `src/core/handlers/select-mode.ts` — pure `SelectMode`/`ModifierCombo` types + `resolveMode`. ~50 lines, no DOM, no Emap.
- Create `src/core/handlers/select-mode.test.ts`.
- Create `src/core/handlers/select-geometry.ts` — pure geometry + ref helpers MOVED verbatim from `lasso-select-control.ts` + `dedupeRefs` MOVED from `box-select-control.ts`. Exports: `pointInPolygon`, `featureMatchesLasso`, `dedupeRefs`, `pathBBox`. Internal helpers (`resolveFeatureShape`, `pathShapeToPixelParts`, `pathIntersectsPolygon`, `pathContainedByPolygon`, `pointInPolygonOrOnBoundary`, `normalizePointShape`, and the `PathShape` type) move too.
- Create `src/core/handlers/select-geometry.test.ts` — move the geometry-only cases from `lasso-select-control.test.ts`; keep `lasso-select-control.test.ts` importing the helpers from their new home (re-export shim, see Task 2).
- Create `src/core/handlers/click-select.ts` + `.test.ts`.
- Create `src/core/handlers/box-select.ts` + `.test.ts`.
- Create `src/core/handlers/lasso-select.ts` + `.test.ts`.
- Modify `src/ui/box-select-control.ts` — replace its private `dedupeRefs` with an import from `select-geometry`; behavior unchanged.
- Modify `src/ui/lasso-select-control.ts` — re-export geometry helpers from `select-geometry` (so its test file and any consumer keep resolving); delete the moved bodies; behavior unchanged.
- Modify `src/core/handler-manager.ts` — add a sibling back-reference accessor used by the box/lasso conflict check (Task 6).
- Modify `src/map/map.ts` — construct + register the three handlers (disabled), add `get clickSelect()/boxSelect()/lassoSelect()` returning `Handler<…Options>`.
- Modify `src/index.ts` — export the three handler classes + their option types + `SelectMode`/`ModifierCombo`/`resolveMode`.
- Modify `CHANGELOG.md`.

---

### Task 1: Pure `resolveMode` + select-mode types

**Files:**
- Create: `src/core/handlers/select-mode.ts`
- Test: `src/core/handlers/select-mode.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/handlers/select-mode.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveMode } from './select-mode';
import type { ModifierCombo, SelectMode } from './select-mode';

function mods(s = false, c = false, a = false, m = false) {
  return { shift: s, ctrl: c, alt: a, meta: m };
}
const BOX_TABLE: Partial<Record<SelectMode, ModifierCombo>> =
  { replace: 'none', add: 'ctrl', toggle: 'alt' };
const CLICK_TABLE: Partial<Record<SelectMode, ModifierCombo>> =
  { replace: 'none', add: 'shift', toggle: 'shift+alt' };

describe('resolveMode', () => {
  it('clickSelect (no activator): plain → replace, shift → add, shift+alt → toggle', () => {
    expect(resolveMode(mods(), CLICK_TABLE)).toBe('replace');
    expect(resolveMode(mods(true), CLICK_TABLE)).toBe('add');
    expect(resolveMode(mods(true, false, true), CLICK_TABLE)).toBe('toggle');
  });

  it('box/lasso (activator=shift): reproduces today exactly', () => {
    // held shift only → strip shift → '' → none → replace
    expect(resolveMode(mods(true), BOX_TABLE, 'shift')).toBe('replace');
    // shift+ctrl → strip shift → 'ctrl' → add
    expect(resolveMode(mods(true, true), BOX_TABLE, 'shift')).toBe('add');
    // shift+alt → strip shift → 'alt' → toggle
    expect(resolveMode(mods(true, false, true), BOX_TABLE, 'shift')).toBe('toggle');
    // shift+meta → strip shift → 'meta' → no match → replace (default)
    expect(resolveMode(mods(true, false, false, true), BOX_TABLE, 'shift')).toBe('replace');
  });

  it('unmatched combo falls back to replace', () => {
    expect(resolveMode(mods(false, false, false, true), CLICK_TABLE)).toBe('replace');
  });

  it('canonical combo order is shift+ctrl+alt+meta regardless of held order', () => {
    const table: Partial<Record<SelectMode, ModifierCombo>> = { add: 'shift+ctrl' };
    expect(resolveMode(mods(true, true), table)).toBe('add');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/handlers/select-mode.test.ts`
Expected: FAIL — `Cannot find module './select-mode'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/handlers/select-mode.ts`:

```ts
import type { PointerModifiers } from '../handler';

/** How a selection gesture combines with the existing selection. */
export type SelectMode = 'replace' | 'add' | 'toggle';

/** A canonical chord of modifier keys, '+'-joined in shift+ctrl+alt+meta order. */
export type ModifierCombo =
  | 'none'
  | 'shift' | 'ctrl' | 'alt' | 'meta'
  | 'shift+ctrl' | 'shift+alt' | 'shift+meta'
  | 'ctrl+alt' | 'ctrl+meta' | 'alt+meta'
  | 'shift+ctrl+alt' | 'shift+ctrl+meta' | 'shift+alt+meta' | 'ctrl+alt+meta'
  | 'shift+ctrl+alt+meta';

const ORDER = ['shift', 'ctrl', 'alt', 'meta'] as const;
type Key = (typeof ORDER)[number];

/** Held PointerModifiers → canonical combo string ('none' if empty). */
function comboOf(m: Pick<PointerModifiers, Key>): string {
  const held = ORDER.filter((k) => m[k]);
  return held.length === 0 ? 'none' : held.join('+');
}

/** Parse a ModifierCombo to its key set ('none' → empty). */
function keysOf(combo: ModifierCombo): Set<Key> {
  if (combo === 'none') return new Set();
  return new Set(combo.split('+') as Key[]);
}

/**
 * Resolve a {@link SelectMode} from held modifiers.
 *
 * When `activator` is given (box/lasso drag gate), its keys are stripped
 * from the held set first — the gesture-end chord is matched on whatever
 * was held *beyond* the activator. With no `activator` (clickSelect) the
 * full held chord is matched. Unmatched → `'replace'`.
 */
export function resolveMode(
  modifiers: PointerModifiers,
  table: Partial<Record<SelectMode, ModifierCombo>>,
  activator?: ModifierCombo,
): SelectMode {
  const strip = activator ? keysOf(activator) : new Set<Key>();
  const effective = {
    shift: modifiers.shift && !strip.has('shift'),
    ctrl: modifiers.ctrl && !strip.has('ctrl'),
    alt: modifiers.alt && !strip.has('alt'),
    meta: modifiers.meta && !strip.has('meta'),
  };
  const combo = comboOf(effective);
  for (const mode of ['replace', 'add', 'toggle'] as const) {
    const want = table[mode];
    if (want && want === combo) return mode;
  }
  return 'replace';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/handlers/select-mode.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/handlers/select-mode.ts src/core/handlers/select-mode.test.ts
git commit -m "feat(core): pure resolveMode + select-mode types (DX P2b)"
```

---

### Task 2: Extract shared selection-geometry module (verbatim move)

**Files:**
- Create: `src/core/handlers/select-geometry.ts`
- Create: `src/core/handlers/select-geometry.test.ts`
- Modify: `src/ui/lasso-select-control.ts`
- Modify: `src/ui/box-select-control.ts`
- Modify: `src/ui/lasso-select-control.test.ts` (import path only)

This task is a **pure refactor: zero behavior change**. No new logic. The geometry helpers move to a control-agnostic home so the handlers (Tasks 4–5) and the legacy controls share one implementation.

- [ ] **Step 1: Create `src/core/handlers/select-geometry.ts`**

MOVE these symbols **verbatim** (cut, do not rewrite) out of `src/ui/lasso-select-control.ts` into the new file:
`pointInPolygon`, `featureMatchesLasso`, `resolveFeatureShape`, `pathShapeToPixelParts`, `pathIntersectsPolygon`, `pathContainedByPolygon`, `pointInPolygonOrOnBoundary`, `normalizePointShape`, `pathBBox`, and the `PathShape` type alias (all module-private/exported helpers below the `// Module-private helpers` banner).
ALSO MOVE `dedupeRefs` **verbatim** out of `src/ui/box-select-control.ts`.
Carry their imports (`Emap`, `MapshaperLayer`, `ArcCollection`, `getLayerId`, `FeatureRef`) — fix the relative paths for the new location (`../../map/map`, `../../types/mapshaper-types`, `../../source/layer-utils`, etc. — verify each against the originals). Keep `export` on `pointInPolygon`, `featureMatchesLasso`, `dedupeRefs`, `pathBBox`; the rest stay module-private as they are today.

- [ ] **Step 2: Re-point the legacy controls (back-compat, no logic change)**

In `src/ui/lasso-select-control.ts`: delete the moved bodies; add at the top:
```ts
import {
  pointInPolygon,
  featureMatchesLasso,
  pathBBox,
} from '../core/handlers/select-geometry';
```
Append a re-export so existing importers/tests keep resolving:
```ts
export { pointInPolygon, featureMatchesLasso } from '../core/handlers/select-geometry';
```
In `src/ui/box-select-control.ts`: delete the private `dedupeRefs`; add:
```ts
import { dedupeRefs } from '../core/handlers/select-geometry';
```

- [ ] **Step 3: Move geometry tests**

Create `src/core/handlers/select-geometry.test.ts`. MOVE the `pointInPolygon` / `featureMatchesLasso` unit cases from `src/ui/lasso-select-control.test.ts` verbatim, updating the import to `'./select-geometry'`. Leave the control-behavior cases in `lasso-select-control.test.ts`; update its helper import to `'../core/handlers/select-geometry'` (or rely on the Step-2 re-export, whichever keeps it green with no body change).

- [ ] **Step 4: GATE — zero behavior change**

Run: `npx tsc --noEmit` (exit 0) AND `npx vitest run` (full suite — total count unchanged: tests moved, not added/removed; box-select-control & lasso-select-control suites still green byte-identically) AND `npm run build` (exit 0).
Expected: same pass count as the post-P2a baseline. If any control test changed outcome, STOP — the move was not verbatim.

- [ ] **Step 5: Commit**

```bash
git add src/core/handlers/select-geometry.ts src/core/handlers/select-geometry.test.ts \
        src/ui/lasso-select-control.ts src/ui/lasso-select-control.test.ts src/ui/box-select-control.ts
git commit -m "refactor(core): extract shared select-geometry module (no behavior change) (DX P2b)"
```

---

### Task 3: `clickSelect` handler

**Files:**
- Create: `src/core/handlers/click-select.ts`
- Test: `src/core/handlers/click-select.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/handlers/click-select.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { ClickSelectHandler } from './click-select';
import type { NormalizedPointerEvent } from '../handler';

function clickEv(x: number, y: number, shift = false, alt = false): NormalizedPointerEvent {
  return {
    kind: 'click', point: { x, y },
    modifiers: { shift, ctrl: false, alt, meta: false },
    button: 0, originalEvent: new MouseEvent('click'),
  };
}

function fakeMap(hits: any[]) {
  return {
    queryFeatures: vi.fn(() => hits),
    select: vi.fn(),
  };
}

describe('ClickSelectHandler', () => {
  it('name + disabled-by-default + passthrough when disabled', () => {
    const h = new ClickSelectHandler(fakeMap([]) as any);
    expect(h.name).toBe('clickSelect');
    expect(h.isEnabled()).toBe(false);
    expect(h.handlePointer(clickEv(1, 1))).toBe('passthrough');
  });

  it('hit click → select(refs,{mode:replace}) and consumes', () => {
    const map = fakeMap([{ source: 's', layer: 'l', id: 3 }, { source: 's', layer: 'l', id: 3 }]);
    const h = new ClickSelectHandler(map as any);
    h.enable();
    expect(h.handlePointer(clickEv(10, 20))).toBe('consumed');
    expect(map.queryFeatures).toHaveBeenCalledWith([10, 20], undefined);
    expect(map.select).toHaveBeenCalledWith([{ source: 's', layer: 'l', id: 3 }], { mode: 'replace' });
  });

  it('empty click with replace-mode clears selection', () => {
    const map = fakeMap([]);
    const h = new ClickSelectHandler(map as any);
    h.enable();
    expect(h.handlePointer(clickEv(0, 0))).toBe('consumed');
    expect(map.select).toHaveBeenCalledWith([], { mode: 'replace' });
  });

  it('shift+click resolves add via default modifiers table', () => {
    const map = fakeMap([{ source: 's', layer: 'l', id: 1 }]);
    const h = new ClickSelectHandler(map as any);
    h.enable();
    h.handlePointer(clickEv(5, 5, true));
    expect(map.select).toHaveBeenCalledWith([{ source: 's', layer: 'l', id: 1 }], { mode: 'add' });
  });

  it('non-click events pass through', () => {
    const h = new ClickSelectHandler(fakeMap([]) as any);
    h.enable();
    expect(h.handlePointer({ ...clickEv(0, 0), kind: 'down' })).toBe('passthrough');
  });

  it('setOptions/getOptions round-trips modifiers + layers', () => {
    const h = new ClickSelectHandler(fakeMap([]) as any);
    h.setOptions({ layers: ['a'], modifiers: { add: 'ctrl' } });
    expect(h.getOptions().layers).toEqual(['a']);
    expect(h.getOptions().modifiers).toEqual({ add: 'ctrl' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/handlers/click-select.test.ts`
Expected: FAIL — `Cannot find module './click-select'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/handlers/click-select.ts`:

```ts
import { EventDispatcher } from '../events';
import type { Handler, HandlerResult, NormalizedPointerEvent } from '../handler';
import { resolveMode, type ModifierCombo, type SelectMode } from './select-mode';
import { dedupeRefs } from './select-geometry';
import type { Emap } from '../../map/map';

export interface SelectHandlerOptions {
  /** Restrict selectable layers; default = all visible. */
  layers?: string[];
  source?: string;
  /** Modifier→mode table. Defaults reproduce a sensible click model. */
  modifiers?: Partial<Record<SelectMode, ModifierCombo>>;
}

const CLICK_DEFAULT_MODS: Partial<Record<SelectMode, ModifierCombo>> = {
  replace: 'none', add: 'shift', toggle: 'shift+alt',
};

/**
 * Named `clickSelect` handler. Acts only on `kind:'click'` (the arbiter
 * synthesizes it from a non-dragging down/up, so it never fights a
 * box/lasso drag). Hit → resolve mode → `Emap.select`; empty click whose
 * resolved mode is `'replace'` clears the selection. Opt-in (disabled by
 * default) so `new Emap()` behavior is unchanged.
 */
export class ClickSelectHandler extends EventDispatcher implements Handler<SelectHandlerOptions> {
  readonly name = 'clickSelect';
  private _enabled = false;
  private _opts: SelectHandlerOptions = {};

  constructor(private _map: Emap) { super(); }

  enable(): void { this._enabled = true; }
  disable(): void { this._enabled = false; }
  isEnabled(): boolean { return this._enabled; }
  setOptions(opts: Partial<SelectHandlerOptions>): void { this._opts = { ...this._opts, ...opts }; }
  getOptions(): Readonly<SelectHandlerOptions> { return this._opts; }

  handlePointer(ev: NormalizedPointerEvent): HandlerResult {
    if (!this._enabled || ev.kind !== 'click' || ev.button !== 0) return 'passthrough';
    const mode = resolveMode(ev.modifiers, this._opts.modifiers ?? CLICK_DEFAULT_MODS);
    const hits = this._map.queryFeatures(
      [ev.point.x, ev.point.y],
      this._opts.layers ? { layers: this._opts.layers } : undefined,
    );
    const refs = dedupeRefs(hits);
    if (refs.length === 0) {
      if (mode === 'replace') this._map.select([], { mode: 'replace' });
      return 'consumed';
    }
    this._map.select(refs, { mode });
    return 'consumed';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/handlers/click-select.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/handlers/click-select.ts src/core/handlers/click-select.test.ts
git commit -m "feat(core): clickSelect handler (DX P2b)"
```

---

### Task 4: `boxSelect` handler

**Files:**
- Create: `src/core/handlers/box-select.ts`
- Test: `src/core/handlers/box-select.test.ts`

Ports `box-select-control.ts`'s gesture + overlay verbatim into a `handlePointer` shape. The DOM overlay is created lazily inside `_canvasContainer` (passed via the map) on first gesture.

- [ ] **Step 1: Write the failing test**

Create `src/core/handlers/box-select.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { BoxSelectHandler } from './box-select';
import type { NormalizedPointerEvent } from '../handler';

function ev(kind: NormalizedPointerEvent['kind'], x: number, y: number, shift = false, alt = false): NormalizedPointerEvent {
  return {
    kind, point: { x, y },
    modifiers: { shift, ctrl: false, alt, meta: false },
    button: 0, originalEvent: new MouseEvent('pointerdown'),
  };
}

function fakeMap() {
  const c = document.createElement('div');
  return {
    _c: c,
    getCanvasContainer: () => c,
    queryFeatures: vi.fn(() => [{ source: 's', layer: 'l', id: 7 }]),
    select: vi.fn(),
  };
}

describe('BoxSelectHandler', () => {
  it('name + disabled-by-default; shift+down while disabled is passthrough', () => {
    const h = new BoxSelectHandler(fakeMap() as any);
    expect(h.name).toBe('boxSelect');
    expect(h.isEnabled()).toBe(false);
    expect(h.handlePointer(ev('down', 0, 0, true))).toBe('passthrough');
  });

  it('without activator (no shift) down → passthrough (lets dragPan have it)', () => {
    const h = new BoxSelectHandler(fakeMap() as any);
    h.enable();
    expect(h.handlePointer(ev('down', 0, 0, false))).toBe('passthrough');
  });

  it('shift+down → exclusive; move tracks; up past threshold → query+select(replace)', () => {
    const map = fakeMap();
    const h = new BoxSelectHandler(map as any);
    h.enable();
    expect(h.handlePointer(ev('down', 10, 10, true))).toBe('exclusive');
    expect(h.handlePointer(ev('move', 60, 40, true))).toBe('exclusive');
    expect(h.handlePointer(ev('up', 60, 40, true))).toBe('passthrough');
    expect(map.queryFeatures).toHaveBeenCalledWith([[10, 10], [60, 40]], undefined);
    expect(map.select).toHaveBeenCalledWith([{ source: 's', layer: 'l', id: 7 }], { mode: 'replace' });
  });

  it('shift+alt drag → toggle mode (strip-activator default table)', () => {
    const map = fakeMap();
    const h = new BoxSelectHandler(map as any);
    h.enable();
    h.handlePointer(ev('down', 0, 0, true, true));
    h.handlePointer(ev('move', 50, 50, true, true));
    h.handlePointer(ev('up', 50, 50, true, true));
    expect(map.select).toHaveBeenCalledWith(expect.anything(), { mode: 'toggle' });
  });

  it('below drag threshold → no select, passthrough (click can proceed)', () => {
    const map = fakeMap();
    const h = new BoxSelectHandler(map as any);
    h.enable();
    h.handlePointer(ev('down', 10, 10, true));
    expect(h.handlePointer(ev('up', 11, 11, true))).toBe('passthrough');
    expect(map.select).not.toHaveBeenCalled();
  });

  it('disable() mid-drag cancels the gesture and hides overlay', () => {
    const map = fakeMap();
    const h = new BoxSelectHandler(map as any);
    h.enable();
    h.handlePointer(ev('down', 10, 10, true));
    h.disable();
    expect(h.handlePointer(ev('up', 99, 99, true))).toBe('passthrough');
    expect(map.select).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/handlers/box-select.test.ts`
Expected: FAIL — `Cannot find module './box-select'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/handlers/box-select.ts`:

```ts
import { EventDispatcher } from '../events';
import type { Handler, HandlerResult, NormalizedPointerEvent, PointerModifiers } from '../handler';
import { resolveMode, type ModifierCombo } from './select-mode';
import { dedupeRefs } from './select-geometry';
import type { SelectHandlerOptions } from './click-select';
import type { Emap } from '../../map/map';

export interface BoxSelectStyle { stroke?: string; strokeWidth?: number; fill?: string; }
export interface BoxSelectHandlerOptions extends SelectHandlerOptions {
  /** Min drag diagonal (px) before a release counts as a box. Default 4. */
  dragThreshold?: number;
  /** Combo that must be held at pointerdown to start. Default 'shift'. */
  dragActivator?: ModifierCombo;
  style?: BoxSelectStyle;
}

const BOX_DEFAULT_MODS = { replace: 'none', add: 'ctrl', toggle: 'alt' } as const;

/** True iff every key of `combo` is held (extra held keys allowed). */
function comboHeld(m: PointerModifiers, combo: ModifierCombo): boolean {
  if (combo === 'none') return true;
  return combo.split('+').every((k) => (m as any)[k] === true);
}

/**
 * Named `boxSelect` handler. Disabled by default. On `dragActivator`+down
 * it captures the gesture (`'exclusive'`), draws a rubber-band rectangle in
 * `_canvasContainer`, and on release past `dragThreshold` runs
 * `queryFeatures(bbox)` → `select(mode)`. Mode is resolved by stripping the
 * activator then matching `modifiers` — reproducing the legacy
 * `BoxSelectControl` behavior exactly. Mutually exclusive with `lassoSelect`
 * (enforced in HandlerManager — see Task 6).
 */
export class BoxSelectHandler extends EventDispatcher implements Handler<BoxSelectHandlerOptions> {
  readonly name = 'boxSelect';
  private _enabled = false;
  private _opts: BoxSelectHandlerOptions = {};
  private _start: { x: number; y: number } | null = null;
  private _overlay: HTMLDivElement | null = null;

  constructor(private _map: Emap) { super(); }

  enable(): void { this._enabled = true; }
  disable(): void {
    this._enabled = false;
    if (this._start) this._cancel();
  }
  isEnabled(): boolean { return this._enabled; }
  setOptions(opts: Partial<BoxSelectHandlerOptions>): void { this._opts = { ...this._opts, ...opts }; }
  getOptions(): Readonly<BoxSelectHandlerOptions> { return this._opts; }

  private get _threshold(): number { return this._opts.dragThreshold ?? 4; }
  private get _activator(): ModifierCombo { return this._opts.dragActivator ?? 'shift'; }

  private _ensureOverlay(): HTMLDivElement {
    if (this._overlay) return this._overlay;
    const o = document.createElement('div');
    o.className = 'emap-box-select';
    o.style.position = 'absolute';
    o.style.pointerEvents = 'none';
    o.style.display = 'none';
    o.style.boxSizing = 'border-box';
    const s = this._opts.style ?? {};
    o.style.border = `${s.strokeWidth ?? 1.5}px solid ${s.stroke ?? '#0078ff'}`;
    o.style.background = s.fill ?? 'rgba(0, 120, 255, 0.1)';
    this._map.getCanvasContainer().appendChild(o);
    this._overlay = o;
    return o;
  }

  private _cancel(): void {
    if (this._overlay) this._overlay.style.display = 'none';
    this._start = null;
  }

  handlePointer(ev: NormalizedPointerEvent): HandlerResult {
    if (!this._enabled) return 'passthrough';

    if (ev.kind === 'down') {
      if (ev.button !== 0 || !comboHeld(ev.modifiers, this._activator)) return 'passthrough';
      this._start = { x: ev.point.x, y: ev.point.y };
      const o = this._ensureOverlay();
      o.style.left = `${ev.point.x}px`;
      o.style.top = `${ev.point.y}px`;
      o.style.width = '0';
      o.style.height = '0';
      o.style.display = 'block';
      return 'exclusive';
    }

    if (ev.kind === 'move' && this._start) {
      const o = this._ensureOverlay();
      const left = Math.min(this._start.x, ev.point.x);
      const top = Math.min(this._start.y, ev.point.y);
      o.style.left = `${left}px`;
      o.style.top = `${top}px`;
      o.style.width = `${Math.abs(ev.point.x - this._start.x)}px`;
      o.style.height = `${Math.abs(ev.point.y - this._start.y)}px`;
      return 'exclusive';
    }

    if (ev.kind === 'up' && this._start) {
      const s = this._start;
      const { x: cx, y: cy } = ev.point;
      this._cancel(); // hides overlay, clears _start; releases the arbiter lock
      if (Math.hypot(cx - s.x, cy - s.y) < this._threshold) return 'passthrough';
      const x1 = Math.min(s.x, cx), y1 = Math.min(s.y, cy);
      const x2 = Math.max(s.x, cx), y2 = Math.max(s.y, cy);
      const hits = this._map.queryFeatures(
        [[x1, y1], [x2, y2]],
        this._opts.layers ? { layers: this._opts.layers } : undefined,
      );
      const mode = resolveMode(ev.modifiers, this._opts.modifiers ?? BOX_DEFAULT_MODS, this._activator);
      this._map.select(dedupeRefs(hits), { mode });
      return 'passthrough';
    }

    return 'passthrough';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/handlers/box-select.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/handlers/box-select.ts src/core/handlers/box-select.test.ts
git commit -m "feat(core): boxSelect handler (DX P2b)"
```

---

### Task 5: `lassoSelect` handler

**Files:**
- Create: `src/core/handlers/lasso-select.ts`
- Test: `src/core/handlers/lasso-select.test.ts`

Ports `lasso-select-control.ts`'s path-record + 2-stage refinement verbatim into `handlePointer`, reusing `select-geometry`.

- [ ] **Step 1: Write the failing test**

Create `src/core/handlers/lasso-select.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { LassoSelectHandler } from './lasso-select';
import type { NormalizedPointerEvent } from '../handler';
import * as geom from './select-geometry';

function ev(kind: NormalizedPointerEvent['kind'], x: number, y: number, shift = false): NormalizedPointerEvent {
  return {
    kind, point: { x, y },
    modifiers: { shift, ctrl: false, alt: false, meta: false },
    button: 0, originalEvent: new MouseEvent('pointerdown'),
  };
}
function fakeMap() {
  const c = document.createElement('div');
  return {
    getCanvasContainer: () => c,
    queryFeatures: vi.fn(() => [{ source: 's', layer: 'l', id: 1 }]),
    select: vi.fn(),
  };
}

describe('LassoSelectHandler', () => {
  it('name + disabled-by-default; shift+down disabled → passthrough', () => {
    const h = new LassoSelectHandler(fakeMap() as any);
    expect(h.name).toBe('lassoSelect');
    expect(h.isEnabled()).toBe(false);
    expect(h.handlePointer(ev('down', 0, 0, true))).toBe('passthrough');
  });

  it('shift+down → exclusive; multi-move builds path; up → bbox query + polygon refine + select', () => {
    const map = fakeMap();
    const spy = vi.spyOn(geom, 'featureMatchesLasso').mockReturnValue(true);
    const h = new LassoSelectHandler(map as any);
    h.enable();
    expect(h.handlePointer(ev('down', 0, 0, true))).toBe('exclusive');
    expect(h.handlePointer(ev('move', 0, 40, true))).toBe('exclusive');
    expect(h.handlePointer(ev('move', 40, 40, true))).toBe('exclusive');
    expect(h.handlePointer(ev('up', 40, 0, true))).toBe('passthrough');
    expect(map.queryFeatures).toHaveBeenCalledWith([[0, 0], [40, 40]], undefined);
    expect(map.select).toHaveBeenCalledWith([{ source: 's', layer: 'l', id: 1 }], { mode: 'replace' });
    spy.mockRestore();
  });

  it('path shorter than 3 points → no select, passthrough', () => {
    const map = fakeMap();
    const h = new LassoSelectHandler(map as any);
    h.enable();
    h.handlePointer(ev('down', 5, 5, true));
    expect(h.handlePointer(ev('up', 6, 6, true))).toBe('passthrough');
    expect(map.select).not.toHaveBeenCalled();
  });

  it('disable() mid-lasso cancels', () => {
    const map = fakeMap();
    const h = new LassoSelectHandler(map as any);
    h.enable();
    h.handlePointer(ev('down', 0, 0, true));
    h.handlePointer(ev('move', 0, 40, true));
    h.disable();
    expect(h.handlePointer(ev('up', 40, 40, true))).toBe('passthrough');
    expect(map.select).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/handlers/lasso-select.test.ts`
Expected: FAIL — `Cannot find module './lasso-select'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/handlers/lasso-select.ts`:

```ts
import { EventDispatcher } from '../events';
import type { Handler, HandlerResult, NormalizedPointerEvent, PointerModifiers } from '../handler';
import { resolveMode, type ModifierCombo } from './select-mode';
import { featureMatchesLasso, pathBBox } from './select-geometry';
import type { SelectHandlerOptions } from './click-select';
import type { FeatureRef } from '../../map/map';
import type { Emap } from '../../map/map';

export interface LassoStyle { stroke?: string; strokeWidth?: number; fill?: string; }
export interface LassoSelectHandlerOptions extends SelectHandlerOptions {
  dragThreshold?: number;
  dragActivator?: ModifierCombo;
  /** Loose hit (any part inside) vs strict containment. Default true. */
  includeIntersecting?: boolean;
  style?: LassoStyle;
}

const LASSO_DEFAULT_MODS = { replace: 'none', add: 'ctrl', toggle: 'alt' } as const;
const SVG_NS = 'http://www.w3.org/2000/svg';

function comboHeld(m: PointerModifiers, combo: ModifierCombo): boolean {
  if (combo === 'none') return true;
  return combo.split('+').every((k) => (m as any)[k] === true);
}

/**
 * Named `lassoSelect` handler. Disabled by default. `dragActivator`+down →
 * `'exclusive'`; each move appends to a pixel-space path drawn as an SVG
 * polyline in `_canvasContainer`; release closes the polygon, bbox-prefilters
 * via `queryFeatures`, then refines per-feature with the shared
 * `featureMatchesLasso`. Mutually exclusive with `boxSelect` (Task 6).
 */
export class LassoSelectHandler extends EventDispatcher implements Handler<LassoSelectHandlerOptions> {
  readonly name = 'lassoSelect';
  private _enabled = false;
  private _opts: LassoSelectHandlerOptions = {};
  private _path: Array<[number, number]> | null = null;
  private _svg: SVGSVGElement | null = null;
  private _poly: SVGPolylineElement | null = null;

  constructor(private _map: Emap) { super(); }

  enable(): void { this._enabled = true; }
  disable(): void {
    this._enabled = false;
    if (this._path) this._cancel();
  }
  isEnabled(): boolean { return this._enabled; }
  setOptions(opts: Partial<LassoSelectHandlerOptions>): void { this._opts = { ...this._opts, ...opts }; }
  getOptions(): Readonly<LassoSelectHandlerOptions> { return this._opts; }

  private get _threshold(): number { return this._opts.dragThreshold ?? 4; }
  private get _activator(): ModifierCombo { return this._opts.dragActivator ?? 'shift'; }

  private _ensureSvg(): { svg: SVGSVGElement; poly: SVGPolylineElement } {
    if (this._svg && this._poly) return { svg: this._svg, poly: this._poly };
    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    svg.style.position = 'absolute';
    svg.style.left = '0';
    svg.style.top = '0';
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.pointerEvents = 'none';
    svg.style.display = 'none';
    svg.setAttribute('class', 'emap-lasso-select');
    const poly = document.createElementNS(SVG_NS, 'polyline') as SVGPolylineElement;
    const s = this._opts.style ?? {};
    poly.setAttribute('fill', s.fill ?? 'rgba(0, 120, 255, 0.1)');
    poly.setAttribute('stroke', s.stroke ?? '#0078ff');
    poly.setAttribute('stroke-width', String(s.strokeWidth ?? 1.5));
    poly.setAttribute('points', '');
    svg.appendChild(poly);
    this._map.getCanvasContainer().appendChild(svg);
    this._svg = svg;
    this._poly = poly;
    return { svg, poly };
  }

  private _cancel(): void {
    if (this._svg) this._svg.style.display = 'none';
    this._path = null;
  }

  handlePointer(ev: NormalizedPointerEvent): HandlerResult {
    if (!this._enabled) return 'passthrough';

    if (ev.kind === 'down') {
      if (ev.button !== 0 || !comboHeld(ev.modifiers, this._activator)) return 'passthrough';
      const { svg, poly } = this._ensureSvg();
      this._path = [[ev.point.x, ev.point.y]];
      poly.setAttribute('points', `${ev.point.x},${ev.point.y}`);
      svg.style.display = 'block';
      return 'exclusive';
    }

    if (ev.kind === 'move' && this._path) {
      this._path.push([ev.point.x, ev.point.y]);
      this._poly?.setAttribute('points', this._path.map((p) => `${p[0]},${p[1]}`).join(' '));
      return 'exclusive';
    }

    if (ev.kind === 'up' && this._path) {
      const path = this._path;
      this._cancel();
      if (path.length < 3) return 'passthrough';
      const bbox = pathBBox(path);
      if (Math.hypot(bbox[2] - bbox[0], bbox[3] - bbox[1]) < this._threshold) return 'passthrough';
      const closed = path.slice();
      closed.push(path[0]);
      const candidates = this._map.queryFeatures(
        [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
        this._opts.layers ? { layers: this._opts.layers } : undefined,
      );
      const includeIntersecting = this._opts.includeIntersecting !== false;
      const refs: FeatureRef[] = [];
      const seen = new Set<string>();
      for (const f of candidates) {
        const key = `${f.source}|${f.layer}|${f.id}`;
        if (seen.has(key)) continue;
        if (!featureMatchesLasso(this._map, f, closed, includeIntersecting)) continue;
        seen.add(key);
        refs.push({ source: f.source, layer: f.layer, id: f.id });
      }
      const mode = resolveMode(ev.modifiers, this._opts.modifiers ?? LASSO_DEFAULT_MODS, this._activator);
      this._map.select(refs, { mode });
      return 'passthrough';
    }

    return 'passthrough';
  }
}
```

> NOTE: confirm the exact `featureMatchesLasso` signature against `select-geometry.ts` (it takes `(map, ref, lasso, includeIntersecting)` per the verbatim move in Task 2). If `FeatureRef` is not exported from `../../map/map`, import it from wherever `box-select-control.ts` imported it (verify the original import line) and use that path.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/handlers/lasso-select.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/handlers/lasso-select.ts src/core/handlers/lasso-select.test.ts
git commit -m "feat(core): lassoSelect handler (DX P2b)"
```

---

### Task 6: box/lasso mutual-exclusion conflict rule

**Files:**
- Modify: `src/core/handler-manager.ts`
- Modify: `src/core/handlers/box-select.ts`
- Modify: `src/core/handlers/lasso-select.ts`
- Test: `src/core/handlers/select-conflict.test.ts` (new)

`boxSelect` and `lassoSelect` both consume `shift`+drag. Enabling one while the other is enabled must throw explicitly (validation-style), not silently shadow.

- [ ] **Step 1: Write the failing test**

Create `src/core/handlers/select-conflict.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { HandlerManager } from '../handler-manager';
import { BoxSelectHandler } from './box-select';
import { LassoSelectHandler } from './lasso-select';

function fakeMap() {
  const c = document.createElement('div');
  return { getCanvasContainer: () => c, queryFeatures: () => [], select: () => {} };
}

describe('box/lasso mutual exclusion', () => {
  it('enabling lasso while box is enabled throws', () => {
    const m = new HandlerManager();
    const box = new BoxSelectHandler(fakeMap() as any);
    const lasso = new LassoSelectHandler(fakeMap() as any);
    m.register(box); m.register(lasso);
    box.enable();
    expect(() => lasso.enable()).toThrow(/boxSelect.*enabled|cannot enable lassoSelect/i);
  });

  it('enabling box while lasso is enabled throws', () => {
    const m = new HandlerManager();
    const box = new BoxSelectHandler(fakeMap() as any);
    const lasso = new LassoSelectHandler(fakeMap() as any);
    m.register(box); m.register(lasso);
    lasso.enable();
    expect(() => box.enable()).toThrow(/lassoSelect.*enabled|cannot enable boxSelect/i);
  });

  it('the two are usable independently when the other is disabled', () => {
    const m = new HandlerManager();
    const box = new BoxSelectHandler(fakeMap() as any);
    const lasso = new LassoSelectHandler(fakeMap() as any);
    m.register(box); m.register(lasso);
    box.enable(); box.disable();
    expect(() => lasso.enable()).not.toThrow();
  });

  it('a handler not registered in any manager can still enable (no manager → no conflict)', () => {
    const box = new BoxSelectHandler(fakeMap() as any);
    expect(() => box.enable()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/handlers/select-conflict.test.ts`
Expected: FAIL — no conflict thrown.

- [ ] **Step 3: Implementation**

(a) In `src/core/handler-manager.ts`, add a back-reference on register so a handler can query its siblings, and a typed lookup:

```ts
  /** Set on register so a handler can consult siblings (e.g. box↔lasso conflict). */
  // add inside register(handler), after the existing this._handlers.set(...) line:
  //   (handler as { _manager?: HandlerManager })._manager = this;

  /** Is a sibling handler currently registered AND enabled? */
  isEnabledByName(name: string): boolean {
    const h = this._handlers.get(name);
    return !!h && h.isEnabled();
  }
```
Concretely: in `register(handler)`, after the map `set`, add:
```ts
    (handler as unknown as { _manager?: HandlerManager })._manager = this;
```
and add the `isEnabledByName` method to the class.

(b) Add a shared guard. In BOTH `box-select.ts` and `lasso-select.ts`, add the back-ref field and gate `enable()`:

box-select.ts:
```ts
  /** Set by HandlerManager.register. */
  _manager?: { isEnabledByName(name: string): boolean };

  enable(): void {
    if (this._manager?.isEnabledByName('lassoSelect')) {
      throw new Error('cannot enable boxSelect: lassoSelect is enabled (both consume shift+drag); disable it first');
    }
    this._enabled = true;
  }
```
lasso-select.ts (symmetric):
```ts
  _manager?: { isEnabledByName(name: string): boolean };

  enable(): void {
    if (this._manager?.isEnabledByName('boxSelect')) {
      throw new Error('cannot enable lassoSelect: boxSelect is enabled (both consume shift+drag); disable it first');
    }
    this._enabled = true;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/handlers/select-conflict.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: GATE**

Run: `npx tsc --noEmit` (exit 0) AND `npx vitest run` (all green; the new `_manager` field must not break P2a `handler-manager.test.ts` or `index.test.ts`).

- [ ] **Step 6: Commit**

```bash
git add src/core/handler-manager.ts src/core/handlers/box-select.ts src/core/handlers/lasso-select.ts src/core/handlers/select-conflict.test.ts
git commit -m "feat(core): box/lasso mutual-exclusion conflict rule (DX P2b)"
```

---

### Task 7: Wire selection handlers into Emap + public exports

**Files:**
- Modify: `src/map/map.ts`
- Modify: `src/index.ts`
- Test: `src/map/handler-registry.test.ts` (append e2e cases)

- [ ] **Step 1: Write the failing test**

Append inside the existing top `describe` in `src/map/handler-registry.test.ts` (reuse its `container()` + canvas-2d `beforeAll`):

```ts
  it('exposes disabled-by-default selection handlers', () => {
    const map = new Emap({ container: container() });
    expect(map.clickSelect.name).toBe('clickSelect');
    expect(map.boxSelect.name).toBe('boxSelect');
    expect(map.lassoSelect.name).toBe('lassoSelect');
    expect(map.clickSelect.isEnabled()).toBe(false);
    expect(map.boxSelect.isEnabled()).toBe(false);
    expect(map.lassoSelect.isEnabled()).toBe(false);
  });

  it('shift+drag with boxSelect enabled selects via the arbiter (not pan)', () => {
    const el = container();
    const map = new Emap({ container: el });
    const canvas = map.getCanvasContainer();
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} });
    map.boxSelect.enable();
    const before = map.getCenter();
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 50, clientY: 50, button: 0, shiftKey: true }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 200, clientY: 200, button: 0, shiftKey: true }));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 200, clientY: 200, button: 0, shiftKey: true }));
    // pan must NOT have happened — boxSelect took the exclusive gesture
    expect(map.getCenter()[0]).toBe(before[0]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/map/handler-registry.test.ts -t "selection handlers"`
Expected: FAIL — `map.clickSelect` undefined.

- [ ] **Step 3: Implementation**

In `src/map/map.ts`:

(a) Imports (near the existing `import { DragPanHandler } from '../core/handlers/drag-pan';`):
```ts
import { ClickSelectHandler, type SelectHandlerOptions } from '../core/handlers/click-select';
import { BoxSelectHandler, type BoxSelectHandlerOptions } from '../core/handlers/box-select';
import { LassoSelectHandler, type LassoSelectHandlerOptions } from '../core/handlers/lasso-select';
```

(b) Fields (beside `private _dragPan: DragPanHandler;`):
```ts
  private _clickSelect: ClickSelectHandler;
  private _boxSelect: BoxSelectHandler;
  private _lassoSelect: LassoSelectHandler;
```

(c) Construct + register them disabled, AFTER the existing `this._handlers.register(this._scrollZoom);` and BEFORE `this._handlers.attach(this._canvasContainer);` (so they participate in the same single attach):
```ts
    this._clickSelect = new ClickSelectHandler(this);
    this._boxSelect = new BoxSelectHandler(this);
    this._lassoSelect = new LassoSelectHandler(this);
    this._handlers.register(this._clickSelect);
    this._handlers.register(this._boxSelect);
    this._handlers.register(this._lassoSelect);
```
(They default to `_enabled = false`; `applyInteractive(false)` already only toggles, so no change there. The arbiter's `PRIORITY` already orders them ahead of `dragPan`.)

(d) Getters (beside `get dragPan()` / `get scrollZoom()` ~L838):
```ts
  get clickSelect(): Handler<SelectHandlerOptions> { return this._clickSelect; }
  get boxSelect(): Handler<BoxSelectHandlerOptions> { return this._boxSelect; }
  get lassoSelect(): Handler<LassoSelectHandlerOptions> { return this._lassoSelect; }
```
(Verify `Handler` is already imported in map.ts from P1/P2a — it is, used by the `dragPan` getter. `SelectHandlerOptions` etc. import added in (a).)

In `src/index.ts` add explicit named exports (no `export *`):
```ts
export { ClickSelectHandler } from './core/handlers/click-select';
export type { SelectHandlerOptions } from './core/handlers/click-select';
export { BoxSelectHandler } from './core/handlers/box-select';
export type { BoxSelectHandlerOptions, BoxSelectStyle } from './core/handlers/box-select';
export { LassoSelectHandler } from './core/handlers/lasso-select';
export type { LassoSelectHandlerOptions, LassoStyle } from './core/handlers/lasso-select';
export { resolveMode } from './core/handlers/select-mode';
export type { SelectMode, ModifierCombo } from './core/handlers/select-mode';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/map/handler-registry.test.ts`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: GATE — no default behavior change**

Run: `npx tsc --noEmit` (exit 0) AND `npx vitest run` AND `npm run build` (exit 0).
**`src/map/map.test.ts` pan/zoom/interactive/edit-mode tests MUST still pass byte-identically** — selectors are disabled by default so the default path is unchanged. If any pan/zoom test fails, STOP and report BLOCKED (a disabled handler must never affect dispatch).

- [ ] **Step 6: Commit**

```bash
git add src/map/map.ts src/index.ts src/map/handler-registry.test.ts
git commit -m "feat(map): expose clickSelect/boxSelect/lassoSelect handlers (DX P2b)"
```

---

### Task 8: CHANGELOG

**Files:** Modify `CHANGELOG.md` (`[Unreleased]` → existing `### Added`).

- [ ] **Step 1: Add after the Phase-2a bullet**

```markdown
- DX Phase 2b (toward 0.3.0): three opt-in named selection handlers —
  `map.clickSelect`, `map.boxSelect`, `map.lassoSelect` (each a `Handler`
  with `enable/disable/isEnabled/setOptions/getOptions`). Driven by the
  Phase-2a pointer arbiter; `box`/`lasso` sit above `dragPan` so
  `shift`+drag selects (when enabled) instead of panning, with no
  `addControl` needed. Shared pure `resolveMode` (configurable
  modifier→`SelectMode` table) and a shared `select-geometry` module
  replace the duplicated private `_modeFromEvent`. `boxSelect` and
  `lassoSelect` are mutually exclusive (`enable()` throws if the other is
  on). Disabled by default → `new Emap()` behavior is unchanged; the
  legacy `BoxSelectControl`/`LassoSelectControl` keep working unchanged
  (thin-shell rewrite is Phase 2c).
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: CHANGELOG for DX Phase 2b selection handlers"
```

---

## Self-Review

**1. Spec coverage (design spec §4):** `clickSelect`/`boxSelect`/`lassoSelect` → Tasks 3/4/5. `SelectHandlerOptions` shape (`layers`/`source`/`modifiers`) → Task 3 (shared base). `dragActivator` (box/lasso, default `'shift'`) + `dragThreshold` (default 4) + `includeIntersecting` (lasso, default true) → Tasks 4/5. Shared pure `resolveMode` replacing duplicated `_modeFromEvent` → Task 1, consumed by 3/4/5. `dragActivator` vs `modifiers` composition = strip-activator-then-match (user-confirmed) → Task 1 `resolveMode(…, activator)`, reproducing legacy box behavior exactly (test asserts the 4 chords). box↔lasso mutual exclusion, explicit throw → Task 6. Exposure as read-only `Handler` on `Emap` (`map.clickSelect/boxSelect/lassoSelect`) → Task 7. Overlay DOM in `_canvasContainer`, `.emap-box-select`/`.emap-lasso-select` classes retained → Tasks 4/5. Controls-as-thin-shells is explicitly **out of scope** (P2c) and stated in the header + Task 2 (controls only re-point imports, behavior byte-identical). `feature:*` events are §5/P3 — not here. CSS theming is §6/P4 — not here. No §4 selection-handler requirement unmapped.

**2. Placeholder scan:** No TBD/TODO. Two "verbatim move" tasks (2) reference exact symbol names + source files; this is a faithful refactor instruction, not a placeholder (the engineer cuts/pastes named, existing code and the GATE proves byte-identical behavior). Every new-logic step (1,3,4,5,6,7) contains complete code. Two NOTE callouts ask the engineer to verify an import path/signature against the just-moved module — that is a correctness check on a verbatim move, not deferred design.

**3. Type consistency:** `SelectMode`/`ModifierCombo` defined in Task 1, imported unchanged by 3/4/5/7. `SelectHandlerOptions` defined in Task 3, `extends`-ed by `BoxSelectHandlerOptions`/`LassoSelectHandlerOptions` (Tasks 4/5), re-exported in Task 7 — consistent. `Handler<Opts>`/`NormalizedPointerEvent`/`PointerModifiers` are the P1/P2a types from `src/core/handler.ts`, used identically. `resolveMode(modifiers, table, activator?)` signature identical across definition (1) and all call sites (3/4/5). `dedupeRefs`/`featureMatchesLasso`/`pathBBox` signatures preserved by the verbatim move (Task 2) and used with those exact signatures in 3/4/5. `getCanvasContainer()` is the existing public accessor (map.ts ~L320) used for overlay mounting. `_manager` back-ref typed structurally and set in `register` (Task 6) — consistent between manager and both handlers. `select(refs,{mode})` / `queryFeatures([x,y] | [[x1,y1],[x2,y2]], {layers})` match the real `Emap` signatures verified in source. Disabled-by-default (`_enabled=false`) is consistent across all three handlers and asserted in Task 7's GATE that the default path is unchanged.

Plan is internally consistent and scoped to one shippable unit: opt-in selection handlers with zero default-path behavior change and zero change to the legacy controls' behavior.
