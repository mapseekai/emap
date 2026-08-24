---
id: error-handling
slug: /recipes/error-handling
title: 错误处理
api: ["Emap"]
examples: ["duckdb-buffer","duckdb-query"]
stability: stable
verifiedVersion: 0.5.0
---

# 错误处理

加载器会在导入错误时 reject，operations 返回 `OpResult`，DuckDB 辅助函数可能抛出带 `kind` 的 `DuckDbOperationError`。

## 行为说明

错误应在应用边界处理：保持地图可用，展示重试说明，不要把失败输出提交到历史。

## API

- [src.OpError](/mapseekai/emap/api/types/emap.OpError.html)
- [src_duckdb.DuckDbOperationError](/mapseekai/emap/api/classes/src_duckdb.DuckDbOperationError.html)

## 可运行示例

- [check-geometry](/mapseekai/emap/examples/check-geometry/)
- [duckdb-query](/mapseekai/emap/examples/duckdb-query/)
- [duckdb-buffer](/mapseekai/emap/examples/duckdb-buffer/)

## 最小片段

```ts
const result = await map.ops.checkGeometry({ source: "main" })
if (!result.ok) setStatus(result.error.kind)
```
