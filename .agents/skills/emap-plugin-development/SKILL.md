---
name: emap-plugin-development
description: Guide for developing emap plugins on the native Cordis runtime. Use when writing a Provider/Service, feature plugin, format codec, control, interaction handler, or AI capability for @mapseekai/emap, or when wiring plugins into Emap.create presets. Triggers on emap plugin development, ctx.plugin, inject/provide, formatPlugin, addControl, capability registration.
user-invocable: false
---

# Developing emap Plugins

emap plugins are native Cordis plugins (`cordis@4.0.0-rc.10`, pinned — never upgrade it). `map.ctx` is the Cordis `Context`; there is no emap-specific plugin wrapper. Full API tables: `packages/docs/docs/guides/plugins.md`; runtime proof: `packages/examples/examples/plugin-runtime/`.

## Choose the plugin kind

| Need | Kind |
| --- | --- |
| Publish a typed service others inject | Provider (`Plugin.Object` with `provide`) |
| Add behavior on top of existing services | Feature (`Plugin.Object` with `inject`) |
| New import/export format | Feature registering a `DatasetFormatPlugin` into `formats` |
| Map UI widget | `Control` (onAdd/onRemove) via `map.addControl()` |
| AI/UI-callable operation | Capability registered into `capabilities` |

Prefer `Emap.create({ preset, plugins, excludePlugins })` composition over new map classes. Same-`name` plugins replace preset entries; `excludePlugins` removes them.

## Minimal Provider + consumer

```typescript
import type { Plugin } from 'cordis';

declare module 'cordis' { // typed ctx access — required
  interface Context {
    counter: { value: number };
  }
}

export const counterPlugin: Plugin.Object = {
  name: 'acme.counter', // namespaced; enables replacement/diagnostics
  provide: ['counter'],
  apply(ctx) {
    ctx.effect(function* () {
      yield ctx.provide('counter', { value: 1 }); // revoked first on unload
    });
  },
};

export const readerPlugin: Plugin.Object = {
  name: 'acme.reader',
  inject: ['counter'], // hard dependency; apply runs once available
  apply(ctx) {
    console.log(ctx.counter.value);
  },
};
```

`Plugin.Object` fields: `name`, `inject`, `provide`, `apply(ctx, config)`, optional `Config` (StandardSchemaV1). Function plugins and `Service` subclasses also work.

## Resource lifecycle — always through ctx.effect

`ctx.effect(fn, label?)` binds cleanup to the plugin Fiber; yields/returns run in reverse order on unload. Register every listener, timer, worker, and subscription this way — never leave module-level handles.

```typescript
apply(ctx) {
  ctx.effect(function* () {
    const resource = acquireResource();
    yield () => resource.close();      // closes after consumers release
    yield ctx.provide('resource', resource);
  });
}
```

Dynamic install: `const fiber = ctx.plugin(plugin, config)` returns `Fiber & PromiseLike<Fiber>`; manage with `fiber.await() / .dispose() / .restart() / .update(config)`. Disposing a Provider revokes its services and re-activates waiting consumers once they return.

## Injectable emap services

Declared in `src/runtime/services/context.ts`; inject what you use. Core groups: `document`/`layers`/`source`/`sourceFactory` (data), `view`/`projection`/`scale` (camera/CRS), `selection`/`history`/`mutation`/`editState` (editing), `query`/`ops`/`attributes` (processing), `surface`/`render`/`signals` (rendering), `interaction`/`shortcuts`/`controls` (UI), `formats`, `capabilities`, `mapEvents`, `mapLibre`, `duckDb`. Full table with contracts: plugins.md § 可注入的 Emap 服务.

## Format feature

Formats are instance-local (no global registry). Use `inject: ['formats']` and register inside `ctx.effect` so unload aborts in-flight imports with `AbortError`:

```typescript
const acmeFormatFeature: Plugin.Object = {
  name: 'feature.format.acme',
  inject: ['formats'],
  apply(ctx) {
    ctx.effect(function* () {
      yield ctx.effect(() => ctx.formats.register(acmeFormat));
    });
  },
};
```

`DatasetFormatPlugin`: `name`, `extensions` (dotless, unique), `importBinary(bytes, filename) → MapshaperDataset`, `exportFormats` map, optional `mimeTypes`. Existing wrappers: `formatPlugin(format)`, `arrowFormatsPlugin`.

## Control

```typescript
import type { Control } from '@mapseekai/emap';

const myControl: Control = {
  inject: ['view'],
  onAdd(map) {
    const el = document.createElement('button'); /* … */ return el;
  },
  onRemove() { /* cleanup */ },
};
await map.addControl(myControl, 'top-right'); // controls are child plugins
```

## Capability (AI/UI-callable)

Register into `capabilities`; id must match `/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/`. `CapabilityDefinition` = descriptor (`id`, `title`, `description`, `category`, `inputSchema`, `effects`, `undoable`, `cost`, `crs`, optional `keywords`/`whenToUse`/`avoidWhen`) + `execute(input, { signal, origin })`. Reads run freely; agent write effects require host `authorizeCapability`. `execute` must honor `signal` (unload aborts with `AbortError`) and reuse domain services instead of mutating datasets directly.

## Rules

- Cordis is pinned; ESM builds keep it external. Cross-bundle checks: `Context.is(map.ctx)`.
- Engine layer: use `EventDispatcher`/`ctx.mapEvents`, never raw DOM events; coordinate math through `AffineTransform`.
- New ops in `map.ops` must be classified in `COMMAND_EFFECTS` (`src/engine/map/ops/_runner.ts`).
- Debug runtime state with `inspectContext` / `inspectServices` / `settleContext` from `@mapseekai/emap/context`.

## Verify

```bash
pnpm typecheck && pnpm run architecture:check
```

For capability additions also `pnpm run capabilities:check`. Exercise the plugin in `packages/examples/examples/plugin-runtime/` or a new example (`pnpm run examples:check`).
