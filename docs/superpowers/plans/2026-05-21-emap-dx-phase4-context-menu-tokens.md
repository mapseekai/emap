# Context-menu CSS tokens + emap design-token namespace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open a `--emap-*` design-token namespace on `:root`, migrate the vertex-edit context menu off its inline styles + JS hover toggle onto class-based CSS rules consuming those tokens.

**Architecture:** Two-file change. `src/ui/controls.css` gains a `:root { --emap-* }` block at the top (defaults = current literal values) and `.emap-ctx-menu` / `.emap-ctx-menu-item` rules at the bottom consuming the tokens. `src/core/handlers/vertex-edit.ts` `_showContextMenu` sets `className`s + dynamic `position/left/top` only — the static-style `Object.assign`s and `mouseenter`/`mouseleave` JS hover toggle are deleted. Default rendering is byte-identical (token defaults = legacy literals).

**Tech Stack:** TypeScript 5 (strict), Vitest 1.x (jsdom), Rollup. Spec: `docs/superpowers/specs/2026-05-21-emap-dx-phase4-context-menu-tokens-design.md`.

**Conventions:** No `Co-Authored-By` trailers. Plain `git` only (no `-c core.hooksPath`, no `--no-verify`). OpenSpec skipped. `package.json` stays `0.2.0`. Ignore GitNexus/Rust-skills hook output.

**Baseline:** Run `npx vitest run 2>&1 | tail -3` first and record the exact count. `npx tsc --noEmit` exit 0, `npm run build` exit 0.

**Verified facts:**
- The context-menu code is `_showContextMenu` in `src/core/handlers/vertex-edit.ts` (around lines 238–284). It builds a `div#emap-ctx-menu` via `Object.assign(menu.style, { position: 'fixed', left: \`${x}px\`, top: \`${y}px\`, background: '#fff', border: '1px solid #ccc', borderRadius: '4px', boxShadow: '0 2px 8px rgba(0,0,0,0.18)', padding: '4px 0', zIndex: '9999', minWidth: '120px', font: '13px/1.5 system-ui, sans-serif' })`, an `item` div with `Object.assign(item.style, { padding: '6px 16px', cursor: 'pointer', color: '#d32' })` and `textContent = '删除节点'`, then `mouseenter`/`mouseleave` listeners that toggle `item.style.background = '#f5f5f5'`/`''`, then a `click` listener, `appendChild`, and a `setTimeout(() => document.addEventListener('click', dismiss), 0)`.
- `src/ui/controls.css` has NO `:root` or `var(--…)` usage anywhere today. The existing rules (`.emap-ctrl-group`, `.emap-box-select`, etc.) keep their literal values — they are NOT migrated by this plan.
- `vertex-edit.test.ts` has no assertion on context-menu inline styles or className today; existing tests must stay green untouched.

---

### Task 1: Tokens + context-menu CSS class migration + test + CHANGELOG

**Files:**
- Modify: `src/ui/controls.css` (prepend `:root` block; append two new selectors)
- Modify: `src/core/handlers/vertex-edit.ts` (`_showContextMenu` body)
- Modify: `src/core/handlers/vertex-edit.test.ts` (append delegation test)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Write the failing test — append to `src/core/handlers/vertex-edit.test.ts`**

First READ the top of `src/core/handlers/vertex-edit.test.ts` to match its existing import/mocks (it constructs `VertexEditHandler` with a mock map and calls private methods via `Reflect.get`). The handler test file's mocks may not include `setEditMode`/`on`/`off`/`render`/`clearEditVertexState` that `enable()` needs — the existing test cases in that file already exercise `enable()` so reuse their mock pattern verbatim. Append this `describe` block at the end of the file (before any final closing `});`):

```ts
describe('VertexEditHandler context-menu CSS-token migration (DX P4)', () => {
  it('_showContextMenu sets class-based DOM and only dynamic position inline', () => {
    // Clean up any previous menu (tests run shared globals).
    document.getElementById('emap-ctx-menu')?.remove();
    // Construct EXACTLY as the existing enable() tests in this file do —
    // mirror the existing mock object shape that provides setEditMode/on/etc.
    const mapMock = { setEditMode: () => {}, on: () => {}, off: () => {}, render: () => {}, clearEditVertexState: () => {} } as any;
    const handler = new VertexEditHandler(mapMock);
    // Invoke the private method directly via Reflect (matches the file's
    // existing pattern of testing privates).
    Reflect.get(handler, '_showContextMenu').call(handler, 123, 456, () => {});

    const menu = document.getElementById('emap-ctx-menu') as HTMLDivElement;
    expect(menu).toBeTruthy();
    expect(menu.className).toBe('emap-ctx-menu');
    expect(menu.style.left).toBe('123px');
    expect(menu.style.top).toBe('456px');
    // Only the two dynamic coord properties should be set inline; static
    // styles (background/border/box-shadow/padding/font/z-index/min-width)
    // belong to CSS now.
    expect(menu.style.background).toBe('');
    expect(menu.style.boxShadow).toBe('');
    expect(menu.style.font).toBe('');

    const item = menu.firstElementChild as HTMLDivElement;
    expect(item).toBeTruthy();
    expect(item.className).toBe('emap-ctx-menu-item');
    expect(item.textContent).toBe('删除节点');
    // Hover background is CSS-driven now, not toggled by JS — no inline
    // background should be set even after dispatching a mouseenter.
    item.dispatchEvent(new Event('mouseenter', { bubbles: true }));
    expect(item.style.background).toBe('');

    // Cleanup so the next test starts clean.
    menu.remove();
  });

  it('_showContextMenu click handler invokes onDelete and removes the menu', () => {
    document.getElementById('emap-ctx-menu')?.remove();
    const mapMock = { setEditMode: () => {}, on: () => {}, off: () => {}, render: () => {}, clearEditVertexState: () => {} } as any;
    const handler = new VertexEditHandler(mapMock);
    let called = 0;
    Reflect.get(handler, '_showContextMenu').call(handler, 10, 20, () => { called++; });
    const item = document.querySelector('#emap-ctx-menu > div') as HTMLDivElement;
    item.click();
    expect(called).toBe(1);
    expect(document.getElementById('emap-ctx-menu')).toBeNull();
  });
});
```

If the test file's existing mock shape supplies extra fields (e.g. `getCanvasContainer`, `clearEditDrawState`), include exactly the same fields here so construction matches what already passes. Read the file first; do not invent fields beyond what's needed for `_showContextMenu` (it only triggers the menu DOM build — no map calls).

- [ ] **Step 2: Run the new tests — verify they FAIL**

Run: `npx vitest run src/core/handlers/vertex-edit.test.ts 2>&1 | tail -10`
Expected: FAIL — `expect(menu.className).toBe('emap-ctx-menu')` fails (current code leaves className empty) AND `expect(menu.style.background).toBe('')` fails (current code sets it to `'#fff'`). Capture proof of RED.

- [ ] **Step 3: Prepend the `:root` token block to `src/ui/controls.css`**

Open `src/ui/controls.css` and insert at the very top of the file (before any existing rule):

```css
/* emap design tokens — defaults are the verbatim legacy literals so default
 * rendering is byte-identical. Override on :root (or any ancestor selector)
 * to theme. Introduced in DX P4 for the context menu; future phases may
 * migrate existing controls to consume these tokens. */
:root {
  /* Accent (current usage: box-select stroke, lasso stroke, button-active bg). */
  --emap-accent: #0078ff;
  --emap-accent-soft: rgba(0, 120, 255, 0.1);
  /* Surface — panels, menus, dropdowns. */
  --emap-surface-bg: #fff;
  --emap-surface-border: #ccc;
  --emap-surface-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
  /* Generic radius + hover/danger + font. */
  --emap-radius: 4px;
  --emap-hover-bg: #f5f5f5;
  --emap-danger: #d32;
  --emap-font: 13px/1.5 system-ui, sans-serif;
}

```

- [ ] **Step 4: Append the new selectors at the end of `src/ui/controls.css`**

Find the end of `src/ui/controls.css` (after the last existing rule) and append:

```css

/* Right-click context menu — opened on right-click over a selected vertex
 * by VertexEditHandler. Dynamic position/left/top are set inline; every
 * other property is tokenised here. */
.emap-ctx-menu {
  position: fixed;
  z-index: 9999;
  min-width: 120px;
  background: var(--emap-surface-bg);
  border: 1px solid var(--emap-surface-border);
  border-radius: var(--emap-radius);
  box-shadow: var(--emap-surface-shadow);
  padding: 4px 0;
  font: var(--emap-font);
}
.emap-ctx-menu-item {
  padding: 6px 16px;
  cursor: pointer;
  color: var(--emap-danger);
}
.emap-ctx-menu-item:hover {
  background: var(--emap-hover-bg);
}
```

- [ ] **Step 5: Rewrite `_showContextMenu` in `src/core/handlers/vertex-edit.ts`**

Find this exact existing method body (it starts with the JSDoc immediately above `private _showContextMenu(`):

```ts
  /**
   * Show a minimal context menu at (x, y) in viewport coords.
   * Auto-dismissed when user clicks anywhere else.
   */
  private _showContextMenu(x: number, y: number, onDelete: () => void): void {
    // Remove any existing menu
    document.getElementById('emap-ctx-menu')?.remove();

    const menu = document.createElement('div');
    menu.id = 'emap-ctx-menu';
    Object.assign(menu.style, {
      position: 'fixed',
      left: `${x}px`,
      top: `${y}px`,
      background: '#fff',
      border: '1px solid #ccc',
      borderRadius: '4px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
      padding: '4px 0',
      zIndex: '9999',
      minWidth: '120px',
      font: '13px/1.5 system-ui, sans-serif',
    });

    const item = document.createElement('div');
    item.textContent = '删除节点';
    Object.assign(item.style, {
      padding: '6px 16px',
      cursor: 'pointer',
      color: '#d32',
    });
    item.addEventListener('mouseenter', () => { item.style.background = '#f5f5f5'; });
    item.addEventListener('mouseleave', () => { item.style.background = ''; });
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.remove();
      document.removeEventListener('click', dismiss);
      onDelete();
    });
    menu.appendChild(item);
    document.body.appendChild(menu);

    // Dismiss on any click outside
    const dismiss = () => {
      menu.remove();
      document.removeEventListener('click', dismiss);
    };
    // Use setTimeout so this listener doesn't fire immediately from the right-click
    setTimeout(() => document.addEventListener('click', dismiss), 0);
  }
```

Replace with:

```ts
  /**
   * Show a minimal context menu at (x, y) in viewport coords.
   * Auto-dismissed when user clicks anywhere else. Static appearance lives
   * in `src/ui/controls.css` as `.emap-ctx-menu` / `.emap-ctx-menu-item`
   * (themable via `--emap-*` tokens on `:root`); only the dynamic
   * `left`/`top` coords are set inline here.
   */
  private _showContextMenu(x: number, y: number, onDelete: () => void): void {
    document.getElementById('emap-ctx-menu')?.remove();

    const menu = document.createElement('div');
    menu.id = 'emap-ctx-menu';
    menu.className = 'emap-ctx-menu';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    const item = document.createElement('div');
    item.className = 'emap-ctx-menu-item';
    item.textContent = '删除节点';
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.remove();
      document.removeEventListener('click', dismiss);
      onDelete();
    });
    menu.appendChild(item);
    document.body.appendChild(menu);

    const dismiss = () => {
      menu.remove();
      document.removeEventListener('click', dismiss);
    };
    // Use setTimeout so this listener doesn't fire immediately from the right-click.
    setTimeout(() => document.addEventListener('click', dismiss), 0);
  }
```

Deletions: both `Object.assign(menu.style, {...})` and `Object.assign(item.style, {...})` blocks, and both `mouseenter`/`mouseleave` listeners (CSS `:hover` replaces them). Additions: `menu.className`, `menu.style.left`/`top`, `item.className`.

- [ ] **Step 6: Run the targeted test — verify it PASSES**

Run: `npx vitest run src/core/handlers/vertex-edit.test.ts 2>&1 | tail -10`
Expected: PASS (new tests + all pre-existing vertex-edit tests still pass; no existing test required modification).

- [ ] **Step 7: Add the CHANGELOG entry**

In `CHANGELOG.md` find the `- DX Phase 2c (toward 0.3.0):` bullet in `## [Unreleased]` → `### Added`. Insert immediately AFTER its last line (plain house style, NOT bold):

```markdown
- DX Phase 4 (toward 0.3.0): opened the emap design-token namespace —
  `controls.css` now declares 9 `--emap-*` custom properties on `:root`
  (`accent`, `accent-soft`, `surface-bg`, `surface-border`,
  `surface-shadow`, `radius`, `hover-bg`, `danger`, `font`) with the
  current literal values as defaults. The vertex-edit right-click menu
  ("删除节点") migrated off inline styles + JS `mouseenter`/`mouseleave`
  hover toggle onto class-based rules (`.emap-ctx-menu` /
  `.emap-ctx-menu-item` with `:hover`) consuming the tokens. Default
  rendering is byte-identical; themers override `--emap-*` on `:root` (or
  a parent) to restyle. Existing controls' literal values are unchanged
  — namespace opened but not retro-applied (follow-up phases may opt in).
```

- [ ] **Step 8: Final verification gate** — run each, report verbatim:

- `npx tsc --noEmit` → exit 0 (authoritative; ignore stale "Cannot find module" LSP noise)
- `npx vitest run 2>&1 | tail -3` → all pass; report EXACT `Test Files` / `Tests` counts (baseline + 2 new = expected)
- `npm run build 2>&1 | tail -2` → artifacts created, exit 0
- `grep -nE "Object.assign\\(menu.style|Object.assign\\(item.style|mouseenter|mouseleave" src/core/handlers/vertex-edit.ts` → ZERO matches (legacy patterns gone)
- `grep -n ":root\|--emap-\|\\.emap-ctx-menu" src/ui/controls.css | head -15` → shows the new `:root` block AND the new `.emap-ctx-menu` selectors
- `git diff --stat 0194fd5 -- src/ CHANGELOG.md | tail -5` → exactly 4 files (`src/core/handlers/vertex-edit.ts`, `src/core/handlers/vertex-edit.test.ts`, `src/ui/controls.css`, `CHANGELOG.md`); no other source touched

- [ ] **Step 9: Commit**

```bash
git add src/ui/controls.css src/core/handlers/vertex-edit.ts src/core/handlers/vertex-edit.test.ts CHANGELOG.md
git commit -m "refactor(ui): context-menu CSS tokens + emap design-token namespace (DX P4)"
```

- [ ] **Step 10: Self-review `git show --stat HEAD`** — exactly 4 files; no Co-Authored-By; vertex-edit.ts has exactly the documented deletions + className additions; controls.css has the `:root` block prepended + the 3 selectors appended; existing controls.css rules byte-identical.

---

## Self-Review

**1. Spec coverage:**
- §1 architecture (two-file change, runtime byte-identical except className switch + dynamic-only inline styles) → Task 1 Steps 3-5.
- §2 the 9 tokens + the 3 selectors with exact values → Steps 3 & 4.
- §3 `_showContextMenu` rewrite (full before/after; `Object.assign` blocks + `mouseenter`/`mouseleave` deletions; `id` kept; className additions; dynamic-only inline) → Step 5.
- §4 testing (no existing test modified; new className/dynamic-style/hover-not-inline assertions; grep invariants; gates) → Steps 1, 2, 6, 8.
- §5 out-of-scope respected: existing controls' literals untouched (verified explicitly in Step 8 grep + the "byte-identical" self-review point); no JS theme API; no i18n; no non-vertex-edit file change beyond CSS + CHANGELOG.

**2. Placeholder scan:** No TBD/TODO. Step 1 includes the full test code and explicitly instructs reading the existing test file to mirror its mock shape — concrete instruction, not a placeholder. All steps have full code blocks and expected outcomes. The CHANGELOG bullet is verbatim.

**3. Type consistency:** ClassNames `emap-ctx-menu` / `emap-ctx-menu-item` are spelled identically across the CSS rules (Step 4), the handler code (Step 5), and the test assertions (Step 1). The `id='emap-ctx-menu'` selector used by the dedupe lookup `document.getElementById('emap-ctx-menu')` is preserved in the rewrite. CSS variable names `--emap-accent`/`--emap-accent-soft`/`--emap-surface-bg`/`--emap-surface-border`/`--emap-surface-shadow`/`--emap-radius`/`--emap-hover-bg`/`--emap-danger`/`--emap-font` appear identically in §2's `:root` declarations and the selector `var(...)` calls.
