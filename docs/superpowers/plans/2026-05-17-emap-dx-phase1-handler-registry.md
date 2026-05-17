# emap DX Phase 1 — Handler Registry Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the unified `Handler` interface + `HandlerManager` registry and expose `map.dragPan` / `map.scrollZoom` as named handler objects, wrapping the existing pan/wheel logic with **zero behavior change**.

**Architecture:** A `Handler` is a small object with `enable/disable/isEnabled/setOptions/getOptions`. `HandlerManager` holds the registry and is owned by `Emap`. In Phase 1 the two handlers *adapt* the existing `DragPanHandler` (renamed) and `MouseWheel` instances rather than re-implementing DOM arbitration — the single-DOM-listener arbitration layer is deferred to Phase 2 (when selection handlers make it necessary). `MapOptions.interactive` is preserved and internally mapped onto the two handlers.

**Tech Stack:** TypeScript 5 (strict), Vitest 1.x (jsdom), Rollup. Source layout per `CLAUDE.md`.

**Scope boundary (explicit):** Phase 1 is no-behavior-change groundwork. It does NOT: remove `interactive`, add selection handlers, add feature events, or change CSS. Those are Phases 2–4, each its own plan derived from `docs/superpowers/specs/2026-05-17-emap-maplibre-dx-design.md`.

---

## File Structure

- Create `src/core/handler.ts` — `Handler<Opts>` interface, `HandlerResult`, `NormalizedPointerEvent` types. One responsibility: the handler contract.
- Create `src/core/handler.test.ts` — type/contract-level tests.
- Create `src/core/handlers/drag-pan.ts` — `DragPanHandler` class implementing `Handler<DragPanOptions>`, wrapping the existing pan DOM logic.
- Create `src/core/handlers/drag-pan.test.ts`
- Create `src/core/handlers/scroll-zoom.ts` — `ScrollZoomHandler` implementing `Handler<ScrollZoomOptions>`, wrapping `MouseWheel`.
- Create `src/core/handlers/scroll-zoom.test.ts`
- Create `src/core/handler-manager.ts` — `HandlerManager`: registry of named handlers + `interactive`→handlers mapping helper.
- Create `src/core/handler-manager.test.ts`
- Rename `src/core/drag-pan-handler.ts` → keep file but it becomes the low-level DOM primitive `PanGestureSource` (the existing class, minus the `shiftKey` early-return which moves to a configurable option so behavior is preserved by defaulting it on).
- Modify `src/map/map.ts` — construct `HandlerManager`, expose `dragPan`/`scrollZoom` getters, map `interactive`.
- Modify `src/index.ts` — export `Handler`, `HandlerManager`, `DragPanHandler`, `ScrollZoomHandler`, and the option/event types.

---

### Task 1: Handler contract types

**Files:**
- Create: `src/core/handler.ts`
- Test: `src/core/handler.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/core/handler.test.ts
import { describe, it, expect } from 'vitest';
import type { Handler, HandlerResult, NormalizedPointerEvent } from './handler';
import { isHandler } from './handler';

describe('Handler contract', () => {
  it('isHandler accepts a conforming object and rejects a non-conforming one', () => {
    const ok: Handler = {
      name: 'noop',
      enable() {}, disable() {}, isEnabled: () => true,
      setOptions() {}, getOptions: () => ({}),
      handlePointer: () => 'passthrough' as HandlerResult,
    };
    expect(isHandler(ok)).toBe(true);
    expect(isHandler({ name: 'bad' })).toBe(false);
    expect(isHandler(null)).toBe(false);
  });

  it('NormalizedPointerEvent shape is usable', () => {
    const ev: NormalizedPointerEvent = {
      kind: 'down',
      point: { x: 1, y: 2 },
      modifiers: { shift: false, ctrl: false, alt: false, meta: false },
      button: 0,
      originalEvent: new MouseEvent('mousedown'),
    };
    expect(ev.point.x).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/handler.test.ts`
Expected: FAIL — `Cannot find module './handler'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/handler.ts

/** Outcome of a handler processing one normalized event. */
export type HandlerResult = 'passthrough' | 'consumed' | 'exclusive';

export interface PointerModifiers {
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
}

/** A DOM pointer/wheel event normalized to element-local coords + modifiers. */
export interface NormalizedPointerEvent {
  kind: 'down' | 'move' | 'up' | 'wheel' | 'click';
  /** Element-local pixel position. */
  point: { x: number; y: number };
  modifiers: PointerModifiers;
  /** Mouse button for down/up/click; 0 otherwise. */
  button: number;
  /** Wheel delta (sign already normalized: +1 zoom-in direction). 0 if N/A. */
  wheelDirection?: number;
  originalEvent: Event;
}

/**
 * A unit of interaction (pan, zoom, selection…). Every interaction on the map
 * is one of these. Mirrors MapLibre's handler model.
 */
export interface Handler<Opts = unknown> {
  readonly name: string;
  enable(): void;
  disable(): void;
  isEnabled(): boolean;
  setOptions(opts: Partial<Opts>): void;
  getOptions(): Readonly<Opts>;
  /** Process one normalized event; report whether it was consumed. */
  handlePointer(ev: NormalizedPointerEvent): HandlerResult;
}

/** Runtime guard — used by HandlerManager.register and by consumers. */
export function isHandler(v: unknown): v is Handler {
  if (!v || typeof v !== 'object') return false;
  const h = v as Record<string, unknown>;
  return (
    typeof h.name === 'string' &&
    typeof h.enable === 'function' &&
    typeof h.disable === 'function' &&
    typeof h.isEnabled === 'function' &&
    typeof h.setOptions === 'function' &&
    typeof h.getOptions === 'function' &&
    typeof h.handlePointer === 'function'
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/handler.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/handler.ts src/core/handler.test.ts
git commit -m "feat(core): add Handler contract + NormalizedPointerEvent (DX P1)"
```

---

### Task 2: Make the pan DOM primitive's shift-skip configurable

**Files:**
- Modify: `src/core/drag-pan-handler.ts:57-65`
- Test: `src/core/drag-pan-handler.test.ts` (exists — add a case)

Rationale: the new `DragPanHandler` (Task 3) must be able to own the
shift-vs-pan decision. The low-level primitive currently hard-skips
`e.shiftKey` (`drag-pan-handler.ts:61`). Make that an option defaulting to
`true` so existing behavior is byte-identical, and the higher layer can flip
it later (Phase 2).

- [ ] **Step 1: Write the failing test**

Append to `src/core/drag-pan-handler.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { DragPanHandler as PanGestureSource } from './drag-pan-handler';

describe('PanGestureSource skipShiftDrag option', () => {
  it('skips shift+drag by default (unchanged behavior)', () => {
    const el = document.createElement('div');
    const src = new PanGestureSource(el);
    const onStart = vi.fn();
    src.on('panstart', onStart);
    el.dispatchEvent(new MouseEvent('mousedown', { shiftKey: true, clientX: 0, clientY: 0 }));
    expect(onStart).not.toHaveBeenCalled();
    src.destroy();
  });

  it('pans on shift+drag when skipShiftDrag=false', () => {
    const el = document.createElement('div');
    const src = new PanGestureSource(el, { skipShiftDrag: false });
    const onStart = vi.fn();
    src.on('panstart', onStart);
    el.dispatchEvent(new MouseEvent('mousedown', { shiftKey: true, clientX: 0, clientY: 0 }));
    expect(onStart).toHaveBeenCalledTimes(1);
    src.destroy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/drag-pan-handler.test.ts -t "skipShiftDrag"`
Expected: FAIL — second test fails (shift still skipped; constructor takes no options).

- [ ] **Step 3: Write minimal implementation**

In `src/core/drag-pan-handler.ts`, change the constructor signature and the shift check:

```ts
  private _skipShiftDrag: boolean;

  constructor(element: HTMLElement, opts?: { skipShiftDrag?: boolean }) {
    super();
    this._element = element;
    this._skipShiftDrag = opts?.skipShiftDrag ?? true;
    this._onMouseDownBound = this._onMouseDown.bind(this);
    this._onMouseMoveBound = this._onMouseMove.bind(this);
    this._onMouseUpBound = this._onMouseUp.bind(this);

    element.addEventListener('mousedown', this._onMouseDownBound);
    window.addEventListener('mousemove', this._onMouseMoveBound);
    window.addEventListener('mouseup', this._onMouseUpBound);
  }
```

And replace lines 59-61 (the comment + `if (e.shiftKey) return;`) with:

```ts
    // Shift+drag is reserved for higher-level handlers (e.g. box-select)
    // unless the owner opts out. Default-on preserves legacy behavior.
    if (this._skipShiftDrag && e.shiftKey) return;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/drag-pan-handler.test.ts`
Expected: PASS (all existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/core/drag-pan-handler.ts src/core/drag-pan-handler.test.ts
git commit -m "refactor(core): make pan primitive shift-skip configurable (DX P1, default unchanged)"
```

---

### Task 3: DragPanHandler implementing Handler

**Files:**
- Create: `src/core/handlers/drag-pan.ts`
- Test: `src/core/handlers/drag-pan.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/core/handlers/drag-pan.test.ts
import { describe, it, expect, vi } from 'vitest';
import { DragPanHandler } from './drag-pan';

function makeEl() { return document.createElement('div'); }

describe('DragPanHandler', () => {
  it('is enabled by default and exposes name "dragPan"', () => {
    const h = new DragPanHandler(makeEl());
    expect(h.name).toBe('dragPan');
    expect(h.isEnabled()).toBe(true);
    h.destroy();
  });

  it('disable() stops pan events; enable() restores them', () => {
    const el = makeEl();
    const h = new DragPanHandler(el);
    const onPan = vi.fn();
    h.on('pan', onPan);

    h.disable();
    el.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0 }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 0 }));
    expect(onPan).not.toHaveBeenCalled();

    h.enable();
    el.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0 }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 0 }));
    expect(onPan).toHaveBeenCalledWith(expect.objectContaining({ dx: 10, dy: 0 }));
    h.destroy();
  });

  it('handlePointer is a no-op passthrough in Phase 1 (DOM-driven)', () => {
    const h = new DragPanHandler(makeEl());
    expect(h.handlePointer({
      kind: 'down', point: { x: 0, y: 0 },
      modifiers: { shift: false, ctrl: false, alt: false, meta: false },
      button: 0, originalEvent: new MouseEvent('mousedown'),
    })).toBe('passthrough');
    h.destroy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/handlers/drag-pan.test.ts`
Expected: FAIL — `Cannot find module './drag-pan'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/handlers/drag-pan.ts
import { EventDispatcher } from '../events';
import { DragPanHandler as PanGestureSource } from '../drag-pan-handler';
import type { Handler, HandlerResult, NormalizedPointerEvent } from '../handler';

export interface DragPanOptions {
  /** Reserve shift+drag for higher-level handlers. Default true. */
  skipShiftDrag: boolean;
}

const DEFAULTS: DragPanOptions = { skipShiftDrag: true };

/**
 * Named `dragPan` handler. Phase 1: adapts the existing PanGestureSource DOM
 * primitive and re-emits its 'pan'/'panstart'/'panend' events, so Emap's
 * existing wiring is unchanged. handlePointer() is a passthrough no-op until
 * Phase 2 introduces the single-DOM arbitration layer.
 */
export class DragPanHandler extends EventDispatcher implements Handler<DragPanOptions> {
  readonly name = 'dragPan';
  private _opts: DragPanOptions;
  private _src: PanGestureSource;
  private _enabled = true;

  constructor(element: HTMLElement, opts?: Partial<DragPanOptions>) {
    super();
    this._opts = { ...DEFAULTS, ...opts };
    this._src = new PanGestureSource(element, { skipShiftDrag: this._opts.skipShiftDrag });
    this._src.on('pan', (e: { dx: number; dy: number }) => this.fire('pan', e));
    this._src.on('panstart', () => this.fire('panstart'));
    this._src.on('panend', () => this.fire('panend'));
  }

  enable(): void { this._enabled = true; this._src.setEnabled(true); }
  disable(): void { this._enabled = false; this._src.setEnabled(false); }
  isEnabled(): boolean { return this._enabled; }

  setOptions(opts: Partial<DragPanOptions>): void {
    this._opts = { ...this._opts, ...opts };
    // skipShiftDrag is fixed at construction in the underlying primitive;
    // Phase 2's arbitration layer makes this dynamic. Documented limitation.
  }
  getOptions(): Readonly<DragPanOptions> { return this._opts; }

  handlePointer(_ev: NormalizedPointerEvent): HandlerResult { return 'passthrough'; }

  destroy(): void { this._src.destroy(); }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/handlers/drag-pan.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/handlers/drag-pan.ts src/core/handlers/drag-pan.test.ts
git commit -m "feat(core): dragPan Handler adapting the pan primitive (DX P1)"
```

---

### Task 4: ScrollZoomHandler implementing Handler

**Files:**
- Create: `src/core/handlers/scroll-zoom.ts`
- Test: `src/core/handlers/scroll-zoom.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/core/handlers/scroll-zoom.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ScrollZoomHandler } from './scroll-zoom';

describe('ScrollZoomHandler', () => {
  it('exposes name "scrollZoom" and is enabled by default', () => {
    const h = new ScrollZoomHandler(document.createElement('div'));
    expect(h.name).toBe('scrollZoom');
    expect(h.isEnabled()).toBe(true);
    h.destroy();
  });

  it('disable() suppresses re-emitted mousewheel events', () => {
    const el = document.createElement('div');
    const h = new ScrollZoomHandler(el);
    const onZoom = vi.fn();
    h.on('mousewheel', onZoom);
    h.disable();
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
    expect(onZoom).not.toHaveBeenCalled();
    h.destroy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/handlers/scroll-zoom.test.ts`
Expected: FAIL — `Cannot find module './scroll-zoom'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/handlers/scroll-zoom.ts
import { EventDispatcher } from '../events';
import { MouseWheel } from '../interactions';
import type { Handler, HandlerResult, NormalizedPointerEvent } from '../handler';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ScrollZoomOptions {}

/**
 * Named `scrollZoom` handler. Phase 1: adapts the existing MouseWheel DOM
 * primitive, re-emitting its 'mousewheel' event. When disabled, re-emission
 * is suppressed (MouseWheel itself has no enable flag, so the handler gates
 * at the boundary).
 */
export class ScrollZoomHandler extends EventDispatcher implements Handler<ScrollZoomOptions> {
  readonly name = 'scrollZoom';
  private _wheel: MouseWheel;
  private _enabled = true;

  constructor(element: HTMLElement) {
    super();
    this._wheel = new MouseWheel(element);
    this._wheel.on('mousewheel', (e: unknown) => {
      if (this._enabled) this.fire('mousewheel', e as object);
    });
  }

  enable(): void { this._enabled = true; }
  disable(): void { this._enabled = false; }
  isEnabled(): boolean { return this._enabled; }
  setOptions(_opts: Partial<ScrollZoomOptions>): void {}
  getOptions(): Readonly<ScrollZoomOptions> { return {}; }
  handlePointer(_ev: NormalizedPointerEvent): HandlerResult { return 'passthrough'; }

  destroy(): void { this._wheel.destroy(); }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/handlers/scroll-zoom.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/handlers/scroll-zoom.ts src/core/handlers/scroll-zoom.test.ts
git commit -m "feat(core): scrollZoom Handler adapting MouseWheel (DX P1)"
```

---

### Task 5: HandlerManager registry + interactive mapping

**Files:**
- Create: `src/core/handler-manager.ts`
- Test: `src/core/handler-manager.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/core/handler-manager.test.ts
import { describe, it, expect } from 'vitest';
import { HandlerManager } from './handler-manager';
import type { Handler } from './handler';

function fake(name: string): Handler & { _on: boolean } {
  let on = true;
  return {
    name, _on: on,
    enable() { (this as any)._on = true; }, disable() { (this as any)._on = false; },
    isEnabled() { return (this as any)._on; },
    setOptions() {}, getOptions: () => ({}),
    handlePointer: () => 'passthrough' as const,
  };
}

describe('HandlerManager', () => {
  it('register + get by name', () => {
    const m = new HandlerManager();
    const h = fake('dragPan');
    m.register(h);
    expect(m.get('dragPan')).toBe(h);
    expect(m.get('nope')).toBeUndefined();
  });

  it('rejects a non-Handler', () => {
    const m = new HandlerManager();
    expect(() => m.register({ name: 'x' } as any)).toThrow(/not a valid Handler/);
  });

  it('applyInteractive(false) disables dragPan + scrollZoom; true re-enables', () => {
    const m = new HandlerManager();
    const pan = fake('dragPan');
    const zoom = fake('scrollZoom');
    m.register(pan); m.register(zoom);
    m.applyInteractive(false);
    expect(pan.isEnabled()).toBe(false);
    expect(zoom.isEnabled()).toBe(false);
    m.applyInteractive(true);
    expect(pan.isEnabled()).toBe(true);
    expect(zoom.isEnabled()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/handler-manager.test.ts`
Expected: FAIL — `Cannot find module './handler-manager'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/handler-manager.ts
import { type Handler, isHandler } from './handler';

/**
 * Registry of named interaction handlers owned by Emap. Phase 1 holds the
 * registry and maps the legacy `interactive` option onto handlers. The
 * single-DOM-listener arbitration layer (priority + exclusive gestures)
 * arrives in Phase 2 when selection handlers need it.
 */
export class HandlerManager {
  private _handlers = new Map<string, Handler>();

  register(handler: Handler): void {
    if (!isHandler(handler)) {
      throw new Error(`HandlerManager.register: argument is not a valid Handler`);
    }
    this._handlers.set(handler.name, handler);
  }

  get(name: string): Handler | undefined {
    return this._handlers.get(name);
  }

  /** Legacy `interactive` shim: toggles the pan + zoom handlers together. */
  applyInteractive(interactive: boolean): void {
    for (const n of ['dragPan', 'scrollZoom']) {
      const h = this._handlers.get(n);
      if (!h) continue;
      if (interactive) h.enable();
      else h.disable();
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/handler-manager.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/handler-manager.ts src/core/handler-manager.test.ts
git commit -m "feat(core): HandlerManager registry + interactive mapping (DX P1)"
```

---

### Task 6: Wire HandlerManager into Emap, expose map.dragPan / map.scrollZoom

**Files:**
- Modify: `src/map/map.ts` (imports near :16-17; fields near :87-88; construction :228-229; pan/zoom wiring :336-344; `interactive` handling; `destroy()` :1465-1466)
- Test: `src/map/handler-registry.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// src/map/handler-registry.test.ts
import { describe, it, expect } from 'vitest';
import { Emap } from './map';

function container(): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: 800 });
  Object.defineProperty(el, 'clientHeight', { value: 600 });
  document.body.appendChild(el);
  return el;
}

describe('Emap handler registry (Phase 1)', () => {
  it('exposes dragPan and scrollZoom handlers, enabled by default', () => {
    const map = new Emap({ container: container() });
    expect(map.dragPan.name).toBe('dragPan');
    expect(map.scrollZoom.name).toBe('scrollZoom');
    expect(map.dragPan.isEnabled()).toBe(true);
    expect(map.scrollZoom.isEnabled()).toBe(true);
  });

  it('interactive:false disables both handlers (legacy behavior preserved)', () => {
    const map = new Emap({ container: container(), interactive: false });
    expect(map.dragPan.isEnabled()).toBe(false);
    expect(map.scrollZoom.isEnabled()).toBe(false);
  });

  it('map.scrollZoom.disable() leaves dragPan enabled (selective toggle)', () => {
    const map = new Emap({ container: container() });
    map.scrollZoom.disable();
    expect(map.scrollZoom.isEnabled()).toBe(false);
    expect(map.dragPan.isEnabled()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/map/handler-registry.test.ts`
Expected: FAIL — `map.dragPan` is undefined (Emap has private `_dragPan` of the old type, no getter).

- [ ] **Step 3: Write minimal implementation**

In `src/map/map.ts`:

(a) Replace the imports at lines 16-17:

```ts
import { ScrollZoomHandler } from '../core/handlers/scroll-zoom';
import { DragPanHandler } from '../core/handlers/drag-pan';
import { HandlerManager } from '../core/handler-manager';
```

(b) Replace the fields at lines 87-88:

```ts
  private _handlers: HandlerManager;
  private _scrollZoom: ScrollZoomHandler;
  private _dragPan: DragPanHandler;
```

(c) Replace construction at lines 228-229:

```ts
    this._handlers = new HandlerManager();
    this._scrollZoom = new ScrollZoomHandler(this._canvasContainer);
    this._dragPan = new DragPanHandler(this._canvasContainer);
    this._handlers.register(this._dragPan);
    this._handlers.register(this._scrollZoom);
```

(d) The existing event wiring at lines 336-344 (`this._dragPan.on('pan' …)`,
`'panstart'`, `this._mouseWheel.on('mousewheel' …)`) — rename `_mouseWheel`
to `_scrollZoom`. The new handlers re-emit the SAME event names
(`'pan'`/`'panstart'`/`'panend'`/`'mousewheel'`) with identical payloads, so
only the identifier changes:

```ts
    this._dragPan.on('pan', (e: { dx: number; dy: number }) => {
      // ...existing body unchanged...
    });
    this._dragPan.on('panstart', () => {
      // ...existing body unchanged...
    });
    this._scrollZoom.on('mousewheel', (e: { direction: number; multiplier: number; x: number; y: number }) => {
      // ...existing body unchanged...
    });
```

(e) Find where `interactive` is consumed (search `interactive` in
`src/map/map.ts`). Replace the existing branch that disables interaction
with:

```ts
    if (options.interactive === false) {
      this._handlers.applyInteractive(false);
    }
```

(f) The edit-mode line at `map.ts:167`
(`this._dragPan?.setEnabled(change.current.mode === 'none')`) — replace
`setEnabled(x)` with the Handler API:

```ts
      if (change.current.mode === 'none') this._dragPan?.enable();
      else this._dragPan?.disable();
```

(g) Add public getters (place near other public accessors, e.g. after
`getZoom`):

```ts
  /** The drag-to-pan interaction handler. */
  get dragPan(): DragPanHandler { return this._dragPan; }
  /** The scroll-wheel zoom interaction handler. */
  get scrollZoom(): ScrollZoomHandler { return this._scrollZoom; }
```

(h) `destroy()` at lines 1465-1466 — replace `_mouseWheel` with
`_scrollZoom`:

```ts
    this._dragPan.destroy();
    this._scrollZoom.destroy();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/map/handler-registry.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full suite + typecheck (no behavior change gate)**

Run: `npx tsc --noEmit 2>&1 | grep -v node_modules/mapshaper | grep -E "src/(core|map)/" ; npx vitest run`
Expected: zero tsc errors in `src/core`/`src/map`; **all prior tests still green** (this is the no-behavior-change contract — `src/map/map.test.ts`'s 429 pan/zoom/interactive tests must pass unchanged). If any pan/zoom/interactive test fails, STOP — the adapter changed behavior; revert and re-investigate.

- [ ] **Step 6: Commit**

```bash
git add src/map/map.ts src/map/handler-registry.test.ts
git commit -m "feat(map): wire HandlerManager; expose map.dragPan/scrollZoom (DX P1, no behavior change)"
```

---

### Task 7: Public exports

**Files:**
- Modify: `src/index.ts` (core block near :184-188)
- Test: `src/index.test.ts` (create — export-surface guard)

- [ ] **Step 1: Write the failing test**

```ts
// src/index.test.ts
import { describe, it, expect } from 'vitest';
import * as emap from './index';

describe('public export surface (DX P1 additions)', () => {
  it('exports HandlerManager and the new handler classes', () => {
    expect(typeof emap.HandlerManager).toBe('function');
    expect(typeof emap.DragPanHandler).toBe('function');
    expect(typeof emap.ScrollZoomHandler).toBe('function');
    expect(typeof emap.isHandler).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/index.test.ts`
Expected: FAIL — `emap.HandlerManager` is undefined.

- [ ] **Step 3: Write minimal implementation**

In `src/index.ts`, replace the line `export { DragPanHandler } from './core/drag-pan-handler';` (currently :188) and add adjacent exports:

```ts
export { EventDispatcher } from './core/events';
export type { EventListener } from './core/events';
export { HandlerManager } from './core/handler-manager';
export { isHandler } from './core/handler';
export type { Handler, HandlerResult, NormalizedPointerEvent, PointerModifiers } from './core/handler';
export { DragPanHandler } from './core/handlers/drag-pan';
export type { DragPanOptions } from './core/handlers/drag-pan';
export { ScrollZoomHandler } from './core/handlers/scroll-zoom';
export type { ScrollZoomOptions } from './core/handlers/scroll-zoom';
```

(Note: the old `DragPanHandler` export now points at the new handler class —
intentional 0.3.0 API consolidation. The low-level primitive in
`src/core/drag-pan-handler.ts` is internal-only and no longer exported.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Build gate**

Run: `npm run build`
Expected: exit 0 (rollup + `tsc -p tsconfig.build.json`). Then
`npx vitest run` → full suite green.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts src/index.test.ts
git commit -m "feat: export Handler API surface (DX P1)"
```

---

### Task 8: CHANGELOG + spec cross-link

**Files:**
- Modify: `CHANGELOG.md` (`[Unreleased]`)

- [ ] **Step 1: Add entry**

Under `## [Unreleased]`, add:

```markdown
### Added

- DX Phase 1 (toward 0.3.0): `Handler` interface + `HandlerManager`; the pan
  and wheel interactions are now named handlers `map.dragPan` /
  `map.scrollZoom` with `enable()/disable()/isEnabled()/setOptions()`.
  Enables selective interaction toggling (e.g. disable wheel, keep pan)
  without reaching into private internals. No behavior change: defaults and
  `interactive` semantics are byte-identical; the underlying pan/wheel
  primitives are unchanged. See
  `docs/superpowers/specs/2026-05-17-emap-maplibre-dx-design.md`.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: CHANGELOG for DX Phase 1 handler registry"
```

---

## Self-Review

**1. Spec coverage (Phase 1 only — §9 P1):** §3 Handler interface → Task 1. §3 HandlerManager → Task 5. §3 "replaces drag-pan-handler.ts:61 shiftKey special-case" → Task 2 makes it a configurable option (default-on = no behavior change in P1; the flip happens in P2 arbitration — correctly deferred, noted in scope boundary). §7 `interactive` → preserved via `applyInteractive` shim (Task 5/6); the *removal* is explicitly Phase-deferred per the scope boundary, consistent with "P1 = no behavior change". `map.dragPan`/`map.scrollZoom` exposure → Task 6. Exports (§7 new exports — Handler/HandlerManager) → Task 7. Phases 2–4 (selection handlers, feature events, CSS) intentionally NOT covered — separate plans, stated in header. No P1 requirement left unmapped.

**2. Placeholder scan:** No TBD/TODO. Step 3(d) of Task 6 references "existing body unchanged" — acceptable because the instruction is explicitly *rename identifier only, do not alter the body*, and the exact lines are cited (`map.ts:336-344`); the engineer reads the existing code in place rather than re-typing it (re-typing risks transcription drift in a no-behavior-change task). This is a deliberate, safe exception, not a placeholder.

**3. Type consistency:** `Handler<Opts>` signature consistent across Tasks 1,3,4,5. `DragPanHandler` (Task 3) / `ScrollZoomHandler` (Task 4) implement it; HandlerManager (Task 5) consumes `Handler` + `isHandler`. Event names re-emitted by the adapters (`pan`/`panstart`/`panend`/`mousewheel`) match what `map.ts:336-344` already listens for — the no-behavior-change hinge. `applyInteractive` named consistently in Tasks 5 and 6. Exports in Task 7 match symbols defined in Tasks 1,3,4,5.

Plan is internally consistent and scoped to one shippable, testable unit.
