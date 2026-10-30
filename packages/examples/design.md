# emap examples design

This system applies to the examples package. It follows Hallmark's application
screen guidance and preserves the emap brand and existing example behavior.

## Purpose

Help developers find an example, run it, adjust its controls and inspect its source.
The catalog follows MapLibre's example gallery: example navigation, preview cards,
and page contents. A detail page dedicates one viewport to the running map.

## System

- Genre: modern minimal, application screens.
- Theme: existing emap brand, restrained green accent and neutral surfaces.
- Fonts: system sans for the interface, Geist Mono for code and API identifiers.
- Hierarchy: a compact title, the running map, and immediately available operations.
- Navigation: example links on the left, category filters above the gallery, page
  contents on the right; a category selector on smaller screens.
- Layout: centered at 1440px; the map keeps its size when switching detail tabs.

## Rules

- Use the roles in [tokens.css](src/tokens.css) for colors, fonts and spacing.
- Default to two columns of example cards; retain a compact list as an alternative.
- Show source code in its own view, with keyboard-accessible file tabs.
- Format source with Prettier and highlight it with Shiki at build time. Keep
  these tools out of the browser bundle; load source files when requested.
- Separate inline JavaScript, CSS and complete HTML. Include the example's
  imported TypeScript modules and local dependencies, with paths and line numbers.
  Copy the formatted current file and link to its original file on GitHub.
- Remove the guide tab, parameter tables and repeated explanatory text.
- Keep native controls in a modeless panel on the map, expanded by default.
  Offer “收起” in its header and “展开操作” on the map; never resize the map when toggling.
  Preserve a collapsed panel with `parameters=closed`; accept existing `parameters=open` links.
- Place operations at the top right on desktop. On phones use the bottom right and
  at most half of the map height, leaving navigation controls available above.
- Align the renderer toolbar with the map frame and keep its controls inside it.
- Remove the persistent status footer. Show loading and errors on the map only
  while relevant, preserving the native status node and announcements.
- Favor native controls. Use a surface only to separate distinct work.
- Show actual map captures in the catalog's card view. Do not draw placeholder maps.
- Keep all example routes, controls, data loading, rendering choices and event handlers.
- Use explicit focus states, readable contrast and reduced motion behavior.
- Filters and active content tabs belong in the URL.

## Shared rendering parameters

- All examples default to WebGL2. The canonical `renderer` URL values are
  `canvas2d`, `webgl2` and `webgpu`; an explicit value takes precedence over a
  legacy luma `gpu` setting.
- A live backend change updates the toolbar, URL and local example links. Explicit
  choices survive reloads and navigation through the catalog. Camera, data and
  editing state remain specific to each example.
- The dedicated 2.5D camera and native vertex editor require a GPU. Their
  Canvas2D button is disabled; navigation from a Canvas2D example selects WebGL2.
- Canvas backing dimensions use the device pixel ratio, matching the main map.
  Native examples must use `getExamplePixelRatio()` without their own DPR cap.
- Vector and numeric raster WebGPU devices explicitly select the `core` profile
  with the same `high-performance` adapter preference.
- Native vector examples default to a 3 CSS px point grid and enabled snapshot
  navigation. They all honor the `pointLod=off` and `nav=off` URL settings.
- Raster examples start with nearest sampling, automatic stretch and full
  opacity. Data-specific bands and the perspective camera keep their own controls.

## Exports

- [tokens.css](src/tokens.css): colors, type, spacing and sizes.
- [base.css](src/base.css): shared browser and accessibility behavior.
- [styles.css](src/styles.css): the catalog.
- [example-presentation.css](src/example-presentation.css): live example pages.

## Preview captures

Every catalog entry has a real map capture at `public/previews/<example-id>.jpg`.
Nested ids retain their directory structure. Captures use WebGL2, DPR 1, the same
viewport, and the example's public starter data. Operations are prepared where
applicable and closed before capturing; the script rejects empty maps and failed
operations. The plugin installation example captures its active runtime inspector.
`captures.json` records the source route, dimensions, pixel checks and image hash.

Build the examples, serve that build, then refresh the captures in another terminal:

```bash
pnpm run examples:build
pnpm --filter @mapseekai/emap-examples exec vite preview --host 127.0.0.1 --port 4187 --strictPort
pnpm run examples:previews
```

Use `--only <example-id>` to refresh one example or `--missing` to resume an
interrupted capture. `--base-url`, `--executable-path` and `--software` support
other local preview servers and headless environments. `examples:check` verifies
that every catalog entry ships its image.
