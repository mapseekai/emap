---
id: migration
slug: /reference/migration
title: 迁移
api: ["Emap"]
examples: ["attribute-expressions"]
stability: stable
verifiedVersion: 0.5.0
---

# 迁移

当前文档默认使用 `@zwishing/emap` 的类型化导入、`formats` 和 `duckdb` 可选子路径，以及默认 `expressionPolicy: "disabled"`。

## 行为说明

迁移旧示例时，要显式开启 trusted expressions，用命令替代直接 dataset 修改，并通过 `Emap.ops` 路由重处理。

## API

- [src.MapOptions](/emap/api/interfaces/index.MapOptions.html)
- [src.Emap](/emap/api/classes/index.Emap.html)

## 可运行示例

- [attribute-expressions](/emap/examples/attribute-expressions/)
- [filter-features](/emap/examples/filter-features/)

## 最小片段

```ts
const map = new Emap({ container: "map", expressionPolicy: "trusted" })
```
