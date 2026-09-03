# emap 属性驱动样式渲染设计

日期：2026-09-02
状态：设计已逐节确认，待用户审阅

## 1. 背景与调研结论

emap 内置 Canvas/topology 图层不支持按属性字段驱动样式：`LayerPaint` 仅标量
（`src/map/layer.ts:15-48`），`LayerSpecification` 无 `filter` 字段
（`layer.ts:54-90`），渲染时每层一次性解析样式
（`src/map/layer-renderer.ts:48,83,117`）。

调研确认的外部事实：

- mapshaper `-classify` / `-style` / `-colorizer` 支持属性驱动样式，但其产物是
  **普通 DataTable 字段**（`fill`/`stroke`/`stroke-width`/`r` 等）：
  v0.7.56 官方源码 `src/commands/mapshaper-svg-style.mjs` 中 `cmd.svgStyle`
  逐记录执行 `rec[svgName] = accessor(i)` 并 `markSchemaChanged`；
  字段随 GeoJSON 等属性输出与 mapshaper undo 机制走。
- `cmd.classify`（本地 0.6.113 bundle:35502）是 void 命令：内部计算断点/颜色后
  原地写字段，不返回结构化结果。
- 本仓库安装 mapshaper 0.6.113 即具备 `-classify`（含显式 `breaks=`/`colors=`）
  与 `-style` 全部所需能力；**本功能对 0.7.56 零依赖**。

## 2. 需求基线（已与用户逐项确认）

1. 范围：数值分级 + 离散分类 + 自定义表达式全覆盖，分阶段交付（fill → circle → line）。
2. 性能：大规模优先（10 万–100 万要素/层）；样式重算预计算+缓存，绘制热路径 O(1) 查表。
3. 线语义：混合——默认弧级拓扑去重，可显式逐要素按 shape 描边。
4. 数据流：烘焙字段为基座 + paint 表达式动态覆盖。
5. 表达式形态：MapLibre 风格静态表达式子集（无 eval，不受 expressionPolicy gate）。
6. 图例：只返回分级结果数据，不附带 UI 组件。
7. 渲染层实现：每要素样式数组 + 惰性缓存；分类场景折叠为 LUT。

## 3. 架构总览

```mermaid
flowchart TD
    A[数据层: layer DataTable<br/>fill/stroke/stroke-width/r/... 普通字段] -->|显式 opt-in 时| R[PerFeatureStyleResolver]
    P[paint 表达式<br/>MapLibre 子集] --> R
    R -->|StyleResolution 缓存产物<br/>键=(表达式指纹, dataset 引用, attributeVersion, layerId)| PA[Painter]
    OPS[classifyFeatures / styleFeatures ops<br/>COMMAND_EFFECTS 登记 attribute-only] -->|烘焙字段| A
    PA --> CF[drawPolygonFill<br/>+ styleBuckets 可选参数]
    PA --> CP[drawPoints<br/>+ styleBuckets 可选参数]
    PA --> DA[drawArcs<br/>逐桶循环调用，签名不变]
```

四个组件，单一职责：

1. **样式字段基座**：mapshaper 兼容字段名的普通 DataTable 字段。来源：外部数据导入，
   或新 ops 烘焙。随导出、undo/history 走，变更经 editVersion/attributeVersion
  计数器通知（4.2.1）。**绝不隐式生效**——业务数据中
   恰好同名的字段不改变显示。
2. **样式 ops**（`src/map/ops/`）：`classifyFeatures` 与 `styleFeatures`，
   均在 `COMMAND_EFFECTS` 登记 `attribute-only`。
3. **PerFeatureStyleResolver**（新模块 `src/map/style-resolver.ts`）：paint 表达式 +
   records + attributeVersion → 缓存的 per-shape 样式产物；逐 paint 键三级回退。
4. **Painter 扩展**：fill/circle 加可选 styleBuckets 参数；line 复用现有 `drawArcs`
   逐桶循环，签名不变。

两条数据流：

- 烘焙路径：op → mapshaper 命令（attribute-only）→ 字段 → attributeVersion bump →
  resolver 缓存失效重算（进 undo 栈、随导出）。失效契约见 4.2.1。
- 覆盖路径：paint 表达式 → resolver 直接求值（不改数据）。

## 4. 组件接口

### 4.1 样式 ops

```ts
// src/map/ops/classify-features.ts
classifyFeatures(opts: {
  source: string;
  target: string;
  field: string;
  method: 'quantile' | 'equal-interval' | 'nice' | 'categorical';
  classes?: number;                        // 默认 4（对齐 mapshaper）
  breaks?: number[];                       // sequential 显式断点，优先于 method 自动计算
  categories?: (string | number)[];        // categorical；缺省时扫描字段 unique 值
  colors: string[];                        // 必填：分级色带/类别色
  saveAs?: string;                         // 默认 'fill'；'stroke'/'class' 可选
  nullValue?: string;                      // 缺失/非法值颜色；缺省用主题默认色
  otherColor?: string;                     // categorical 未列类别颜色；缺省同 effective null 色
  invert?: boolean;
}): Promise<OpResult<ClassificationResult>>;

type ClassificationResult =
  | {
      kind: 'sequential';
      method: 'quantile' | 'equal-interval' | 'nice';
      breaks: number[];
      colors: string[];      // 不变量: colors.length === breaks.length + 1
      counts: number[];
      nullColor: string;   // effective 值，非缺省
      nullCount: number;
      saveAs: string;
      featureCount: number;
      // 不变量: sum(counts) + nullCount === featureCount
    }
  | {
      kind: 'categorical';
      categories: (string | number)[];
      colors: string[];      // 不变量: colors.length === categories.length
      counts: number[];
      otherColor: string;    // effective 值，非缺省（见下）
      otherCount: number;
      nullColor: string;     // effective 值，非缺省
      nullCount: number;
      saveAs: string;
      featureCount: number;
      // 不变量: sum(counts) + otherCount + nullCount === featureCount
    };
```

契约要点：

- **断点权威在 emap**：quantile/equal-interval/nice/categorical 的断点（类别）计算
  自研（标准算法），调 mapshaper classify 时始终传显式 `breaks=`/`colors=`，
  mapshaper 只负责逐记录映射上色（复用其 where/undo/字段写入语义）。
  mapshaper 自动分级与 emap 断点可能存在数值差异——可接受，返回的是 emap 权威值。
- **effective 兜底色**：op 始终显式传 `null_value = nullValue ?? 主题默认色`，
  categorical 另传 `other = otherColor ?? effectiveNullColor`，并原样回显为
  结果的 `nullColor`/`otherColor`（均必填）——不允许缺省：0.6.113 在 `colors`
  存在且未传 `null_value` 时实际写 `#eee`，缺省会让图例与烘焙字段不一致。
  （已核实：categorical 支持独立 other 色——`getCategoricalClassifier` 经
  `getDiscreteValueGetter(classValues, nullVal, opts.other)` 将未列有效值
  分到 -2/other 路，与 null 分路着色。）
- **计数独立于颜色**：`otherCount` 统计有效但未列入 categories 的值；
  `nullCount` 只统计缺失/非法值（undefined/null/NaN），与是否提供
  `otherColor` 无关。
- 划分不变量：每个要素恰好落入一个桶（类别段 / other / null）。

```ts
// src/map/ops/style-features.ts — 转发 mapshaper -style，JS 表达式受 expressionPolicy gate
styleFeatures(opts: {
  source: string;
  target: string;
  fill?: string; stroke?: string; strokeWidth?: string; r?: string;
  where?: string;                          // JS 表达式限定子集
  clear?: boolean;
}): Promise<OpResult>;
```

### 4.2 PerFeatureStyleResolver（`src/map/style-resolver.ts`）

```ts
interface StyleResolution {
  styleIds: Uint32Array;                   // shapeId → styleId；统一位宽
  styles: readonly ResolvedStyle[];        // LUT：styleId → { color, width?, radius? }
  fillBuckets?: Array<Uint32Array>;        // fill/circle：styleId → shapeIds
  arcBuckets?: Array<Uint32Array>;         // line/outline：styleId → 去重 arcIds
}
```

- **缓存键** `(表达式指纹, dataset 引用, attributeVersion, layerId)`；
  桶成员资格与样式数组同生命周期，相机移动/帧渲染不重建桶。
  `editVersion` **不在键中**——样式产物只依赖 records 与 shape 结构；
  顶点级就地编辑 bump editVersion 不影响样式缓存（见 4.2.1）。
- **逐 paint 键三级回退**：对每个键 K（`fill-color`/`line-color`/`line-width`/
  `circle-color`/`circle-radius`/…）：
  1. `paint[K]` 已声明（标量或表达式）→ 用之；
  2. 未声明且显式 opt-in（图层 `styleSource: 'mapshaper'` 或
     `paint[K]` 为 `['get', '<样式字段>']`）且烘焙字段存在 → 用烘焙值；
  3. 否则 → 主题默认色。
- **桶基数策略**：声明式分类（match/step/categorical）K 为用户声明类数；
  连续 `interpolate` 量化为固定步数（默认 256 级，可配置）再入桶；
  K 超阈值（暂定 256，benchmark 校准）触发诊断 warn 事件（含 layerId、K），
  仍正常渲染。
- 无表达式/样式字段的图层不进入 resolver（静态零回归）。

#### 4.2.1 失效契约：所有权与 bump 矩阵

两个计数器均挂在 `MapshaperDataset` 上（emap 自有，mapshaper 不感知），沿用
`bumpEditVersion()`（`src/types/mapshaper-types.ts:291`）的既有模式新增
`bumpAttributeVersion()`。分工：`editVersion` 服务空间索引与几何相关缓存
（feature-query、arrow-dot），`attributeVersion` 服务样式 resolver；
resolver 每次渲染时廉价读取 dataset 引用 + attributeVersion，命中即复用。

| 变更来源 | bump | 理由 |
|---|---|---|
| 纯属性编辑（字段值修改、field add/remove/rename、classifyFeatures/styleFeatures 烘焙）的 do/undo/redo | `attributeVersion` | records 变化；shape/弧未动，不牵连空间索引 |
| shape-count 变化（feature create/delete/split 等） | `attributeVersion` + `editVersion` | shape↔record 对齐与样式桶均失效，弧 bbox 也可能变 |
| topology-only 就地编辑（vertex move/translate） | `editVersion` | 样式桶按 shapeId 索引不受影响，resolver 缓存保留 |
| dataset 替换（replace 类 op、worker op 输出、reproject、transaction rollback 快照恢复、source setData/load） | 引用变化强制失效 | 不依赖版本号，引用不等即重建 |

bump 实施点：属性命令与烘焙 op 在提交/回滚路径统一经共享 helper 调用
`bumpAttributeVersion`（现状只有几何编辑 bump `editVersion`，
`src/edit/commands/_shared.ts:26`；属性命令路径是本次新增的覆盖项）；
dataset 替换路径由引用比较兜底，无需显式 bump。
已枚举的同引用 shape-count 覆盖点——**bump 所有权在命令自身/突变点**，
不存在中央 runner 提交点（`delete-selected.ts` 直接 `bulk.do()`，
`EditHistory.push` 不调 `do()`，undo/redo 直达 command）：
- 新增 `_shared.ts` helper `markShapeCountChanged(source)` =
  `markSourceChanged` + `bumpAttributeVersion`；
- `FeatureCreateCommand`、`FeatureDeleteWithSelectionCommand`、
  `SplitFeaturesCommand`（split-features.ts do/undo 直接 append/truncate
  features，不经 FeatureCreate/Delete）将现有 `markSourceChanged` 换成它；
- 裸 `FeatureDeleteCommand`/`BulkFeatureDeleteCommand` 的 options 增加必填
  `source`，do/undo 调 `markShapeCountChanged`；caller 迁移：
  `delete-selected.ts`、`vertex-delete.ts`；
- **首次创建路径**：`draw-feature.ts:_commitFeature()` 在 command 之外直接
  push shape/record（首次提交不经 `do()`），突变后显式调
  `markShapeCountChanged(source)`——command 内 bump 只覆盖 undo/redo。
纯属性命令（field-add/remove/rename、feature-property-change）只 bump
`attributeVersion`；translate/affine 等 topology-only 维持只 bump
`editVersion`，不过度失效样式缓存。
**并发陈旧保护**：`_runner.ts` 全部 stale guard（`runPreparedDatasetMutation`、
直接编辑、多 source、worker 命令四条路径）同步比较 **两个计数器**——
否则 worker op 在飞期间的纯属性编辑（只 bump attributeVersion）会绕过
`Err.staleOperation`，提交的旧结果 replace 后丢失用户改动；dataset
copy/replace 必须保留两个计数器（单调不回退）。
失效合并：编辑会话内多次 bump 只置脏一次，下一帧前重算一次；超阈值规模
（暂定 20 万要素，benchmark 校准）走 worker 卸载或分帧 chunk。

### 4.3 表达式求值器（`src/map/style-expression.ts`）

MapLibre 静态子集，纯函数无 eval：`['get', f]`、`['match', input, ...pairs, fallback]`、
`['step', input, ...stops]`、`['interpolate', 'linear', ...]`、比较/逻辑原子。
编译一次为闭包；非法结构在 `addLayer`/`setPaintProperty` 时同步报错，
不进入渲染循环。

### 4.4 类型与 Painter 扩展

```ts
// src/map/layer.ts
type PaintValue = string | number | StyleExpression;   // StyleExpression = readonly unknown[]
interface LayerSpecificationBase { styleSource?: 'mapshaper'; /* ... */ }

// src/renderer/painter.ts — 桶经现有 options 袋传入（与 viewBBox 同袋，
// 避免第 7 个位置参数）：
interface PolygonFillOptions { viewBBox?: ...; styleBuckets?: FillStyleBuckets }
interface FillStyleBuckets { buckets: readonly Uint32Array[]; colors: readonly string[] }
drawPoints(shapes, style, styleBuckets?: FillStyleBuckets)   // Phase 2
// line 不改签名：layer-renderer 逐桶循环调 drawArcs(arcs, bucketStyle, filter, arcBucket)
```

## 5. 性能契约

### 两阶段模型

| 触发 | 成本 |
|---|---|
| 表达式/attributeVersion/dataset 引用变更（阶段 A） | O(N) 求值 + 重建样式数组与桶。预算（验收前 benchmark 校准）：10 万要素主线程一次 ≈ 5–30ms；100 万要素 worker 卸载或分帧 chunk |
| 缓存命中的完整重绘帧（阶段 B） | O(可见内容) 路径构建（基线同型）+ K 次样式状态切换；**零重分桶、零表达式求值**；line 直接遍历缓存桶 arcIds，无 shape→弧再归集 |
| 相机平移/缩放（fastNav） | 样式零成本（CSS 变换） |
| 静态样式图层 | **零回归**（不分配样式数组、不查表、不进桶逻辑）——唯一承诺的绝对保证 |

### Worker 路由契约

现状缺口：`shouldUseWorkerForHeads`（`src/map/worker-routing.ts:107`）与
`WorkerRoutingFn` 的 info 仅以 `vertexCount` 判定，`_runner.ts:599` 用
`arcs?.getPointCount() ?? 0`——点层/纯属性数据顶点数≈0，百万级 records
永远不会自动卸载到 worker。本功能修补如下：

- classifyFeatures/styleFeatures 与 resolver 阶段 A 重算的路由判定以
  **`recordCount`** 为主键（成本随记录数线性增长），`vertexCount` 仅作次级参考；
- `WorkerRoutingFn` 的 info 扩展可选字段 `recordCount`（向后兼容，旧回调不受影响）；
- 决策须计入**序列化开销**：records 序列化进 worker 的成本随 recordCount 增长，
  超过计算收益时应选主线程分帧 chunk 而非 worker（阈值由基准脚本校准后回填第 9 节）；
- vertexCount≈0 不得成为排除 worker 的理由。
- **resolver 卸载是独立 worker task，不复用 mapshaper 命令路由**：paint 表达式
  （MapLibre 子集）是 emap 代码，`shouldUseWorkerForHeads` 的命令路由无法执行。
  **落地门控（Phase 1 完成判据之一）**：Phase 1 先交付主线程同步重建
  （含分帧 chunk 之外的完整正确性）；第 9 节基准回填后，若 recordCount=10 万
  主线程重建超过 §4.2 预算上限，则按本节协议在同一 Phase 补 worker task
  及其 round-trip/transferable/确定性 styleId 测试；未超预算则卸载归入
  Phase 2，本节协议即为其既定设计。无论哪条路径，"卸载失败回退主线程"
  （§6）只在卸载实现后适用。
  协议与合并契约：
  - **单 task 处理整层 records，不分片**——分片会产生各 task 本地 styleId
    冲突，且 `arcBuckets` 需 shapes→arcs 拓扑，records 切片构不出来；
  - 主线程发送 `(原始表达式 JSON, 整层 records)`（表达式为可序列化数组，
    worker 侧编译为闭包）；
  - worker 返回全局 `{ styleIds: Uint32Array, styles: ResolvedStyle[] }`
    （transferable 零拷贝；styleId 按首次出现顺序分配，保证单次构建内确定性）；
  - **构桶在主线程**：收到 styleIds 后单趟扫描 shapes 生成 `fillBuckets`/
    `arcBuckets`（主线程本就持有 shapes 拓扑，无需向 worker 传输）；
  - classify/styleFeatures 两个 op 仍走现有 mapshaper 命令路由（只是判定键换 recordCount）。

### 动态路径开销上限（相对基线）

缓存命中帧耗时 ≤ 基线 × (1 + α)，绝对上限按 (可见要素数 V, 类别数 K) 设定；
α 与上限数值由实施时 benchmark 校准后回填本文件。暂定参考点：
V=10 万、K≤32 时增量目标 < 8ms/帧。

Phase 1 实测（`STYLE_BENCH=1 pnpm vitest run src/map/style-resolver.bench.test.ts`，
Apple M4，step 表达式 K=4）：
- V=100k：冷构建（编译+求值+LUT+构桶）3.89ms，缓存命中 0.01ms；
- V=1M：冷构建 21.16ms，缓存命中 0.01ms。
结论：主线程冷构建在 100k 级远低于 8ms 参考点；1M 级单次 ~21ms（约一帧半），
Phase 1 主线程构桶成立，worker 卸载阈值可推迟到 Phase 2 按序列化拐点校准。

### 内存预算

`styleIds` Uint32 ≈ 4MB/100 万要素；桶索引 ≈ 4MB；桶 arcIds 总量 ≈
图层弧引用总和 + 跨桶共享弧副本（与现有 `_layerArcIdsCache` 同量级分摊）。

### 共享弧语义

- 弧归入桶：至少一个引用它的要素属于该桶；桶内去重保留。
- 共享弧仅当两侧要素属于不同 styleId 时出现在多个桶。
- **polygon outline**：默认图层级统一样式（choropleth 主流）；显式 opt-in 逐桶描边时
  按 styleId 升序绘制、后者覆盖前者（确定性，文档注明单侧语义）。不做双侧偏移。
- **polyline 层**：直接按样式桶画弧；重合弧按同样升序覆盖。
- `perFeature` 按 shape 描边为独立选项（虚线相位/闭合环逐要素正确性场景）。

## 6. 错误处理（三层）

**配置期（fail fast，同步）**
- 非法表达式结构 → `addLayer`/`setPaintProperty` 同步 throw。
- `classifyFeatures`：字段不存在 / sequential 作用于非数值字段 / `classes < 2` /
  `colors` 为空 → 返回 `OpResult` Err（沿用 ops 现有模式）。
- `styleFeatures`：`expressionPolicy: 'disabled'`（默认）→ Err。

**渲染期（隔离，不中断帧）**
- 单条记录求值异常 → 该要素落入 null 桶，整层照常渲染；异常不进 render loop。
- K 超阈值 → 诊断 warn 事件，照常渲染。
- resolver 重建失败 → 保留旧缓存 stale 渲染 + warn，不出现空白帧。
- worker 卸载失败 → 回退主线程分帧 chunk，功能不丢。

## 7. 测试策略

| 层 | 覆盖点 |
|---|---|
| 表达式求值器 | 每个原子真值表、类型强制、嵌套组合、非法结构报错；match/step/interpolate 边界（空 stops、单 stop、降序 stops） |
| classify 断点算法 | quantile/equal-interval/nice 已知输入→已知断点；判别联合三条不变量（两条长度 + 划分）；全 null/全未列/空图层边界；缺失值与未列类别端到端断言：烘焙值 === 结果 `nullColor`/`otherColor`；显式区分时 other 与 null 着不同色 |
| resolver 缓存 | 版本与引用均不变→产物引用相等；纯属性编辑只 bump attributeVersion（不触发空间索引重建）；纯顶点编辑只 bump editVersion（样式缓存保留）；多次编辑合并为一次重建；共享弧跨桶归属正确性 |
| worker 路由 | vertexCount=0 时 recordCount 仍参与决策（点层不因顶点数为 0 被排除）；阈值上/下两侧分别命中 worker 与主线程；序列化成本超过收益的构造用例选主线程 chunk；WorkerRoutingFn 旧回调在新增 recordCount 字段后行为不变；resolver 表达式 task 走独立 worker 协议（整层单 task、round-trip 正确、transferable 零拷贝、styleId 首现序确定性），不经 mapshaper 命令路由 |
| painter | 每桶 fillStyle/strokeStyle 恰好设置一次；所有可见 shape/arc 恰好绘制一次（跨桶无重复遗漏）；flush 次数符合批次边界（`POLYGON_FILL_BATCH_SHAPE_LIMIT`/`VERTEX_LIMIT`、`ARC_STROKE_*`），**不断言等于 K**；单 shape 不跨 flush（holes/shell 同 evenodd 路径）桶化后保持 |
| 集成 | op→烘焙字段→attributeVersion bump→重渲染端到端；undo 恢复字段并 bump（attribute-only 语义）；dataset 替换/rollback 引用失效路径；**worker op 在飞 + setFeatureProperty → Err.staleOperation，不提交旧结果**；replace 后两计数器不回退 |
| 性能基准 | 本地基准脚本（不进 CI 门禁）：10 万/100 万重算耗时、缓存命中帧耗时 vs 静态基线；产出回填第 5 节数值 |

## 8. 分阶段交付

**版本前提**：功能基于 mapshaper 0.6.113 即可完整落地（0.6.113 同时具备
`-classify` 显式 breaks/colors 与 `-style` 字段写入；样式字段为普通 DataTable 字段，
worker pack/unpack 与导出现有序列化覆盖）。

**Phase 0（可选、独立，不进关键路径）**— mapshaper 0.7.56 升级回归：
adapter/internal API、worker pack/unpack、全部现有 ops/import/export 回归；
任一不过 → 留在 0.6.113，不影响 Phase 1–3。

**Phase 1 — 面填色（fill）**
范围：表达式求值器全量原子（含颜色插值 256 级量化）、resolver
（styleIds+LUT+fillBuckets、桶基数 warn、重建失败 stale 保留）、
`drawPolygonFill` 可选 styleBuckets（options 袋）、逐键回退 + styleSource opt-in、
`classifyFeatures` op（判别联合返回）、`bumpAttributeVersion` 及属性命令
bump 覆盖审计（失效契约 4.2.1 的落地前提）、worker 路由扩展
（recordCount 主键 + WorkerRoutingFn info 扩展，见第 5 节）。
验收：字段驱动面填色端到端可见；undo 恢复字段；静态图层零回归；
基准脚本产出第一批实测值回填第 5 节。

**Phase 2 — 点（circle）+ 表达式烘焙路径**
范围：`drawPoints` 桶化（颜色+半径）、`styleFeatures` op（expressionPolicy gate）、
烘焙字段全键 opt-in 读取、paint 表达式覆盖全部样式键。
验收：点按属性变色/变径；JS 表达式烘焙→渲染端到端；gate 关闭时 styleFeatures 返回 Err。

**Phase 3 — 线（line/outline）**
范围：arcBuckets、逐桶 drawArcs、polygon outline 默认统一 + opt-in 逐桶
（styleId 升序确定性覆盖）、perFeature 按 shape 描边选项。
验收：polyline 按属性着色；共享弧归属/跨桶语义测试；perFeature 虚线相位与
闭合环正确性；线层静态零回归。

**横切事项（每 Phase 收尾）**：新 op 登记 `COMMAND_EFFECTS`（attribute-only）；
TypeDoc/API 文档同步；`docs:check-api` 通过；每 Phase 独立验收后才进入下一 Phase；
回归测试随功能同 PR。

## 9. 开放项

- 第 5 节 α、开销上限、worker 卸载阈值（含序列化成本拐点）、桶基数阈值的
  最终数值：resolver 冷/热构桶数值已回填（见 §5 实测块）；worker 卸载阈值
  （序列化成本拐点）与 α 帧级上限待 Phase 2 worker 协议落地后校准。
- `nice` 方法与 mapshaper 自动分级的数值对齐策略：以 emap 自研断点为准，
  如需完全对齐再单独立项评估。
