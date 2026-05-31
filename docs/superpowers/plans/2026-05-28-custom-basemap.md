# Custom Basemap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let applications define and control basemaps outside the built-in button UI while still allowing the bundled BasemapControl to be themed or custom-rendered.

**Architecture:** Keep the existing `BasemapControl` as the single owner of the MapLibre overlay lifecycle. Add public methods for style lookup, activation, deactivation, and replacement, plus small UI customization hooks that only affect the generated control shell. Preserve the existing default styles and button behavior.

**Tech Stack:** TypeScript, Vitest with jsdom, MapLibre lazy import, CSS design tokens.

---

### Task 1: Lock BasemapControl Public Behavior

**Files:**
- Create: `src/ui/basemap-control.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { BasemapControl } from './basemap-control';

function makeMap() {
  const canvasContainer = document.createElement('div');
  const listeners: Record<string, Function[]> = {};
  return {
    canvasContainer,
    map: {
      getCanvasContainer: () => canvasContainer,
      on: vi.fn((type: string, cb: Function) => { (listeners[type] ??= []).push(cb); }),
      off: vi.fn(),
      getCRS: () => 'webmercator',
      getCenter: () => [0, 0] as [number, number],
      getZoom: () => 3,
    },
  };
}

describe('BasemapControl custom basemap API', () => {
  it('uses custom class hooks and renderButton for built-in UI', () => {
    const { map } = makeMap();
    const control = new BasemapControl({
      className: 'host-basemap',
      buttonClassName: 'host-basemap-button',
      activeClassName: 'is-selected',
      styles: [{ id: 'osm', name: 'OSM', url: '/tiles/{z}/{x}/{y}.png', type: 'raster' }],
      renderButton: ({ style, isActive, activate }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.styleId = style.id;
        button.textContent = `${style.name}:${isActive}`;
        button.onclick = activate;
        return button;
      },
    });

    const el = control.onAdd(map as any);

    expect(el.className).toBe('emap-ctrl emap-basemap-ctrl host-basemap');
    const button = el.querySelector('button') as HTMLButtonElement;
    expect(button.dataset.styleId).toBe('osm');
    expect(button.classList.contains('host-basemap-button')).toBe(true);
  });

  it('can hide the generated UI and activate a named style programmatically', async () => {
    const { map } = makeMap();
    const control = new BasemapControl({
      showControl: false,
      styles: [{ id: 'custom', name: 'Custom', url: '/custom/{z}/{x}/{y}.png', type: 'raster' }],
    });
    vi.spyOn(control as any, '_showBasemap').mockImplementation(async (style: any) => {
      (control as any)._activeStyle = style;
      (control as any)._isOn = true;
    });

    const el = control.onAdd(map as any);
    await control.showStyle('custom');

    expect(el.querySelector('button')).toBeNull();
    expect(control.isOn()).toBe(true);
    expect(control.getActiveStyle()?.id).toBe('custom');
  });

  it('applies defaultStyle after onAdd and lets callers replace styles', async () => {
    const { map } = makeMap();
    const control = new BasemapControl({
      defaultStyle: 'second',
      styles: [
        { id: 'first', name: 'First', url: '/first/{z}/{x}/{y}.png', type: 'raster' },
        { id: 'second', name: 'Second', url: '/second/{z}/{x}/{y}.png', type: 'raster' },
      ],
    });
    const show = vi.spyOn(control as any, '_showBasemap').mockImplementation(async (style: any) => {
      (control as any)._activeStyle = style;
      (control as any)._isOn = true;
    });

    control.onAdd(map as any);
    await Promise.resolve();
    expect(show).toHaveBeenCalledWith(expect.objectContaining({ id: 'second' }));

    control.setStyles([{ id: 'third', name: 'Third', url: '/third/{z}/{x}/{y}.png', type: 'raster' }]);
    expect(control.getStyles()).toEqual([
      { id: 'third', name: 'Third', url: '/third/{z}/{x}/{y}.png', type: 'raster' },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify RED**

Run: `npm run test:run -- src/ui/basemap-control.test.ts`

Expected: FAIL because `className`, `buttonClassName`, `activeClassName`, `renderButton`, `showControl`, `showStyle`, `getActiveStyle`, `setStyles`, and `getStyles` do not exist yet.

### Task 2: Implement BasemapControl API

**Files:**
- Modify: `src/ui/basemap-control.ts`

- [ ] **Step 1: Add option and render types**

Add exported types for style IDs, button render context, and class-name hooks. Keep `name` and `url` backward compatible.

- [ ] **Step 2: Implement public methods**

Add `getStyles()`, `setStyles(styles)`, `getActiveStyle()`, `showStyle(idOrName)`, `toggleStyle(idOrName)`, and `hide()` as thin wrappers over the existing private lifecycle methods.

- [ ] **Step 3: Wire defaultStyle and optional control UI**

Apply `defaultStyle` after `onAdd()` creates the basemap layer. If `showControl` is `false`, return an empty control container but keep the basemap layer and event subscriptions available for programmatic control.

- [ ] **Step 4: Run the targeted test to verify GREEN**

Run: `npm run test:run -- src/ui/basemap-control.test.ts`

Expected: PASS.

### Task 3: Tokenize Basemap CSS

**Files:**
- Modify: `src/ui/controls.css`

- [ ] **Step 1: Add basemap-specific CSS variables**

Add variables for basemap control background, button background, button text, active background, active text, gap, padding, font, and hover background.

- [ ] **Step 2: Replace hard-coded basemap literals**

Use the new variables in `.emap-basemap-ctrl`, `.emap-basemap-btn`, hover, and active rules while preserving default visual output.

- [ ] **Step 3: Run typecheck and targeted tests**

Run: `npm run typecheck` and `npm run test:run -- src/ui/basemap-control.test.ts`.

Expected: both PASS.

### Task 4: Add Emap-Level Basemap Loading

**Files:**
- Create: `src/map/basemap-facade.test.ts`
- Modify: `src/map/map.ts`

- [ ] **Step 1: Write failing facade tests**

Cover `map.showBasemap({ id, name, url, type: 'raster' })` and `map.setBasemapStyles([...]); await map.showBasemap(id)` without adding the built-in button UI.

- [ ] **Step 2: Implement a narrow Emap facade**

Add `setBasemapStyles`, `getBasemapStyles`, `showBasemap`, `hideBasemap`, and `getActiveBasemapStyle`. Lazily create one `BasemapControl({ showControl: false })` so MapLibre overlay ownership stays in one class.

- [ ] **Step 3: Run facade tests**

Run: `npm run test:run -- src/map/basemap-facade.test.ts src/ui/basemap-control.test.ts`

Expected: PASS.

### Task 5: Document the New Public Surface

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a short custom basemap example**

Show custom styles, hidden built-in UI, and a host button calling `showStyle()`.

- [ ] **Step 2: Extend theming token snippet**

Include basemap-specific CSS variables.

- [ ] **Step 3: Run final checks**

Run: `npm run test:run -- src/ui/basemap-control.test.ts src/index.test.ts` and `npm run typecheck`.

Expected: both PASS.
