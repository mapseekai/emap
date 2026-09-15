---
id: architecture
slug: /concepts/architecture
title: Current architecture and source layout
api: ["Emap", "Context", "TopologySource"]
examples: ["plugin-runtime", "getting-started/geojson-viewer"]
stability: experimental
verifiedVersion: unreleased
---

# Current architecture and source layout

Emap now uses a **native Cordis plugin runtime + GIS domain core + Canvas engine + optional integrations**. The public `Emap` facade stays stable while runtime features are composed through Cordis `Context`, services, providers, and feature plugins.

Only six first-level responsibility zones remain under `src/`:

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

## Six source zones
| Zone | Responsibility | Typical contents |
| --- | --- | --- |
| `domain/` | GIS state and reversible changes independent of UI/plugin runtime | `source/`, `geo/`, `edit/`, `validation/` |
| `engine/` | Hot-path map execution and host implementations | `map/`, `core/handlers/`, `rendering/`, `worker/`, built-in workspace providers |
| `runtime/` | Cordis composition layer | `context/`, `services/`, `providers/`, `plugins/`, `presets/`, `ai/` |
| `integrations/` | Third-party and optional engine boundaries | `mapshaper/`, `maplibre/`, `arrow/`, `duckdb/` |
| `ui/` | Browser controls, CSS, icons, and theme | controls, `assets/`, `theme/` |
| `shared/` | Declarations without one business owner | ambient `.d.ts`, external declarations, stylesheet typing |

Dependencies follow an “inner domain, outer composition” rule. Runtime may compose engine/domain/integration capabilities; domain must not depend on Cordis, DOM, or a concrete provider. Pointer movement, hit testing, and Canvas drawing remain direct TypeScript calls rather than going through the JSON capability layer.

## Runtime: upstream Cordis

The project pins upstream `cordis@4.0.0-rc.10`. `map.ctx` is the real Cordis `Context`; plugins use native `name / inject / apply / provide / effect`, and native `Fiber` owns lifecycle.

```ts
const map = await Emap.create({ container: 'map', preset: 'editor' });
const fiber = map.ctx.plugin(myPlugin);
await fiber.await();
await fiber.dispose();
```

There is no `PluginRuntime`, `ServiceRegistry`, `EffectScope`, `map.runtime`, or `map.services` compatibility layer. `runtime/context/` only re-exports upstream primitives, exposes read-only inspection, and adapts browser cancellation to native effects.

## Services, providers, features, and capabilities
The runtime still distinguishes five conceptual roles, but each now has a clear home in the source tree:

```text
Cordis Context / Fiber
        │
        ├─ Service contracts      runtime/services
        ├─ Providers              runtime/providers + engine/providers + integrations/*/plugin
        ├─ Feature plugins        runtime/plugins
        ├─ Presets                runtime/presets
        └─ AI capabilities        runtime/ai + runtime/plugins/capabilities
```

Services define capability contracts. Providers own state/resources and implement services. Feature plugins compose services into interaction, controls, and validation. Capabilities expose existing domain operations to UI, workflow, and agents without duplicating GIS algorithms.

`editor / viewer / headless / empty` are plugin compositions, not different map classes. MapLibre, Arrow, and DuckDB stay explicit optional integrations. Mapshaper is a GIS processing integration, not part of the Cordis kernel.

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

Editing remains `EditCommand → history/transaction → source version → render invalidation`. Geometry and attribute versions are independent; async workers/analysis verify both before committing stale results.

## Test layout rules
Unit tests must be colocated with the implementation and differ only by the `.test` suffix:

```text
foo.ts
foo.test.ts
```

One implementation file may have at most one colocated unit-test file. Cross-module behavior, regressions, browser checks, package/build checks, and public type contracts live under root `test/`:

```text
test/
├── integration/   # Cross-module behavior and regressions
├── browser/       # Playwright / real browsers
├── build/         # Bundle and package exports
├── types/         # *.test-d.ts public contracts
├── docs/          # Documentation metadata/build contracts
├── examples/      # Example behavior
├── security/      # Security boundaries
└── utils/         # Test support
```

`pnpm run test-layout:check` rejects unmatched tests under `src`, multiple unit tests for one implementation, integration/audit/type-contract tests drifting back into production source. `pnpm run typecheck:contracts` validates `test/types/` separately.

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

The complete release gate covers formatting, types, architecture, capability schemas, production build, bundles, unit/integration tests, DuckDB-Wasm, examples, bilingual docs, three real browsers, pack dry-run, and production dependency auditing.

See ADR 0009 for native Cordis and ADR 0010 for the source/test layout decision.
