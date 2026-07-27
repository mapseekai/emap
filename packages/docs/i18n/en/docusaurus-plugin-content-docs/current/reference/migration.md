---
slug: /reference/migration
title: Migration
---

# Migration

The current docs assume typed imports from `@zwishing/emap`, optional subpath imports for `formats` and `duckdb`, and `expressionPolicy: "disabled"` by default.

## Behavior notes

When migrating older examples, explicitly opt into trusted expressions, replace direct dataset mutation with commands, and route heavy processing through `Emap.ops`.

## API

- [src.MapOptions](https://zwishing.github.io/emap/api/interfaces/index.MapOptions.html)
- [src.Emap](https://zwishing.github.io/emap/api/classes/index.Emap.html)

## Runnable examples

- [attribute-expressions](https://zwishing.github.io/emap/examples/attribute-expressions/)
- [filter-features](https://zwishing.github.io/emap/examples/filter-features/)

## Minimal snippet

```ts
const map = new Emap({ container: "map", expressionPolicy: "trusted" })
```
