---
id: architecture
slug: /concepts/architecture
title: Current architecture and source layout
api: ["Emap", "Context", "TopologySource"]
examples: ["plugin-runtime", "getting-started/geojson-viewer"]
stability: experimental
verifiedVersion: 0.13.0
---

# Current architecture and source layout

Emap composes a GIS domain core, Canvas rendering, and optional integrations through its native Cordis plugin runtime; the public API is the `Emap` facade.

```ts
const map = await Emap.create({ container: 'map', preset: 'viewer' }); // create a browser map with browsing capability
await map.dispose(); // release plugins, services, and resources
```

## Core structure

The six `src/` responsibility zones and root public API:

```text
src/
├── domain/          # GIS domain state and reversible mutations
├── engine/          # Map execution, interaction, rendering, built-in providers
├── runtime/         # Cordis, service contracts, plugins, presets, AI capabilities
├── integrations/    # Arrow / DuckDB / MapLibre / Mapshaper / GeoPackage
├── ui/              # Controls, icons, styles, theme
├── shared/          # Cross-layer declarations and type boundaries
└── index.ts         # Root public API
```

| Zone | Responsibility | Typical contents |
| --- | --- | --- |
| `domain/` | GIS state and reversible changes independent of UI/plugin runtime | `source/`, `geo/`, `edit/`, `validation/` |
| `engine/` | Hot-path map execution and host implementations | `map/`, `core/handlers/`, `rendering/`, `worker/`, built-in workspace providers |
| `runtime/` | Cordis composition layer | `context/`, `services/`, `providers/`, `plugins/`, `presets/`, `ai/` |
| `integrations/` | Third-party and optional engine boundaries | `mapshaper/`, `maplibre/`, `arrow/`, `duckdb/`, `geopackage/` |
| `ui/` | Browser controls, CSS, icons, and theme | controls, `assets/`, `theme/` |
| `shared/` | Declarations without one business owner | ambient `.d.ts`, external declarations, stylesheet typing |

Dependencies follow “inner domain, outer composition”: `runtime` may compose engine, domain, and integration capability; domain does not depend on Cordis, DOM, or a concrete provider. Hot-path pointer movement, hit testing, and Canvas drawing stay direct TypeScript calls.

### `Emap.create()`

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `container` | `string \| HTMLElement` | Unset | Browser-preset mount node. |
| `preset` | `'editor' \| 'viewer' \| 'headless' \| 'empty'` | `'editor'` | Built-in plugin composition. |
| `plugins` | `readonly Plugin[]` | `[]` | Mounted after the preset; same-named entries replace preset plugins. |
| `excludePlugins` | `readonly string[]` | `[]` | Removes preset plugins by `name`. |
| `authorizeCapability` | `CapabilityAuthorizer` | Unset | Host authorization policy for Capability invocation. |

| preset | Included | Use case |
| --- | --- | --- |
| `editor` | Everything in `viewer`, editing handlers, and editing controls. | A complete interactive editor. |
| `viewer` | Everything in `headless`, Canvas, rendering, interaction, events, shortcuts, controls, and browsing handlers. | A page for viewing, querying, selecting, and processing data. |
| `headless` | Capability/format providers, workspace, mapshaper, editing, attributes, document, view, cache, layers, selection, history, source, policy, execution, query, validation, snapshots, projection, mutation, and scale services. | Data operations in Node, Workers, and batch jobs. |
| `empty` | Empty preset; instance-local `host.options` is always mounted. | Application-selected Providers and Feature Plugins. |

## More runtime composition

The project pins `cordis@4.0.0-rc.10`. `map.ctx` is the upstream `Context`; `Emap.create()` mounts `host.options`, resolves presets, and calls `ctx.plugin()`, then returns with ready services.

### `Plugin.Object` and effects

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `name` | `string` | Unset | Plugin identity for replacement and filtering. |
| `inject` | `Inject` (a service-key array or keyed configuration object) | Unset | Activates `apply` when services are available. |
| `apply` | `(ctx: Context, config: T) => unknown` | Required | Plugin entry point. |
| `provide` | `string \| string[]` | Unset | Declares provided service keys. |

`ctx.effect(execute, label?)` binds a resource to the current Fiber: `execute` returns a cleanup function, Promise, or async iterator that Fiber unload cleans up; `label` defaults to `'anonymous'` and labels the effect in diagnostics.

```ts
import { Emap } from '@mapseekai/emap';
import type { Plugin } from 'cordis';

const moveLogger: Plugin.Object = {
  name: 'app.move-logger',
  inject: ['mapEvents'],
  apply(ctx) {
    ctx.effect(() => {
      const log = () => console.log('map moved');
      ctx.mapEvents.on('move', log);
      return () => ctx.mapEvents.off('move', log);
    }, 'app.move-logger');
  },
};

const map = await Emap.create({ container: 'map', preset: 'viewer' });
const fiber = map.ctx.plugin(moveLogger);
await fiber.await();
// The application continues; unloading the plugin releases the listener.
await fiber.dispose();
```

### `ctx.plugin()` and Fiber

`ctx.plugin(plugin, config?)`: `plugin` is a function, constructor, or object with `apply`; `config` is passed to `apply(ctx, config)`.

`fiber.await()` waits for mounting or unloading to settle and rejects on error; `fiber.dispose()` unloads the plugin and awaits effect cleanup.

`runtime/context/` is a thin adapter: re-exported primitives, read-only inspection, lifecycle settling, and browser cancellation through effects.

### Services, Providers, Features, and Capabilities

```text
Cordis Context / Fiber
        │
        ├─ Service contracts      runtime/services
        ├─ Providers              runtime/providers + engine/providers + integrations/*/plugin
        ├─ Feature plugins        runtime/plugins
        ├─ Presets                runtime/presets
        └─ AI capabilities        runtime/ai + runtime/plugins/capabilities
```

Services define contracts; Providers implement them and own resources; Feature Plugins compose services; Capabilities expose existing domain operations. The presets share an `Emap` facade; MapLibre, Arrow, and DuckDB are optional integrations, while Mapshaper processes data operations.

## Data and rendering flow

```text
TopologySource / domain data
        ↓
engine providers (document/source/layer/view/history)
        ↓
engine map + interaction handlers
        ↓
render scheduler
        ↓
Canvas painter
```

Editing follows `EditCommand → history/transaction → source version → render invalidation`; geometry and attribute versions are independent, and async work checks versions before commit.

## Test organization

Unit tests sit beside implementations and differ only by `.test`:

```text
foo.ts
foo.test.ts
```

One implementation file has at most one colocated unit-test file. Cross-module behavior, regressions, browser checks, builds, and public type contracts live in root `test/`:

```text
test/
├── integration/   # Cross-module behavior and regressions
├── browser/       # Playwright / real browsers
├── build/         # Bundle / package exports
├── types/         # *.test-d.ts public contracts
├── docs/          # Documentation metadata/build contracts
├── examples/      # Example behavior
├── security/      # Security boundaries
└── utils/         # Test support
```

`pnpm run test-layout:check` validates `src` test layout; `pnpm run typecheck:contracts` validates `test/types/`.

## Release verification

```bash
pnpm run typecheck
pnpm run typecheck:contracts
pnpm run typecheck:examples
pnpm run test-layout:check
pnpm run architecture:check
pnpm run test:run
pnpm run test:duckdb
pnpm run release:verify
```

The release gate covers formatting, types, architecture, schemas, builds, tests, examples, bilingual docs, browsers, pack dry-run, and dependency auditing.

## Runnable examples

- [Plugin runtime](/mapseekai/emap/examples/plugin-runtime/)
- [GeoJSON viewer](/mapseekai/emap/examples/getting-started/geojson-viewer/)
