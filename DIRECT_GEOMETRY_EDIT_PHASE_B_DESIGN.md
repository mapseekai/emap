# Phase B 设计:reshapeSelected / splitSelected 原地增量迁移

- 日期:2026-08-30
- 状态:已批准(拓扑联动 + mini-dataset 整体执行架构)
- 前置:DIRECT_GEOMETRY_EDIT_DESIGN.md(§7.5、§8-§11、§13-§16);Phase A 已合并(master 65dcd050)
- 目标:reshape 与 split 从 whole-dataset replacement(`insertCutPoints` + `DatasetReplaceSelectionCommand`,barrier 清历史)迁移为可逆的原地增量命令,支持多级 undo/redo
- 已批准的关键决策:
  1. **拓扑联动**:reshape/split 切割共享弧时,所有引用方(目标 feature + 邻居 feature)的 shape 统一 patch 到新弧 id 序列,未被整形/切割的共享段保持 shared-arc identity,后续顶点编辑继续联动。
  2. **mini-dataset 整体执行**(计划阶段修订,取代初稿的"独立切片规划器 + 显式切点契约"):legacy 几何函数把弧追加、候选校验、回滚(`deleteLastArc`)深度交织在内部 `insertCutPoints` 调用前后(`reshape-selected-line.ts:294-457` 实证),无法拆成"纯规划 + 外部校验"而不重写。改为让它们在有界 mini dataset 上**整体原样运行**,产出翻译回 live 追加/patch 指令。初稿的 `_arc-slicer.ts` 与切点 provenance 契约改造随之取消(扁平顶点索引契约在 mini 内部自洽,无需变更;两条评审意见由翻译器的逐槽位 provenance 机制满足,见 §3.2)。

## 1. 现状(探索核实,file:line 可复查)

### reshape(legacy)

`reshapeSelected`(`src/map/ops/reshape-selected.ts:70-163`):
- 逐 source 调 `runPreparedDatasetMutation`(每次 = `copyDataset` + `DatasetReplaceSelectionCommand`,`invalidatesPriorCommands = true`);
- 不限选中:所有被画线接触的 feature 都被整形(注释与测试 pin 此行为);
- 几何管线:`collectLineContacts`(横向接触,`reshape-selected-line.ts:108-177`)→ `cutPointsForContacts` → `adapter.insertCutPoints(working, cutPoints)`(全局分裂 + `remapDividedArcs` 重写所有引用 shape,`mapshaper-adapter.ts:813-816`)→ 重读 remap 后 shape → `partArcIndexes` 定位端点弧 → 追加单条替换弧 → 开环 splice / 闭环双向候选(`reshape-selected-line.ts:352-457`)→ 多边形候选校验(自交/洞逃逸/包含,`reshape-selected-polygon.ts:115-203`);
- 现状每 source 各成一个 undo entry(reshape-selected.ts 注释 "each contacted source is committed as its own undo step");
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

## 2. 架构:mini-dataset 整体执行 + 追加式落地

**不变量:永不修改 live 已有弧的顶点数据。** 被分裂的 live 弧原样保留(成为孤儿,等待导出副本压缩——已批准决策 §16.1);其 piece 与替换/cutter 弧作为新弧批量追加;所有引用被分裂弧的 shape(目标 + 邻居)统一 patch 到新弧 id 序列。

```text
live dataset(只读)
  → 候选集圈定(reshape:画线 bbox 预筛;split:选中 feature)
  → 构建 mini dataset:候选 feature 的弧拷贝 + live 对齐稀疏 shapes(mini id 翻译)
  → 在 mini 上原样执行 legacy 几何管线(insertCutPoints / 候选校验 / mosaic,全部不变)
  → 翻译器:逐槽位 provenance 对比 → 被分裂弧的 piece 一律追加,未动弧保留原 id
  → 邻居 patch:live 侧扫描被分裂弧的其他引用 shape,按映射替换引用序列(signed 保持)
  → 命令提交:do = 批量追加弧 + 写 shape(+ split 追加 feature);undo = 截断 + 恢复
```

联动语义与 legacy 完全一致:未切割/未整形的共享段在目标与邻居间仍是同一批弧 id;被整形的 span 双方各自引用不同弧——这正是 legacy `insertCutPoints`+替换弧的行为。

mini 的成本与**候选 feature 的弧总量**相关,与 dataset 总大小无关;legacy 几何代码零改动,现有 ~2000 行几何测试矩阵继续作为等价性证据。

## 3. 新组件

### 3.1 mini-dataset 构建器 `src/map/ops/_mini-dataset.ts`

每 source(reshape)/ 每次 op(split)构建一个 mini dataset,在其上原样执行 legacy 几何函数:

- **候选集**:reshape 用画线 bbox(外扩一个 CONTACT_EPSILON 级 margin)对 feature bbox 预筛,只有可能接触的 feature 进入 mini;split 即选中 feature。bbox 不相交 ⇒ 段级接触不可能,预筛只省拷贝、不改变几何结果。
- **内容**:候选 feature 引用的全部弧的坐标拷贝(reshape polygon 含洞与多 part;split 为选中 feature 全部边界弧)。`layers` 为原 path layer 的浅拷贝,其 `shapes` 数组与 live **等长对齐**——非候选位置填 `null`(legacy 循环对 null shape 跳过,行为不变),候选位置填翻译成 mini id 的 shape 深拷贝。
- **provenance**:构建时记录 `miniArcId → liveArcId` 精确映射(拷贝即 provenance,不做任何跨弧字节匹配——坐标重复但拓扑身份不同的弧真实存在)。
- **属性表**:几何函数不读 record;record 克留在翻译器/命令数据组装时从 live 读原记录浅拷贝。mini layer 不带 data。
- **adapter 新 API**:`createArcCollection(arcs: AppendedArc[]): ArcCollection`(经 mapshaper internal 构造,mapshaper import 留在 adapter 边界内,遵守 AGENTS.md 硬规则)。

### 3.2 结果翻译器 `src/map/ops/_mini-translate.ts`

mini 上跑完 legacy 函数后,把产出翻译为 live 指令:

- **弧映射**:按 mini 弧 id 升序扫描。mini 弧 j 携 provenance live 弧 i 且与构建时拷贝**逐槽位坐标一致**(未被 `insertCutPoints` 分裂/未被 noding 改动)→ 复用 live id i;否则(被分裂的基弧与派生 piece、新追加的替换/cutter 弧)→ 分配 live 追加 id,顺序 = mini id 升序,确定性。逐槽位对比是 1:1 provenance 校验,不是跨弧身份推断,无合并风险(满足评审意见一)。
- **shape 翻译**:legacy 产出的 after-shape(mini id)经弧映射翻回 live id;与 live before 比对,不同则生成 `PathShapePatch`。signed 方向在 mini 内已被 legacy 正确处理,翻译仅做无符号 id 映射 + 符号保持。
- **邻居 patch**:live 侧扫描全部 layer 的 shape,凡引用"被分裂 live 弧"且不在候选集内的 feature,生成仅替换该引用为 piece 序列的 patch(signed 序列,方向保持)。这保证拓扑联动:未切割共享段在目标与邻居间仍是同一批弧 id。
- **断言**:任何 mini id 无映射或映射冲突 → 规划失败返回 OpResult failure,无副作用(满足评审意见二的"显式 provenance"诉求:provenance 由构建期拷贝关系携带,不经扁平索引反推)。

### 3.3 `SplitFeaturesCommand`(`src/edit/commands/split-features.ts`,新命令类)

split 改变 feature 数,超出 PathGeometryPatchCommand 表达范围。捕获:

```ts
{
  source, label,
  shapePatches: PathShapePatch[],        // 邻居 + 被分割原 feature(最大块 after shape)
  appendedArcs: AppendedArc[], originalArcCount: number,
  appendedFeatures: { layer, shapes: PathShape[], records: (Record<string, unknown> | null)[] },
  originalShapeCount: number,            // 目标 layer 的 shapes/data 数组截断点(split 限定单 source/单 layer)
  selection, beforeSelection, afterSelection, publishSelection
}
```

- do:追加弧 → 写 shapePatches → 追加 features(shapes + records)→ selection 替换 → `markSourceChanged`。
- undo:截断弧 → 恢复 shapePatches → 截断 shapes/records 数组 → 恢复 selection。
- do/redo 断言当前弧数 === originalArcCount(与 PathGeometryPatchCommand 一致的防旁路断言)。
- `invalidatesPriorCommands = false`;effect 类沿用 `COMMAND_EFFECTS['split-selected'] = 'shape-count'`。

reshape **不需要新命令类**:PathGeometryPatchCommand 天然适配(targets + neighbors 均为 shapePatches);multi-source 由 CompositeCommand 包成单 history entry。

## 4. 分 op 迁移要点

### 4.1 reshape(line + polygon)— 零全量 dataset 拷贝

`reshape-selected.ts`:
- 保留:画线归一化校验、逐 source 扫描、不限选中的"所有接触 feature"语义、per-source 校验失败继续后续 source。
- 变更:`runPreparedDatasetMutation` → 逐 source `runPreparedEditCommand` 规划,各 source 生成 PathGeometryPatchCommand;多 source 命中时包 CompositeCommand **单 entry** 提交(现状为每 source 各一 entry,此处为有意改进,符合 §13.2 "多个 source 命中 → 单 entry undo")。
- 规划(每 source):画线 bbox 预筛候选 feature → 构建 mini → 逐 path layer 在 mini 上调用 `reshapeSelectedPolygon` / `reshapeSelectedPolylines`(函数体不变;polyline 的 `validatePolylineFeature` 在 live 上只读预跑,传入 mini 的 id 集只含候选 feature)→ 翻译器产出 shapePatches(目标 + 邻居)+ appendedArcs → 构造命令。reshape 无 selection 变更。

### 4.2 split 点/线切割(polyline layer)

- 构建选中 feature 的 mini → 在 mini 上原样调用 `splitSelectedPolylines`(点切割内部走 `insertCutPoints`;线切割内部走临时 cutter 层 + `addIntersectionCuts`——都只在 mini 内,永不触碰 live)→ `SplitPieces[]`(mini id)。
- `applySplitPieces` 改写为**纯规划变体**:最大块保留原 id(面积/长度排序在 mini 上算)、追加顺序、record 克隆(从 live 读原记录浅拷贝进 appendedFeatures)、unsplit 选中 id 保留、resultFeatures 计算——全部产出命令数据,不触碰 live。
- 翻译器统一处理弧映射与邻居 patch,产出 `SplitFeaturesCommand`。

### 4.3 split 面切割(polygon layer)

- 同 4.2 的 mini 流程,调用 `splitSelectedPolygons`(内部 properCrossings + 临时 cutter + noding + `buildPolygonMosaic` + 面积守恒校验,全部在 mini 内原样运行)。
- 翻译与命令构造同 4.2。

### 4.4 唯一行为变更:删除 `cleanArcReferences`

`applySplitPieces` 末尾的压缩调用删除——append-only 下压缩会重排弧 id、击穿 undo。孤儿弧累积沿用已批准决策(§6/§16.1:MSX 导出走副本压缩,live 永不压缩)。几何输出不变;唯一可观测差异是 live 弧表单调增长。reshape 本无压缩调用,不受影响。legacy 的临时 cutter 层移除逻辑也随之消失(临时层只在 mini 内存在)。

## 5. runner / 缓存 / transaction / 事件

- `_runner.ts` 增加多 source 规划-提交路径:逐 source stale guard(host/source/dataset identity + editVersion + transaction),全部规划成功后单 composite push,统一 publish(data reason `'edit'`、selectionchange、historychange 各一次)。
- 缓存失效(markDisplayArcsDirty、bumpEditVersion、FeatureQuery Flatbush、layer arc-id cache)由 direct runner 统一处理;**实现检查点**:确认 shape-count 变化(feature 追加)路径下 FeatureQuery/Flatbush 失效已覆盖(Phase A deletePart 删除路径已覆盖,追加为对称场景)。
- transaction:捕获缓冲内命令按序 do(),arc count 链式自然衔接;rollback 反序 undo(Phase A §11 修复已就位)。跨 source composite 的各 child 操作不同 ArcCollection,无 chaining 依赖。
- selection:reshape 不变(保持现有 selection);split 替换为 result refs(最大块原 id + 追加 id + unsplit id),与现状逐一一致。

## 6. 测试策略

**几何等价性(主要证据)**:现有 op 级测试矩阵原样保留并通过——
- `reshape-selected.test.ts` / `reshape-selected-line.test.ts` / `reshape-selected-polygon.test.ts`
- `split-selected*.test.ts`(+ integration)/ `mapshaper-feature-split.test.ts` / `split-selected.test-d.ts`

**新增**:
- mini 构建器/翻译器单元测试(稀疏对齐、provenance 映射、逐槽位对比、确定性追加序、无映射即失败);
- SplitFeaturesCommand do/undo/redo、弧 id 稳定、feature/record 截断恢复;
- **联动证明**:reshape 后对未整形共享段做顶点编辑,邻居跟随(shared piece 被双方引用);
- 历史:reshape×3 → undo×3 → redo×3;split×3 同理;multi-source reshape 单 entry undo;
- orphan 弧不被压缩(do 后 `arcs.size()` 单调,undo 后精确回到 originalArcCount);
- transaction:多 op capture 单 entry、rollback 无残留 mutation;
- barrier 交互:direct reshape → replacement → undo replacement → undo reshape(仅观察,不收窄 barrier);
- split 撤销后 feature 计数/记录/selection 完整恢复;追加 feature 的 Flatbush 失效;
- bbox 预筛等价性:预筛开/关结果一致(候选外 feature 接触恒为空)。

## 7. 实施顺序

1. adapter `createArcCollection` + `_mini-dataset.ts` 构建器 + 单测;
2. `_mini-translate.ts` 翻译器 + 单测;
3. reshape-line 迁移(mini 整体执行)+ 几何等价测试;
4. reshape-polygon 迁移 + 测试;
5. `_runner.ts` 多 source composite 路径 + `reshape-selected.ts` 编排 + 历史测试;
6. `SplitFeaturesCommand` + 命令级测试;
7. split polyline 迁移(点 + 线切割,mini 整体执行,`applySplitPieces` 纯规划化);
8. split polygon 迁移(mosaic mini 执行);
9. 集成:barrier/transaction/orphan/联动/预筛等价测试;CHANGELOG、editing 文档、`reshape-ring-part` 示例人工验证(连续 reshape/split × 3 + 逐级 undo/redo)。

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| mini id ↔ live id 翻译错误 | 翻译器双向断言,失败即 OpResult failure(无副作用);构建/翻译单测 |
| mini 缺上下文弧(面切割 mosaic、面 reshape 的洞分组) | 候选集按整个 feature(含洞与多 part)收录;面积守恒等现有校验兜底 |
| bbox 预筛误排接触 feature | margin 外扩 + 预筛开/关等价测试;几何测试矩阵原样通过 |
| 邻居引用扫描遗漏(layer 遍历不全) | 扫描覆盖 source 全部 layers;联动证明测试 |
| feature 追加后 FeatureQuery 索引失效遗漏 | §5 实现检查点;新增失效测试 |
| 孤儿弧增长 | 已批准决策:导出副本压缩;live 单调增长属预期 |
| mini 上 legacy 函数的内部 append/deleteLastArc 序列产生非确定性最终弧表 | 最终弧表只含保留弧且连续(rollback 截断到 feature 起点,`reshape-selected-line.ts:444-446`);翻译按最终 mini id 升序分配,确定性 |

## 9. 非目标

- 不收窄 replacement barrier(阶段 D);
- 不合并 transaction 事件(阶段 B 之后评估,§16.3);
- 不迁移 clip/erase/dissolve/union/project 等全局 op;
- 不做 mini 之外的性能再优化(reshape 无全量拷贝;mini 成本与候选 feature 弧量相关)。
