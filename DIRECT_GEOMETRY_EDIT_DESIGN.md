# 直接几何编辑与多级撤回设计

## 文档状态

- 状态：已核实（2026-08-29 对照源码逐条核查 + 独立审查），阶段 A 可实施
- 目标范围：`reshape-ring-part` 示例及其对应的 ring / part / reshape 编辑操作
- 主要目标：将局部几何编辑从 whole-dataset replacement 迁移为可逆的原地增量命令，支持稳定的多级 undo / redo
- 非目标：本设计不要求将 clip、dissolve、union、project、rebuild topology、数据导入等全局操作改为原地编辑
- 本轮实施范围：**仅阶段 A**（addRing / deleteRing / addPart / deletePart + 命令基础设施 + transaction 修复 + MSX 导出压缩）；reshape（阶段 B）另开一轮

## 0. 核实修订（2026-08-29）

对照源码核查结论：§1 背景、§2 混合模型、§7.1–7.4 写集断言**全部属实**。关键事实：

- `EditHistory.push()` 遇 `invalidatesPriorCommands` 释放全部旧 undo 项并插入一个 stale 占位符（`src/edit/edit-history.ts:107`）；undo/redo 遇 stale 只移动占位符。
- `_runPreparedDatasetMutation()` 的 `before` 是 live 原对象、`after` 是 working copy（`src/map/ops/_runner.ts:269`）；undo replacement 挂回精确 `before` identity——`edit-command.ts` 注释中"恢复的是不同 identity 的 deep copy"与实现矛盾，§10 对 barrier 过严的怀疑有依据。
- `appendArc()` 每次整体重分配 nn/xx/yy/zz（`mapshaper-adapter.ts:664`）；reshape-polygon 已有 append 候选 + `deleteLastArc` 试错模式。
- `FeatureDeleteCommand`、`SplitSharedArcsCommand`、`CompositeCommand`、`markSourceChanged()`（DisplayArcs dirty + editVersion bump）、transaction capture buffer 均已存在；FeatureQuery 缓存 keyed on editVersion。

核查发现的**四处文档与代码的实质冲突**，本稿已修正：

1. ~~§5.2 假定存在 `selectionRestoreCommand`~~ → 实际不存在；改为新增 `FeatureDeleteWithSelectionCommand` wrapper（见 §5.2）。
2. ~~§6.1 直接复用 `SplitSharedArcsCommand` 私有 helper~~ → 私有实现丢 retained interval、`zz` 全有才保留、无 arc count 断言；须"抽取并修复"（见 §6.1）。
3. ~~§8 runner 返回裸 `EditCommand`~~ → 无法携带 op 结果值；返回类型改为 `PreparedDirectEdit<T> = { value, command, affectedSourceIds }`。runner 不新建文件，并入 `_runner.ts` 与既有 commit 路径并列。
4. ~~§11 假定 transaction rollback 兼容 direct command~~ → `Transaction.rollback()` 靠 `setDataset(firstTouchBefore)` 快照，对原地修改无效；修复为反序调用 captured commands 的 `undo()`，快照仅作异常兜底（见 §11）。

其他已决事项：

- 缓存/事件唯一所有者是 direct runner；`source.fire('data')` reason 扩展为 `'edit'`，接线前先核对 data handler 已有职责，避免双重副作用。
- highlight 无 feature-id remap API；feature 删除导致 id 下移时清除受影响 layer 的 highlight 引用。
- 导出：live dataset 永不压缩；MSX 快照导出前 `copyDataset` + `cleanArcReferences` 副本（GeoJSON 按 shape 遍历、TopoJSON 自带 dissolve 拷贝，均无需改动）。
- 阶段 A 每个 add 仅追加一个 arc，批量 append API 的性能收益主要服务阶段 B；仍在本轮实施以统一 `SplitSharedArcsCommand` 实现。
- 工作量估计：阶段 A 最小切片约 5–8 开发日；含 transaction/highlight/事件归属的完整契约约 2–3 人周；阶段 B reshape 约 4–6 人周（polygon 校验当前依赖可变 ArcCollection 试错，需 coordinate-level validator 或 scratch collection）。

## 1. 背景

`reshape-ring-part` 示例中的整形、挖洞、删洞、加部分、删部分操作当前通过 `runPreparedDatasetMutation()` 执行：

```text
handler
→ map.ops.*
→ runPreparedDatasetMutation()
→ copyDataset(original)
→ 在 working dataset 上修改
→ DatasetReplaceSelectionCommand
→ EditHistory.push()
```

`DatasetReplaceSelectionCommand` 声明：

```ts
readonly invalidatesPriorCommands = true;
```

`EditHistory.push()` 遇到该标记时会清空旧 undo 栈，并放入一个 stale barrier：

```text
Earlier edits unavailable
```

因此连续执行：

```text
挖洞 A → 挖洞 B → 删洞 C
```

历史不会保留为：

```text
[A, B, C]
```

而会反复变成：

```text
[stale, C]
```

第一次 undo 能恢复 C；第二次 undo 只弹出 stale 占位符，不执行几何恢复，表现为“只能撤回上一步”。

## 2. 设计结论

采用混合编辑模型：

| 操作类型 | 执行方式 |
|---|---|
| 顶点移动、插入、删除 | 现有原地增量命令 |
| `addRing` / `deleteRing` | 原地可逆命令 |
| `addPart` / `deletePart` | 原地可逆命令 |
| `reshapeSelected` | 拓扑 patch 命令 |
| `splitSelected` | 后续复用拓扑 patch 命令 |
| clip / erase / dissolve / union | whole-dataset replacement |
| project / reproject / rebuild topology | whole-dataset replacement |
| 数据导入、source replacement | whole-dataset replacement |

原则：

```text
局部编辑 → direct reversible command
全局空间运算 → dataset replacement barrier
```

## 3. 设计目标

### 3.1 必须满足

1. ring / part / reshape 操作可以连续多级 undo / redo。
2. 每个逻辑操作只形成一个 history entry。
3. undo / redo 后 geometry、attributes、selection、feature ids 与事件状态完全恢复。
4. 直接编辑不能在验证失败时留下部分 mutation。
5. source 被替换、editVersion 变化或 transaction 失效时必须返回 stale-operation，不得提交旧计划。
6. ArcCollection 中既有 arc id 在可撤回历史存活期间保持稳定。
7. 与当前 QGIS-style 选择无关目标解析语义一致。
8. 不改变当前 ring/part/reshape 对真实穿越、共边、自交等几何校验规则。

### 3.2 性能目标

1. 局部编辑不再执行 `copyDataset()`。
2. 删除 ring / part 不再运行全 dataset `cleanArcReferences()`。
3. 一次操作追加多个 arc 时只扩容 ArcCollection 一次。
4. undo 追加操作时一次性截断到原 arc count。
5. 仅失效受影响 source 的 DisplayArcs、feature query 和 shape caches。

## 4. 非目标

1. 不在第一阶段重写 mapshaper 全局运算。
2. 不在有可撤回历史时压缩 live ArcCollection。
3. 不要求第一阶段引入通用拓扑 free-list 或引用计数系统。
4. 不在本设计中改变 Shapefile、TopoJSON、GeoParquet 导入归一化策略。
5. 不把所有现有 `DatasetReplaceCommand` 一律取消 history barrier。

## 5. 核心命令模型

## 5.1 `PathGeometryPatchCommand`

建议新增内部命令：

```ts
interface PathShapePatch {
  layer: MapshaperLayer;
  featureId: number;
  before: PathShape;
  after: PathShape;
}

interface AppendedArcSnapshot {
  xx: Float64Array;
  yy: Float64Array;
  zz?: Float64Array | null;
}

interface PathGeometryPatchCommandOptions {
  source: TopologySource;
  shapePatches: PathShapePatch[];
  originalArcCount: number;
  appendedArcs: AppendedArcSnapshot[];
  selection: Selection;
  beforeSelection: SelectionSnapshot;
  afterSelection: FeatureRef[];
  publishSelection(diff: SelectionDiff): void;
  label: string;
}
```

### `do()`

```text
批量追加 appendedArcs
→ 写入 after shapes
→ 应用 afterSelection
→ markSourceChanged(source)
```

### `undo()`

```text
一次性截断 arcs 至 originalArcCount
→ 恢复 before shapes
→ 恢复 beforeSelection
→ markSourceChanged(source)
```

### `publish()`

```text
source.fire('data', { reason: 'edit' })
→ 发布 selection diff
```

命令应内部 clone `before` / `after` shape，避免调用方后续 mutation 改写历史快照。

## 5.2 Feature 删除

`deletePart` 删除最后一个 part 时会删除整个 feature，导致后续 feature id 下移。

建议复用现有：

```ts
FeatureDeleteCommand
```

注意：代码中不存在独立的 selection restore command（2026-08-29 核实）。改为新增小型 wrapper `FeatureDeleteWithSelectionCommand`（放在 `feature-delete.ts`），内部组合：

```text
FeatureDeleteCommand（shape / record splice 与恢复）
+ selection 快照恢复（beforeSelection / afterSelection remap）
+ markSourceChanged(source)
```

`FeatureDeleteCommand` 本身保持现有契约不变——不把 source / cache / event 职责塞回纯命令；缓存、render、history 事件由 direct runner 统一负责（§8、§9）。

## 5.3 多 source 操作

若一个用户动作涉及多个 source，应为每个 source 生成一个 patch command，再组合为一个：

```ts
CompositeCommand(sourceCommands, label)
```

`undo()` 必须按相反 source mutation 顺序执行；`redo()` 按原顺序执行。

## 6. ArcCollection 生命周期

## 6.1 追加 arc

当前 `appendArc()` 每调用一次都会重新分配并复制整个顶点表。reshape 一次可能追加多个 arc，重复调用会形成：

```text
O(totalVertices × appendedArcCount)
```

建议从 `SplitSharedArcsCommand` 抽取为 adapter 公开 API（"抽取并修复"，不是原样 export 私有实现）：

```ts
appendArcs(arcs: ArcCollection, arcsToAppend: AppendedArcSnapshot[]): number; // 返回首个新 arc id
truncateArcs(arcs: ArcCollection, targetArcCount: number): void;
```

要求：

- 一次性计算新增顶点总数；
- 一次性分配 `nn / xx / yy / zz`；
- 保留 retained interval（`updateVertexData()` 会重置为 0，必须显式保存并恢复——现有私有实现未做，抽取时修复）；
- 原 collection 有 `zz` 时，缺失 `zz` 的新 arc 填 `Infinity`（镜像 `appendArc()` 现有行为；现有私有实现只在全部新 arc 带 `zz` 时才保留，否则整体丢弃，抽取时修复）；
- `truncateArcs()` 一次性恢复历史 arc count；
- `do()` / `redo()` 追加前断言 `arcs.size() === expectedArcCount`（防止绕过 history 的尾部追加导致 truncate 误删其他 command 的 arc）；
- redo 追加后的 arc ids 必须与首次 do 完全一致。

抽取后 `SplitSharedArcsCommand` 反向改为调用该 adapter API，消灭重复实现。

## 6.2 删除 ring / part 时不压缩 arc

当前 `deleteRing` / `deletePart` 会调用：

```ts
cleanArcReferences(dataset)
```

该函数会：

1. 扫描全部 layer shapes；
2. 删除未引用 arc；
3. 重排 arc ids；
4. 重写所有 path references。

这会使历史命令捕获的 arc id 失效，因此 direct edit 路径不得在每次删除时压缩 ArcCollection。

改为：

```text
do：只删除 shape 中的 ring / part 引用
undo：在原索引插回引用
```

未引用 arc 暂时保留。

## 6.3 拓扑压缩策略

live dataset 有可撤回历史时不得重排 arc ids。可选压缩点：

1. 导出时对 dataset 副本执行 `cleanArcReferences()`；
2. `clearHistory()` 后执行显式 compact；
3. 提供 `source.compactTopology()`，并明确它是 history barrier；
4. 长期方案：ArcCollection free-list / reference counts。

第一阶段推荐方案 1：导出副本压缩，不修改 live dataset。

## 7. 各操作迁移设计

## 7.1 `addRing`

当前写集：

```text
appendArc(hole)
shape.splice(insertIndex, 0, [arcId])
```

迁移步骤：

1. 在 live dataset 上只读扫描目标 feature；
2. 完成 ring containment、boundary conflict、orientation 校验；
3. 生成 `beforeShape`；
4. 预计算新 arc vertices 和 `afterShape`；
5. 构造 `PathGeometryPatchCommand`；
6. 经 direct runner 提交命令。

undo：移除新增 ring shape 引用并截断新 arc。

风险：低。

## 7.2 `deleteRing`

当前写集：

```text
shape.splice(ringIndex, 1)
cleanArcReferences(dataset)
```

迁移后：

```text
shape patch only
不删除 arc
```

命令捕获：

- source / layer / featureId；
- ringIndex；
- 完整 beforeShape / afterShape；
- before / after selection。

风险：低。

## 7.3 `addPart`

与 `addRing` 相同：

```text
append one arc
→ shape.push([arcId])
```

对 polygon part 保持现有方向校验；对 polyline part 保持端点/冲突校验。

风险：低。

## 7.4 `deletePart`

### feature 仍有其他 part

使用 shape patch：

```text
shape.splice(partIndex, 1)
```

### 删除最后一个 part

使用 `FeatureDeleteCommand`，并捕获：

- shape；
- attribute record；
- featureId；
- selection remap；
- 同 layer 后续 feature refs 的 id 下移。

不立即删除未引用 arcs。

风险：中。

## 7.5 `reshapeSelected`

reshape 是高风险迁移项。

当前流程使用：

```ts
insertCutPoints(dataset, cutPoints)
```

该调用会：

- 分裂 ArcCollection；
- remap divided arcs；
- 重写所有引用相关共享 arc 的 shapes；
- 追加 replacement arcs；
- 替换多个 feature shapes。

直接原地调用会扩大写集，不适合普通局部命令。

### 推荐方案：追加替代 arcs

不修改原共享 arc，而是：

```text
读取原 arc / 接触点
→ 生成所需前段、替换段、后段坐标
→ 作为新 arc 批量追加
→ 只重写命中的 feature shapes
→ 原 arc 和未命中相邻 feature 保持不变
```

优点：

1. undo 只需截断 appended arcs；
2. 无需全 dataset remap；
3. 未选中相邻 feature 不会被同步改变；
4. 与 `SplitSharedArcsCommand` 的模式一致；
5. 多个命中 feature 可作为一个 patch command 提交。

需要重点验证：

- closed ring 两种候选路径方向；
- line replacement 前后接点一致；
- shared arc 只复制目标 feature 的使用路径；
- multiple features / multiple sources；
- polygon orientation、hole grouping；
- undo / redo 后 arc ids 完全一致。

风险：高，建议独立阶段实施。

## 8. Direct Runner

并入 `_runner.ts`，与 `commitDatasetReplace` / `commitDatasetReplaceSelection` 并列（复用模块私有的 `enqueueSourceOperation` 与 stale guard 骨架，不新建 `_direct-runner.ts`）。内部提交路径：

```ts
interface PreparedDirectEdit<T> {
  value: T;
  command: EditCommand;                  // 单 source patch 或 Composite
  affectedSourceIds: readonly string[];
}

runPreparedEditCommand<T>(
  host: EmapHostInternal,
  sourceId: string,
  label: string,
  plan: (
    dataset: MapshaperDataset,
    source: MutableTopologySource,
  ) => PreparedDirectEdit<T> | OpResult<T>,   // planner 纯只读；校验失败返回 OpResult
): Promise<OpResult<T>>;
```

执行顺序：

```text
enqueueSourceOperation
→ 检查 host/source/dataset
→ 记录 dataset identity + editVersion + transaction
→ 只读规划、校验、构造 command
→ 再次检查 identity/editVersion/transaction
→ command.do()
→ history.push(command)
→ invalidate source shape caches
→ schedule render
→ command.publish()
→ fire historychange
```

## 8.1 规划阶段必须只读

不能先 mutation live dataset 再尝试构造 undo 数据。否则校验失败会留下部分变更。

要求 planner 返回：

```text
不可变 plan
或 OpResult failure
```

`command.do()` 在所有验证通过后一次性提交。

## 8.2 stale guard

提交前必须验证：

```ts
host._sources.get(sourceId) === source
source.getDataset() === dataset
(dataset.editVersion ?? 0) === plannedEditVersion
host._activeTransaction === transaction
transaction == null || transaction.isOpen
```

## 8.3 失败回滚

命令 `do()` 应设计为验证后无失败路径。若 ArcCollection 扩容仍可能抛错，则 direct runner 需要：

```text
try command.do()
catch → command.undo() / restore captured state
```

首选将所有可能失败的工作放在 planner 阶段。

## 9. 缓存与事件

每次 direct command do / undo 必须：

1. `markDisplayArcsDirty()`；
2. `bumpEditVersion(dataset)`；
3. 清理对应 source 的 `FeatureQuery` Flatbush；
4. 清理 layer arc-id cache；
5. 更新 selection；
6. 调度 render；
7. 发布 `data`、`selectionchange`、`historychange`；
8. 清除或更新指向已删除 feature id 的 highlight。

这些副作用应集中在 direct runner / command publish 中，不应复制到每个 op。

## 10. History 设计

迁移后的局部命令：

```ts
invalidatesPriorCommands = false;
```

因此历史可以保持：

```text
addRing A
addRing B
deleteRing C
```

undo：

```text
C → B → A
```

redo：

```text
A → B → C
```

### Dataset replacement barrier

全局 replacement 仍保留 barrier，但需要单独复核当前假设：

- `_runner.ts` 的 `before` 是操作前 live dataset 对象；
- `working` 才是 `copyDataset(original)`；
- undo replacement 会重新挂回 `before` 对象；
- 早期 direct commands 捕获的引用可能重新成为 live。

这意味着现有 barrier 可能比实际需要更严格，但不能在本次迁移中顺手移除。应增加专门测试：

```text
direct edit
→ dataset replacement
→ undo replacement
→ undo direct edit
```

只有确认 source/layer/arcs identity 全部恢复后，才能缩小 barrier。

## 11. Transaction 影响

`EditHistory.beginCapture()` 期间 direct commands 应进入 capture buffer。commit 后组合为一个 `CompositeCommand`。

必须保证：

- 同 source 多个 patch 的 arc append 顺序固定；
- Composite undo 反序截断 arc；
- 后一个 child 的 `originalArcCount` 与前一个 child 的 after count 对齐；
- **rollback 修复（2026-08-29 核实为硬冲突）**：现有 `Transaction.rollback()` 仅 `setDataset(firstTouchBefore)` 挂回快照——对 replacement 有效（before 对象未被碰过），对 direct command 无效（原地改的就是 before 对象）。修复为：先反序调用 capture buffer 中每个 command 的 `undo()`，dataset 快照仅作异常兜底。replacement command 反序 undo 与快照恢复等价，行为不回归；
- rollback 不发布中间 selection/data/history 事件；
- capture 期间事件维持现状（各 op 立即 publish，commit 不重放）；"transaction 只发布最终状态"的事件合并留给阶段 B reshape 一并处理。

如果多个 child 都操作同一 ArcCollection，建议 transaction planner 合并成一个 source-scoped patch command，避免相互依赖的 arc count。

## 12. 影响文件范围

### 新增

```text
src/edit/commands/path-geometry-patch.ts
src/edit/commands/path-geometry-patch.test.ts
```

（`_direct-runner.ts` 已取消：direct runner 并入 `_runner.ts`，见 §8。）

### 修改（阶段 A 本轮范围）

```text
src/map/ops/_context.ts            # OpContext 增加 runPreparedEditCommand
src/map/ops/_runner.ts             # runPreparedEditCommand + commitEditCommand 路径
src/map/ops/rings.ts               # addRing / deleteRing 迁移
src/map/ops/parts.ts               # addPart / deletePart 迁移（含末 part wrapper）
src/map/mapshaper-ops.ts           # OpContext 接线（原清单遗漏）
src/adapter/mapshaper-adapter.ts   # appendArcs / truncateArcs 公开 API
src/edit/commands/_shared.ts       # 共享 clone / vertex-data helper
src/edit/commands/feature-delete.ts # FeatureDeleteWithSelectionCommand wrapper
src/edit/commands/split-shared-arcs.ts # 反向复用 adapter 批量 API
src/edit/transaction.ts            # rollback 反序 undo 修复
src/edit/edit-history.ts           # capture buffer 安全取回（rollback 用）
src/map/map.ts                     # data 事件 reason 扩展、highlight 清除
src/map/highlight-manager.ts       # 受影响 layer highlight 清除（原清单遗漏）
src/source/topology-source.ts      # MSX 导出 copy + cleanArcReferences 副本
src/map/ops/_test-helpers.ts       # runner fixture 更新（原清单遗漏）
src/map/ops/rings.test.ts          # 真 runner 测试矩阵
src/map/ops/parts.test.ts          # 真 runner 测试矩阵
```

### 阶段 B 才修改（本轮不动）

```text
src/map/ops/reshape-selected.ts
src/map/ops/reshape-selected-line.ts
src/map/ops/reshape-selected-polygon.ts
```

### 可能修改

```text
src/edit/edit-command.ts           # 如需 affected sources / publish 元数据
src/edit/commands/composite.ts     # 如需事件合并（阶段 B 再评估）
src/map/selection.ts               # 如需 remap helper
```

### 文档与示例

```text
packages/examples/examples/reshape-ring-part/index.html
packages/docs/docs/guides/editing.md
packages/docs/i18n/en/docusaurus-plugin-content-docs/current/guides/editing.md
CHANGELOG.md
```

## 13. 测试矩阵

## 13.1 命令级

- do 后 shape / arcs 正确；
- undo 完整恢复；
- redo 与首次 do 完全一致；
- 连续 undo / redo 多轮不漂移；
- appended arc ids 稳定；
- attributes 不变；
- source editVersion 每次 do / undo 递增；
- DisplayArcs dirty；
- publish 事件只触发一次。

## 13.2 操作级

```text
addRing × 3 → undo × 3 → redo × 3
addRing → deleteRing → undo × 2
addPart → deletePart → undo × 2
删除最后 part → feature row/record/selection 恢复
多个 feature reshape → 单 entry undo
多个 source 命中 → 单 entry undo
```

## 13.3 拓扑级

- shared arc；
- reversed arc id；
- tangent hole；
- nested island/hole；
- polygon orientation；
- unused arcs；
- simplified arcs / `zz`；
- 多环、多部件、大顶点数；
- undo 后导出 GeoJSON/TopoJSON/Shapefile 保持有效。

## 13.4 History / transaction

- direct → direct：逐级撤回；
- direct → replacement：barrier 行为符合设计；
- replacement → direct：只能在 replacement 之后逐级撤回；
- transaction 内多个 direct patch：一个 entry；
- transaction rollback：无残留 mutation；
- max history size 淘汰后，arc 生命周期仍正确。

## 13.5 性能

以 3.5M+ vertex 数据为基准：

- addRing / addPart 不再执行 `copyDataset()`；
- deleteRing / deletePart 不再执行 `cleanArcReferences()`；
- 追加多个 arc 仅一次分配；
- operation latency 与被修改 shape / 新增 arc 大小相关，而不是与 dataset 总大小线性相关；
- undo / redo 不做全 dataset clone。

## 14. 分阶段实施

## 阶段 A：ring / part direct commands

迁移：

```text
addRing
deleteRing
addPart
deletePart
```

交付条件：

- 示例可连续执行至少 3 次 ring/part 操作；
- undo / redo 可以逐级恢复；
- selection / attributes / feature ids 完整；
- 大数据删除洞不运行 dataset copy / arc compaction；
- transaction 内 direct op 单 history entry，rollback 反序 undo 无残留 mutation（§11 修复）；
- 末 part 删除后 feature row / record / selection 恢复，受影响 layer highlight 被清除；
- MSX 快照导出不含 orphan arcs（导出副本压缩，live dataset 不动）；
- direct → replacement → undo replacement → undo direct 的 identity 行为有专项测试覆盖（§10，仅观察不收窄 barrier）。

## 阶段 B：reshape topology patch

迁移：

```text
reshapeSelected line
reshapeSelected polygon
```

交付条件：

- 不调用全局 `insertCutPoints()` remap；
- 只重写命中的 feature shapes；
- shared arc 邻居保持不变；
- multi-feature 操作一个 history entry。

## 阶段 C：复用 patch 基础设施

候选：

```text
splitSelected
部分 feature rotate/scale 后处理
其他局部 topology edits
```

## 阶段 D：History barrier 复核

使用 identity 测试确认 replacement 前后的 direct command 是否安全。若安全，再将 barrier 从“清空全部历史”收窄为 source/identity scoped barrier。

## 15. 风险

| 风险 | 缓解方式 |
|---|---|
| 未引用 arcs 增长 | 导出副本压缩；clearHistory 后 compact |
| redo arc id 漂移 | LIFO + originalArcCount + 批量追加 |
| selection id 重排错误 | 选择快照 + feature delete 专项测试 |
| 多命令共享 ArcCollection | source-scoped 合并 patch |
| planner 意外 mutation | readonly plan API + mutation-before-commit 测试 |
| cache 未失效 | direct runner 统一缓存处理 |
| 事件重复或缺失 | publish 契约和事件计数测试 |
| reshape 破坏邻接要素 | 追加替代 arc，不切原共享 arc |
| topology compact 破坏历史 | compact 明确作为 barrier |

## 16. 待确认问题

1. ~~live dataset 的未引用 arc 是否在所有导出格式中都会自动过滤？~~ → **已核实并决策（2026-08-29）**：GeoJSON 按 shape 遍历自然过滤；TopoJSON 导出自带 copy + dissolve；MSX 快照（`compact: true` 仅压缩顶点缓冲，不删 orphan arcs）会随之膨胀 → MSX 导出路径改为 `copyDataset` + `cleanArcReferences` 副本后序列化，live dataset 永不压缩。
2. ~~`source.fire('data')` 是否应由每个 command publish，还是 direct runner 统一发布？~~ → **已决策**：direct runner 统一发布，reason 扩展为 `'edit'`；接线前核对 data handler 已有职责，避免双重副作用。
3. transaction 中同 source 多个 patch 是否强制合并？（阶段 A 维持逐 child capture；合并与事件聚合留待阶段 B 评估）
4. ~~highlight 是否应跟随 selection snapshot，还是单独维护 feature-ref remap？~~ → **已决策**：无 remap API；feature 删除导致 id 下移时清除受影响 layer 的 highlight 引用。
5. direct command 是否作为公共 API 导出，还是第一阶段仅内部使用？建议先内部使用。（维持）
6. replacement barrier 是否按 source scope 缩小，而不是全 map 清空？（维持待验证；已核实 barrier 很可能过严——runner 挂回精确 before identity——须 `direct → replacement → undo replacement → undo direct` identity 测试通过后才收窄）
7. reshape 是否允许复制 shared arcs，还是必须保持邻接拓扑联动？建议默认复制，仅改命中 feature。（维持，阶段 B 决策；注意这是产品行为决策而非纯实现细节——复制会切断目标 feature 与邻接 feature 的 shared-arc identity，影响后续顶点编辑联动）

## 17. 推荐首个实现切片

第一轮只实施：

```text
PathGeometryPatchCommand
批量 append/truncate arc adapter API
direct runner
addRing
deleteRing
addPart
deletePart
```

暂不迁移 reshape。

该切片可以直接验证核心架构：

- 多级 undo / redo；
- 稳定 arc ids；
- selection 恢复；
- 无 whole-dataset clone；
- 无删除时 arc compaction；
- 与现有节点编辑命令共存。

验证通过后，再基于同一命令模型迁移 reshape。
