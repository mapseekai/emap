# Typed EmapEventMap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a typed, augmentable `EmapEventMap` so `map.on/off/once` give event-name autocomplete and payload inference for the ~14 events emitted on the `Emap` instance, while preserving the existing `mousemove`/`feature:*` overloads and the arbitrary-name escape hatch.

**Architecture:** New `src/core/event-map.ts` exports `interface EmapEventMap` + `interface CameraEvent`. `Emap` gains ONE keyed `on`/`off`/`once` overload each, inserted between the bespoke (`mousemove`) overload and the generic `string` fallback. `EventDispatcher` and all `on/off/once` runtime bodies are byte-unchanged — compile-time-only change. Verified by a `tsc`-checked `*.test-d.ts` type-assertion file plus a runtime sanity test.

**Tech Stack:** TypeScript 5 (strict), Vitest 1.x, Rollup. Spec: `docs/superpowers/specs/2026-05-19-emap-dx-phase10-event-map-design.md`.

**Conventions:** No Co-Authored-By trailers. Plain `git` only (no `-c core.hooksPath`, no hook bypass). OpenSpec skipped (P1–P9 precedent). `package.json` stays `0.2.0`. Ignore the GitNexus / Rust-skills hook output (not applicable here).

**Baseline:** full suite currently **1142 passed (67 files)**; `npx tsc --noEmit` exit 0; `npm run build` exit 0. tsconfig `include: ["src"]`, `exclude: ["**/*.test.ts","**/*.test.tsx"]` — so `src/**/*.test-d.ts` IS type-checked by `tsc` and is NOT run by Vitest (Vitest globs `*.test.ts`).

---

### Task 1: Create the `EmapEventMap` type module

**Files:**
- Create: `src/core/event-map.ts`
- Modify: `src/index.ts` (Core-events export block, around line 189)

- [ ] **Step 1: Create `src/core/event-map.ts`**

Exact contents (the import paths are verified: `EditMode` is `export type` in `src/map/edit-state-store.ts:8`; `HistoryStateSnapshot` is `export interface` in `src/edit/edit-history.ts:11`; `FeatureRef` is `export interface` in `src/map/types.ts:179`; `ValidatorResult` is `export interface` in `src/validation/validator.ts:69`). All imports are `import type` — type-only, erased at runtime, so the `event-map → map → event-map` reference is not a runtime cycle.

```ts
import type { EditMode } from '../map/edit-state-store';
import type { HistoryStateSnapshot } from '../edit/edit-history';
import type { FeatureRef } from '../map/types';
import type { ValidatorResult } from '../validation/validator';

/**
 * Camera lifecycle payload (P9). `zoom` is `log2(scale)` — meaningful for
 * WebMercator, otherwise the documented log2 convention. `originalEvent`
 * is `null` for programmatic camera moves.
 */
export interface CameraEvent {
  center: [number, number];
  zoom: number;
  originalEvent: MouseEvent | null;
}

/**
 * Typed payloads for every event emitted ON the `Emap` instance (P10).
 * Scoped to `this.fire(…)` in `src/map/map.ts` + the camera lifecycle
 * wired through the camera host. Handler-internal events (`pan`,
 * `panstart`, `mousewheel*`) and sub-dispatcher events (`tick`, `change`,
 * `workerjob*`, source `dataloading`) are intentionally excluded — they
 * are not delivered via `map.on`.
 *
 * This is an `interface` (not a `type`) so consumers can augment it:
 *
 * ```ts
 * declare module '@zwishing/emap' {
 *   interface EmapEventMap { myCustomEvent: { detail: string } }
 * }
 * ```
 */
export interface EmapEventMap {
  // Camera lifecycle (P9) — always a full CameraEvent
  movestart: CameraEvent;
  moveend: CameraEvent;
  zoomstart: CameraEvent;
  zoom: CameraEvent;
  zoomend: CameraEvent;
  // Fired BOTH bare (viewport pan / wheel → this.fire('move')) AND as a
  // full CameraEvent (camera) → every field optional (truthful union).
  move: Partial<CameraEvent>;

  // Lifecycle / data
  crschange: Record<string, never>;
  resize: Record<string, never>;
  data: { sourceId?: string; reason?: 'edit' | 'load' | 'replace' | 'reproject' };
  editmodechange: { mode: EditMode };
  error: { error: Error };
  // Fired bare AND with a snapshot → Partial.
  historychange: Partial<HistoryStateSnapshot>;
  selectionchange: { selected: FeatureRef[]; added: FeatureRef[]; removed: FeatureRef[] };
  validationfailed: { results: ValidatorResult[]; label: string };
}
```

- [ ] **Step 2: Export from `src/index.ts`**

Find this exact block (around line 187-189):

```ts
export { EventDispatcher } from './core/events';
export type { EventListener } from './core/events';
export type { CameraOptions, AnimationOptions, FlyToOptions, FitBoundsOptions } from './geo/camera';
```

Add ONE line immediately after the `EventListener` line (keep alphabetical-ish grouping with the other event types):

```ts
export type { EmapEventMap, CameraEvent } from './core/event-map';
```

Resulting block:

```ts
export { EventDispatcher } from './core/events';
export type { EventListener } from './core/events';
export type { EmapEventMap, CameraEvent } from './core/event-map';
export type { CameraOptions, AnimationOptions, FlyToOptions, FitBoundsOptions } from './geo/camera';
```

- [ ] **Step 3: Verify the type module compiles standalone**

Run: `npx tsc --noEmit`
Expected: exit 0 (the interface + its 4 type-only imports resolve; no runtime cycle).

- [ ] **Step 4: Verify nothing else changed / suite still green**

Run: `npx vitest run 2>&1 | tail -3`
Expected: `Test Files 67 passed (67)` / `Tests 1142 passed (1142)` (no behavior change yet — type module is not referenced by runtime code).

- [ ] **Step 5: Commit**

```bash
git add src/core/event-map.ts src/index.ts
git commit -m "feat(core): add typed EmapEventMap + CameraEvent (DX P10)"
```

---

### Task 2: Keyed `on`/`off`/`once` overloads (TDD: type-test is the failing test)

**Files:**
- Create: `src/core/event-map.test-d.ts` (type assertions, checked by `tsc`, NOT run by Vitest)
- Modify: `src/map/map.ts` (the three overload blocks; current `on` block ≈ lines 380-403, `off` ≈ 406-424, `once` ≈ 427-447 — locate by the comment text shown below, not by line number)

- [ ] **Step 1: Write the failing type-test `src/core/event-map.test-d.ts`**

`declare const map: Emap;` avoids constructor typing noise; the file is type-checked but never executed. Each `@ts-expect-error` MUST trigger an error or `tsc` fails ("unused '@ts-expect-error' directive") — that is precisely what makes this the RED test before the overloads exist.

```ts
// Type-level assertions for EmapEventMap. Checked by `tsc --noEmit`
// (tsconfig excludes only *.test.ts / *.test.tsx — this file IS checked).
// Vitest globs *.test.ts so this file is never executed.
import type { Emap } from '../map/map';

declare const map: Emap;

// --- payload inference on known events ---
map.on('moveend', (e) => {
  const c: [number, number] = e.center;
  const z: number = e.zoom;
  const t: 'moveend' = e.type;
  const oe: MouseEvent | null = e.originalEvent;
  void c; void z; void t; void oe;
});

map.on('error', (e) => {
  const err: Error = e.error;
  void err;
});

map.on('selectionchange', (e) => {
  const n: number = e.selected.length + e.added.length + e.removed.length;
  void n;
});

// `move` is Partial<CameraEvent> — center is optional
map.on('move', (e) => {
  const c: [number, number] | undefined = e.center;
  void c;
});

// off / once infer identically
map.off('zoomend', (e) => { const z: number = e.zoom; void z; });
map.once('editmodechange', (e) => {
  const m: 'none' | 'vertex' | 'draw' | 'transform' = e.mode;
  void m;
});

// --- bad property on a known event must error ---
// @ts-expect-error 'nope' is not on the moveend payload
map.on('moveend', (e) => { void e.nope; });

// --- escape hatch: arbitrary custom names still compile ---
map.on('totallyCustomAppEvent', (e) => { void e; });
map.off('anotherCustomEvent', (e) => { void e; });

// --- module augmentation adds a key that then infers ---
declare module './event-map' {
  interface EmapEventMap { myAugmentedEvent: { detail: string } }
}
map.on('myAugmentedEvent', (e) => {
  const d: string = e.detail;
  void d;
});

// --- bespoke overloads still work (regression guard) ---
map.on('mousemove', (e) => { void e.mapCoord; });
```

- [ ] **Step 2: Run `tsc` to verify it FAILS**

Run: `npx tsc --noEmit`
Expected: FAIL. Without the keyed overload, `map.on('moveend', …)` resolves to the generic `on<T = Record<string, unknown>>`, so `e.center` is `unknown` → `const c: [number, number] = e.center;` errors (`Type 'unknown' is not assignable to type '[number, number]'`), and the `@ts-expect-error` on `e.nope` is unused (because `e.nope` on `Record<string, unknown>` is allowed) → `tsc` reports "Unused '@ts-expect-error' directive". Non-zero exit.

- [ ] **Step 3: Add the keyed overload to `on` in `src/map/map.ts`**

Find this exact existing code (the `on` overload group):

```ts
  on(type: 'mousemove', listener: (e: PointerMoveEvent) => void): this;
  // Overload 2: generic 2-arg form — preserves the base class API for non-feature events
  // (e.g. `map.on<HistoryStateSnapshot>('historychange', cb)`)
  on<T = Record<string, unknown>>(type: string, listener: EventListener<T>): this;
```

Replace it with (insert the keyed overload BETWEEN them):

```ts
  on(type: 'mousemove', listener: (e: PointerMoveEvent) => void): this;
  // Overload 1b (P10): typed known events — autocomplete + payload inference.
  // MUST sit after the 'mousemove' literal and before the generic string
  // fallback so known names infer and unknown names fall through.
  on<K extends keyof EmapEventMap>(
    type: K,
    listener: (e: { type: K } & EmapEventMap[K]) => void,
  ): this;
  // Overload 2: generic 2-arg form — preserves the base class API for non-feature events
  // (e.g. `map.on<HistoryStateSnapshot>('historychange', cb)`)
  on<T = Record<string, unknown>>(type: string, listener: EventListener<T>): this;
```

- [ ] **Step 4: Add the keyed overload to `off` in `src/map/map.ts`**

Find this exact existing code:

```ts
  off(type: 'mousemove', listener: (e: PointerMoveEvent) => void): this;
  // Overload: generic 2-arg form for non-feature events
  off<T = Record<string, unknown>>(type: string, listener: EventListener<T>): this;
```

Replace with:

```ts
  off(type: 'mousemove', listener: (e: PointerMoveEvent) => void): this;
  // Overload 1b (P10): typed known events
  off<K extends keyof EmapEventMap>(
    type: K,
    listener: (e: { type: K } & EmapEventMap[K]) => void,
  ): this;
  // Overload: generic 2-arg form for non-feature events
  off<T = Record<string, unknown>>(type: string, listener: EventListener<T>): this;
```

- [ ] **Step 5: Add the keyed overload to `once` in `src/map/map.ts`**

Find this exact existing code:

```ts
  once(type: 'mousemove', listener: (e: PointerMoveEvent) => void): this;
  // Overload 2: generic 2-arg form for non-feature events
  once<T = Record<string, unknown>>(type: string, listener: EventListener<T>): this;
```

Replace with:

```ts
  once(type: 'mousemove', listener: (e: PointerMoveEvent) => void): this;
  // Overload 1b (P10): typed known events
  once<K extends keyof EmapEventMap>(
    type: K,
    listener: (e: { type: K } & EmapEventMap[K]) => void,
  ): this;
  // Overload 2: generic 2-arg form for non-feature events
  once<T = Record<string, unknown>>(type: string, listener: EventListener<T>): this;
```

- [ ] **Step 6: Add the `EmapEventMap` import to `src/map/map.ts`**

Near the other `src/core` imports in `map.ts` (e.g. the line importing `EventDispatcher`/`EventListener` from `../core/events`), add a type-only import. Find:

```ts
import { EventDispatcher, EventListener } from './core/events';
```

(The actual existing line — `map.ts` is in `src/map/`, so the path is `'../core/events'`. Locate the real import of `EventDispatcher` and add immediately below it:)

```ts
import type { EmapEventMap } from '../core/event-map';
```

If the existing import is written `from './core/events'` it is wrong relative to `src/map/`; do NOT "fix" unrelated imports — only ADD the new `import type` line using the SAME relative prefix the neighbouring `../core/...` imports in `map.ts` already use. Verify by reading the top of `map.ts` first.

- [ ] **Step 7: Run `tsc` to verify it PASSES**

Run: `npx tsc --noEmit`
Expected: exit 0. `map.on('moveend', …)` now resolves to the keyed overload; `e.center` is `[number, number]`; the `@ts-expect-error` on `e.nope` now correctly fires (and is therefore "used"); the custom-name calls fall through to the generic overload; the augmentation key infers.

- [ ] **Step 8: Run the full suite (runtime non-regression)**

Run: `npx vitest run 2>&1 | tail -3`
Expected: `Test Files 67 passed (67)` / `Tests 1142 passed (1142)` — unchanged. The `.test-d.ts` file is NOT collected by Vitest. Runtime `on/off/once` bodies are byte-unchanged.

- [ ] **Step 9: Commit**

```bash
git add src/core/event-map.test-d.ts src/map/map.ts
git commit -m "feat(map): keyed on/off/once overloads for EmapEventMap (DX P10)"
```

---

### Task 3: Runtime sanity test + CHANGELOG + final verification

**Files:**
- Create: `src/core/event-map.test.ts` (Vitest-executed runtime sanity)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Write the runtime sanity test `src/core/event-map.test.ts`**

Proves the keyed overload routes to the unchanged `super.on` path and the payload arrives intact at runtime. Mirrors the jsdom + canvas-mock + container pattern used by `src/map/camera-facade.test.ts`.

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { Emap } from '../map/map';

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = () => ({
    scale: () => {}, clearRect: () => {}, fillRect: () => {}, strokeRect: () => {},
    beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {},
    fill: () => {}, arc: () => {}, save: () => {}, restore: () => {},
    translate: () => {}, setTransform: () => {}, drawImage: () => {},
    measureText: () => ({ width: 0 }),
  } as any);
});

function container(): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: 800 });
  Object.defineProperty(el, 'clientHeight', { value: 600 });
  document.body.appendChild(el);
  return el;
}

describe('EmapEventMap runtime wiring (DX P10)', () => {
  it('keyed on() delivers the typed payload at runtime', () => {
    const map = new Emap({ container: container() });
    const seen: Array<{ type: string; center?: [number, number] }> = [];
    map.on('moveend', (e) => seen.push({ type: e.type, center: e.center }));
    map.jumpTo({ center: [3, 4], scale: 2 });
    const end = seen.find((s) => s.type === 'moveend');
    expect(end).toBeDefined();
    expect(end!.center).toEqual([3, 4]);
  });

  it('off() unsubscribes a keyed listener', () => {
    const map = new Emap({ container: container() });
    let n = 0;
    const cb = () => { n++; };
    map.on('moveend', cb);
    map.jumpTo({ center: [1, 1], scale: 2 });
    map.off('moveend', cb);
    map.jumpTo({ center: [2, 2], scale: 2 });
    expect(n).toBe(1);
  });

  it('escape-hatch custom event still fires through the generic path', () => {
    const map = new Emap({ container: container() });
    let got = '';
    map.on('myCustomThing', (e: { type: string; payload?: string }) => { got = e.payload ?? ''; });
    map.fire('myCustomThing', { payload: 'hi' });
    expect(got).toBe('hi');
  });
});
```

- [ ] **Step 2: Run the new runtime test — verify it PASSES**

Run: `npx vitest run src/core/event-map.test.ts 2>&1 | tail -4`
Expected: `Test Files 1 passed (1)` / `Tests 3 passed (3)`.

- [ ] **Step 3: Add the CHANGELOG entry**

Open `CHANGELOG.md`, find the `## [Unreleased]` → `### Added` section and the most recent P9 bullet. Add immediately AFTER the P9 bullet:

```markdown
- **Typed `EmapEventMap` (DX P10):** `map.on` / `off` / `once` now give
  event-name autocomplete and payload inference for the camera lifecycle
  (`movestart`/`move`/`moveend`/`zoomstart`/`zoom`/`zoomend`) and the
  `data`/`error`/`selectionchange`/`historychange`/`editmodechange`/
  `crschange`/`resize`/`validationfailed` events. `EmapEventMap` is an
  augmentable `interface` (`declare module` to register custom events);
  unknown event names still compile (escape hatch preserved). Compile-time
  only — zero runtime change. Exported: `EmapEventMap`, `CameraEvent`.
```

- [ ] **Step 4: Full verification gate**

Run each, confirm expected:
- `npx tsc --noEmit` → exit 0
- `npx vitest run 2>&1 | tail -3` → `Test Files 68 passed (68)` / `Tests 1145 passed (1145)` (baseline 1142 + 3 new runtime cases; the `.test-d.ts` adds 0 runtime tests)
- `npm run build 2>&1 | tail -2` → build created, exit 0
- `git diff --stat fb0a43c -- src/ | tail -1` then inspect: only `src/core/event-map.ts` (new), `src/core/event-map.test-d.ts` (new), `src/core/event-map.test.ts` (new), `src/index.ts` (+1 line), `src/map/map.ts` (additive overloads + 1 import). No existing test modified. `git diff` of `src/map/map.ts` shows ONLY the three overload insertions + one `import type` line; all `on/off/once` IMPLEMENTATION bodies byte-identical.

- [ ] **Step 5: Commit**

```bash
git add src/core/event-map.test.ts CHANGELOG.md
git commit -m "test(core): EmapEventMap runtime sanity + CHANGELOG (DX P10)"
```

---

## Self-Review

**1. Spec coverage:**
- §1 Architecture (new file, keyed overloads, byte-unchanged runtime, index export) → Task 1 (file+export), Task 2 (overloads).
- §2 14 members + `Partial<>` for `move`/`historychange` → Task 1 Step 1 (verbatim).
- §3 overload order (mousemove → keyed → generic → feature), augmentable interface, escape hatch → Task 2 Steps 3-6 (exact insertion between the named overloads) + `.test-d.ts` augmentation/escape-hatch assertions.
- §4 testing (`.test-d.ts` tsc-checked, runtime sanity, non-regression, gates) → Task 2 Step 1-2-7-8, Task 3.
- §5 out-of-scope → respected (no `fire()` typing, no closed union, bespoke overloads untouched, runtime bodies untouched).

**2. Placeholder scan:** No TBD/TODO; every code step has complete code; commands have expected output. Step 6 of Task 2 deliberately instructs reading the real import line first rather than guessing the relative path — concrete instruction, not a placeholder.

**3. Type consistency:** `EmapEventMap`, `CameraEvent`, the keyed overload signature `<K extends keyof EmapEventMap>(type: K, listener: (e: { type: K } & EmapEventMap[K]) => void)`, and the import path `../core/event-map` are identical across Tasks 1-3 and match the spec §2/§3 verbatim. Member names match the audited emit sites in spec §2.
