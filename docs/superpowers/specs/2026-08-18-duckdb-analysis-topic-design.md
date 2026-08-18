# DuckDB 空间数据分析专题设计

**日期：** 2026-08-18  
**状态：** 已确认，待实现计划

## 目标

在示例目录的“数据分析”一级分类内建立“DuckDB 空间数据分析”专题。每个 DuckDB 空间函数都有独立、可直接访问的示例页；现有合并的 `duckdb-spatial-ops` 页面被完全移除。

用户可从专题中按“查询与数据接入”“专项分析流程”“几何处理”“属性派生”“空间关系”浏览示例。每个示例页只讲解一个函数或一项既有专项流程。

## 范围

### 保留的现有页面

以下五页保留当前公开路由和交互行为，只加入 DuckDB 专题与分段元数据：

| 分段 | 路由 | 页面 |
| --- | --- | --- |
| 查询与数据接入 | `duckdb-query` | DuckDB 受限 SELECT |
| 查询与数据接入 | `duckdb-geoparquet-query` | DuckDB GeoParquet 查询 |
| 专项分析流程 | `duckdb-buffer` | DuckDB 缓冲区 |
| 专项分析流程 | `duckdb-overlay` | DuckDB Overlay |
| 专项分析流程 | `duckdb-spatial-aggregate-join` | DuckDB 空间聚合连接 |

### 新建的独立函数页面

新增 31 个页面。新页面采用嵌套路由，均位于 `packages/examples/examples/<route>/index.html`。

| 分段 | 路由 | DuckDB 函数 / 页面主题 |
| --- | --- | --- |
| 几何处理 | `duckdb/geometry/centroid` | Centroid |
| 几何处理 | `duckdb/geometry/envelope` | Envelope |
| 几何处理 | `duckdb/geometry/convex-hull` | Convex Hull |
| 几何处理 | `duckdb/geometry/boundary` | Boundary |
| 几何处理 | `duckdb/geometry/simplify` | Simplify |
| 几何处理 | `duckdb/geometry/simplify-preserve-topology` | Simplify Preserve Topology |
| 几何处理 | `duckdb/geometry/make-valid` | Make Valid |
| 属性派生 | `duckdb/attribute/area` | Area |
| 属性派生 | `duckdb/attribute/length` | Length |
| 属性派生 | `duckdb/attribute/perimeter` | Perimeter |
| 属性派生 | `duckdb/attribute/geometry-type` | Geometry Type |
| 属性派生 | `duckdb/attribute/is-valid` | Is Valid |
| 属性派生 | `duckdb/attribute/is-empty` | Is Empty |
| 属性派生 | `duckdb/attribute/is-simple` | Is Simple |
| 属性派生 | `duckdb/attribute/x` | X |
| 属性派生 | `duckdb/attribute/y` | Y |
| 属性派生 | `duckdb/attribute/centroid-x` | Centroid X |
| 属性派生 | `duckdb/attribute/centroid-y` | Centroid Y |
| 空间关系 | `duckdb/relation/intersects` | Intersects |
| 空间关系 | `duckdb/relation/contains` | Contains |
| 空间关系 | `duckdb/relation/within` | Within |
| 空间关系 | `duckdb/relation/touches` | Touches |
| 空间关系 | `duckdb/relation/disjoint` | Disjoint |
| 空间关系 | `duckdb/relation/overlaps` | Overlaps |
| 空间关系 | `duckdb/relation/equals` | Equals |
| 空间关系 | `duckdb/relation/crosses` | Crosses |
| 空间关系 | `duckdb/relation/covers` | Covers |
| 空间关系 | `duckdb/relation/covered-by` | Covered By |
| 空间关系 | `duckdb/relation/contains-properly` | Contains Properly |
| 空间关系 | `duckdb/relation/distance` | Distance |
| 空间关系 | `duckdb/relation/distance-within` | Distance Within |

空间关系页按函数划分。除 `Distance` 以外，每页保留现有的 Filter / Attribute 输出模式选择；`Distance` 保持仅属性输出。`Distance Within` 保留距离输入和输出模式选择。

### 删除的页面

删除以下旧的合并入口及其所有目录、元数据、构建路由和测试引用：

- `duckdb-spatial-ops`

不提供重定向、别名或兼容页面。新目录是完整切换后的唯一入口。

## 目录信息架构

`data-analysis` 保持一级分类。其 53 张卡片按原始声明顺序显示，其中 17 张非 DuckDB 卡片保持直接显示；36 张 DuckDB 卡片放入专题内：

```text
数据分析（53）
├── 通用数据分析（17）
└── DuckDB 空间数据分析（36）
    ├── 查询与数据接入（2）
    ├── 专项分析流程（3）
    ├── 几何处理（7）
    ├── 属性派生（11）
    └── 空间关系（13）
```

`ExampleDefinition` 扩展为可选专题标识和分段标识。专题名称与分段名称由单一、双语的专题元数据表定义，不在 36 个条目中重复文字。未带专题标识的示例继续使用现有目录行为。

目录渲染先应用一级分类与搜索过滤，再渲染专题。搜索结果中为空的 DuckDB 分段和专题不显示；其他分类、语言切换、卡片链接和搜索规则不变。

## 页面与共享运行器

### 静态页面

每个新路由都有独立的 `index.html`。页面负责：

- 中文与英文可检索的页面标题、卡片标题和说明；
- 该函数的明确工作台标题与帮助文字；
- 该函数需要的实际表单元素；
- 固定操作配置；
- 对共享运行器的显式调用。

页面不是以 query parameter 或运行时路由决定操作的通用入口；每个 URL 对应一个固定学习目标。

### 共享运行器

新增一个仅供 examples 使用的 DuckDB 空间示例模块。它接收经过类型约束的固定配置：操作、分段、输出标签和所需控件。模块维护一个显式的 31 项操作注册表，并将每项映射到现有 `@mapseekai/emap/duckdb` helper。

共享运行器只提取旧合并页已存在的通用行为：

- 文件读取、TopologySource 注册、图层选择与可见性；
- 输入 CRS 重新声明与重新导入；
- DuckDB-Wasm 单例初始化、`setDuckDbRuntime` 与 `pagehide` 清理；
- 输入变更后的异步结果失效检查；
- 输出 source / layer 的替换、渲染和范围调整；
- 点击要素的属性展示；
- 状态栏中的加载、成功和失败信息。

控件只按操作显示：

- 几何页：文件、图层、CRS；两个简化页额外显示容差和“允许经纬度简化”。
- 属性页：文件、图层、CRS。
- 关系页：文件、目标图层、Mask 图层；`Distance` 和 `Distance Within` 显示距离；除 `Distance` 外显示 Filter / Attribute 模式。

现有五个独立 DuckDB 页不迁移到这个共享运行器，避免改变其已验证的专项工作流。

## 状态与错误约束

1. 上传文件、修改 CRS 或替换输入 source 时，旧输出必须被移除。
2. DuckDB 异步执行结束时，若输入 source 已变更，结果不得注册为 source 或 layer，并向状态栏说明结果已丢弃。
3. 操作失败不得留下部分 source、layer 或可选择的旧输出；错误经状态栏报告，并保留现有控制台错误记录。
4. 每页只持有自己的 DuckDB runtime；页面卸载时必须关闭它。
5. 不新增 DuckDB API、SQL 解析能力、网络服务发现或通用示例生成器。

## 元数据、构建与测试

### 元数据和构建

- `docs-meta/examples.ts` 添加 31 条新条目、专题元数据与分段标识，删除合并页条目。
- `packages/examples/vite.config.ts` 的 `routeIds` 与示例元数据完全同步。
- fixture manifest 继续从示例元数据导出；每个新页面以自己的 route id 调用 `autoLoadExampleFixtures`。
- `ExampleDefinition.source.html`、公开 route、实际 HTML 文件和 Vite 输入必须一一对应。

### 测试边界

1. 目录元数据测试固定数据分析总数为 53、DuckDB 专题总数为 36、五个分段及其顺序和条目数。
2. 目录 DOM 测试验证专题嵌套、专题 / 分段计数、搜索过滤后空分段隐藏，以及非 DuckDB 卡片不进入专题。
3. 路由测试验证每个元数据条目存在真实 HTML，`routeIds` 不缺项、不多项，且旧合并页不再存在。
4. 共享运行器测试验证 31 项操作均有确定映射；几何、属性、关系三种配置渲染正确控件；简化参数、关系模式、距离参数和异步过期结果遵守约束。
5. 每个静态页面测试其固定配置、标题和 fixture 请求；代表性页面执行真实的 jsdom 交互合同。
6. 保留现有五个专项 DuckDB 页的行为测试。

## 验收标准

- “数据分析”目录内可见一个 DuckDB 空间数据分析专题，包含 36 张卡片和五个有序分段。
- 所有 31 个原本聚在 `duckdb-spatial-ops` 的操作都通过自己的可访问页面运行；没有操作选择下拉框作为主入口。
- 每个关系函数独立成页且保留约定的输出模式；每个页面只显示需要的控件。
- `duckdb-spatial-ops` 不再出现在元数据、构建产物或路由中。
- 现有五个专项 DuckDB 页面继续可用，公开 URL 不变。
- `pnpm vitest run test/docs/example-catalog.test.ts`、共享运行器与页面的新增合同测试、`pnpm typecheck`、`pnpm --dir packages/examples build` 均通过；最终全量测试在隔离 worktree 中通过。

## 非目标

- 不更改 DuckDB 引擎、现有公开库 API 或空间函数语义。
- 不重写五个既有专项页的 UI 或流程。
- 不重新组织非 DuckDB 的数据分析示例。
- 不为删除的 `duckdb-spatial-ops` URL 添加兼容层。
