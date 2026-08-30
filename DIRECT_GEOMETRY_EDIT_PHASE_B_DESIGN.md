# Phase B 设计:reshapeSelected / splitSelected 原地增量迁移

- 日期:2026-08-30
- 状态:已批准(方案 1 + 拓扑联动)
- 前置:DIRECT_GEOMETRY_EDIT_DESIGN.md(§7.5、§8-§11、§13-§16);Phase A 已合并(master 65dcd050)
- 目标:reshape 与 split 从 whole-dataset replacement(`insertCutPoints` + `DatasetReplaceSelectionCommand`,barrier 清历史)迁移为可逆的原地增量命令,支持多级 undo/redo
- 已批准的两项关键决策:
  1. **拓扑联动**:reshape/split 切割共享弧时,所有引用方(目标 feature + 邻居 feature)的 shape 统一 patch 到新弧 id 序列,未被整形/切割的共享段保持 shared-arc identity,后续顶点编辑继续联动。
  2. **方案 1:直接规划 + 追加式分裂**;仅 split 线/面切割的 noding+mosaic 在子集草稿副本上执行。

## 1. 现状(探索核实,file:line 可复查)

### reshape(legacy)

`reshapeSelected`(`src/map/ops/reshape-selected.ts:70-163`):
- 逐 source 调 `runPreparedDatasetMutation`(每次 = `copyDataset` + `DatasetReplaceSelectionCommand`,`invalidatesPriorCommands = true`);
- 不限选中:所有被画线接触的 feature 都被整形(注释与测试 pin 此行为);
- 几何管线:`collectLineContacts`(横向接触,`reshape-selected-line.ts:108-177`)→ `cutPointsForContacts` → `adapter.insertCutPoints(working, cutPoints)`(全局分裂 + `remapDividedArcs` 重写所有引用 shape,`mapshaper-adapter.ts:813-816`)→ 重读 remap 后 shape → `partArcIndexes` 定位端点弧 → 追加单条替换弧 → 开环 splice / 闭环双向候选(`reshape-selected-line.ts:352-457`)→ 多边形候选校验(自交/洞逃逸/包含,`reshape-selected-polygon.ts:115-203`);
- undo = 整数据集换回。

### split(legacy)

`splitSelected`(`src/map/ops/split-selected.ts:87-192`):单 source/单 layer,点或折线 cutter。
- 点切割:`collectPointCutPoints`(`split-selected-line.ts:67-104`)→ `insertCutPoints` → `partitionShape`(`split-selected-line.ts:32-65`);
- 线切割:`properLineCutCoordinates` 横向/端点分类(`split-selected-line.ts:134-314`)→ 临时 cutter 层 + `addIntersectionCuts(rebuild_topology)`(`split-selected-line.ts:394-418`);
- 面切割:`properCrossings`(`split-selected-polygon.ts:19-103`)→ 临时 cutter + noding → `buildPolygonMosaic` → 面积守恒校验(`split-selected-polygon.ts:133-180`);
- `applySplitPieces`(`split-selected-geometry.ts:18-90`):最大块保留原 id、其余按序追加、克隆 attribute record、unsplit id 保留、返回 resultFeatures 作为替换 selection、移除临时层、**调 `cleanArcReferences` 压缩**。

### Phase A 可复用基础设施(已核实)

- `PathGeometryPatchCommand`(`src/edit/commands/path-geometry-patch.ts:62-125`):`{ source, shapePatches: {layer, featureId, before, after}[], originalArcCount, appendedArcs, selection, beforeSelection, afterSelection, publishSelection, label }`;do = 追加弧 + 写 after shape + selection;undo = 截断 + 恢复。
- `appendArcsCompat` / `truncateArcsCompat`(`src/edit/commands/_shared.ts:34-89`),adapter 快路径 `appendArcs`/`truncateArcs`(`mapshaper-adapter.ts:703-774`),`AppendedArc = { xx, yy, zz? }`。
- direct runner:`RunPreparedEditCommand`(`_context.ts:86-93`)、`_runPreparedEditCommand`(`_runner.ts:319-389`,live 只读规划 + stale guard + do + push + 统一 publish)。
- CompositeCommand(multi-source 单 entry)。
- `SplitSharedArcsCommand.planSharedArcSplit`(signed 方向保持的 remap 先例,`split-shared-arcs.ts:118-224`)。

## 2. 架构:追加式弧分裂(append-split)

**不变量:永不修改已有弧的顶点数据。** 被切弧原样保留(成为孤儿,等待导出副本压缩——已批准决策 §16.1),其坐标切片作为新弧批量追加;所有引用被切弧的 shape(目标 + 邻居)统一 patch 到新 piece id 序列。

```text
live dataset(只读规划)
  → 联系/交点计算(复用现有纯几何,直接在 live arcs 上读)
  → 切片规划器:cut 集合 → 每弧 piece 序列 → 确定性追加 id 分配
  → 引用扫描:哪些 shape 引用被切弧(跨 layer,含邻居)
  → after-shape 构造(目标替换 span;全部引用方换 piece 序列,signed 保持)
  → 命令提交:do = 批量追加弧 + 写 shape(+ split 追加 feature);undo = 截断 + 恢复
```

联动语义与 legacy 完全一致:未切割/未整形的共享段在目标与邻居间仍是同一批弧 id;被整形的 span 双方各自引用不同弧——这正是 legacy `insertCutPoints`+替换弧的行为。

## 3. 新组件

### 3.1 切片规划器 `src/map/ops/_arc-slicer.ts`(纯函数)

- 输入:live `ArcCollection` + 每弧切点集合。切点以**显式 provenance** 携带 `{ arcId, localSegmentIndex, point }`;亦接受 op 自有坐标数组(cutter)作为“虚拟弧”切片输入。
  - **契约修正(评审核实)**:现有 `Contact` 只有 `{ point, targetDist, lineDist }`;`TargetSegment.cutIndex` 是 `ii[arcId] + localOffset` 的**扁平顶点索引**(`reshape-selected-line.ts:12-17,39-62,220-230`),legacy `ArcCutPoint.i` 即此索引。迁移时在 `TargetSegment` 构建处直接附加 `{ arcId, localSegmentIndex }`(构建循环本来就知道二者);反向引用(`signedArcId < 0`)在发射时换算回弧存储序的 local segment(现有 `points.length - index - 1` 换算逻辑不变),切片始终按存储序进行,方向由 shape 组合时的 signed piece id 表达。`collectPointCutPoints`、`properLineCutCoordinates`、`properCrossings` 同样扩展为显式 provenance 输出,不再依赖扁平索引反查。
- 处理:每弧切点按顶点位置升序排序、去重(端点切点拒绝/规整与 legacy 一致);弧 i 的 k 个切点 → k+1 个 piece,每个 piece = 原弧坐标的切片(+插值切点);追加 id 按(弧 id 升序, 切点位置升序)确定分配。
- zz 规则:原顶点继承原 zz 切片;插值切点 zz = Infinity(对齐现有 `appendArc` 行为)。
- 输出:`{ pieces: AppendedArc[], pieceIdsBySourceArc: Map<number, number[]>, firstAppendedId }`。纯函数,无 dataset 依赖,独立单测。

### 3.2 mini-dataset 校验 harness(reshape 用)

reshape 候选校验(自交、洞逃逸/包含、双向选择)现有函数吃 `dataset` + `adapter`(~600 行已测逻辑,不重写)。harness 构造只含"被切弧原坐标 + piece 弧 + 替换弧"的迷你 ArcCollection 与翻译后的 shape,让现有校验**原样运行**,选定 after-shape 翻译回 live id。

- 双向 id 映射:liveId ↔ miniId,进入校验前、出来后各一次,带断言(映射必须全命中,否则规划失败 = OpResult failure,不留任何副作用)。
- mini 数据集在 planner 内构造、规划结束即弃;其成本与被切弧数量相关,与 dataset 总量无关。

### 3.3 `SplitFeaturesCommand`(`src/edit/commands/split-features.ts`,新命令类)

split 改变 feature 数,超出 PathGeometryPatchCommand 表达范围。捕获:

```ts
{
  source, label,
  shapePatches: PathShapePatch[],        // 邻居 + 被分割原 feature
  appendedArcs: AppendedArc[], originalArcCount: number,
  appendedFeatures: { layer, shapes: FeatureShape[], records: (Record<string, unknown> | null)[] }[],
    originalShapeCount: number,            // 目标 layer 的 shapes/data 数组截断点(split 限定单 source/单 layer)
  selection / beforeSelection / afterSelection / publishSelection
}
```

- do:追加弧 → 写 shapePatches → 追加 features(shapes + records)→ selection 替换 → `markSourceChanged`。
- undo:截断弧 → 恢复 shapePatches → 截断 shapes/records 数组 → 恢复 selection。
- `invalidatesPriorCommands = false`;effect 类沿用 `COMMAND_EFFECTS['split-selected'] = 'shape-count'`。

reshape **不需要新命令类**:PathGeometryPatchCommand 天然适配(targets + neighbors 均为 shapePatches);multi-source 由 CompositeCommand 包成单 history entry。

## 4. 分 op 迁移要点

### 4.1 reshape(line + polygon)— 零 dataset 拷贝

`reshape-selected.ts`:
- 保留:画线归一化校验、逐 source 扫描、不限选中的"所有接触 feature"语义、per-source 校验失败继续后续 source。
- 变更:`runPreparedDatasetMutation` → 逐 source `runPreparedEditCommand` 规划,各 source 生成 PathGeometryPatchCommand,多 source 命中时包 CompositeCommand 单 entry 提交。
- 规划(每 source,live 只读):联系收集 → 切点集 → slicer → 引用扫描 → 目标 after-shape(替换 span:开环直接拼接 piece 序列;闭环双向候选经 mini-dataset 校验选择)→ 邻居 after-shape(仅 i→pieces 重引用)→ 命令构造。

### 4.2 split 点切割

- `collectPointCutPoints` 复用(已知弧 id + 位置)→ slicer → `partitionShape` 等价逻辑直接作用于 piece id 序列(闭 part 存储缝衔接规则保持)→ feature 追加语义复刻 `applySplitPieces`(最大块保留原 id、追加顺序、记录克隆、unsplit id 保留、resultFeatures 替换 selection)。

### 4.3 split 线/面切割 — 显式切分 + provenance 精确草稿

- proper-crossing 分类(`properLineCutCoordinates` / `properCrossings`,纯几何)在 live 上跑;交点自带边界弧 id + 顶点位置与 cutter 参数位置。
- **线切割无草稿**:slicer 直接在交点处切分目标弧(noding 的等价物),`partitionShape` 等价逻辑作用于 piece id 序列。`addIntersectionCuts` 不进入迁移后路径。
- **面切割**:slicer 同样显式切分边界弧与 cutter 弧(cutter 为 op 自有坐标数组,按 cutter 参数位置切片);mosaic 草稿**仅由这些 piece + 未切边界弧的拷贝**组成,每条草稿弧按构造携带 `scratchArcId → liveArcId | cutter` provenance——**不做任何字节等同匹配**(坐标重复但拓扑身份不同的弧真实存在,字节匹配会错误合并身份)。
- `buildPolygonMosaic` 原样运行于该草稿;tile 引用的弧经 provenance 直接翻译:未切弧 → 原 live id;一切派生 piece(含未被 crossing 命中但属于被切弧的分段)→ 一律追加。面切割面积守恒校验保持。
- cutter 及其 piece 只存在于草稿与追加指令,永不触碰 live 已有弧。

### 4.4 唯一行为变更:删除 `cleanArcReferences`

`applySplitPieces` 末尾的压缩调用删除——append-only 下压缩会重排弧 id、击穿 undo。孤儿弧累积沿用已批准决策(§6/§16.1:MSX 导出走副本压缩,live 永不压缩)。几何输出不变;唯一可观测差异是 live 弧表单调增长。reshape 本无压缩调用,不受影响。

## 5. runner / 缓存 / transaction / 事件

- `_runner.ts` 增加多 source 规划-提交路径:逐 source stale guard(host/source/dataset identity + editVersion + transaction),全部规划成功后单 composite push,统一 publish(data reason `'edit'`、selectionchange、historychange 各一次)。
- 缓存失效(markDisplayArcsDirty、bumpEditVersion、FeatureQuery Flatbush、layer arc-id cache)由 direct runner 统一处理;**实现检查点**:确认 shape-count 变化(feature 追加)路径下 FeatureQuery/Flatbush 失效已覆盖(Phase A deletePart 删除路径已覆盖,追加为对称场景)。
- transaction:捕获缓冲内命令按序 do(),arc count 链式自然衔接;rollback 反序 undo(Phase A §11 修复已就位)。跨 source composite 的各 child 操作不同 ArcCollection,无 chaining 依赖。
- selection:reshape 不变(保持现有 selection);split 替换为 result refs(最大块原 id + 追加 id + unsplit id),与现状逐一致。

## 6. 测试策略

**几何等价性(主要证据)**:现有 op 级测试矩阵原样保留并通过——
- `reshape-selected.test.ts` / `reshape-selected-line.test.ts` / `reshape-selected-polygon.test.ts`
- `split-selected*.test.ts`(+ integration)/ `mapshaper-feature-split.test.ts` / `split-selected.test-d.ts`

**新增**:
- slicer 单元测试(排序/去重/端点/zz/多弧确定性);
- SplitFeaturesCommand do/undo/redo、弧 id 稳定、feature/record 截断恢复;
- **联动证明**:reshape 后对未整形共享段做顶点编辑,邻居跟随(shared piece 被双方引用);
- 历史:reshape×3 → undo×3 → redo×3;split×3 同理;multi-source reshape 单 entry undo;
- orphan 弧不被压缩(do 后 `arcs.size()` 单调,undo 后精确回到 originalArcCount);
- transaction:多 op capture 单 entry、rollback 无残留 mutation;
- barrier 交互:direct reshape → replacement → undo replacement → undo reshape(仅观察,不收窄 barrier);
- split 撤销后 feature 计数/记录/selection 完整恢复;追加 feature 的 Flatbush 失效。

## 7. 实施顺序

1. `_arc-slicer.ts` + 单测(纯函数,无依赖);
2. reshape-line 迁移(slicer + mini-dataset harness)+ 几何等价测试;
3. reshape-polygon 迁移 + 测试;
4. `_runner.ts` 多 source composite 路径 + `reshape-selected.ts` 编排 + 历史测试;
5. `SplitFeaturesCommand` + 命令级测试;
6. split 点切割迁移;
7. split 线切割迁移(子集草稿 noding 翻译);
8. split 面切割迁移(mosaic 翻译);
9. 集成:barrier/transaction/orphan 测试;CHANGELOG、editing 文档、`reshape-ring-part` 示例人工验证(连续 reshape/split × 3 + 逐级 undo/redo)。

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| mini-dataset id 双向翻译错误 | 进出各一次映射断言,失败即 OpResult failure(无副作用) |
| mosaic 草稿上下文弧遗漏 | 草稿仅由显式 provenance piece + 未切边界弧拷贝组成;现有面积守恒校验兜底 |
| 切点位置自算与 mapshaper `insertCutPoints` / `addIntersectionCuts` 定位不一致 | slicer 单测对照 legacy 输出;op 级几何测试矩阵原样通过即证据 |
| 邻居引用扫描遗漏(layer 遍历不全) | 扫描覆盖 source 全部 layers;联动证明测试 |
| feature 追加后 FeatureQuery 索引失效遗漏 | §5 实现检查点;新增失效测试 |
| 孤儿弧增长 | 已批准决策:导出副本压缩;live 单调增长属预期 |

## 9. 非目标

- 不收窄 replacement barrier(阶段 D);
- 不合并 transaction 事件(阶段 B 之后评估,§16.3);
- 不迁移 clip/erase/dissolve/union/project 等全局 op;
- 不做 subset-scratch 之外的性能再优化(reshape 已零拷贝;split 面切割的子集草稿成本与选中 feature 边界大小相关)。
