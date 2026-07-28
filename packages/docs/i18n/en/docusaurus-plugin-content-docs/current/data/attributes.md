---
id: attributes
slug: /data/attributes
title: Attributes
api: ["Emap"]
examples: ["attribute-editing","attribute-expressions","data-engineering","feature-attributes","filter-features","join","split-layer"]
stability: stable
verifiedVersion: 0.5.0
---

# Attributes

Attributes live in mapshaper layer data tables. Query through map APIs for screen interaction and use operations for table-wide changes.

## Behavior notes

Expression-based changes require `expressionPolicy: "trusted"` because mapshaper expressions execute JavaScript-like code. Keep the default `disabled` for remote or user-supplied formulas.

## API

- [src.Emap](/emap/api/classes/index.Emap.html)
- [src.ApplyExpressionOptions](/emap/api/interfaces/index.ApplyExpressionOptions.html)
- [src.JoinTableOptions](/emap/api/interfaces/index.JoinTableOptions.html)

## Runnable examples

- [feature-attributes](/emap/examples/feature-attributes/)
- [attribute-editing](/emap/examples/attribute-editing/)
- [attribute-expressions](/emap/examples/attribute-expressions/)
- [join](/emap/examples/join/)

## Minimal snippet

```ts
const features = map.queryFeatures(point, { layers: ["district-fill"] })
await map.ops.applyExpression({ source: "main", expression: "POP_DENS = POP / AREA" })
```
