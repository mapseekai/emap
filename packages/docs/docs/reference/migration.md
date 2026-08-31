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

当前文档默认使用 `@mapseekai/emap` 的类型化导入、`arrow` 和 `duckdb` 可选子路径，
以及默认 `expressionPolicy: "disabled"`。这些子路径通过 `package.json` 的 `exports`
提供；请按[安装中的模块解析配置](../getting-started/installation.md#typescript-模块解析)
选择 TypeScript 解析器。

## 行为说明

迁移旧示例时，要显式开启 trusted expressions，用命令替代直接 dataset 修改，并通过 `Emap.ops` 路由重处理。

## API

- [src.MapOptions](/mapseekai/emap/api/interfaces/emap.MapOptions.html)
- [src.Emap](/mapseekai/emap/api/classes/emap.Emap.html)

## 可运行示例

- [attribute-expressions](/mapseekai/emap/examples/attribute-expressions/)
- [filter-features](/mapseekai/emap/examples/filter-features/)

## 最小片段

```ts
const map = new Emap({ container: "map", expressionPolicy: "trusted" })
```
