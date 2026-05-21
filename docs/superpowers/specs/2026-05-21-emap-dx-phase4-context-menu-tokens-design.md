# DX Phase 4 — Context-menu CSS tokens + design-token namespace (design)

> Carry-over from P5's CHANGELOG note ("P4 will migrate the context-menu
> inline styles to CSS tokens"). Accumulates toward 0.3.0. OpenSpec skipped
> per P1–P11 + P2c precedent. Rhythm: brainstorm → spec → plan →
> subagent-driven TDD.

## §0 Problem

`VertexEditHandler._showContextMenu` (`src/core/handlers/vertex-edit.ts:238`)
builds the "删除节点" right-click menu with 11 inline styles on the wrapper
and 3 on the item, plus a JS-toggled hover background swap via
`mouseenter`/`mouseleave`. Consumers cannot theme the menu without
monkey-patching, and `src/ui/controls.css` has no design-token convention
at all — every selector hardcodes literal values (`#0078ff`,
`rgba(0, 120, 255, 0.1)`, `#fff`, `box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.1)`,
etc.) duplicated across rules.

P4 opens an emap design-token namespace (`--emap-*` on `:root`), migrates
the context menu to class-based rules consuming those tokens, and replaces
the JS hover toggle with `:hover`. Existing controls keep their literal
values — token namespace is opened but not retro-applied (separate
follow-up phases may opt in). Default rendering is byte-identical.

## §1 Architecture

Two-file change:
- `src/ui/controls.css`: prepend a `:root` block defining the new tokens
  (defaults = the verbatim legacy literals); append `.emap-ctx-menu` and
  `.emap-ctx-menu-item` rules consuming those tokens.
- `src/core/handlers/vertex-edit.ts`: in `_showContextMenu`, drop the
  `Object.assign(menu.style, {...})` and `Object.assign(item.style, {...})`
  static-style blocks, drop the `mouseenter`/`mouseleave` JS hover toggle,
  set `menu.className = 'emap-ctx-menu'` and `item.className =
  'emap-ctx-menu-item'`, and keep only the dynamic `menu.style.left =
  '${x}px'; menu.style.top = '${y}px';` inline. `menu.id = 'emap-ctx-menu'`
  stays (the dedupe lookup `document.getElementById('emap-ctx-menu')`
  relies on it). All other behavior — click-outside dismiss, the delete
  callback, the `setTimeout(..., 0)` document-listener attachment — is
  byte-identical.

## §2 Design tokens (`:root` defaults + selector consumption)

Defaults are the verbatim legacy literals so default rendering is
byte-identical with or without the new CSS rules.

```css
/* Top of src/ui/controls.css */
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

```css
/* Bottom of src/ui/controls.css */
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

9 tokens. The 2 token names not consumed in §2 yet (`--emap-accent`,
`--emap-accent-soft`) are deliberately defined now: they're the obvious
shared values used across box-select / lasso / button-active rules, and
declaring them here lets a downstream consumer theme the *accent* via
`:root` override even though those rules haven't been migrated yet (CSS
custom properties are inherited; once existing rules eventually switch to
`var(--emap-accent)`, an existing override Just Works).

## §3 `vertex-edit.ts` changes

`_showContextMenu` (`src/core/handlers/vertex-edit.ts:238-282`) becomes:

```ts
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
  setTimeout(() => document.addEventListener('click', dismiss), 0);
}
```

Deletions vs. today: the `Object.assign(menu.style, {...})` block (11
properties), the `Object.assign(item.style, {...})` block (3 properties),
and the two `mouseenter`/`mouseleave` listeners (hover swap → CSS
`:hover`). `position: fixed`, `z-index: 9999`, `min-width: 120px`, the
font, padding, border, shadow, radius, danger color — all moved into the
new CSS rules. `position/left/top` stay inline because they're computed
from runtime coords.

## §4 Testing & verification

- No existing vertex-edit test asserts inline-style values, so the
  current suite must stay green with **zero modifications to any existing
  test** — verify by running it untouched.
- Add a minimal jsdom test in `src/core/handlers/vertex-edit.test.ts`
  asserting the new contract after a context-menu invocation: the menu
  element has `className === 'emap-ctx-menu'` and `id === 'emap-ctx-menu'`,
  `style.left`/`style.top` reflect the requested coords, the item has
  `className === 'emap-ctx-menu-item'`, no `mouseenter`/`mouseleave`
  listener swap is needed for hover (assert via `getAttribute('style')`
  not containing `background`).
- Post-fix invariants checked with grep:
  `grep -nE "Object.assign\\(menu.style|Object.assign\\(item.style|mouseenter|mouseleave" src/core/handlers/vertex-edit.ts` → ZERO matches.
- Gates: `npx tsc --noEmit` exit 0 · `npx vitest run` full suite green
  (report exact counts) · `npm run build` exit 0 · `controls.css` `:root`
  block present at top, `.emap-ctx-menu`/`.emap-ctx-menu-item` selectors
  present at bottom · existing controls' literal values UNTOUCHED.

## §5 Out of scope (YAGNI)

- Migrating existing controls' literal values (`#0078ff` in box-select /
  lasso / button-active rules, the duplicated `box-shadow: 0 0 0 2px
  rgba(0,0,0,0.1)`) to use the new tokens — namespace opened, retro-apply
  is a separate follow-up.
- Theme overrides at the JS API level (`map.setTheme({...})`) — themers
  override `:root` (or a parent selector) in CSS; that is the entire
  affordance.
- Touch-device `:hover` semantics (sticks until tap elsewhere) — acceptable
  for a desktop edit menu; no regression for the documented use.
- i18n of "删除节点" — out of scope; would be its own phase.
- Other context menus — none exist in the codebase today.
- Any non-vertex-edit file change (arbiter, P1–P11+P2c sources stay
  byte-identical).
