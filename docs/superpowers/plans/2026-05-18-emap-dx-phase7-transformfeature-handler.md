# emap DX Phase 7 — `transformFeature` Handler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Absorb the pointer→`editSession` translate/rotate/scale boilerplate into an arbiter-driven `TransformFeatureHandler` (`map.transformFeature`). Design of record: `docs/superpowers/specs/2026-05-18-emap-dx-phase7-transformfeature-handler-design.md` (§15). Purely additive (no existing control). Mirrors P5/P6 execution.

**Architecture:** Add `'transform'` to `EditMode` (the only core/shared edit — verified safe). `TransformFeatureHandler` is **modal** (`enable()`→`setEditMode('transform')`, inheriting the `map.ts:185` pan-disable + `editmodechange` + cross-mode auto-deactivate). It drives the existing `map.editSession.beginTranslateSession()`/`beginAffineSession()`; the angle/scale-delta math currently inlined in `feature-rotate-scale.html` moves verbatim into the handler. No new pointer event kind (uses `down`/`move`/`up`). `Escape`-cancel is a handler-owned `window keydown` listener. No thin-shell task — there is no existing `TransformControl`; the two examples are rewritten to dogfood the handler.

**Tech Stack:** TypeScript 5 (strict), Vitest 1.x (jsdom), Rollup.

**Execution order:** T1 → T2 → T4 → T5.

## Design Decisions (challenge these in review)

1. **`EditMode` += `'transform'`** — single union-literal addition in `src/map/edit-state-store.ts:8`. Verified safe: `EditStateStore.setMode` only special-cases `'vertex'`/`'draw'` (a `'transform'` set drops both, needs no own sub-state — the session holds transform state); `map.ts:185` `mode==='none' ? dragPan.enable() : dragPan.disable()` auto-disables pan for `'transform'` + fires `editmodechange`. No exhaustive `EditMode` switch anywhere breaks.
2. **Modal** (user-approved), like `vertexEdit`/`drawFeature`. `enable()`→`setEditMode('transform')`+keydown; `disable()`→cancel session+`setEditMode('none')`+remove keydown+`render()`. Constructor subscribes `editmodechange`; `mode!=='transform' && isEnabled()` → `_quietDisable()` (cancel session + remove keydown, NO `setEditMode`); recursion-guarded by setting `_enabled=false` before any `setEditMode`.
3. **Verbatim port of the example math.** The session-driving + angle/scale-delta logic is moved from `test/examples/feature-translate.html` / `feature-rotate-scale.html` (the canonical reference). Element-local px → data coords via `map.unproject(ev.point.x, ev.point.y)` (the examples' `pixelToMap`). No new math invented. `session.origin` is data-space (pivot from `beginAffineSession`); `cur` is `unproject`'d → same space (consistent, as in the example).
4. **Selection coupling = hit→select(replace if unselected)→session** (user-approved). Modifier-driven select modes are NOT transformFeature's concern (delegated to `clickSelect`/box); the handler only ensures the hit feature is selected then transforms.
5. **`mode` read at `down`-time.** A session is per-gesture (begin on `down`, commit on `up`, cancel on `Escape`); switching `setOptions({mode})` between gestures is trivial, no mid-session handling.
6. **Returns `'exclusive'` only while a session is live**; missed `down`/no-session → `'passthrough'`. Priority `['lassoSelect','boxSelect','clickSelect','transformFeature','drawFeature','vertexEdit','dragPan']`.
7. **Purely additive.** `map.editSession` + session/command/matrix APIs byte-identical. No control. Default `new Emap()` unchanged (disabled by default; no always-on listener — keydown added only on `enable()`; no arbiter event-kind added).

---

## File Structure

- Modify `src/map/edit-state-store.ts` — `EditMode` += `'transform'`.
- Modify `src/map/edit-state-store.test.ts` (or create if absent) — `setMode('transform')` behavior.
- Create `src/core/handlers/transform-feature.ts` — `TransformFeatureHandler` + `TransformFeatureOptions`.
- Create `src/core/handlers/transform-feature.test.ts`.
- Modify `src/core/handler-manager.ts` — `PRIORITY` gains `'transformFeature'` (Task 4).
- Modify `src/map/map.ts` — construct + register handler; `get transformFeature()`.
- Modify `src/index.ts` — export `TransformFeatureHandler` + `TransformFeatureOptions`.
- Modify `src/map/handler-registry.test.ts` — e2e (disabled by default; enable→transform mode→pan disabled; cross-mode with vertexEdit).
- Rewrite `test/examples/feature-translate.html`, `test/examples/feature-rotate-scale.html`.
- Modify `CHANGELOG.md`.

---

### Task 1: `EditMode` gains `'transform'`

**Files:** Modify `src/map/edit-state-store.ts`; Test `src/map/edit-state-store.test.ts` (create if it does not exist); add a `map.ts` e2e in `src/map/handler-registry.test.ts`.

- [ ] **Step 1: Write the failing test**

First check whether `src/map/edit-state-store.test.ts` exists (`ls src/map/edit-state-store.test.ts`). Add (or create the file with) this case:

```ts
// (if creating the file) // @vitest-environment jsdom NOT needed — pure logic
import { describe, it, expect, vi } from 'vitest';
import { EditStateStore } from './edit-state-store';

describe('EditStateStore — transform mode', () => {
  it("setMode('transform') drops vertex/draw sub-state and fires one change", () => {
    const onChange = vi.fn();
    const s = new EditStateStore(onChange);
    s.setVertex({ /* minimal */ } as any);
    onChange.mockClear();
    s.setMode('transform');
    expect(s.mode).toBe('transform');
    expect(s.vertex).toBeNull();
    expect(s.draw).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toMatchObject({ modeChanged: true, current: { mode: 'transform' } });
  });
});
```
(Use the real minimal `EditVertexState` shape `setVertex` accepts — inspect the type; if a full object is awkward, `s.setVertex(null)` then assert `setMode('transform')` still fires one `modeChanged` change with `current.mode==='transform'`. Keep the assertion meaningful: mode set, vertex/draw nulled, exactly one change with `modeChanged:true`.)

And append to `src/map/handler-registry.test.ts` (inside its top `describe`, reuse `container()`):

```ts
  it("setEditMode('transform') disables dragPan and fires editmodechange; 'none' re-enables", () => {
    const map = new Emap({ container: container() });
    const modes: string[] = [];
    map.on('editmodechange', (e: any) => modes.push(e.mode));
    map.setEditMode('transform');
    expect(map.getEditMode()).toBe('transform');
    expect(map.dragPan.isEnabled()).toBe(false);
    map.setEditMode('none');
    expect(map.dragPan.isEnabled()).toBe(true);
    expect(modes).toEqual(['transform', 'none']);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/map/edit-state-store.test.ts src/map/handler-registry.test.ts -t "transform"`
Expected: FAIL — `'transform'` not assignable to `EditMode` (tsc) / mode not accepted.

- [ ] **Step 3: Implement**

`src/map/edit-state-store.ts` line 8:
```ts
export type EditMode = 'none' | 'vertex' | 'draw' | 'transform';
```
No other change — `setMode` already drops `vertex` when `mode!=='vertex'` and `draw` when `mode!=='draw'`, which is correct for `'transform'`. `map.ts:185` already handles any non-`'none'` mode. Verify (read, don't edit) that nothing else does an exhaustive `switch (mode)` that would now be non-exhaustive; if one exists and tsc flags it, STOP and report BLOCKED with the location (do not silently add a case without surfacing it).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/map/edit-state-store.test.ts src/map/handler-registry.test.ts`
Expected: PASS (new + existing).

- [ ] **Step 5: GATE**

`npx tsc --noEmit` exit 0 AND `npx vitest run` full suite green (existing edit-mode/pan/zoom + P1–P6 unaffected — additive literal). Report exact count (baseline 1084 + 2 new).

- [ ] **Step 6: Commit**

```bash
git add src/map/edit-state-store.ts src/map/edit-state-store.test.ts src/map/handler-registry.test.ts
git commit -m "feat(core): EditMode gains 'transform' (DX P7)"
```

---

### Task 2: `TransformFeatureHandler`

**Files:** Create `src/core/handlers/transform-feature.ts`, `src/core/handlers/transform-feature.test.ts`.

Read first: `test/examples/feature-translate.html` + `test/examples/feature-rotate-scale.html` (the reference interaction — port its math), `src/map/edit-sessions.ts` (`beginTranslateSession`/`beginAffineSession` signatures + the `FeatureTranslateSession`/`FeatureAffineSession`/`DragSessionOptions` types — trace where they're declared; `src/index.ts:24-25` re-exports them), `src/core/handlers/draw-feature.ts` (the P6 modal-handler shape to mirror: ctor `editmodechange` subscription, `_quietDisable`, keydown self-listener, config/gate style), `src/core/handler.ts` (`Handler`/`HandlerResult`/`NormalizedPointerEvent`).

- [ ] **Step 1: Create the handler**

`src/core/handlers/transform-feature.ts`:

```ts
import { EventDispatcher } from '../events';
import type { Handler, HandlerResult, NormalizedPointerEvent } from '../handler';
import type { Emap } from '../../map/map';
// Import the session types + DragSessionOptions + matrix helpers from
// their canonical modules (trace from src/index.ts:24-25 / edit-sessions.ts;
// rotateMatrix/scaleMatrix live in src/edit/commands/feature-affine — verify):
import type { FeatureTranslateSession, FeatureAffineSession } from '../../map/edit-sessions';
import type { DragSessionOptions } from '../../map/types';
import { rotateMatrix, scaleMatrix } from '../../edit/commands/feature-affine';

export interface TransformFeatureOptions {
  /** Active transform. Default 'translate'. */
  mode?: 'translate' | 'rotate' | 'scale';
  /** Forwarded to begin*Session (e.g. { splitSharedArcs }). */
  session?: DragSessionOptions;
}

/**
 * Named `transformFeature` handler. Modal (`enable()`→`setEditMode
 * ('transform')`). On pointerdown over a feature it selects it (replace,
 * if not already selected) and opens the matching editSession; pointermove
 * streams the per-frame delta (translate dx/dy, or rotate/scale matrix vs
 * the session origin); pointerup commits (one undo entry); Escape cancels.
 * Absorbs the boilerplate previously hand-wired in the transform examples.
 */
export class TransformFeatureHandler extends EventDispatcher implements Handler<TransformFeatureOptions> {
  readonly name = 'transformFeature';
  private _enabled = false;
  private _opts: TransformFeatureOptions = {};
  private _translate: FeatureTranslateSession | null = null;
  private _affine: FeatureAffineSession | null = null;
  private _lastMap: [number, number] | null = null;   // translate ref
  private _prevAngle = 0;                                // rotate ref
  private _prevDist = 1;                                 // scale ref
  private _onKeyDownBound = (e: KeyboardEvent) => this._onKeyDown(e);

  constructor(private _map: Emap) {
    super();
    this._map.on('editmodechange', (e: { mode: string }) => {
      if (e.mode !== 'transform' && this._enabled) this._quietDisable();
    });
  }

  get _mode(): 'translate' | 'rotate' | 'scale' { return this._opts.mode ?? 'translate'; }

  enable(): void {
    if (this._enabled) return;
    this._enabled = true;
    this._map.setEditMode('transform');
    window.addEventListener('keydown', this._onKeyDownBound);
  }
  disable(): void {
    if (!this._enabled) return;
    this._enabled = false;
    this._cancelSession();
    window.removeEventListener('keydown', this._onKeyDownBound);
    this._map.setEditMode('none');
    this._map.render();
  }
  private _quietDisable(): void {
    this._enabled = false;
    this._cancelSession();
    window.removeEventListener('keydown', this._onKeyDownBound);
    this._map.render();
  }
  isEnabled(): boolean { return this._enabled; }
  setOptions(o: Partial<TransformFeatureOptions>): void { this._opts = { ...this._opts, ...o }; }
  getOptions(): Readonly<TransformFeatureOptions> { return this._opts; }

  private _cancelSession(): void {
    if (this._translate) { this._translate.cancel(); this._translate = null; }
    if (this._affine) { this._affine.cancel(); this._affine = null; }
    this._lastMap = null;
  }
  private _onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && (this._translate || this._affine)) this._cancelSession();
  }

  handlePointer(ev: NormalizedPointerEvent): HandlerResult {
    if (!this._enabled) return 'passthrough';

    if (ev.kind === 'down') {
      if (ev.button !== 0) return 'passthrough';
      const point: [number, number] = [ev.point.x, ev.point.y];
      const hits = this._map.queryFeatures(point);
      if (!hits.length) return 'passthrough';
      // Ensure the hit feature is selected (replace) before transforming.
      this._map.select(hits, { mode: 'replace' });
      const cur = this._map.unproject(ev.point.x, ev.point.y);
      if (this._mode === 'translate') {
        this._translate = this._map.editSession.beginTranslateSession(this._opts.session);
        if (!this._translate) return 'passthrough';
        this._lastMap = cur;
      } else {
        this._affine = this._map.editSession.beginAffineSession(this._opts.session);
        if (!this._affine) return 'passthrough';
        const [ox, oy] = this._affine.origin;
        this._prevAngle = Math.atan2(cur[1] - oy, cur[0] - ox);
        this._prevDist = Math.hypot(cur[0] - ox, cur[1] - oy) || 1;
      }
      return 'exclusive';
    }

    if (ev.kind === 'move') {
      if (!this._translate && !this._affine) return 'passthrough';
      const cur = this._map.unproject(ev.point.x, ev.point.y);
      if (this._translate) {
        if (this._lastMap) this._translate.move(cur[0] - this._lastMap[0], cur[1] - this._lastMap[1]);
        this._lastMap = cur;
      } else if (this._affine) {
        const [ox, oy] = this._affine.origin;
        if (this._mode === 'rotate') {
          const ang = Math.atan2(cur[1] - oy, cur[0] - ox);
          const delta = ang - this._prevAngle;
          if (delta !== 0) this._affine.applyDelta(rotateMatrix(delta, ox, oy));
          this._prevAngle = ang;
        } else { // scale
          const dist = Math.hypot(cur[0] - ox, cur[1] - oy) || 1;
          const factor = dist / this._prevDist;
          if (factor !== 1) this._affine.applyDelta(scaleMatrix(factor, factor, ox, oy));
          this._prevDist = dist;
        }
      }
      return 'exclusive';
    }

    if (ev.kind === 'up') {
      if (!this._translate && !this._affine) return 'passthrough';
      if (this._translate) { this._translate.commit(); this._translate = null; }
      if (this._affine) { this._affine.commit(); this._affine = null; }
      this._lastMap = null;
      return 'passthrough';
    }

    return 'passthrough';
  }
}
```
> NOTE: verify the EXACT import paths for `FeatureTranslateSession`/`FeatureAffineSession` (where `edit-sessions.ts` imports them from, lines ~30-31), `DragSessionOptions`, and `rotateMatrix`/`scaleMatrix` (`feature-affine` command module) — fix to the real locations; do NOT invent. Verify `map.editSession` is the public accessor (it is — `get editSession()`), and `map.queryFeatures(point)`/`map.select(refs,{mode})`/`map.unproject`/`map.setEditMode`/`map.render` signatures match (all verified to exist). If `select` needs deduped `FeatureRef[]` not raw `QueriedFeature[]`, mirror exactly what the examples pass (`map.select(features, {mode})` — they pass the queryFeatures result directly, so do the same). If any signature genuinely mismatches, STOP/BLOCKED with the exact tsc error — no `any` casts.

- [ ] **Step 2: Tests**

Create `src/core/handlers/transform-feature.test.ts`. Stub `Emap` with spies: `queryFeatures`, `select`, `unproject` (e.g. `(x,y)=>[x/10,y/10]`), `setEditMode`, `render`, `on` (capture the editmodechange cb), and `editSession: { beginTranslateSession: vi.fn(()=>translateStub), beginAffineSession: vi.fn(()=>affineStub) }` where `translateStub = { move: vi.fn(), commit: vi.fn(()=>true), cancel: vi.fn() }` and `affineStub = { origin:[0,0], applyDelta: vi.fn(), commit: vi.fn(()=>true), cancel: vi.fn() }`. Cover:
- `name === 'transformFeature'`, disabled by default, `handlePointer` passthrough when disabled.
- `enable()` → `setEditMode('transform')` called + `isEnabled()` true + a `window` `keydown` listener added (assert via `vi.spyOn(window,'addEventListener')` or by dispatching Escape after a session and checking cancel).
- `disable()` → session cancelled (if any) + `setEditMode('none')` + keydown removed + `isEnabled()` false.
- `down` (button 0) hit → `select(hits,{mode:'replace'})` + `beginTranslateSession` (mode default translate) + returns `'exclusive'`.
- `down` miss (queryFeatures → []) → `'passthrough'`, no session, no select.
- `down` button≠0 → `'passthrough'`.
- translate `move` → `translateStub.move` called with the expected `(dx,dy)` deltas given the stub `unproject` (compute expected literals); `up` → `translateStub.commit` called, subsequent `move` → `'passthrough'`.
- `setOptions({mode:'rotate'})` then `down` → `beginAffineSession`; `move` → `affineStub.applyDelta` called (with a `rotateMatrix(...)` result — assert it was called; you may `vi.spyOn` the real `rotateMatrix` or just assert `applyDelta` invoked with an object); `setOptions({mode:'scale'})` path → `scaleMatrix`.
- `Escape` keydown mid-session → `cancel` called, session cleared (next `move` → passthrough).
- cross-mode: invoke the captured `editmodechange` cb with `{mode:'vertex'}` while enabled → `_quietDisable` (session cancelled, `isEnabled()` false, `setEditMode` NOT called again — assert the stub's setEditMode call count unchanged after).

- [ ] **Step 3: Run + GATE**

`npx vitest run src/core/handlers/transform-feature.test.ts` all pass. `npx tsc --noEmit` exit 0. `npx vitest run` full suite green (report exact: 1086 + the new handler cases). `npm run build` exit 0. `map.test.ts` unaffected. Real type mismatch in the session/select API → STOP/BLOCKED with the exact tsc error.

- [ ] **Step 4: Commit**

```bash
git add src/core/handlers/transform-feature.ts src/core/handlers/transform-feature.test.ts
git commit -m "feat(core): TransformFeatureHandler — modal translate/rotate/scale (DX P7)"
```

---

### Task 4: wire `TransformFeatureHandler` into Emap + priority + exports

**Files:** Modify `src/core/handler-manager.ts`, `src/map/map.ts`, `src/index.ts`; Test `src/map/handler-registry.test.ts`.

- [ ] **Step 1: Write the failing test**

Append inside the existing top `describe` of `src/map/handler-registry.test.ts`:

```ts
  it('exposes a disabled-by-default transformFeature handler', () => {
    const map = new Emap({ container: container() });
    expect(map.transformFeature.name).toBe('transformFeature');
    expect(map.transformFeature.isEnabled()).toBe(false);
  });

  it('transformFeature.enable() enters transform mode (pan disabled); disable() restores', () => {
    const map = new Emap({ container: container() });
    map.transformFeature.enable();
    expect(map.getEditMode()).toBe('transform');
    expect(map.dragPan.isEnabled()).toBe(false);
    map.transformFeature.disable();
    expect(map.getEditMode()).toBe('none');
    expect(map.dragPan.isEnabled()).toBe(true);
  });

  it('enabling vertexEdit cross-deactivates an active transformFeature', () => {
    const map = new Emap({ container: container() });
    map.transformFeature.enable();
    map.vertexEdit.enable();                 // setEditMode('vertex') → editmodechange
    expect(map.transformFeature.isEnabled()).toBe(false);
    expect(map.getEditMode()).toBe('vertex');
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/map/handler-registry.test.ts -t "transformFeature"` → FAIL (`map.transformFeature` undefined).

- [ ] **Step 3: Implement**

(a) `src/core/handler-manager.ts` `PRIORITY` → insert `'transformFeature'` before `'drawFeature'`:
```ts
const PRIORITY = ['lassoSelect', 'boxSelect', 'clickSelect', 'transformFeature', 'drawFeature', 'vertexEdit', 'dragPan'] as const;
```
(b) `src/map/map.ts`:
- Import: `import { TransformFeatureHandler, type TransformFeatureOptions } from '../core/handlers/transform-feature';`
- Field: `private _transformFeature!: TransformFeatureHandler;`
- Construct + register AFTER `this._handlers.register(this._drawFeature);` and BEFORE `this._handlers.attach(this._canvasContainer);`:
  ```ts
  this._transformFeature = new TransformFeatureHandler(this);
  this._handlers.register(this._transformFeature);
  ```
- Getter near `get drawFeature()`:
  ```ts
  get transformFeature(): Handler<TransformFeatureOptions> { return this._transformFeature; }
  ```
- Do NOT touch the `editmodechange`/`dragPan` toggle (~line 185).
(c) `src/index.ts` after the P6 drawFeature exports:
```ts
export { TransformFeatureHandler } from './core/handlers/transform-feature';
export type { TransformFeatureOptions } from './core/handlers/transform-feature';
```

- [ ] **Step 4: Run + GATE**

`npx vitest run src/map/handler-registry.test.ts` → existing + 3 new pass. `npx tsc --noEmit` exit 0. `npx vitest run` full suite. `npm run build` exit 0. **`src/map/map.test.ts` edit-mode/pan/zoom + ALL P1–P6 byte-identical** (transformFeature disabled by default). Regression → STOP/BLOCKED.

- [ ] **Step 5: Commit**

```bash
git add src/core/handler-manager.ts src/map/map.ts src/index.ts src/map/handler-registry.test.ts
git commit -m "feat(map): expose map.transformFeature handler; priority slot (DX P7)"
```

---

### Task 5: rewrite examples + CHANGELOG

**Files:** Rewrite `test/examples/feature-translate.html`, `test/examples/feature-rotate-scale.html`; Modify `CHANGELOG.md`.

- [ ] **Step 1: Rewrite the two examples**

Replace the hand-wired mousedown/move/up + angle/scale math with the canonical recipe. Keep each example's existing file-load UI, `NavigationControl`/`HistoryControl`, status text, and the empty-space-click-clears-selection behavior. The transform interaction collapses to:
```js
// feature-translate.html
map.transformFeature.setOptions({ mode: 'translate' });
map.transformFeature.enable();
// (no manual mousedown/move/up — the handler drives the session)
```
```js
// feature-rotate-scale.html — keep the t/r/s switcher UI, but it now just:
function setMode(m) { // 't'|'r'|'s'
  map.transformFeature.setOptions({ mode: m === 't' ? 'translate' : m === 'r' ? 'rotate' : 'scale' });
}
map.transformFeature.enable();
setMode('t');
```
Delete the now-obsolete `pixelToMap`/`beginTranslateSession`/`beginAffineSession`/`rotateMatrix`/`scaleMatrix`/window-listener boilerplate that the handler now owns. Keep a short comment block explaining `map.transformFeature` is the one-liner replacing the old recipe (these examples double as the migration doc). Verify each rewritten example still loads a dataset and the transform works by reading the file for obvious breakage (no automated test for HTML playgrounds; ensure no dangling references to removed vars).

- [ ] **Step 2: CHANGELOG**

Add after the Phase-6 bullet in `CHANGELOG.md` `[Unreleased]` `### Added`:
```markdown
- DX Phase 7 (toward 0.3.0): feature transform is now the arbiter-driven
  modal `map.transformFeature` handler (`setOptions({ mode:
  'translate'|'rotate'|'scale' })`, `enable/disable/isEnabled/getOptions`).
  pointerdown over a feature selects + opens the matching `editSession`;
  drag streams the delta; pointerup commits one undo entry; `Escape`
  cancels. `EditMode` gained `'transform'` (enters the modal pan-disable +
  `editmodechange` like vertex/draw; cross-deactivates with
  vertexEdit/drawFeature). The headless `map.editSession` API is unchanged
  — this only absorbs the pointer→session boilerplate. Disabled by default
  → `new Emap()` behavior unchanged. The `feature-translate` /
  `feature-rotate-scale` examples are rewritten to the one-line recipe.
```

- [ ] **Step 3: Commit**

```bash
git add test/examples/feature-translate.html test/examples/feature-rotate-scale.html CHANGELOG.md
git commit -m "docs: rewrite transform examples to map.transformFeature + CHANGELOG (DX P7)"
```

---

## Self-Review

**1. Spec coverage (§15):** §15.2 modal + `EditMode 'transform'` → Task 1 (enum literal + edit-state-store + map.ts e2e); enable/disable/_quietDisable + ctor `editmodechange` recursion-guarded → Task 2; cross-mode with vertexEdit → Task 4 test. §15.3 no new event kind → Task 2 uses only down/move/up. §15.4 handlePointer mapping (down→select-replace+begin session+exclusive; move→translate `move`/affine `applyDelta` with rotate/scale matrix vs origin; up→commit; Escape→cancel) → Task 2 code is the verbatim port of the example math. §15.5 `TransformFeatureOptions {mode?, session?}`, mode read at down-time → Task 2. §15.6 purely additive, editSession untouched, no control → no thin-shell task; Task 4 only adds getter/register/export. §15.7 examples rewritten → Task 5. §15.8 back-compat (disabled default, no always-on listener, editSession byte-identical) → Tasks 2/4 (default-off) + Task 5 keeps editSession usage out. §15.9 testing (handler unit, edit-state-store, e2e) → Tasks 1/2/4. §15.10 phasing → 4 tasks, each commit green, T1→T2→T4→T5. Every §15 requirement mapped.

**2. Placeholder scan:** No TBD/TODO. The handler code is concrete (the example math transcribed with `ev.point`+`map.unproject`); two NOTE callouts are import-path/signature verification instructions with an explicit STOP-if-mismatch-no-`any` rule (P5/P6-proven). Task 5 references the exact recipe; "verify by reading for dangling refs" is the correct check for un-testable HTML playgrounds.

**3. Type consistency:** `EditMode` extended once (Task 1), consumed by `setEditMode('transform')` in Task 2 + asserted in Tasks 1/4. `Handler<TransformFeatureOptions>` matches the P1 interface; `TransformFeatureOptions` defined once (Task 2), exported (Task 4). `FeatureTranslateSession`/`FeatureAffineSession`/`DragSessionOptions`/`rotateMatrix`/`scaleMatrix` imported from their canonical modules (Task 2 NOTE pins verification). `map.transformFeature` getter returns `Handler<TransformFeatureOptions>` (Task 4); `name='transformFeature'` (Task 2) matches the `PRIORITY` literal (Task 4). `_quietDisable` sets `_enabled=false` before any `setEditMode`, consistent with the ctor `editmodechange` guard (Task 2) — same recursion-guard discipline proven in P6. Session field type `FeatureTranslateSession | FeatureAffineSession | null` consistent across begin/move/commit/cancel paths.

Plan is internally consistent and scoped to one shippable unit: an additive modal transform handler that absorbs the example boilerplate over the unchanged `editSession` API, with one safe `EditMode` literal extension and zero default-path behavior change.
