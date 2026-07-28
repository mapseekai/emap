# Unified Runnable Examples Design

## Context

The repository currently has two implementations for most runnable examples:

- `test/examples/*.html` contains the original interactive pages and upload workflows.
- `packages/examples` contains a second Vite application whose metadata and runtime logic recreate those examples for the documentation site.

The split has produced three user-visible failures:

1. Documentation links use `/emap/examples/<id>/`, while the Vite build emits
   `dist/examples/<id>/` and the release composer copies that directory under
   `build/examples/`. The resulting deployed route is accidentally
   `/emap/examples/examples/<id>/`.
2. Fixture requests use root-relative `/fixtures/...` URLs instead of the Vite
   base `/emap/examples/fixtures/...`.
3. Local documentation preview starts the docs and examples on separate ports,
   but documentation links remain same-origin and therefore never reach the
   examples server.

## Goals

- Make each runnable example have one implementation and one route.
- Move the original `test/examples/*.html` pages into the corresponding
  `packages/examples/examples/<id>/index.html` directories.
- Open every example with a rendered map and local starter data.
- Preserve the existing file-upload controls so users can replace the starter data.
- Serve the catalog, example routes, fixtures, worker bundle, API reference, and
  documentation from one local preview origin.
- Keep the public route contract `/emap/examples/<id>/`.

## Non-goals

- Redesigning the individual example interfaces.
- Changing public `emap` APIs or operation behavior.
- Adding a backend service.
- Adding a new frontend framework or runtime dependency.
- Making DuckDB-Wasm binaries part of this migration; only example input data is
  required to be local.

## Canonical Source Layout

Each HTML example becomes the implementation for its documentation route:

```text
packages/examples/
  index.html
  examples/
    buffer/index.html
    getting-started/geojson-viewer/index.html
    getting-started/points/index.html
    ...
  public/fixtures/
  src/
    catalog.ts
    example-runtime.ts
    fixture-manifest.ts
    main.ts
```

The five introductory files map to the existing nested IDs:

- `geojson-viewer.html` -> `getting-started/geojson-viewer/index.html`
- `points.html` -> `getting-started/points/index.html`
- `lines.html` -> `getting-started/lines/index.html`
- `polygons.html` -> `getting-started/polygons/index.html`
- `polygon-fill.html` -> `getting-started/polygon-fill/index.html`

All other filenames map directly to `<id>/index.html`. The HTML files under
`test/examples` are removed after migration; the TypeScript tests in that
directory remain tests.

## Browser Runtime

The migrated pages retain their markup, controls, and operation code. Their
root-relative development bundle tags are replaced by an inline module import
from a shared `example-runtime.ts` module. That module:

- imports the public `@zwishing/emap` package and stylesheet;
- exposes the package namespace to the migrated inline scripts;
- exposes optional formats helpers needed by format examples; and
- exports the fixture auto-load helper.

DuckDB examples import `@zwishing/emap/duckdb` through Vite instead of reaching
into `../../dist`. The worker example receives a base-aware worker URL from the
shared runtime.

This keeps examples representative of package-consumer behavior and removes
all dependence on a route's filesystem depth.

## Starter Data and Upload Flow

`fixture-manifest.ts` maps every example ID to one or more fixture bindings. A
binding contains an input selector and the local fixture paths assigned to that
input. Existing shared Task 6 and Task 7 fixtures are reused. Small local
GeoJSON files are added for introductory examples that previously embedded or
required user-supplied data.

After an example has registered its existing `change` handlers, it calls the
shared auto-loader. The auto-loader:

1. resolves fixture URLs against Vite's `BASE_URL`;
2. fetches each local file;
3. creates browser `File` objects with the original filenames;
4. assigns them to the declared file inputs through `DataTransfer`; and
5. dispatches the same `change` event used for a user upload.

The existing upload path therefore remains the only data-import implementation.
Automatic loading exercises it once on startup; later user uploads follow the
same code path. A missing input, failed fetch, or failed import is reported in
the page's existing status element and is not silently ignored.

## Catalog and Metadata

The catalog remains at `/emap/examples/`, but its cards link directly to
`/emap/examples/<id>/`. It no longer uses hash routing or renders a second
example-page shell.

`docs-meta/examples.ts` is reduced to catalog metadata, route IDs, fixture
bindings, documentation references, API references, and success text. The
duplicated runtime `load()` implementations are removed. `example-page.ts` is
removed when no longer referenced.

## Build and Route Composition

Vite continues to compile the physical source files below
`packages/examples/examples/`. A post-build normalization step moves generated
`dist/examples/<id>/` directories to `dist/<id>/`, leaving the final artifact
with this public shape:

```text
packages/examples/dist/
  index.html
  buffer/index.html
  getting-started/geojson-viewer/index.html
  fixtures/...
  assets/...
  emap-worker.js
```

The normalizer works only inside `packages/examples/dist`, validates its source
and destination paths, and fails if a route would overwrite an unrelated file.
The Vite development server rewrites `/emap/examples/<id>/` to the physical
source HTML so development and production use the same browser URL.

The documentation composer can then copy the normalized examples artifact
directly into `packages/docs/build/examples`. There is no nested
`examples/examples` directory.

## Local Preview

A root `docs:preview` command performs the required sequence:

1. build the library;
2. build and normalize examples;
3. build documentation and API output;
4. compose examples into the documentation build; and
5. start one Docusaurus static server.

`docs:dev` remains the fast documentation-only authoring command. Its name and
limitations are documented explicitly so it is not presented as an integrated
examples preview.

## Testing

Implementation follows test-driven development. Focused tests are added before
production changes for these contracts:

- catalog links use non-hash `/emap/examples/<id>/` routes;
- every metadata ID has exactly one canonical HTML file under
  `packages/examples/examples`;
- no migrated HTML depends on `../../dist` or `../../src`;
- fixture URLs resolve from `/emap/examples/`, not `/fixtures/`;
- automatic fixture injection dispatches the existing upload change path;
- the build normalizer produces `dist/<id>/index.html` and removes the nested
  `dist/examples` directory;
- composition produces `packages/docs/build/examples/<id>/index.html`;
- documentation route checks reject `/emap/examples/examples/` links.

Verification runs the focused documentation/example tests, typecheck, library
build, examples build, docs build, composition checks, and a local HTTP probe
for the catalog, a representative introductory example, a fixture, and the
worker bundle. Browser automation is not added as a dependency; manual browser
checks confirm initial map rendering and replacement uploads for representative
single-file, multi-file, format, and worker examples.

## Success Criteria

- `/emap/examples/` shows the catalog.
- `/emap/examples/getting-started/geojson-viewer/` and
  `/emap/examples/buffer/` return real example HTML, not a fallback page.
- Opening an example loads local starter data and displays a map without user action.
- Selecting a replacement file reuses the same upload workflow and updates the map.
- No request is made to `/fixtures/...` or `/emap/examples/examples/...`.
- The integrated local preview uses one origin for docs, API, examples, fixtures,
  and workers.
- The repository contains no duplicate HTML example implementation under
  `test/examples`.

