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
- Hierarchy: a compact title, the running map, and essential operations on demand.
- Navigation: example links on the left, category filters above the gallery, page
  contents on the right; a category selector on smaller screens.
- Layout: centered at 1440px; the map keeps its size when switching detail tabs.

## Rules

- Use the roles in [tokens.css](src/tokens.css) for colors, fonts and spacing.
- Default to two columns of example cards; retain a compact list as an alternative.
- Show source code in its own view, with keyboard-accessible file tabs.
- Remove the guide tab, parameter tables and repeated explanatory text.
- Keep the native map and essential controls; collect controls under “操作”.
- Open operations beside the map, or in a modeless dialog on phones.
  The `parameters=open` URL state preserves an open panel when sharing an example.
- Keep operation status visible beneath the map while the parameter dialog is closed.
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
