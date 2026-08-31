---
id: migration
slug: /reference/migration
title: Migration
api: ["Emap"]
examples: ["attribute-expressions"]
stability: stable
verifiedVersion: 0.8.1
---

# Migration

The current docs assume typed imports from `@mapseekai/emap`, optional subpath imports for `arrow` and `duckdb`, [modern TypeScript resolver settings](../getting-started/installation.md), and `expressionPolicy: "disabled"` by default.


## Behavior notes

When migrating older examples, explicitly opt into trusted expressions, replace direct dataset mutation with commands, and route heavy processing through `Emap.ops`.

## API

- [src.MapOptions](/mapseekai/emap/api/interfaces/emap.MapOptions.html)
- [src.Emap](/mapseekai/emap/api/classes/emap.Emap.html)

## Runnable examples

- [attribute-expressions](/mapseekai/emap/examples/attribute-expressions/)
- [filter-features](/mapseekai/emap/examples/filter-features/)

## Minimal snippet

```ts
const map = new Emap({ container: "map", expressionPolicy: "trusted" })
```
