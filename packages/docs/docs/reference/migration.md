---
slug: /reference/migration
title: 迁移
---

# 迁移

当前文档默认使用 `@zwishing/emap` 的类型化导入、`formats` 和 `duckdb` 可选子路径，以及默认 `expressionPolicy: "disabled"`。

## 行为说明

迁移旧示例时，要显式开启 trusted expressions，用命令替代直接 dataset 修改，并通过 `Emap.ops` 路由重处理。

## API

- [src.MapOptions](https://zwishing.github.io/emap/api/interfaces/index.MapOptions.html)
- [src.Emap](https://zwishing.github.io/emap/api/classes/index.Emap.html)

## 可运行示例

- [attribute-expressions](https://zwishing.github.io/emap/examples/attribute-expressions/)
- [filter-features](https://zwishing.github.io/emap/examples/filter-features/)

## 最小片段

```ts
const map = new Emap({ container: "map", expressionPolicy: "trusted" })
```
