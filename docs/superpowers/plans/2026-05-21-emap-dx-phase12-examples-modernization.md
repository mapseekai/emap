# Examples Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch `test/examples/box-select.html` and `test/examples/lasso-select.html` from the legacy `addControl(new BoxSelectControl())` / `LassoSelectControl()` boilerplate to the P2c handler-direct API (`map.boxSelect.enable()` / `map.lassoSelect.enable()`).

**Architecture:** Two surgical HTML rewrites. The Controls are removed from the `emap` destructured imports and from `addControl(...)` calls; the handlers are activated directly. `lasso-select.html`'s box↔lasso toggle is rewritten with disable-other-first ordering and a `try/catch` that surfaces the handler's mutual-exclusivity throw — which also fixes a latent throw bug present in the current file post-P2c (calling `boxSelect.enable()` while `lassoSelect` is still enabled throws under the P2c handler mutex).

**Tech Stack:** Static HTML + bundled emap (no TypeScript / no Vitest coverage for these examples). Spec: `docs/superpowers/specs/2026-05-21-emap-dx-phase12-examples-modernization-design.md`.

**Conventions:** No `Co-Authored-By` trailers. Plain `git` only. OpenSpec skipped. `package.json` stays `0.2.0`. Ignore GitNexus/Rust-skills hook output. Zero `src/` changes; full Vitest suite remains green at 1147/68 by construction. No CHANGELOG entry (example-only).

**Baseline:** `npx tsc --noEmit` exit 0; `npx vitest run` → 1147 / 68; `npm run build` exit 0. Work on `master` (authorized).

---

### Task 1: `box-select.html` — switch to `map.boxSelect.enable()`

**Files:** Modify `test/examples/box-select.html`.

- [ ] **Step 1: Apply the import + activation edits**

In `test/examples/box-select.html` find this exact line:

```html
    const { Emap, TopologySource, NavigationControl, HistoryControl, BoxSelectControl } = emap;
```

Replace with:

```html
    const { Emap, TopologySource, NavigationControl, HistoryControl } = emap;
```

Then find:

```html
    map.addControl(new NavigationControl(), 'top-left');
    map.addControl(new HistoryControl(), 'top-left');
    map.addControl(new BoxSelectControl());
    map.bindHistoryShortcuts();
```

Replace with:

```html
    map.addControl(new NavigationControl(), 'top-left');
    map.addControl(new HistoryControl(), 'top-left');
    // Activate shift+drag box selection via the named handler (P2c).
    // Alternative: `map.addControl(new BoxSelectControl())` for a toolbar-button surface.
    map.boxSelect.enable();
    map.bindHistoryShortcuts();
```

- [ ] **Step 2: Verify the file**

Run: `grep -nE "BoxSelectControl|new BoxSelectControl\\(\\)|map\\.boxSelect\\.enable\\(\\)" test/examples/box-select.html`
Expected output: ONE line — `    map.boxSelect.enable();` plus the comment line mentioning `BoxSelectControl` as an alternative. **No** `new BoxSelectControl()` call, **no** `BoxSelectControl` in the destructured import.

Run: `grep -c "BoxSelectControl" test/examples/box-select.html`
Expected: `1` (only the comment-line reference).

- [ ] **Step 3: Gates (gates are cheap; run them once per task)**

- `npx tsc --noEmit` → exit 0
- `npx vitest run 2>&1 | tail -3` → `Test Files 68 passed (68)` / `Tests 1147 passed (1147)` (unchanged)
- `npm run build 2>&1 | tail -2` → artifacts created, exit 0
- `git diff --stat HEAD -- test/examples/ | tail -3` → exactly one file (`test/examples/box-select.html`)

- [ ] **Step 4: Commit**

```bash
git add test/examples/box-select.html
git commit -m "docs(examples): box-select.html — use map.boxSelect.enable() (DX P12)"
```

- [ ] **Step 5: Self-review `git show --stat HEAD`**

Expected: exactly 1 file changed; no Co-Authored-By; the only diff is the two find/replace blocks from Step 1.

---

### Task 2: `lasso-select.html` — switch to handler-direct + fix toggle ordering

**Files:** Modify `test/examples/lasso-select.html`.

- [ ] **Step 1: Apply the import + activation edits**

In `test/examples/lasso-select.html` find:

```html
    const { Emap, TopologySource, NavigationControl, HistoryControl, BoxSelectControl, LassoSelectControl } = emap;

    const map = new Emap({ container: 'map' });
    map.addControl(new NavigationControl(), 'top-left');
    map.addControl(new HistoryControl(), 'top-left');
    map.bindHistoryShortcuts();

    // Both controls installed at once. Switching is via enable() / disable().
    const boxSelect = new BoxSelectControl();
    const lassoSelect = new LassoSelectControl();
    map.addControl(boxSelect);
    map.addControl(lassoSelect);
    lassoSelect.disable();  // Start with rect active.
```

Replace with:

```html
    const { Emap, TopologySource, NavigationControl, HistoryControl } = emap;

    const map = new Emap({ container: 'map' });
    map.addControl(new NavigationControl(), 'top-left');
    map.addControl(new HistoryControl(), 'top-left');
    map.bindHistoryShortcuts();

    // Box + lasso are named handlers on the map (P2c). Switching is one
    // disable-then-enable pair; the handlers are mutually exclusive
    // (boxSelect.enable() throws if lassoSelect is enabled, and vice
    // versa) — we always disable the other first.
    // Alternative for toolbar-button surfaces:
    //   map.addControl(new BoxSelectControl()) / new LassoSelectControl()
    map.boxSelect.enable();   // Start with rect active.
```

- [ ] **Step 2: Rewrite the toggle function**

In the same file find:

```html
    function pickTool(name) {
      if (name === 'box') {
        boxSelect.enable();
        lassoSelect.disable();
        toolBoxBtn.classList.add('active');
        toolLassoBtn.classList.remove('active');
        status.textContent = '矩形选择 — Shift+拖拽画矩形';
      } else {
        boxSelect.disable();
        lassoSelect.enable();
        toolBoxBtn.classList.remove('active');
        toolLassoBtn.classList.add('active');
        status.textContent = '套索选择 — Shift+拖拽画自由曲线';
      }
    }
```

Replace with (note the disable-first ordering and the try/catch around the mutex throw):

```html
    function pickTool(name) {
      try {
        if (name === 'box') {
          // Disable the OTHER first so boxSelect.enable() doesn't trip
          // the mutual-exclusivity throw.
          map.lassoSelect.disable();
          map.boxSelect.enable();
          toolBoxBtn.classList.add('active');
          toolLassoBtn.classList.remove('active');
          status.textContent = '矩形选择 — Shift+拖拽画矩形';
        } else {
          map.boxSelect.disable();
          map.lassoSelect.enable();
          toolBoxBtn.classList.remove('active');
          toolLassoBtn.classList.add('active');
          status.textContent = '套索选择 — Shift+拖拽画自由曲线';
        }
      } catch (err) {
        status.textContent = '切换失败: ' + (err && err.message ? err.message : String(err));
      }
    }
```

- [ ] **Step 3: Verify the file**

Run: `grep -nE "BoxSelectControl|LassoSelectControl|new (Box|Lasso)SelectControl\\(\\)|map\\.(box|lasso)Select\\." test/examples/lasso-select.html`
Expected:
- ONE comment line mentioning `BoxSelectControl` and `LassoSelectControl` as alternatives (the comment in Step 1's replacement).
- `map.boxSelect.enable();` (Step 1)
- `map.lassoSelect.disable();`, `map.boxSelect.enable();`, `map.boxSelect.disable();`, `map.lassoSelect.enable();` (Step 2)
- **No** `new BoxSelectControl()` / `new LassoSelectControl()` runtime calls.
- **No** lingering `boxSelect.` / `lassoSelect.` (the bare-variable references — they MUST all be prefixed with `map.` now).

Run: `grep -nE "\\bboxSelect\\.|\\blassoSelect\\." test/examples/lasso-select.html`
Expected: ZERO matches (every reference is now `map.boxSelect.` / `map.lassoSelect.`).

- [ ] **Step 4: Gates**

- `npx tsc --noEmit` → exit 0
- `npx vitest run 2>&1 | tail -3` → `Test Files 68 passed (68)` / `Tests 1147 passed (1147)` (unchanged)
- `npm run build 2>&1 | tail -2` → artifacts created, exit 0
- `git diff --stat HEAD -- test/examples/ | tail -3` → exactly one file (`test/examples/lasso-select.html`)

- [ ] **Step 5: Commit**

```bash
git add test/examples/lasso-select.html
git commit -m "docs(examples): lasso-select.html — use map.boxSelect/lassoSelect handlers + fix toggle ordering (DX P12)"
```

- [ ] **Step 6: Self-review `git show --stat HEAD`**

Expected: exactly 1 file changed; no Co-Authored-By; both find/replace blocks from Steps 1–2 present; legacy `boxSelect`/`lassoSelect` local variables and `new BoxSelectControl()`/`new LassoSelectControl()` are gone.

---

## Self-Review

**1. Spec coverage:**
- §1 scope (2 files: box-select.html, lasso-select.html) → Tasks 1 + 2 (one per file).
- §2 box-select recipe (drop Control import + addControl, add `map.boxSelect.enable()` + alternative comment) → Task 1 Step 1.
- §3 lasso-select recipe (drop both Control imports + addControls, replace the two-instance toggle with handler-direct + try/catch + alternative comment) → Task 2 Steps 1 + 2.
- §4 verification (tsc 0, suite 1147/68, build 0, grep invariants) → both tasks' verify + gates steps.
- §5 out-of-scope respected: no other example touched; no src/ change; no CHANGELOG.

**2. Placeholder scan:** No TBD/TODO. Every find block is a verbatim multi-line excerpt from the actual file content (verified in the spec). Replacements are complete code. Commands have expected outputs.

**3. Consistency:** ClassNames in the alternative comments (`BoxSelectControl`, `LassoSelectControl`) match the file names and the actual exported class names. Handler accessors (`map.boxSelect`, `map.lassoSelect`) match the Emap getters at `src/map/map.ts:1014,1016`. The toggle's disable-first ordering matches the handlers' mutex semantics documented in `src/core/handlers/box-select.ts` / `lasso-select.ts` (`cannot enable boxSelect: lassoSelect is enabled`).
