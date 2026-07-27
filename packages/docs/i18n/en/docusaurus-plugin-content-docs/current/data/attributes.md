---
slug: /data/attributes
title: Attributes
---

# Attributes

Attributes live in mapshaper layer data tables. Query through map APIs for screen interaction and use operations for table-wide changes.

## Behavior notes

Expression-based changes require `expressionPolicy: "trusted"` because mapshaper expressions execute JavaScript-like code. Keep the default `disabled` for remote or user-supplied formulas.

## API

- [src.Emap](https://zwishing.github.io/emap/api/classes/index.Emap.html)
- [src.ApplyExpressionOptions](https://zwishing.github.io/emap/api/interfaces/index.ApplyExpressionOptions.html)
- [src.JoinTableOptions](https://zwishing.github.io/emap/api/interfaces/index.JoinTableOptions.html)

## Runnable examples

- [feature-attributes](https://zwishing.github.io/emap/examples/feature-attributes/)
- [attribute-editing](https://zwishing.github.io/emap/examples/attribute-editing/)
- [attribute-expressions](https://zwishing.github.io/emap/examples/attribute-expressions/)
- [join](https://zwishing.github.io/emap/examples/join/)

## Minimal snippet

```ts
const features = map.queryFeatures(point, { layers: ["district-fill"] })
await map.ops.applyExpression({ source: "main", expression: "POP_DENS = POP / AREA" })
```
