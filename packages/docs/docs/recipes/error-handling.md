---
id: error-handling
slug: /recipes/error-handling
title: 错误处理
api: ["Emap", "OpResult", "OpError"]
examples: ["check-geometry", "duckdb-buffer", "duckdb-query"]
stability: stable
verifiedVersion: 0.12.0
---

# 错误处理

`Emap` 的数据操作返回 `OpResult`：成功结果含有 `ok: true`，失败结果含有 `ok: false` 和可判别的 `OpError`。使用 `ok` 分支处理失败，不把失败当作成功结果继续使用。

## 处理操作结果

```ts
const result = await map.ops.checkGeometry({ source: "main" })
if (!result.ok) {
  switch (result.error.kind) {
    case "not-found":
      console.error(`Missing ${result.error.what}: ${result.error.id}`)
      break
    case "validation":
      console.error(result.error.reason)
      break
    default:
      console.error(result.error.kind)
  }
}
```

成功时，`checkGeometry` 的 `value` 是几何检查报告。将加载器的 rejected promise 和 DuckDB 抛出的 `DuckDbOperationError` 放在应用边界的 `try`/`catch` 中。只有成功的结果才更新图层、历史记录或界面状态。

## API

- `Emap`
- `OpResult`
- `OpError`

## 可运行示例

- [几何检查](/mapseekai/emap/examples/check-geometry/)
- [DuckDB 缓冲区](/mapseekai/emap/examples/duckdb-buffer/)
- [DuckDB 查询](/mapseekai/emap/examples/duckdb-query/)
