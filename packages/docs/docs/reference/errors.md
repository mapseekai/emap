---
id: errors
slug: /reference/errors
title: 错误参考
api: ["Emap", "Err", "OK", "okValue", "OpError", "OpResult", "topologyValidator", "TopologyValidatorOptions", "ValidationChange", "ValidationIssue", "ValidationReport", "Validator", "ValidatorPhase", "ValidatorRegistry", "ValidatorResult", "SourceLoadError", "DuckDbOperationError", "DuckDbOperationErrorKind"]
examples: ["check-geometry","duckdb-query","transaction"]
stability: stable
verifiedVersion: 0.14.0
---

# 错误参考

地图处理返回 `OpResult<T>`；按 `ok` 和 `error.kind` 处理成功或失败。

结构化诊断帮助应用提示待修正参数、补充导入 CRS，以及在数据变化后重新发起操作。

```ts
const result = await map.ops.checkGeometry({ source: "parcels" }) // 运行地图操作
if (!result.ok) { // 失败时按 error.kind 分支
  if (result.error.kind === "validation") {
    console.error(result.error.field, result.error.reason) // 显示待修正字段
  }
  return // 停止成功路径
}
console.log(result.value) // 使用成功值
```

## 核心错误处理

| `kind` | 字段 | 说明 |
| --- | --- | --- |
| `not-found` | `what`、`id` | 未找到目标。 |
| `validation` | `field`、`reason` | 选项、字段或几何校验失败。 |
| `expression-disabled` | `operation` | 禁用策略拒绝 JavaScript 表达式。 |
| `duckdb` | `operation`、`duckDbKind`、`reason`、`field?`、`cause?` | DuckDB 操作异常。 |
| `mapshaper` | `cause`、`cmd?`、`operation?` | mapshaper、Worker 或提交异常。 |
| `stale-operation` | `sourceId`、`operation` | 异步操作期间 source 或事务已变更。 |
| `host-removed` | — | 地图移除期间的操作或提交。 |

成功结果含 `value`，失败结果含 `error`；`OK` 是无值成功结果，`okValue(value)` 创建有值结果。

## 更多错误构造

### `Err` 构造参数

| 构造函数 | 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `notFound` | `what`、`id` | `'source' \| 'layer' \| 'mask' \| 'divider' \| 'field'`、`string` | 必填 | 缺失目标类别和请求的标识。 |
| `validation` | `field`、`reason` | `string`、`string` | 必填 | 待修正的字段名和可呈现的校验原因。 |
| `expressionDisabled` | `operation` | `string` | 必填 | 被策略拦截的操作名。 |
| `duckdb` | `operation`、`duckDbKind`、`reason` | `string` | 必填 | 调用 DuckDB 的操作名、故障类别和错误消息。 |
| `duckdb` | `opts.field`、`opts.cause` | `{ field?: string; cause?: unknown }` | `undefined` | 可选输入字段和原始异常。 |
| `mapshaper` | `cause` | `unknown` | 必填 | mapshaper、Worker 或提交异常。 |
| `mapshaper` | `opts.cmd`、`opts.operation` | `{ cmd?: string; operation?: string }` | `undefined` | 可选命令文本和 API 操作名。 |
| `staleOperation` | `sourceId`、`operation` | `string`、`string` | 必填 | 已改变的 source 与待提交操作。 |
| `hostRemoved` | — | — | — | 创建 `host-removed` 结果。 |

`Err` 为内部操作和扩展构造统一失败形状；应用通常消费 `OpResult`。

## 更多加载与 DuckDB 错误

### Source 加载诊断

`SourceLoadError(code, diagnostics)` 使用首条诊断消息；预检返回诊断，`addSource()` 与 `confirmSource()` 将终止性问题抛为该错误。

| `code` | 触发条件 | 说明 |
| --- | --- | --- |
| `source-crs-required` | 缺少输入和元数据 CRS | 提交 `SourceLoadAnswers.sourceCrs` 后重新预检。 |
| `source-crs-invalid` | `sourceCrs` 为空或无效 | 诊断提供 CRS 修正信息。 |
| `source-crs-overrides-metadata` | 显式 CRS 覆盖或待确认元数据 CRS | 警告含有效 CRS。 |
| `source-id-conflict` | source `id` 已注册或待确认 | 改用新 `id` 或等待加载。 |
| `source-load-cancelled` | 地图、AbortSignal 或待确认任务取消 | 导入已取消。 |
| `source-load-rejected` | 解析、source 契约、dataset 或 CRS 不匹配 | 诊断标识失败。 |
| `source-plan-invalid` | plan 无效、异图或已消费 | 重新预检。 |
| `source-plan-stale` | 预检后 source 或地图 CRS 已变 | 使用当前数据重新预检。 |

`SourceLoadDiagnostic` 包含代码、级别和可选 CRS 值。请求以 `id` 和二选一的 `source` 或 `input` 提供数据。

### 导入资源阈值

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `resourceLimits.maxInputBytes` | `number` | 2 GiB | 原始输入上限。 |
| `zipLimits.maxCompressedBytes` | `number` | 2 GiB | ZIP 压缩输入上限。 |
| `zipLimits.maxBytes` | `number` | 2 GiB | ZIP 解压总字节上限。 |
| `zipLimits.maxEntries` | `number` | 5000 | ZIP 条目上限。 |
| `zipLimits.maxRatio` | `number` | 100 | 解压比上限，防护 ZIP bomb。 |

### 表达式与 Worker 控制

| API / 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `MapOptions.expressionPolicy`、`Emap.setExpressionPolicy(policy)` | `'disabled' \| 'trusted'` | `'disabled'` | 表达式策略。 |
| `MapOptions.useWorker` | `boolean \| 'auto'` | `false` | Worker 路由。 |
| `MapOptions.workerThreshold` | `number` | `50000` | `'auto'` 顶点阈值。 |
| `MapOptions.workerUrl` | `string` | `'emap-worker.js'` | Worker bundle URL。 |
| `MapOptions.workerPoolSize` | `number` | `1` | Worker 池槽位数。 |
| `MapshaperWorkerPoolOptions.jobTimeoutMs` | `number` | `120000` 毫秒 | 请求超时，必须是 `1`–`2147483647` 的整数。 |

Worker 以请求 `id`、消息 `type` 和槽位 `epoch` 关联响应；迟到响应会忽略。`workerUrl` 应使用与页面相同发行版的 Worker。

### DuckDB 失败类别

Map 操作将 `DuckDbOperationError` 转为 `OpError` `duckdb`。

| `kind` | 触发条件 | 说明 |
| --- | --- | --- |
| `validation` | SQL 或操作前置条件无效 | `field` 标识待修正参数。 |
| `runtime-unavailable` | DuckDB runtime 缺失或不完整 | 初始化所需 runtime 后重试。 |
| `spatial-extension-unavailable` | spatial 扩展加载失败 | 检查扩展或 runtime。 |
| `query-failed` | SQL 或连接操作失败 | `message` 和 `cause` 提供诊断。 |
| `conversion-failed` | dataset 与 Arrow 转换失败 | 检查几何和字段类型。 |

## 更多验证器报告

匹配验证器在提交后并行运行；任一 `ok: false` 时，`Emap` 发出含结果和标签的 `validationfailed`。

| API | 参数 / 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `ValidatorRegistry.register` | `v` | `Validator` | 必填 | 注册验证器并返回幂等注销函数；同名对象可分别注册。 |
| `ValidatorRegistry.runFor` | `phase` | `ValidatorPhase` | 必填 | 当前为 `'after-commit'`，在每次提交后运行。 |
| `ValidatorRegistry.runFor` | `host`、`change` | `EmapHostInternal`、`ValidationChange` | 必填 | `host` 提供数据访问；`change.label` 是刚提交的历史命令标签。 |
| `Validator` | `name`、`phase`、`run(host, change)` | `string`、`'after-commit'`、`Promise<ValidationReport>` | 必填 | `name` 出现在事件结果；`run` 返回诊断报告。 |
| `ValidationIssue` | `severity`、`message`、`ref?` | `'error' \| 'warning'`、`string`、`FeatureRef` | `ref` 为 `undefined` | `ref` 让 UI 高亮问题要素。 |
| `ValidationReport` | `ok`、`issues` | `boolean`、`ValidationIssue[]` | 必填 | `issues` 为空或仅含 warning 时 `ok` 为 `true`。 |
| `ValidatorResult` | `validator`、`report` | `string`、`ValidationReport` | 必填 | 一个已运行验证器在事件中的结果。 |

验证器异常转换为 `severity: 'error'` 的 issue。

### `topologyValidator` 参数

`topologyValidator(opts = {})` 在提交后检查 arc 自交，每个命中 source 生成一条 issue。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `sources` | `string[]` | 所有已注册 source | 扫描的 source ID。 |
| `tolerance` | `number` | `undefined` | 相交判定容差。 |
| `severity` | `'error' \| 'warning'` | `'error'` | issue 级别。 |

## API

- [src.OpError](/mapseekai/emap/api/types/emap.OpError.html)
- [src.SourceLoadError](/mapseekai/emap/api/classes/emap.SourceLoadError.html)
- [src_duckdb.DuckDbOperationError](/mapseekai/emap/api/classes/duckdb.DuckDbOperationError.html)

## 可运行示例

- [check-geometry](/mapseekai/emap/examples/check-geometry/)
- [duckdb-query](/mapseekai/emap/examples/duckdb-query/)
- [transaction](/mapseekai/emap/examples/transaction/)
