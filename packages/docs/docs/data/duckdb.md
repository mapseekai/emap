---
slug: /data/duckdb
title: DuckDB
---

# DuckDB

可选 DuckDB 入口在 DuckDB-Wasm 中运行 SQL 和空间操作。建议懒加载，避免核心地图承担可选依赖成本。

## 行为说明

辅助函数会校验受限 SELECT SQL、规范化操作选项、尽量保留 CRS 元数据，并返回可显示在地图中的操作图层结果。

## API

- [src_duckdb.queryDatasetWithDuckDb](https://zwishing.github.io/emap/api/functions/src_duckdb.queryDatasetWithDuckDb.html)
- [src_duckdb.bufferDatasetWithDuckDb](https://zwishing.github.io/emap/api/functions/src_duckdb.bufferDatasetWithDuckDb.html)
- [src_duckdb.DuckDbOperationError](https://zwishing.github.io/emap/api/classes/src_duckdb.DuckDbOperationError.html)

## 可运行示例

- [duckdb-query](https://zwishing.github.io/emap/examples/duckdb-query/)
- [duckdb-buffer](https://zwishing.github.io/emap/examples/duckdb-buffer/)
- [duckdb-spatial-ops](https://zwishing.github.io/emap/examples/duckdb-spatial-ops/)

## 最小片段

```ts
const duckdb = await import("@zwishing/emap/duckdb")
const result = await duckdb.queryDatasetWithDuckDb({ runtime, source, sql })
```
