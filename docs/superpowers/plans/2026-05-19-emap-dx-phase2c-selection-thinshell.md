# Selection-control thin-shell + type consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `BoxSelectControl`/`LassoSelectControl` as thin shells over the P2b `map.boxSelect`/`map.lassoSelect` handlers, and consolidate the duplicated `SelectMode`/`BoxSelectStyle`/lasso-style types to canonical homes with re-export shims — byte-identical public API + visual behavior.

**Architecture:** Each control becomes a `Control` that, on `onAdd`, grabs the Emap-owned handler (`map.boxSelect`/`map.lassoSelect`), forwards mapped options via `setOptions`, enables it if the control is enabled, and returns the same 0×0 anchor; `enable/disable/isEnabled` proxy to the handler; `onRemove` disables it. Types get one canonical declaration each; all public import paths preserved by `export type ... from` shims. `LassoSelectHandler` is extended to honor `strokeDasharray` so the dashed lasso stays visually identical.

**Tech Stack:** TypeScript 5 (strict), Vitest 1.x (jsdom), Rollup. Spec: `docs/superpowers/specs/2026-05-19-emap-dx-phase2c-selection-thinshell-design.md`.

**Conventions:** No `Co-Authored-By` trailers. Plain `git` only (no `-c core.hooksPath`, no `--no-verify`). OpenSpec skipped (P1–P11 precedent). `package.json` stays `0.2.0`. Ignore GitNexus/Rust-skills hook output.

**Baseline:** `npx tsc --noEmit` exit 0; `npm run build` exit 0; full suite green (run `npx vitest run 2>&1 | tail -3` first and record the number). Work on `master` (authorized; push when the user asks).

**Verified facts:**
- Emap exposes `get boxSelect(): Handler<BoxSelectHandlerOptions>` and `get lassoSelect(): Handler<LassoSelectHandlerOptions>` (`src/map/map.ts:1014,1016`); both are constructed + registered in the Emap ctor.
- `BoxSelectHandlerOptions` (`src/core/handlers/box-select.ts`) extends `SelectHandlerOptions` (`{ layers? }`) and adds `dragThreshold?`, `dragActivator?`, `style?: BoxSelectStyle`. `BoxSelectHandler` already builds the `.emap-box-select` overlay, runs the gesture via the arbiter, and on release does `queryFeatures(bbox)` → dedupe → `select(mode)` reproducing the legacy modifier table.
- `LassoSelectHandlerOptions` adds `dragThreshold?`, `dragActivator?`, `includeIntersecting?`, `style?: LassoStyle`. `LassoSelectHandler._ensureSvg` sets fill/stroke/stroke-width on its `.emap-lasso-select` polyline but **NOT** `stroke-dasharray`.
- `SelectMode` is declared identically at `src/core/handlers/select-mode.ts:4` and `src/map/selection.ts:4`. `select-mode.ts` only imports `type PointerModifiers from '../handler'` (a leaf — safe canonical). `index.ts:86` exports `SelectMode` from `./map/selection`; `src/map/map.ts:38` imports it from `./selection`; `click-select.ts:3` imports from `./select-mode`.
- `BoxSelectStyle` declared at `ui/box-select-control.ts:6` (JSDoc'd) and `core/handlers/box-select.ts:8` (terse, same `{stroke?,strokeWidth?,fill?}` shape). `index.ts:310` exports it from box-select-control.
- Lasso style: `ui/lasso-select-control.ts:8` `LassoSelectStyle` = `{stroke?,strokeWidth?,fill?,strokeDasharray?}` (public via `index.ts:316`); `core/handlers/lasso-select.ts:8` `LassoStyle` = `{stroke?,strokeWidth?,fill?}` (public via `index.ts:203`).
- `lasso-select-control.ts:5` has `export { pointInPolygon, featureMatchesLasso } from '../core/handlers/select-geometry';` — a public re-export that MUST be preserved.
- `DrawGeometryType` is single-source (`core/handlers/draw-feature.ts:7`) — untouched (out of scope).

---

### Task 1: Type consolidation + type-path regression test

**Files:**
- Modify: `src/core/handlers/select-mode.ts` (canonical `SelectMode` — already there, no change to the decl itself), `src/map/selection.ts` (re-export), `src/core/handlers/box-select.ts` (carry JSDoc), `src/ui/box-select-control.ts` (re-export `BoxSelectStyle`), `src/core/handlers/lasso-select.ts` (canonical 4-field `LassoSelectStyle` + `LassoStyle` alias + honor it in options type), `src/ui/lasso-select-control.ts` (re-export `LassoSelectStyle`)
- Create: `src/ui/selection-types.test-d.ts`

- [ ] **Step 1: Write the failing type-path test `src/ui/selection-types.test-d.ts`**

`*.test-d.ts` is type-checked by `tsc` (tsconfig excludes only `*.test.ts`/`*.test.tsx`) and not run by Vitest.

```ts
// Type-path regression for P2c consolidation. Checked by `tsc --noEmit`.
import type { SelectMode } from '../map/selection';
import type { SelectMode as SelectModeHandler } from '../core/handlers/select-mode';
import type { BoxSelectStyle } from './box-select-control';
import type { BoxSelectStyle as BoxSelectStyleHandler } from '../core/handlers/box-select';
import type { LassoSelectStyle } from './lasso-select-control';
import type { LassoStyle } from '../core/handlers/lasso-select';
import type { LassoSelectStyle as LassoSelectStyleHandler } from '../core/handlers/lasso-select';

// Same nominal type across both public paths (assignable both ways).
const a: SelectMode = 'replace' as SelectModeHandler;
const b: SelectModeHandler = a;
const c: BoxSelectStyle = {} as BoxSelectStyleHandler;
const d: BoxSelectStyleHandler = c;
// LassoStyle is now the 4-field superset and structurally accepts strokeDasharray.
const e: LassoStyle = { stroke: '#000', strokeWidth: 2, fill: 'red', strokeDasharray: '4 3' };
const f: LassoSelectStyle = e;
const g: LassoSelectStyleHandler = f;
void a; void b; void c; void d; void e; void f; void g;
```

- [ ] **Step 2: Run `tsc` to verify it FAILS**

Run: `npx tsc --noEmit`
Expected: FAIL — `LassoStyle` does not yet have `strokeDasharray` (the `e` literal errors: "Object literal may only specify known properties, 'strokeDasharray'"), and `BoxSelectStyle` from box-select-control vs handler are two separate declarations (assignable structurally, so those lines may pass) — the `strokeDasharray` line is the guaranteed RED. Confirm a non-zero exit.

- [ ] **Step 3: Make `SelectMode` canonical in `select-mode.ts`, re-export from `selection.ts`**

`src/core/handlers/select-mode.ts:4` already declares `export type SelectMode = 'replace' | 'add' | 'toggle';` — leave it (this is the canonical).

In `src/map/selection.ts` find:

```ts
/** Mutation modes for {@link Selection.apply}. */
export type SelectMode = 'replace' | 'add' | 'toggle';
```

Replace with:

```ts
/** Mutation modes for {@link Selection.apply}. Canonical declaration lives
 *  in `core/handlers/select-mode.ts`; re-exported here for back-compat
 *  (the public `@/map/selection` path is unchanged). */
export type { SelectMode } from '../core/handlers/select-mode';
```

(`src/map/map.ts:38` does `import { Selection, SelectMode, SelectionDiff } from './selection';` — `SelectMode` is type-only there; with `isolatedModules` set but NOT `verbatimModuleSyntax`, a re-exported type imported in a value-position import is fine. If `tsc` complains, change that one line in `map.ts` to `import { Selection, type SelectMode, SelectionDiff }`. Read `map.ts:38` and apply that narrowing only if `tsc` errors.)

- [ ] **Step 4: Make `BoxSelectStyle` canonical in the handler, re-export from the control**

In `src/core/handlers/box-select.ts` find:

```ts
export interface BoxSelectStyle { stroke?: string; strokeWidth?: number; fill?: string; }
```

Replace with (carry the JSDoc from the control):

```ts
/** Visual style for the rubber-band rectangle. */
export interface BoxSelectStyle {
  /** Stroke color. Default `'#0078ff'`. */
  stroke?: string;
  /** Stroke width in CSS pixels. Default `1.5`. */
  strokeWidth?: number;
  /** Fill color. Default `'rgba(0, 120, 255, 0.1)'`. */
  fill?: string;
}
```

In `src/ui/box-select-control.ts` find the local declaration:

```ts
/** Visual style for the rubber-band rectangle. */
export interface BoxSelectStyle {
  /** Stroke color. Default `'#0078ff'`. */
  stroke?: string;
  /** Stroke width in CSS pixels. Default `1.5`. */
  strokeWidth?: number;
  /** Fill color. Default `'rgba(0, 120, 255, 0.1)'`. */
  fill?: string;
}
```

Replace with:

```ts
export type { BoxSelectStyle } from '../core/handlers/box-select';
```

(`BoxSelectControlOptions` in that file references `BoxSelectStyle` — the re-export keeps it in scope. Task 3 rewrites the rest of this file anyway.)

- [ ] **Step 5: Make the 4-field `LassoSelectStyle` canonical in the handler, alias `LassoStyle`, re-export from the control**

In `src/core/handlers/lasso-select.ts` find:

```ts
export interface LassoStyle { stroke?: string; strokeWidth?: number; fill?: string; }
```

Replace with:

```ts
/** Visual style for the rubber-band lasso path. */
export interface LassoSelectStyle {
  /** Stroke color. Default `'#0078ff'`. */
  stroke?: string;
  /** Stroke width in CSS pixels. Default `1.5`. */
  strokeWidth?: number;
  /** Fill color of the closed shape preview. Default `'rgba(0, 120, 255, 0.1)'`. */
  fill?: string;
  /** SVG `stroke-dasharray`. Default `'4 3'` (subtly dashed). */
  strokeDasharray?: string;
}
/** Back-compat alias — historically the handler-side name. */
export type LassoStyle = LassoSelectStyle;
```

Then in the same file find the options interface line that uses it:

```ts
  style?: LassoStyle;
```

Replace with:

```ts
  style?: LassoSelectStyle;
```

In `src/ui/lasso-select-control.ts` find the local declaration:

```ts
/** Visual style for the rubber-band lasso path. */
export interface LassoSelectStyle {
  /** Stroke color. Default `'#0078ff'`. */
  stroke?: string;
  /** Stroke width in CSS pixels. Default `1.5`. */
  strokeWidth?: number;
  /** Fill color of the closed shape preview. Default `'rgba(0, 120, 255, 0.1)'`. */
  fill?: string;
  /** SVG `stroke-dasharray` value. Default `'4 3'` (subtly dashed). */
  strokeDasharray?: string;
}
```

Replace with:

```ts
export type { LassoSelectStyle } from '../core/handlers/lasso-select';
```

(`index.ts:203` exports `LassoStyle` from `./core/handlers/lasso-select` — now an alias, still resolves. `index.ts:316` exports `LassoSelectStyle` from `./ui/lasso-select-control` — now a re-export, still resolves. Task 4 rewrites the rest of this file.)

- [ ] **Step 6: Run `tsc` — verify it PASSES**

Run: `npx tsc --noEmit`
Expected: exit 0. `LassoStyle` now has `strokeDasharray`; both `SelectMode` paths resolve to the one canonical; `BoxSelectStyle` single declaration.

- [ ] **Step 7: Full suite (no behavior change yet)**

Run: `npx vitest run 2>&1 | tail -3`
Expected: all pass; same count as the recorded baseline (type-only change).

- [ ] **Step 8: Commit**

```bash
git add src/core/handlers/select-mode.ts src/map/selection.ts src/core/handlers/box-select.ts src/ui/box-select-control.ts src/core/handlers/lasso-select.ts src/ui/lasso-select-control.ts src/ui/selection-types.test-d.ts
git commit -m "refactor(types): consolidate SelectMode/BoxSelectStyle/LassoStyle to canonical homes (DX P2c)"
```

(`git add -p`-level note: `select-mode.ts` may have no diff — that's fine, it's the canonical and unchanged; drop it from `git add` if `git status` shows it unmodified.)

---

### Task 2: LassoSelectHandler honors `strokeDasharray`

**Files:**
- Modify: `src/core/handlers/lasso-select.ts` (`_ensureSvg`)
- Test: `src/core/handlers/lasso-select.test.ts` (extend)

- [ ] **Step 1: Write the failing test** — append to `src/core/handlers/lasso-select.test.ts`

First READ the top of `src/core/handlers/lasso-select.test.ts` to match its imports + how it constructs `LassoSelectHandler` + obtains the SVG polyline (it likely drives a gesture through the handler and inspects `_canvasContainer`). Mirror that exact construction. Append a `describe` that enables the handler, triggers the gesture-start so `_ensureSvg` runs, and asserts the polyline's `stroke-dasharray`:

```ts
describe('LassoSelectHandler stroke-dasharray (DX P2c)', () => {
  it('applies default dasharray "4 3", overridable via style', () => {
    // Construct + enable EXACTLY as the existing tests in this file do,
    // then start a drag so _ensureSvg() builds the polyline. Reuse this
    // file's existing helper/mocks; replace the two marked lines.
    const { handler, container } = /* existing setup from this file */;
    handler.enable();
    /* dispatch the activator+down via the same path existing tests use */;
    const poly = container.querySelector('polyline') as SVGPolylineElement;
    expect(poly.getAttribute('stroke-dasharray')).toBe('4 3');

    const h2 = /* construct another handler the same way */;
    h2.setOptions({ style: { strokeDasharray: '8 2' } });
    h2.enable();
    /* start its drag */;
    const poly2 = container.querySelector('polyline:last-of-type') as SVGPolylineElement;
    expect(poly2.getAttribute('stroke-dasharray')).toBe('8 2');
  });
});
```

You MUST replace the `/* ... */` markers with the real construction/gesture sequence copied verbatim from an existing passing test in the same file (do not invent mocks). If isolating two handlers in one container is awkward, split into two `it()`s each with its own fresh setup.

- [ ] **Step 2: Run — verify FAIL**

Run: `npx vitest run src/core/handlers/lasso-select.test.ts 2>&1 | tail -8`
Expected: FAIL — `poly.getAttribute('stroke-dasharray')` is `null` (handler does not set it yet).

- [ ] **Step 3: Apply `stroke-dasharray` in `_ensureSvg`**

In `src/core/handlers/lasso-select.ts` find:

```ts
    poly.setAttribute('fill', s.fill ?? 'rgba(0, 120, 255, 0.1)');
    poly.setAttribute('stroke', s.stroke ?? '#0078ff');
    poly.setAttribute('stroke-width', String(s.strokeWidth ?? 1.5));
    poly.setAttribute('points', '');
```

Replace with:

```ts
    poly.setAttribute('fill', s.fill ?? 'rgba(0, 120, 255, 0.1)');
    poly.setAttribute('stroke', s.stroke ?? '#0078ff');
    poly.setAttribute('stroke-width', String(s.strokeWidth ?? 1.5));
    poly.setAttribute('stroke-dasharray', s.strokeDasharray ?? '4 3');
    poly.setAttribute('points', '');
```

- [ ] **Step 4: Run — verify PASS**

Run: `npx vitest run src/core/handlers/lasso-select.test.ts 2>&1 | tail -8`
Expected: PASS (new dasharray cases + all pre-existing lasso-handler tests).

- [ ] **Step 5: tsc + full suite**

Run: `npx tsc --noEmit` → exit 0.
Run: `npx vitest run 2>&1 | tail -3` → all pass; report exact counts.

- [ ] **Step 6: Commit**

```bash
git add src/core/handlers/lasso-select.ts src/core/handlers/lasso-select.test.ts
git commit -m "feat(handlers): LassoSelectHandler honors strokeDasharray (default '4 3') (DX P2c)"
```

---

### Task 3: BoxSelectControl thin-shell + delegation tests

**Files:**
- Modify (full rewrite): `src/ui/box-select-control.ts`
- Modify (full rewrite): `src/ui/box-select-control.test.ts`

- [ ] **Step 1: Replace `src/ui/box-select-control.test.ts` with delegation tests**

The legacy tests drove the control's own `mousedown`; the drag behavior is now the handler's (covered by `box-select.test.ts`). New file content (exactly):

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BoxSelectControl } from './box-select-control';

/** Minimal stub of the Emap boxSelect handler + getter. */
function makeMap() {
  const handler = {
    enable: vi.fn(),
    disable: vi.fn(),
    isEnabled: vi.fn(() => false),
    setOptions: vi.fn(),
    getOptions: vi.fn(() => ({})),
  };
  const map = { get boxSelect() { return handler; } };
  return { map, handler };
}

describe('BoxSelectControl (thin shell, DX P2c)', () => {
  let map: ReturnType<typeof makeMap>['map'];
  let handler: ReturnType<typeof makeMap>['handler'];

  beforeEach(() => {
    const m = makeMap();
    map = m.map;
    handler = m.handler;
  });

  it('onAdd forwards options to map.boxSelect.setOptions and enables it', () => {
    const c = new BoxSelectControl({ layers: ['a'], dragThreshold: 7, style: { stroke: '#f00' } });
    const anchor = c.onAdd(map as any);
    expect(handler.setOptions).toHaveBeenCalledWith({
      layers: ['a'], dragThreshold: 7, style: { stroke: '#f00' },
    });
    expect(handler.enable).toHaveBeenCalledTimes(1);
    expect(anchor.className).toBe('emap-ctrl emap-box-select-anchor');
    expect(anchor.style.width).toBe('0px');
  });

  it('onAdd with no options forwards an object with undefined fields, still enables', () => {
    const c = new BoxSelectControl();
    c.onAdd(map as any);
    expect(handler.setOptions).toHaveBeenCalledWith({
      layers: undefined, dragThreshold: undefined, style: undefined,
    });
    expect(handler.enable).toHaveBeenCalledTimes(1);
  });

  it('enable/disable/isEnabled proxy to the handler', () => {
    const c = new BoxSelectControl();
    c.onAdd(map as any);
    c.disable();
    expect(handler.disable).toHaveBeenCalledTimes(1);
    c.enable();
    expect(handler.enable).toHaveBeenCalledTimes(2); // once in onAdd, once here
    handler.isEnabled.mockReturnValue(true);
    expect(c.isEnabled()).toBe(true);
  });

  it('a disabled control does not enable the handler on onAdd', () => {
    const c = new BoxSelectControl();
    c.disable();                 // before onAdd
    c.onAdd(map as any);
    expect(handler.enable).not.toHaveBeenCalled();
    expect(handler.setOptions).toHaveBeenCalledTimes(1); // options still forwarded
  });

  it('onRemove disables the handler and removes the anchor', () => {
    const c = new BoxSelectControl();
    const anchor = c.onAdd(map as any);
    document.body.appendChild(anchor);
    c.onRemove();
    expect(handler.disable).toHaveBeenCalledTimes(1);
    expect(anchor.parentNode).toBeNull();
  });

  it('propagates the handler mutual-exclusivity throw from enable()', () => {
    handler.enable.mockImplementation(() => { throw new Error('cannot enable boxSelect: lassoSelect is enabled'); });
    const c = new BoxSelectControl();
    expect(() => c.onAdd(map as any)).toThrow(/lassoSelect is enabled/);
  });
});
```

- [ ] **Step 2: Run — verify FAIL**

Run: `npx vitest run src/ui/box-select-control.test.ts 2>&1 | tail -8`
Expected: FAIL — current `BoxSelectControl` has no `map.boxSelect` delegation; `setOptions`/`enable` not called, anchor className differs (current is `emap-ctrl emap-box-select-anchor` — that part may pass — but the delegation expectations fail).

- [ ] **Step 3: Replace `src/ui/box-select-control.ts` with the thin shell**

Entire new file content:

```ts
import type { Control } from './control';
import type { Emap } from '../map/map';
import type { BoxSelectHandlerOptions } from '../core/handlers/box-select';

export type { BoxSelectStyle } from '../core/handlers/box-select';
import type { BoxSelectStyle } from '../core/handlers/box-select';

export interface BoxSelectControlOptions {
  /**
   * Restrict the selection to a subset of layer ids. When omitted, every
   * visible layer participates (matching `queryFeatures` default).
   */
  layers?: string[];
  /** Visual style of the rubber-band rectangle. */
  style?: BoxSelectStyle;
  /**
   * Pixel diagonal threshold below which the drag is treated as no-op.
   * Default `4`.
   */
  dragThreshold?: number;
}

/**
 * Thin shell over the `map.boxSelect` handler (DX P2c). The handler owns
 * the shift+drag gesture, the `.emap-box-select` rubber-band overlay,
 * hit-testing, and selection; this control just forwards options and
 * proxies enable/disable, returning a 0×0 anchor for `addControl`
 * placement. Public class, options, anchor DOM, and selection behaviour
 * are unchanged from the pre-P2c control.
 *
 * Modifier conventions (on top of shift): shift→`replace`,
 * shift+ctrl/meta→`add`, shift+alt→`toggle`. Mutually exclusive with
 * lasso-select — `onAdd` propagates the handler's throw if `lassoSelect`
 * is already enabled.
 */
export class BoxSelectControl implements Control {
  private _options: BoxSelectControlOptions;
  private _enabled = true;
  private _handler: Emap['boxSelect'] | null = null;
  private _container: HTMLElement | null = null;

  constructor(options: BoxSelectControlOptions = {}) {
    this._options = options;
  }

  onAdd(map: Emap): HTMLElement {
    this._handler = map.boxSelect;
    this._handler.setOptions({
      layers: this._options.layers,
      dragThreshold: this._options.dragThreshold,
      style: this._options.style,
    } as Partial<BoxSelectHandlerOptions>);
    if (this._enabled) this._handler.enable();

    const container = document.createElement('div');
    container.className = 'emap-ctrl emap-box-select-anchor';
    container.style.width = '0';
    container.style.height = '0';
    container.style.pointerEvents = 'none';
    this._container = container;
    return container;
  }

  onRemove(): void {
    this._handler?.disable();
    if (this._container?.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }
    this._handler = null;
    this._container = null;
  }

  disable(): void {
    this._enabled = false;
    this._handler?.disable();
  }

  enable(): void {
    this._enabled = true;
    this._handler?.enable();
  }

  isEnabled(): boolean {
    return this._handler ? this._handler.isEnabled() : this._enabled;
  }
}
```

- [ ] **Step 4: Run — verify PASS**

Run: `npx vitest run src/ui/box-select-control.test.ts 2>&1 | tail -8`
Expected: PASS (all delegation cases).

- [ ] **Step 5: tsc + full suite + the handler tests unaffected**

Run: `npx tsc --noEmit` → exit 0.
Run: `npx vitest run src/core/handlers/box-select.test.ts 2>&1 | tail -3` → still all pass (handler unchanged).
Run: `npx vitest run 2>&1 | tail -3` → all pass; report exact counts.

- [ ] **Step 6: Commit**

```bash
git add src/ui/box-select-control.ts src/ui/box-select-control.test.ts
git commit -m "refactor(ui): BoxSelectControl is a thin shell over map.boxSelect (DX P2c)"
```

---

### Task 4: LassoSelectControl thin-shell + delegation tests + parity + CHANGELOG + final gate

**Files:**
- Modify (full rewrite): `src/ui/lasso-select-control.ts`
- Modify (full rewrite): `src/ui/lasso-select-control.test.ts`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Replace `src/ui/lasso-select-control.test.ts` with delegation tests**

Entire new file content:

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { LassoSelectControl } from './lasso-select-control';

function makeMap() {
  const handler = {
    enable: vi.fn(),
    disable: vi.fn(),
    isEnabled: vi.fn(() => false),
    setOptions: vi.fn(),
    getOptions: vi.fn(() => ({})),
  };
  const map = { get lassoSelect() { return handler; } };
  return { map, handler };
}

describe('LassoSelectControl (thin shell, DX P2c)', () => {
  let map: ReturnType<typeof makeMap>['map'];
  let handler: ReturnType<typeof makeMap>['handler'];

  beforeEach(() => {
    const m = makeMap();
    map = m.map;
    handler = m.handler;
  });

  it('onAdd forwards options to map.lassoSelect.setOptions and enables it', () => {
    const c = new LassoSelectControl({
      layers: ['a'], dragThreshold: 7, includeIntersecting: false,
      style: { stroke: '#f00', strokeDasharray: '8 2' },
    });
    const anchor = c.onAdd(map as any);
    expect(handler.setOptions).toHaveBeenCalledWith({
      layers: ['a'], dragThreshold: 7, includeIntersecting: false,
      style: { stroke: '#f00', strokeDasharray: '8 2' },
    });
    expect(handler.enable).toHaveBeenCalledTimes(1);
    expect(anchor.className).toBe('emap-ctrl emap-lasso-select-anchor');
    expect(anchor.style.width).toBe('0px');
  });

  it('onAdd with no options forwards undefined fields, still enables', () => {
    const c = new LassoSelectControl();
    c.onAdd(map as any);
    expect(handler.setOptions).toHaveBeenCalledWith({
      layers: undefined, dragThreshold: undefined,
      includeIntersecting: undefined, style: undefined,
    });
    expect(handler.enable).toHaveBeenCalledTimes(1);
  });

  it('enable/disable/isEnabled proxy to the handler', () => {
    const c = new LassoSelectControl();
    c.onAdd(map as any);
    c.disable();
    expect(handler.disable).toHaveBeenCalledTimes(1);
    c.enable();
    expect(handler.enable).toHaveBeenCalledTimes(2);
    handler.isEnabled.mockReturnValue(true);
    expect(c.isEnabled()).toBe(true);
  });

  it('a disabled control does not enable the handler on onAdd', () => {
    const c = new LassoSelectControl();
    c.disable();
    c.onAdd(map as any);
    expect(handler.enable).not.toHaveBeenCalled();
    expect(handler.setOptions).toHaveBeenCalledTimes(1);
  });

  it('onRemove disables the handler and removes the anchor', () => {
    const c = new LassoSelectControl();
    const anchor = c.onAdd(map as any);
    document.body.appendChild(anchor);
    c.onRemove();
    expect(handler.disable).toHaveBeenCalledTimes(1);
    expect(anchor.parentNode).toBeNull();
  });

  it('propagates the handler mutual-exclusivity throw from enable()', () => {
    handler.enable.mockImplementation(() => { throw new Error('cannot enable lassoSelect: boxSelect is enabled'); });
    const c = new LassoSelectControl();
    expect(() => c.onAdd(map as any)).toThrow(/boxSelect is enabled/);
  });
});
```

- [ ] **Step 2: Run — verify FAIL**

Run: `npx vitest run src/ui/lasso-select-control.test.ts 2>&1 | tail -8`
Expected: FAIL — current control has no `map.lassoSelect` delegation.

- [ ] **Step 3: Replace `src/ui/lasso-select-control.ts` with the thin shell**

Entire new file content (preserves the public `pointInPolygon`/`featureMatchesLasso` re-export and the `LassoSelectStyle` re-export):

```ts
import type { Control } from './control';
import type { Emap } from '../map/map';
import type { LassoSelectHandlerOptions } from '../core/handlers/lasso-select';

export { pointInPolygon, featureMatchesLasso } from '../core/handlers/select-geometry';
export type { LassoSelectStyle } from '../core/handlers/lasso-select';
import type { LassoSelectStyle } from '../core/handlers/lasso-select';

export interface LassoSelectControlOptions {
  /**
   * Restrict the selection to a subset of layer ids. When omitted, every
   * visible layer participates (matching `queryFeatures` default).
   */
  layers?: string[];
  /** Visual style of the lasso polyline. */
  style?: LassoSelectStyle;
  /**
   * Pixel diagonal threshold below which the drag is treated as no-op.
   * Default `4`.
   */
  dragThreshold?: number;
  /**
   * Select features that intersect the lasso boundary or interior, not only
   * features fully contained by it. Default `true`, matching box-select.
   */
  includeIntersecting?: boolean;
}

/**
 * Thin shell over the `map.lassoSelect` handler (DX P2c). The handler owns
 * the shift+drag free-form gesture, the dashed `.emap-lasso-select` SVG
 * polyline, polygon hit-testing, and selection; this control just forwards
 * options and proxies enable/disable, returning a 0×0 anchor. Public
 * class, options, anchor DOM, selection behaviour, and the dashed visual
 * are unchanged from the pre-P2c control.
 *
 * Modifier conventions (on top of shift): shift→`replace`,
 * shift+ctrl/meta→`add`, shift+alt→`toggle`. Mutually exclusive with
 * box-select — `onAdd` propagates the handler's throw if `boxSelect` is
 * already enabled.
 */
export class LassoSelectControl implements Control {
  private _options: LassoSelectControlOptions;
  private _enabled = true;
  private _handler: Emap['lassoSelect'] | null = null;
  private _container: HTMLElement | null = null;

  constructor(options: LassoSelectControlOptions = {}) {
    this._options = options;
  }

  onAdd(map: Emap): HTMLElement {
    this._handler = map.lassoSelect;
    this._handler.setOptions({
      layers: this._options.layers,
      dragThreshold: this._options.dragThreshold,
      includeIntersecting: this._options.includeIntersecting,
      style: this._options.style,
    } as Partial<LassoSelectHandlerOptions>);
    if (this._enabled) this._handler.enable();

    const container = document.createElement('div');
    container.className = 'emap-ctrl emap-lasso-select-anchor';
    container.style.width = '0';
    container.style.height = '0';
    container.style.pointerEvents = 'none';
    this._container = container;
    return container;
  }

  onRemove(): void {
    this._handler?.disable();
    if (this._container?.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }
    this._handler = null;
    this._container = null;
  }

  disable(): void {
    this._enabled = false;
    this._handler?.disable();
  }

  enable(): void {
    this._enabled = true;
    this._handler?.enable();
  }

  isEnabled(): boolean {
    return this._handler ? this._handler.isEnabled() : this._enabled;
  }
}
```

- [ ] **Step 4: Run — verify PASS**

Run: `npx vitest run src/ui/lasso-select-control.test.ts 2>&1 | tail -8`
Expected: PASS.

- [ ] **Step 5: Add the CHANGELOG entry**

In `CHANGELOG.md` find the `- DX Phase 11 (toward 0.3.0):` bullet in `## [Unreleased]` → `### Added`; insert immediately AFTER its last line (plain house style, not bold):

```markdown
- DX Phase 2c (toward 0.3.0): `BoxSelectControl` / `LassoSelectControl`
  are now button-only thin shells over the P2b `map.boxSelect` /
  `map.lassoSelect` handlers (the ~490 lines of duplicated
  listener/overlay/hit-test/select logic deleted) — public class,
  constructor options, 0×0 anchor DOM, selection behaviour, and the
  dashed-lasso visual are byte-identical (the handler now honours
  `strokeDasharray`, default `'4 3'`). Adding both controls now surfaces
  the handlers' mutual-exclusivity error instead of silently conflicting.
  Duplicated types consolidated to one declaration each with re-export
  shims (every public import path unchanged): `SelectMode` →
  `core/handlers/select-mode`, `BoxSelectStyle` →
  `core/handlers/box-select`, `LassoSelectStyle`/`LassoStyle` →
  `core/handlers/lasso-select` (`LassoStyle` widened additively to include
  the optional `strokeDasharray`). No arbiter/dispatch change.
```

- [ ] **Step 6: Final verification gate** — run each, report verbatim:

- `npx tsc --noEmit` → exit 0 (authoritative; ignore stale "Cannot find module" LSP noise)
- `npx vitest run 2>&1 | tail -3` → all pass; report exact Test Files / Tests counts
- `npm run build 2>&1 | tail -2` → artifacts created, exit 0
- `grep -rn "addEventListener('mousedown'\|_onMouseDown\|queryFeatures\|_eventToContainerPx" src/ui/box-select-control.ts src/ui/lasso-select-control.ts` → ZERO matches (proves the duplicated logic is gone)
- `git diff --stat 9a02ea7 -- src/ | tail -1` then inspect: only the spec'd files; the P2a arbiter (`src/core/handler-manager.ts`), the handlers' core logic, and P1–P11 sources untouched except the additive `stroke-dasharray` line in `lasso-select.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/ui/lasso-select-control.ts src/ui/lasso-select-control.test.ts CHANGELOG.md
git commit -m "refactor(ui): LassoSelectControl thin shell + CHANGELOG (DX P2c)"
```

---

## Self-Review

**1. Spec coverage:**
- §1 thin-shell architecture (delegate to `map.boxSelect`/`map.lassoSelect`, proxy enable/disable, 0×0 anchor, propagate throw) → Tasks 3 & 4.
- §2 type consolidation (SelectMode→select-mode, BoxSelectStyle→box-select, LassoSelectStyle canonical 4-field + LassoStyle alias, DrawGeometryType untouched, re-export shims, additive widening) → Task 1.
- §3 parity (modifier→mode already in handler, dragThreshold 4, options mapping, classNames, lasso dash, mutual-exclusivity throw) → Task 2 (dasharray) + Tasks 3/4 (option mapping, anchor className, throw propagation); modifier→mode is pre-existing handler behavior covered by `box-select.test.ts`/`lasso-select.test.ts` (unchanged, asserted green in Task 3/4 Step 5 / final gate).
- §4 testing (control tests rewritten to delegation, dasharray test, type-d path test, gates) → Tasks 1 Step 1, 2 Step 1, 3 Step 1, 4 Step 1+6.
- §5 out-of-scope respected: no ClickSelectControl, DrawGeometryType untouched, arbiter untouched, additive-only.

**2. Placeholder scan:** No TBD/TODO. Full file contents given for both rewritten controls and both rewritten test files. Task 2 Step 1 explicitly instructs copying the existing lasso-handler test setup verbatim (concrete instruction — the only safe option without hard-coding that file's private mock shape, which was not read) rather than a vague placeholder. All commands have expected outcomes.

**3. Type consistency:** `BoxSelectControlOptions`/`LassoSelectControlOptions` field names (`layers`, `style`, `dragThreshold`, `includeIntersecting`) match the `setOptions({...})` payloads and the handler option interfaces. `Emap['boxSelect']`/`Emap['lassoSelect']` indexed-access types match the verified getter return types. `LassoSelectStyle`/`LassoStyle`/`BoxSelectStyle`/`SelectMode` canonical locations and re-export paths are identical across Task 1 and the Task 3/4 control imports. Anchor classNames (`emap-ctrl emap-box-select-anchor`, `emap-ctrl emap-lasso-select-anchor`) match the legacy values verified in the source.
