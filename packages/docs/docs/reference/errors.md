---
slug: /reference/errors
title: 错误参考
---

# 错误参考

操作错误通过 `OpResult` 返回。DuckDB 错误带 `kind`，应用可区分运行时初始化、SQL 校验和操作失败。

## 行为说明

用户恢复说明放在触发控件附近，技术错误文本放进日志。

## API

- [src.OpError](https://zwishing.github.io/emap/api/types/index.OpError.html)
- [src_duckdb.DuckDbOperationErrorKind](https://zwishing.github.io/emap/api/types/src_duckdb.DuckDbOperationErrorKind.html)

## 可运行示例

- [duckdb-query](https://zwishing.github.io/emap/examples/duckdb-query/)
- [check-geometry](https://zwishing.github.io/emap/examples/check-geometry/)

## 最小片段

```ts
if (!result.ok) console.error(result.error)
```
