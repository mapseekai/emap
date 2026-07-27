---
slug: /data/attributes
title: 属性
---

# 属性

属性保存在 mapshaper layer 的 data table 中。屏幕交互用地图查询 API；整表变更用 operations。

## 行为说明

表达式变更需要 `expressionPolicy: "trusted"`，因为 mapshaper 表达式会执行类似 JavaScript 的代码。远程或用户提供公式时保持默认 `disabled`。

## API

- [src.Emap](https://zwishing.github.io/emap/api/classes/index.Emap.html)
- [src.ApplyExpressionOptions](https://zwishing.github.io/emap/api/interfaces/index.ApplyExpressionOptions.html)
- [src.JoinTableOptions](https://zwishing.github.io/emap/api/interfaces/index.JoinTableOptions.html)

## 可运行示例

- [feature-attributes](https://zwishing.github.io/emap/examples/feature-attributes/)
- [attribute-editing](https://zwishing.github.io/emap/examples/attribute-editing/)
- [attribute-expressions](https://zwishing.github.io/emap/examples/attribute-expressions/)
- [join](https://zwishing.github.io/emap/examples/join/)

## 最小片段

```ts
const features = map.queryFeatures(point, { layers: ["district-fill"] })
await map.ops.applyExpression({ source: "main", expression: "POP_DENS = POP / AREA" })
```
