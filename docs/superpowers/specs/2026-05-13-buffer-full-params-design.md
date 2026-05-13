# Buffer 全参数支持 + 点/面 buffer 缺陷修复 — 设计稿

- 日期: 2026-05-13
- 范围: `src/map/ops/buffer.ts`, `src/map/types.ts` (`BufferOptions`),
  `test/examples/buffer.html`, `src/map/ops/buffer.test.ts`
- 关联现象:
  - `buffer.html` 上 **点图层 buffer 看起来不工作**（实际是 mapshaper
    点 buffer 单位是米，默认 `radius=0.01` 在 lat/lng 数据上等于 1 cm
    圆，肉眼不可见）。
  - **面图层 buffer 出现"内部线"**（mapshaper 默认行为是逐 feature 缓冲
    再 dissolve，若相邻多边形在 topology 中没有共享弧，内部边界不会被
    合并）。

## 1. 动机

emap 现版本 `BufferOptions` 只暴露了 `radius` 与 `capStyle` 两个字段，
mapshaper `-buffer` 命令其余 8 个 CLI 选项（`vertices` / `arc-quality` /
`tolerance` / `type` / `planar` / `v2` / `slice-length` / `backtrack`）全部
被屏蔽。这导致:

1. 应用层无法控制点 buffer 圆精度、单侧缓冲、平面/大地切换。
2. 上文提到的"面 buffer 内部线"问题没有任何 op 级的修复入口，调用方
   只能在外面手动拼 `dissolve2` → `buffer` 两步流程。

本设计把全部 mapshaper buffer 参数透传到 emap 公共 API，并新增一个
`mergeFirst` 开关把"整层先合再 buffer"做成 op 内部的一次调用。

## 2. 不在范围内 (YAGNI)

- 不修改默认行为；`mergeFirst` 默认 `false`，旧调用零破坏。
- 不在 op 内部自动投影坐标系；调用方仍需自行 `projectLayer` 到米制 CRS
  才能让线/面 buffer 与点 buffer 单位一致。
- 不暴露 `debug-points`（仅 mapshaper 内部调试用，无应用价值）。
- 不改 `_runner.COMMAND_EFFECTS` 中 buffer 的分类（仍是
  `shape-count`）。

## 3. API 变更

### 3.1 `BufferOptions`（`src/map/types.ts`）

```ts
export interface BufferOptions {
  source: string;
  target: string;

  /** 缓冲半径；常量或 mapshaper 表达式串。线/面单位 = 源 CRS 单位，
   *  点单位 = 米（除非 `planar=true`）。 */
  radius: number | string;

  /** 端点样式；仅对 polyline 影响显式可见。默认 'round'。 */
  capStyle?: 'flat' | 'round';

  /** 点 buffer 圆周顶点数，默认 mapshaper 内部 72。正整数。 */
  vertices?: number;

  /** polyline/polygon 拐角与端点圆弧每 1/4 圆段数。正整数。 */
  arcQuality?: number;

  /** 弧近似允许偏差。正有限数。 */
  tolerance?: number;

  /** 单侧缓冲；语义仅对 polyline 严格成立。 */
  type?: 'left' | 'right' | 'outer' | 'inner';

  /** 强制平面计算；让点 buffer 以源 CRS 单位（度等）而非米解释 radius。 */
  planar?: boolean;

  /** 启用 v2 算法。 */
  v2?: boolean;

  /** 单段最大路径段数，性能调优。正整数。 */
  sliceLength?: number;

  /** 反向回溯，性能调优。正整数。 */
  backtrack?: number;

  /** 面 buffer 前先 `-dissolve2` 把整层按几何重叠合并成一个外轮廓，
   *  消除"内部线"。仅对 polygon 图层生效；其余几何类型忽略并通过
   *  console.warn 提示。默认 false。 */
  mergeFirst?: boolean;
}
```

### 3.2 emap → mapshaper 字段映射

| emap 字段 | ParsedCommand 选项 key | 备注 |
|---|---|---|
| `radius` | `radius` | 数字串化（`String(...)`）保持现有行为 |
| `capStyle` | `cap_style` | 已有 |
| `vertices` | `vertices` | int |
| `arcQuality` | `arc_quality` | int |
| `tolerance` | `tolerance` | number |
| `type` | `type` | 枚举 |
| `planar` | `planar` | flag → `true` |
| `v2` | `v2` | flag → `true` |
| `sliceLength` | `slice_length` | int |
| `backtrack` | `backtrack` | int |
| `mergeFirst` | (不透传 buffer) | 改为前置 `dissolve2` 命令 |

## 4. 实现要点 (`src/map/ops/buffer.ts`)

### 4.1 校验顺序（短路）

1. `source` / 目标 layer 存在性（保留现有逻辑）。
2. `radius`:
   - `number` → `Number.isFinite(r) && r > 0`，否则 `Err.validation`。
   - `string` → trim 后非空；并经过 `_allowExpressionEvaluation`。
3. **新增**: 数值参数校验，全部走 helper:
   - `vertices`, `arcQuality`, `sliceLength`, `backtrack` → 正整数
     (`Number.isInteger(x) && x > 0`)。
   - `tolerance` → 正有限数。
4. **新增**: `type` ∈ `{'left','right','outer','inner'}`，否则
   `Err.validation('type', ...)`。
5. **新增**: `mergeFirst` 仅在 layer 的 `geometry_type === 'polygon'`
   时生效；其他类型 → `console.warn(...)` 并忽略（不报错，因为这是
   "尽力而为"的便利开关）。

### 4.2 选项装配

按 4.2 表逐字段往 `bufferOptions: Record<string, unknown>` 里塞，
**仅当字段被显式提供**才写入（避免 mapshaper 收到 `undefined` 触发
默认行为以外的分支）。`planar` / `v2` 仅在 `true` 时透传。

### 4.3 命令链组装

```
const commands: ParsedCommand[] = [
  { name: 'target', options: { target: opts.target } },
];
if (mergeFirstApplies) {
  commands.push({ name: 'dissolve2', options: {} });
}
commands.push({ name: 'buffer', options: bufferOptions });
```

调用 `ctx.runDatasetCommandParsed(opts.source, commands, label)`，其中
`label = mergeFirstApplies ? \`Buffer (merged) ${target}\` : \`Buffer ${target}\``。

### 4.4 错误透传

mapshaper 内部抛错（如不支持的几何类型）已经由 `_runner` 包装成
`Err.mapshaper`，无需在 `buffer.ts` 额外捕获。

## 5. UI 改造 (`test/examples/buffer.html`)

### 5.1 控件增加

| 控件 | HTML 元素 | 默认 | 备注 |
|---|---|---|---|
| 半径 | (已有) | `1000` | 改默认值；保留数字/表达式双解析 |
| 端点样式 | (已有) | round | — |
| vertices | `<input type="number" min="1">` | 空 | 空 = 不透传 |
| arc-quality | `<input type="number" min="1">` | 空 | — |
| type | `<select>` (空/left/right/outer/inner) | 空 | — |
| planar | `<input type="checkbox">` | false | — |
| v2 | `<input type="checkbox">` | false | — |
| mergeFirst | `<input type="checkbox">` | false | 标签："整层合并后再 buffer (面)" |
| 单位提示 | `<small>` | — | 文本固定：点 buffer 半径单位 = 米（勾选 planar 则为源 CRS 单位）；线/面 buffer 单位 = 源 CRS 单位。 |

### 5.2 提交逻辑

- 收集所有有值的控件，按 `BufferOptions` 字段命名传入
  `map.ops.bufferLayer(opts)`。
- 半径解析保留 `/^-?\d+(\.\d+)?$/` 判断（其余视为表达式）。

## 6. 测试 (`src/map/ops/buffer.test.ts`)

新增 / 调整 case（沿用现有 mock 风格：`setDefaultMapshaperAdapter`
配 `Object.create(MapshaperOps.prototype)` + stub `runDatasetCommand`）：

1. **字段透传** — 给所有新字段传非默认值，断言 ParsedCommand 选项
   里出现对应 snake_case key 且值正确。
2. **`mergeFirst` 命令链 (polygon)** — 断言命令序列里 `dissolve2`
   出现在 `buffer` 之前，且 `target` 在最前。
3. **`mergeFirst` 命令链 (polyline)** — 不出现 `dissolve2`；spy 一次
   `console.warn`。
4. **校验失败** — 非法 `type`、`vertices=0`、`vertices=1.5`、
   `tolerance=-1` 各自返回 `Err.validation`，且 `runDatasetCommand`
   未被调用。
5. **未提供字段不透传** — 只传 `radius`，其余字段在 ParsedCommand
   选项中不存在（防御 mapshaper 收到 `undefined` 分支）。
6. **现有 case 不动** — 旧的 `radius` 数值/字符串/表达式禁用三条
   case 保留。

## 7. 文档

`CLAUDE.md` "Where to Make Changes" 表中 buffer 行追加一句："字段映射
camelCase ↔ snake_case 见 `src/map/ops/buffer.ts`"。其他文档不动。

## 8. 数据流（无变化但备记）

```
emap.ops.bufferLayer(opts)
  → src/map/ops/buffer.ts
      ├─ 校验 + 装配 ParsedCommand[]
      └─ ctx.runDatasetCommandParsed(source, cmds, label)
          → _runner.ts (effect: 'shape-count' → 选择清空)
              → MapshaperAdapter.runOnDatasetParsed
                  → mapshaper.internal.runParsedCommands
                      ├─ (mergeFirst) -dissolve2
                      └─ -buffer  →  cmd.buffer = makeBufferLayer
                          ├─ point     → makePointBuffer (米/大地)
                          ├─ polyline  → makePolylineBuffer (源 CRS)
                          └─ polygon   → makePolygonBuffer + dissolveBufferDataset
```

## 9. 兼容性

- **二进制兼容**: 全部新增字段是可选的；旧调用 `bufferLayer({source,
  target, radius})` 行为字节级不变。
- **撤销栈**: 仍是单条 `DatasetReplaceCommand`（runner 内部把
  `[target, dissolve2, buffer]` 视为一次 dataset-replace）。Ctrl+Z 一次
  撤销到 buffer 之前。
- **Worker 路由**: buffer 在 `_runner.EXPENSIVE_COMMANDS` 集合里，
  `dissolve2` 也是 expensive，命令链整体仍可走 worker。

## 10. 风险

- mapshaper 对参数组合的边界条件未文档化（例如 `type=inner` + 点
  layer）。处理方式：emap 不做组合校验，让 mapshaper 报错通过
  `Err.mapshaper` 透传给调用方。
- `mergeFirst=true` 会丢弃 feature 级 properties（dissolve2 合并行为）。
  在 JSDoc 中明示。

## 11. Out-of-Scope（未来工作占位）

- 单位自动一致化（先投影到米再 buffer 再反投回经纬度）。
- buffer 结果回写到原 layer（当前永远新建 layer，由 mapshaper 决定）。
