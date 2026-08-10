# Emap Mapseek Theme Alignment Design

**Date:** 2026-08-10  
**Status:** Approved

## Goal

Align every built-in emap visual surface and default color with the Mapseek UI
design system while keeping emap framework-agnostic. The change covers bundled
controls, interaction overlays, default layer styling, highlighting, editing,
and Canvas fallbacks. Existing example and product-documentation styling is out
of scope.

Success means that emap:

- inherits an embedding application's Mapseek semantic theme automatically;
- remains usable when no host theme is present;
- supports Mapseek light and dark values without a JavaScript theme API;
- uses square, border-first, shadowless, compact controls;
- preserves explicit caller-supplied colors over theme defaults; and
- leaves public method signatures and non-visual behavior unchanged.

## Scope

### Included

- `src/ui/controls.css` and static built-in control styling.
- Static inline styles owned by built-in controls, especially the simplify
  popover.
- Navigation, history, basemap, edit, draw, simplify, status, and context-menu
  states.
- Box-select, lasso, draw, vertex-edit, highlight, default layer, default fill,
  and Canvas fallback colors.
- Keyboard focus, disabled, pressed, and persistent selected-state treatments.
- Focused tests for the token contract, DOM state, and Canvas color resolution.

### Excluded

- Existing files under `packages/examples/`, `packages/docs/`, and product
  documentation.
- Caller-provided layer paint, highlight, or interaction colors.
- New theme configuration APIs, component abstractions, or icon-system work.
- Unrelated layout, rendering, or editing behavior.

## Chosen Approach

Use an emap-prefixed CSS-variable bridge and resolve those variables centrally
at the Canvas boundary.

The alternatives were rejected for the following reasons:

- Passing a typed palette from `Emap` through every renderer and handler would
  widen constructors and rendering interfaces for a visual-only change.
- Replacing colors with static OKLCH literals would not inherit a host theme or
  respond correctly to dark mode.

## Theme Contract

`--emap-*` variables remain the stable integration surface. Each semantic emap
variable first consumes the corresponding host variable and then falls back to
the exact Mapseek value. For example, emap primary follows `--primary` when it
exists and otherwise uses the approved Mapseek primary OKLCH value.

The bridge covers:

| Role | Host token | Emap use |
| --- | --- | --- |
| Background and foreground | `--background`, `--foreground` | Control text and generic Canvas fallback |
| Card and popover | `--card`, `--popover` | Map controls, status, popovers, context menus |
| Primary | `--primary`, `--primary-foreground` | Default layers, active actions, drawing, editing, highlighting |
| Accent and selection | `--accent`, `--selection-bg` | Hover and persistent active surfaces |
| Muted | `--muted`, `--muted-foreground` | Default polygon fill and secondary status text |
| Structure | `--border`, `--border-strong`, `--input` | Groups, separators, popovers, and form fields |
| Focus | `--ring` | Three-pixel keyboard focus ring |
| Semantic feedback | `--destructive`, `--warning`, `--info` | Errors and status feedback |

Existing emap token names such as `--emap-accent`, `--emap-surface-bg`,
`--emap-hover-bg`, and `--emap-danger` remain accepted so current consumer
overrides do not break. Their defaults are remapped to the matching Mapseek
semantics. The legacy radius and shadow defaults become zero and none.

When a `.dark` ancestor is present, the bridge uses the approved dark fallbacks
from Mapseek's runtime registry. Host variables still take precedence. No new
theme class or JavaScript option is introduced.

## Component Styling

Built-in controls use the Mapseek technical-minimalist rules:

- Geist Mono with 13px control text and 11px status text.
- A 32px primary control height, with square icon buttons.
- Zero radius, no decorative shadow, and one-pixel structural borders.
- A half-strength accent hover surface.
- A visible three-pixel `focus-visible` ring.
- Selection background, primary text, and a persistent edge marker for active
  controls.
- Disabled opacity and cursor treatment that remains understandable without
  color alone.

Basemap controls use the same 32px text-button scale. The status control uses a
solid readable floating surface rather than a translucent legacy white pill.
The simplify popover and context menu use popover colors, one-pixel borders,
zero radius, and no shadow.

Static simplify-popover presentation moves from inline style strings into
`controls.css`. Inline code retains only dynamic state such as open/closed
display and changing values. Form elements receive descriptive classes rather
than new component abstractions.

Pressed editing and drawing controls keep their existing `.active` state and
also synchronize `aria-pressed`. This provides a semantic state in addition to
the persistent visual edge.

## Color Mapping

Caller-provided colors always win. Built-in fallbacks map as follows:

| Existing role | Mapseek role |
| --- | --- |
| Default line and point layer | Primary |
| Default polygon fill | Muted |
| Box-select and lasso outline | Primary |
| Box-select and lasso fill | Selection background |
| Draw preview | Primary |
| Vertex dots and vertex hover | Primary |
| Feature highlight | Primary |
| Generic Canvas stroke/dot fallback | Foreground |
| Rendered error marker | Destructive |
| Hovered control surface | Accent at the documented interaction strength |
| Active control surface | Selection background plus primary edge/text |

Mapseek category colors are not introduced because emap has no stable semantic
category assignment for arbitrary user data.

## Runtime Color Flow

DOM and SVG styles consume `var(--emap-*)` directly and therefore follow normal
CSS inheritance.

Canvas cannot consume unresolved CSS variables. Immediately before assigning a
built-in or caller-supplied color to `fillStyle` or `strokeStyle`, the painter
resolves exact CSS-variable references against the canvas's computed style.
Nested variable references are resolved recursively with a bounded cycle guard.
Literal CSS colors pass through unchanged.

Resolution happens during drawing and is not cached across frames, so the next
render observes the current host theme. It performs only computed-style reads
and does not mutate DOM state from the render loop.

If a variable is missing, cyclic, empty, or cannot be resolved, the painter uses
the matching Mapseek semantic fallback. Missing `emap.css` must not prevent
Canvas rendering. Invalid caller-provided literal colors retain the browser's
existing handling; the theme bridge does not introduce a new exception path.

## Compatibility

- Public methods and option types do not change.
- Explicit paint and interaction options retain priority.
- Existing emap custom-property overrides remain supported.
- The standalone stylesheet continues to ship through the existing
  `dist/emap.css` build path.
- No raw DOM events are introduced at the engine layer.
- Theme reads are side-effect free and do not add inline work that mutates the
  render loop.

## Verification

Implementation follows focused red-green tests for each affected contract:

1. A stylesheet contract test verifies host-token bridging, approved light and
   dark fallbacks, zero radius, no shadow, 32px controls, and the three-pixel
   focus ring.
2. UI tests verify simplify markup no longer carries legacy visual literals and
   active controls keep `.active` and `aria-pressed` synchronized.
3. Canvas tests verify semantic variables resolve from the canvas inheritance
   chain, dark values are observed on the next draw, unresolved variables fall
   back safely, and explicit literal colors are unchanged.
4. Layer, highlight, draw, selection, edit-overlay, and painter tests verify the
   full default-color mapping.
5. Typecheck, the complete test suite, and the production build verify that the
   public and distribution contracts remain intact.
6. Browser visual checks cover navigation, history, basemap, editing, simplify,
   status, and the context menu in light and dark themes, including hover,
   pressed, disabled, and keyboard-focus states.

Before implementation completion, GitNexus change detection must confirm that
only the expected UI, theme-resolution, rendering-default, and focused-test
areas are affected.
