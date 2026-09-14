---
id: errors
slug: /reference/errors
title: 错误参考
api: ["Emap", "Err", "OK", "okValue", "OpError", "OpResult", "topologyValidator", "TopologyValidatorOptions", "ValidationChange", "ValidationIssue", "ValidationReport", "Validator", "ValidatorPhase", "ValidatorRegistry", "ValidatorResult", "SourceLoadError", "DuckDbOperationError", "DuckDbOperationErrorKind"]
examples: ["check-geometry","duckdb-query","transaction"]
stability: stable
verifiedVersion: unreleased
---

# 错误参考

地图处理方法以 `OpResult<T>` 返回可处理的失败：成功结果为 `{ ok: true, value }`，失败结果为 `{ ok: false, error }`。通过 `ok` 判别结果，再按 `error.kind` 处理失败。

```ts
const result = await map.ops.checkGeometry({ source: "parcels" })
if (!result.ok) {
  if (result.error.kind === "validation") {
    console.error(result.error.field, result.error.reason)
  }
  return
}
console.log(result.value)
```

## `OpError` 失败形状

| `kind` | 字段 | 含义 |
| --- | --- | --- |
| `not-found` | `what`、`id` | 找不到 source、layer、mask、divider 或 field |
| `validation` | `field`、`reason` | 选项或字段验证失败 |
| `expression-disabled` | `operation` | 表达式策略禁止该操作 |
| `duckdb` | `operation`、`duckDbKind`、`reason`、`field?`、`cause?` | DuckDB 操作失败 |
| `mapshaper` | `cause`、`cmd?`、`operation?` | Mapshaper 操作失败 |
| `stale-operation` | `sourceId`、`operation` | 操作的 source 版本已改变 |
| `host-removed` | 无字段 | 地图宿主已经移除 |

`OK` 是无 payload 的成功结果；`okValue(value)` 创建带 payload 的成功结果。`Err` 提供与表中失败形状对应的构造函数。

## 加载与 DuckDB 错误

`SourceLoadError` 提供 `code` 和 `diagnostics`，用于报告 source 预检和加载诊断。`DuckDbOperationError` 提供 `kind`、错误消息、可选的 `field` 和 `cause`。其 `kind` 为 `validation`、`runtime-unavailable`、`spatial-extension-unavailable`、`query-failed` 或 `conversion-failed`。

将面向用户的恢复说明放在触发操作的界面附近，将原始错误和 `cause` 写入日志。

## API

- [src.OpError](/mapseekai/emap/api/types/emap.OpError.html)
- [src.SourceLoadError](/mapseekai/emap/api/classes/emap.SourceLoadError.html)
- [src_duckdb.DuckDbOperationError](/mapseekai/emap/api/classes/duckdb.DuckDbOperationError.html)

## 可运行示例

- [check-geometry](/mapseekai/emap/examples/check-geometry/)
- [duckdb-query](/mapseekai/emap/examples/duckdb-query/)
- [transaction](/mapseekai/emap/examples/transaction/)
