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

`Emap` 数据操作返回 `OpResult`；用 `ok` 分支读取结果或结构化错误。


```ts
const result = await map.ops.checkGeometry({ source: 'main' }); // 执行操作
if (!result.ok) {
  // 读取结果前先分支
  switch (
    result.error.kind // 收窄结构化错误
  ) {
    case 'not-found': // source、layer、mask、divider 或 field 缺失
      console.error(`Missing ${result.error.what}: ${result.error.id}`); // 标识缺失项
      break; // 结束此错误分支
    case 'validation': // 操作输入无效
      console.error(`${result.error.field}: ${result.error.reason}`); // 显示字段错误
      break; // 结束此错误分支
    default: // 其他结构化错误
      console.error(result.error.kind); // 报告错误类别
  }
} else {
  // 操作成功
  console.log(result.value); // 使用检查报告
}
```

## 核心方法


### `OpResult` 结构

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `ok` | `true \| false` | 必填 | 判别字段；`true` 时读取 `value`，`false` 时读取 `error` |
| `value` | `T` | `undefined`（无返回值操作） | 成功操作的结果 |
| `error` | `OpError` | — | 结构化失败详情；按 `kind` 分支可收窄类型 |

## 更多错误详情

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `error.kind` | `'not-found'` | 必填 | source、layer、mask、divider 或 field 未找到；用 `what`、`id` 定位 |
| `error.what` | `'source' \| 'layer' \| 'mask' \| 'divider' \| 'field'` | 必填（`not-found`） | 未找到资源的类别 |
| `error.id` | `string` | 必填（`not-found`） | 未找到资源的标识 |
| `error.kind` | `'validation'` | 必填 | 操作输入校验失败 |
| `error.field` | `string` | 必填（`validation`）；可选（`duckdb`） | 关联的选项字段 |
| `error.reason` | `string` | 必填（`validation`、`duckdb`） | 人类可读的失败原因 |
| `error.kind` | `'expression-disabled'` | 必填 | 表达式策略已关闭 |
| `error.operation` | `string` | 必填（`expression-disabled`、`duckdb`、`stale-operation`）；可选（`mapshaper`） | 失败或过期的操作名 |
| `error.kind` | `'duckdb'` | 必填 | DuckDB 操作失败 |
| `error.duckDbKind` | `string` | 必填（`duckdb`） | DuckDB 失败类别 |
| `error.cause` | `unknown` | 可选（`duckdb`）；必填（`mapshaper`） | 用于诊断的原始异常 |
| `error.kind` | `'mapshaper'` | 必填 | mapshaper 执行失败 |
| `error.cmd` | `string` | 可选（`mapshaper`） | 关联的 mapshaper 命令 |
| `error.kind` | `'stale-operation'` | 必填 | 排队操作等待时 source 已变化 |
| `error.sourceId` | `string` | 必填（`stale-operation`） | 已变化的 source 标识 |
| `error.kind` | `'host-removed'` | 必填 | 地图已移除；无额外字段 |

## Source 加载错误事件

`TopologySource.setData()` 在当前加载失败时触发 `error`，并以相同错误 reject。事件可集中展示错误，`await` 路径会停止后续加载。

```ts
source.on<{ error: unknown }>('error', ({ error }) => {
  console.error('Source import failed', error);
});

try {
  await source.setData({ filename: file.name, content: new Uint8Array(await file.arrayBuffer()) });
} catch (error) {
  console.error('Keep the import UI open', error);
}
```

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `event.type` | `string` | — | 当前加载失败时为 `'error'` |
| `event.error` | `unknown` | 必填 | URL、解析、格式插件或 dataset 归一化的原始错误 |

## 回滚事务

`map.beginTransaction()` 和 `transaction.rollback()` 都不接收参数。回滚逆序撤销暂存命令，恢复初始 source dataset 与选择集，并发布状态更新。

```ts
async function previewThenCancel(map: Emap) {
  const transaction = map.beginTransaction();
  try {
    const result = await map.ops.dropLayer({ source: 'main', target: 'draft' });
    if (!result.ok) {
      transaction.rollback();
      return result;
    }

    transaction.rollback();
    return result;
  } catch (error) {
    if (transaction.isOpen) transaction.rollback();
    throw error;
  }
}
```

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `map.beginTransaction()` 参数 | `[]` | `[]` | 创建并开始捕获编辑命令；每个地图一次一个事务 |
| `transaction.rollback()` 参数 | `[]` | `[]` | 关闭事务，恢复初始数据和选择集，并逆序 `undo()` 暂存命令 |
| `transaction.rollback()` 返回值 | `void` | — | 安排渲染，触发 `historychange`；选择变化时触发 `selectionchange`，并设 `isOpen: false` |

## API

- `Emap`
- `OpResult`
- `OpError`

## 可运行示例

- [几何检查](/mapseekai/emap/examples/check-geometry/)
- [DuckDB 缓冲区](/mapseekai/emap/examples/duckdb-buffer/)
- [DuckDB 查询](/mapseekai/emap/examples/duckdb-query/)
