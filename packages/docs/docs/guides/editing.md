---
id: editing
slug: /guides/editing
title: 编辑
api: ["AffineMatrix", "AppendedArc", "AutoCompletePolygonHandler", "AutoCompletePolygonOptions", "AutoCompletePolygonResult", "BulkFeatureDeleteCommand", "BulkFeatureDeleteCommandOptions", "composeMatrix", "CompositeCommand", "DatasetReplaceCommand", "DatasetReplaceCommandOptions", "EditCommand", "EditHistory", "EditHistoryOptions", "Emap", "FeatureAffineCommand", "FeatureAffineCommandOptions", "FeatureAppendCommand", "FeatureAppendCommandOptions", "FeatureCreateCommand", "FeatureDeleteCommand", "FeatureDeleteCommandOptions", "FeaturePropertyChangeCommand", "FeaturePropertyChangeCommandOptions", "FeatureTranslateCommand", "FeatureTranslateCommandOptions", "FieldAddCommand", "FieldAddCommandOptions", "FieldRemoveCommand", "FieldRemoveCommandOptions", "FieldRenameCommand", "FieldRenameCommandOptions", "HistoryStateSnapshot", "IDENTITY_MATRIX", "invertMatrix", "planSharedArcSplit", "planSharedNodeSplit", "rotateMatrix", "scaleMatrix", "SplitSharedArcsCommand", "SplitSharedArcsCommandOptions", "SplitSharedArcsRemap", "SplitSharedNodeCommand", "SplitSharedNodePlan", "TopologySource.fromBytes", "Transaction", "TranslatedPointFeature", "VertexDeleteCommand", "VertexInsertCommand", "VertexMoveCommand", "AddPartOptions", "AddRingOptions", "DeletePartOptions", "DeleteRingOptions", "FillRingOptions", "PartEditHandler", "PartEditOptions", "ReshapeFeatureHandler", "ReshapeFeatureOptions", "ReshapeSelectedOptions", "ReshapeSelectedResult", "RingEditHandler", "RingEditOptions", "DrawFeatureHandler", "VertexEditHandler", "SplitFeatureHandler", "TransformFeatureHandler"]
examples: ["attribute-editing","china-editing","draw-snap-clear","draw-snap-edge","feature-rotate-scale","feature-translate","rebuild-topology","reshape-ring-part","snapshot","split-features","transaction","undo-redo","vertex-editing"]
stability: stable
verifiedVersion: 0.12.0
---

# 编辑

Emap 将交互编辑、选择变换和可撤销命令写入同一地图状态。

```ts
map.drawFeature.setOptions({
  // 配置面要素绘制
  source: 'parcels', // 接收新要素的 source
  sourceLayer: 'lots', // 目标数据图层
  type: 'polygon', // 草图几何类型
  snapThreshold: 12, // 捕捉距离（像素）
  snapToVertex: true, // 捕捉顶点
  snapToEdge: true, // 捕捉边
}); // 保存绘制选项
map.drawFeature.enable(); // 启用绘制会话
```

## 核心方法

### Handler 通用方法

所有编辑 Handler 提供：

| 方法 | 签名 | 参数与行为 |
| --- | --- | --- |
| `enable()` / `disable()` | `(): void` | 进入编辑模式（重复调用保持状态）/ 清理交互并退出。 |
| `isEnabled` | `isEnabled(): boolean` | 返回启用状态。 |
| `setOptions` | `setOptions(options: Partial<Options>): void` | 合并传入字段；按 Handler 校验或重建会话。 |
| `getOptions` | `getOptions(): Readonly<Options>` | 返回当前选项快照。 |

### 绘制要素

绘制工具需要目标 source 和几何类型：

| Handler | 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `drawFeature` | `source` | `string` | 必填 | 新要素写入的 source ID。 |
|  | `sourceLayer` | `string` | 第一个匹配的几何图层 | 目标 layer 名称。 |
|  | `type` | `'point' \| 'polyline' \| 'polygon'` | 必填 | 草图几何类型。 |
|  | `snapThreshold` | `number` | `10` | 顶点和边捕捉阈值（像素）。 |
|  | `snapSources` | `string[]` | `[source]` | 可捕捉的 source。 |
|  | `snapToVertex` | `boolean` | `true` | 捕捉已有顶点。 |
|  | `snapToEdge` | `boolean` | `true` | 捕捉弧段垂足。 |
|  | `drawColor` | `string` | `EMAP_THEME_COLORS.primary` | 草图线 CSS 颜色。 |

## 更多编辑工具

### Handler 选项

| Handler | 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `vertexEdit` | `layers` | `string[]` | 全部可见图层 | 可编辑命中测试图层。 |
|  | `polygonFillColor` | `string` | `EMAP_THEME_COLORS.selection` | 面要素悬停填充色。 |
|  | `snapThreshold` | `number` | `10` | 顶点拖动捕捉阈值（像素）。 |
|  | `snapToVertex` | `boolean` | `true` | 捕捉其他要素顶点。 |
|  | `snapToEdge` | `boolean` | `true` | 捕捉其他要素边。 |
| `splitFeature` | `cutterType` | `'point' \| 'polyline'` | `'point'` | 点或折线切刀。 |
|  | `snapThreshold` | `number` | `10` | 切刀捕捉阈值（像素）。 |
| `reshapeFeature` | `snapThreshold` | `number` | `10` | 重塑草图捕捉阈值（像素）。 |
| `autoCompletePolygon` | `snapThreshold` | `number` | `10` | 继承 `ReshapeFeatureOptions`。 |
| `ringEdit` | `mode` | `'add' \| 'delete' \| 'fill'` | `'add'` | `add` 画内环，`delete` 点击孔洞，`fill` 生成面。 |
|  | `snapThreshold` | `number` | `10` | `add` 草图捕捉阈值（像素）。 |
| `partEdit` | `mode` | `'add' \| 'delete'` | `'add'` | 添加或删除路径 part。 |
|  | `snapThreshold` | `number` | `10` | `add` 草图捕捉阈值（像素）。 |
| `transformFeature` | `mode` | `'translate' \| 'rotate' \| 'scale'` | `'translate'` | 已选要素变换模式。 |
|  | `layers` | `string[]` | 全部可见图层 | 命中测试图层。 |
|  | `session.splitSharedArcs` | `boolean` | `true` | 会话开始时复制共享弧，保持未选邻要素不动。 |

`splitFeature` 需同一 source layer 的有效路径选择。`partEdit.add` 需恰好一个已选路径；`ringEdit`、`reshapeFeature`、`autoCompletePolygon` 操作草图命中几何。`transformFeature` 仅从已选要素开始拖动。`boxSelect` 与 `lassoSelect` 手势互斥，切换前调用 `disable()`。

## 选择编辑会话

`map.editSession` 用于选择级编辑；即时方法写入一个历史项，拖动会话将多帧预览折叠为一个。

### 一次性操作

| 方法 | 签名 | 参数 | 行为 |
| --- | --- | --- | --- |
| `translateSelected` | `(dx: number, dy: number): OpResult` | `dx`、`dy` 为 source 数据坐标偏移 | 平移当前选择；空选择或零偏移返回校验结果。 |
| `rotateSelected` | `(angleDegrees: number, origin?: [number, number]): OpResult` | `angleDegrees` 为角度；`origin` 默认受影响顶点包围盒中心 | 绕指定或自动枢轴旋转。 |
| `scaleSelected` | `(sx: number, sy?: number, origin?: [number, number]): OpResult` | `sx` 为 X 比例；`sy` 默认 `sx`；`origin` 默认包围盒中心 | 均匀或非均匀缩放。 |
| `splitSharedNode` | `(ref: FeatureRef, vertexId: number): number[] \| null` | `ref` 为 `{ source, layer, id }`；`vertexId` 为 source 全局顶点索引 | 分离共享节点并返回独立顶点 ID。 |

### 拖动会话

| API | 签名 | 参数 | 行为 |
| --- | --- | --- | --- |
| `beginTranslateSession` | `(options?: DragSessionOptions): FeatureTranslateSession \| null` | `options.splitSharedArcs?: boolean`，默认 `true` | 创建平移预览；空选择返回 `null`。 |
| `FeatureTranslateSession.move` | `(dx: number, dy: number): void` | 单帧数据坐标增量 | 立即更新几何，不写历史。 |
| `FeatureTranslateSession.commit` | `(): boolean` | 无参数 | 将累计位移写为一个命令；零位移为 `false`。 |
| `FeatureTranslateSession.getAccumulated` | `(): [number, number]` | 无参数 | 返回累计 `(dx, dy)`。 |
| `beginAffineSession` | `(origin?: [number, number], options?: DragSessionOptions): FeatureAffineSession \| null` | `origin` 默认选择包围盒中心；`options.splitSharedArcs` 默认 `true` | 创建仿射预览。 |
| `FeatureAffineSession.origin` | `readonly [number, number]` | 会话创建时确定 | 固定枢轴。 |
| `FeatureAffineSession.applyDelta` | `(matrix: AffineMatrix): void` | `matrix` 为 `{ a, b, c, d, tx, ty }` | 应用并累计单帧仿射增量。 |
| `FeatureAffineSession.commit` | `(label?: string): boolean` | `label` 默认自动生成 | 将累计矩阵写为一个命令；单位矩阵为 `false`。 |
| `FeatureAffineSession.getCumulative` | `(): AffineMatrix` | 无参数 | 返回累计复合矩阵。 |
| `FeatureTranslateSession.cancel` / `FeatureAffineSession.cancel` | `(): void` | 无参数 | 恢复会话前几何。 |

`rotateMatrix()`、`scaleMatrix()` 生成 `AffineMatrix`；`composeMatrix(a, b)` 按 `a · b` 复合，`invertMatrix()` 求逆，`IDENTITY_MATRIX` 为单位矩阵。

## 撤销、重做和快捷键

| 方法 | 签名 | 参数 | 行为 |
| --- | --- | --- | --- |
| `map.undo` / `map.redo` | `(): boolean` | 无参数 | 撤销 / 重做顶部历史项。 |
| `map.canUndo` / `map.canRedo` | `(): boolean` | 无参数 | 是否可撤销 / 重做；事务期间为 `false`。 |
| `map.clearHistory` | `(): void` | 无参数 | 清空撤销和重做栈。 |
| `map.bindHistoryShortcuts` | `(target?: HTMLElement): () => void` | `target` 默认地图画布容器 | 绑定撤销/重做快捷键，返回解绑函数。 |

```ts
if (map.canUndo()) map.undo();
if (map.canRedo()) map.redo();

const unbind = map.bindHistoryShortcuts();
// 组件卸载时调用 unbind()
```

`historychange` 的 `HistoryStateSnapshot` 含 `canUndo`、`canRedo`、顶部 `label`、`staleCount`、`topIsStale`、一次性 `skippedStale`。数据集替换建立历史边界。

## 将多个操作作为一个动作

`map.beginTransaction()` 捕获期间命令和操作；提交后成为一个 `CompositeCommand` 历史项。

| API | 签名 | 参数 | 行为 |
| --- | --- | --- | --- |
| `map.beginTransaction` | `(): Transaction` | 无参数 | 开始事务并快照选择和首次触及 source；嵌套时抛错。 |
| `tx.isOpen` | `readonly boolean` | 无参数 | `commit()` 或 `rollback()` 前为 `true`。 |
| `tx.commit` | `(label: string): Promise<OpResult>` | `label` 为历史项标签 | 等待已跟踪操作，合并命令并关闭事务。 |
| `tx.rollback` | `(): void` | 无参数 | 逆序撤销命令，恢复 dataset 和选择。 |

```ts
const tx = map.beginTransaction();
const clipped = await map.ops.clipLayer({ source: 'parcels', target: 'lots', mask: 'boundary' });
if (!clipped.ok) {
  tx.rollback();
} else {
  await tx.commit('裁剪地块');
}
```

## 高级可撤销编辑

### 命令契约

公开操作不足时实现 `EditCommand`：先修改数据，再 `map.pushCommand(command)` 记录重做状态；首次提交不调用 `do()`。

| 成员 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `do` | `(): void` | 必填 | 重做时重放修改。 |
| `undo` | `(): void` | 必填 | 撤销时恢复状态。 |
| `label` | `readonly string` | 可选 | 历史标签。 |
| `mergeable` | `(previous: EditCommand): boolean` | 可选 | 与栈顶命令合并。 |
| `merge` | `(next: EditCommand): void` | 可选 | 吸收后续命令，保留最早撤销快照。 |
| `invalidatesPriorCommands` | `readonly boolean` | 可选 | 替换 dataset 时建立历史边界。 |

`CompositeCommand(children, label?)` 按声明顺序 `do()`、逆序 `undo()`，将多个命令记录为一个动作。

### 内置命令选项

这些构造器面向高级集成；常规编辑优先用 Handler、`map.ops`、`map.editSession`。相关类型均为现有地图对象引用。

| 命令 | 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `FeatureCreateCommand` | `geometryType` | `'point' \| 'polyline' \| 'polygon'` | 必填 | 新绘制要素类型。 |
|  | `layer`, `source` | `MapshaperLayer`, `TopologySource` | 必填 | shape 接收图层和所属 source。 |
|  | `appendedShape`, `appendedRecord` | `FeatureShape`, `Record<string, unknown> \| null` | 必填 | 已追加的 shape 和属性记录。 |
|  | `arcVertices`, `arcs` | `[number, number][]`, `ArcCollection` | 路径必填 | 路径弧顶点和弧集合；点省略。 |
|  | `adapter` | `MapshaperAdapter` | 默认适配器 | mapshaper 弧操作适配器。 |
| `FeatureAppendCommand` | `layer`, `source` | `MapshaperLayer`, `TopologySource` | 必填 | 追加目标。 |
|  | `appendedShape`, `appendedRecord` | `FeatureShape`, `Record<string, unknown> \| null` | 必填 | 既有弧引用和可选属性记录。 |
|  | `label` | `string` | `'Append feature'` | 历史标签。 |
| `FeatureDeleteCommand` | `layer`, `featureId` | `MapshaperLayer`, `number` | 必填 | 目标图层和删除前索引。 |
|  | `shape`, `record`, `source` | `FeatureShape \| null`, `Record<string, unknown> \| null`, `TopologySource` | 必填 | 撤销用几何、属性快照和 source。 |
| `BulkFeatureDeleteCommand` | `layer`, `source` | `MapshaperLayer`, `TopologySource` | 必填 | 批量删除目标。 |
|  | `snapshots` | `Array<{ id, shape, record }>` | 必填 | 删除前快照；`id` 为原图层索引。 |
| `FeaturePropertyChangeCommand` | `layer`, `featureId`, `dataset` | `MapshaperLayer`, `number`, `MapshaperDataset` | 必填 | 属性变更图层、要素和 dataset。 |
|  | `prev`, `next` | `Record<string, unknown>` | 必填 | 前后稀疏属性补丁。 |
|  | `label` | `string` | `'Edit properties'` | 历史标签。 |
| `FeatureTranslateCommand` | `source`, `dx`, `dy` | `TopologySource`, `number`, `number` | 必填 | source 数据坐标平移目标和偏移。 |
|  | `arcs`, `arcIds`, `pointFeatures` | `ArcCollection`, `number[]`, `TranslatedPointFeature[]` | 点要素省略 `arcs` | 要移动的路径弧和点要素。 |
| `FeatureAffineCommand` | `source`, `matrix`, `arcIds`, `pointFeatures` | `TopologySource`, `AffineMatrix`, `number[]`, `TranslatedPointFeature[]` | 必填 | 仿射变换和受影响要素。 |
|  | `arcs` | `ArcCollection` | 点要素省略 | 路径要素共享弧。 |
|  | `label` | `string` | `Transform N features` | 历史标签。 |
| `DatasetReplaceCommand` | `source`, `before`, `after`, `label` | `TopologySource`, `MapshaperDataset`, `MapshaperDataset`, `string` | 必填 | dataset 替换；`before` 撤销，`after` 重做，并建立历史边界。 |
| `FieldAddCommand` | `layer`, `field`, `dataset` | `MapshaperLayer`, `string`, `MapshaperDataset` | 必填 | 添加属性列。 |
|  | `defaultValue` | `unknown` | `null` | 缺少字段记录的值。 |
| `FieldRemoveCommand` | `layer`, `field`, `dataset` | `MapshaperLayer`, `string`, `MapshaperDataset` | 必填 | 删除列并保存原值。 |
| `FieldRenameCommand` | `layer`, `from`, `to`, `dataset` | `MapshaperLayer`, `string`, `string`, `MapshaperDataset` | 必填 | 重命名记录和字段元数据。 |

### 低层拓扑命令

| 命令 | 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `VertexInsertCommand` | `insertionId`, `point`, `arcs`, `source` | `number`, `[number, number]`, `ArcCollection`, `TopologySource` | 必填 | 在全局索引插入顶点；`adapter` 可选。 |
| `VertexDeleteCommand` | `vertexIndex`, `coords`, `arcs`, `source` | `number`, `[number, number]`, `ArcCollection`, `TopologySource` | 必填 | 删除顶点；撤销时恢复 `coords`；`adapter` 可选。 |
| `VertexMoveCommand` | `vertexIds`, `from`, `to`, `arcs`, `source` | `number[]`, `[number, number]`, `[number, number]`, `ArcCollection`, `TopologySource` | 必填 | 移动同一拓扑节点顶点；可合并；`adapter` 可选。 |
| `SplitSharedArcsCommand` | `source`, `remaps`, `appendedArcs`, `originalArcCount` | `TopologySource`, `SplitSharedArcsRemap[]`, `AppendedArc[]`, `number` | 必填 | 复制共享弧并重写选择 shape；撤销恢复 shape 并截断弧。 |
| `SplitSharedNodeCommand` | `plan` | `SplitSharedNodePlan` | 必填 | 执行共享节点分离计划。 |

`planSharedArcSplit()` 和 `planSharedNodeSplit()` 产生计划；交互编辑优先使用 `map.editSession.splitSharedNode()` 或拖动会话。

### 支持契约

| API | 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `new EditHistory` | `options: EditHistoryOptions` 的 `maxSize` | `number` | `200` | 保留撤销命令上限，至少 `1`。 |
| `AppendedArc` | `xx`, `yy`, `zz` | `Float64Array`, `Float64Array`, `Float64Array \| null` | `zz` 可省略 | 追加共享弧顶点坐标。 |
| `SplitSharedArcsRemap` | `layer`, `featureId`, `originalShape`, `newShape` | `MapshaperLayer`, `number`, `PathShape`, `PathShape` | 必填 | shape 重写前后快照。 |
| `ReshapeSelectedOptions` | `line` | `[number, number][]` | 必填 | 替换触及路径的折线草图。 |
| `AddRingOptions` | `ring` | `[number, number][]` | 必填 | 闭合内环坐标。 |
| `DeleteRingOptions` / `FillRingOptions` | `point` | `[number, number]` | 必填 | 孔洞内一点，删除孔洞或生成面。 |
| `AddPartOptions` | `coordinates` | `[number, number][]` | 必填 | 新独立 part 坐标。 |
| `DeletePartOptions` | `point`, `tolerance` | `[number, number]`, `number` | `tolerance` 为 `0` | 待删除 part 点和可选容差。 |
| `AutoCompletePolygonOptions` | `line` | `[number, number][]` | 必填 | 沿已有边界围出面的开放草图。 |
| `AutoCompletePolygonResult` | `createdCount`, `features` | `number`, `FeatureRef[]` | 必填 | 创建面数量和引用。 |
| `ReshapeSelectedResult` | `reshapedCount` | `number` | 必填 | 成功重塑要素数。 |
| `TopologySource.fromBytes` | `(id, bytes, options?)` | `string`, `Uint8Array \| ArrayBuffer`, `TopologySourceFromBytesOptions` | `filename` 为 `${id}.geojson` | 从内存文件创建可编辑 source；文件扩展名选择导入器。 |

## 可运行示例

- [顶点编辑](/mapseekai/emap/examples/vertex-editing/)
- [撤销与重做](/mapseekai/emap/examples/undo-redo/)
- [事务](/mapseekai/emap/examples/transaction/)
