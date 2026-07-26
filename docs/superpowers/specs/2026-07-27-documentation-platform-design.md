# emap 文档平台与示例站设计

## 状态

已确认，等待实施计划。

## 背景与目标

`emap` 是面向浏览器的 TypeScript 拓扑地图渲染与编辑引擎。当前 README、FEATURES 和 CHANGELOG 已包含重要集成信息，`test/examples/` 还保留了可直接打开的示例。本设计将其升级为一套适合前端与 GIS 开发者共同使用的双语文档平台：

- 中文是内容源，英文与中文保持相同的信息架构和发布节奏。
- Docusaurus 承担任务导向的指南、概念、配方和排障。
- TypeDoc 承担从公开 TypeScript 导出生成的参数级 API 参考。
- 独立 Vite Examples 承担每个场景的真实可运行演示，不以内嵌 iframe 作为主要体验。
- 所有内容生成静态产物；不假设任何特定托管平台。

成功标准：开发者能在 10 分钟内完成一个最小地图；能在 API 页面查到每个公开参数的语义、类型、默认行为、约束和可运行示例；每个示例、文档页面和 API 符号能互相追溯；中英文导航和链接不漂移。

## 范围与非目标

本期范围：文档与示例平台结构、内容体系、完整示例迁移、双语策略、API 参考规则与构建验证。

非目标：在线编辑器、用户账户、搜索服务后端、文档站内嵌运行时、将示例单独发布为独立产品、为未公开/内部 API 编写用户文档。

## 总体架构

采用一个 pnpm workspace 中的多应用结构：源码和 JSDoc 是唯一 API 事实来源；文档和示例有独立的开发服务器与静态产物，但共享版本、类型、示例元数据和校验脚本。

```text
emap/
├── src/                         # 公开导出 + JSDoc（API 事实来源）
├── test/examples/               # 现有示例，作为迁移期间的行为基线
├── packages/
│   ├── docs/                    # Docusaurus 站
│   │   ├── docs/                # 中文源内容
│   │   ├── i18n/en/.../current/ # 英文镜像内容
│   │   ├── src/                 # 主题、导航、API 集成组件
│   │   └── static/api/          # TypeDoc 页面/JSON 产物
│   └── examples/                # 独立 Vite 站
│       ├── src/examples/        # 每个示例的入口模块
│       ├── src/catalog/         # 分类、列表、运行页和源码页
│       └── public/fixtures/     # 示例资产
├── docs-meta/                   # 示例—文档—API 映射清单
├── typedoc.json                 # 仅公开 API 的 TypeDoc 配置
└── package.json                 # workspace 与聚合脚本
```

构建流：

1. `src/index.ts` 的公开导出与相邻 JSDoc 生成 TypeDoc HTML 和 JSON。
2. 中文 Markdown/MDX 由 Docusaurus 构建；英文由其 i18n 镜像构建。
3. Vite 将每个示例路由构建成独立静态页面。
4. 聚合静态产物保留文档站和示例站的相对链接，但二者可单独预览和部署。

浏览流：指南/教程 → 参数级 API 参考 → “运行示例” → 独立 Vite 页面 → 源码与文档回链。

## Docusaurus 内容信息架构

中文目录为源目录；所有条目都必须有对应英文文档、相同 doc ID、slug、侧边栏位置和示例 ID。

| 区域 | 内容 | 主要读者问题 |
| --- | --- | --- |
| 开始使用 | 安装、样式表、容器、最小地图、`TopologySource.setData()` 加载契约 | 如何在浏览器里显示第一张图？ |
| 核心概念 | Emap、Source、Layer、Feature、拓扑、坐标、CRS、渲染周期 | 为什么图层/坐标/数据的行为与一般地图框架不同？ |
| 开发指南 | 图层样式、事件、交互 handler、选择、编辑、相机、控件、Worker | 如何实现一个产品功能？ |
| 数据与运算 | GeoJSON/TopoJSON/Shapefile/GeoParquet、属性、导入导出、地图运算、DuckDB | 如何导入、处理、查询和输出空间数据？ |
| 配方 | 文件上传、状态栏、选择工具切换、撤销重做、相机定位、大数据、异常处理 | 如何组合多个 API 完成常见任务？ |
| 参考与排障 | API、事件目录、`OpResult`/错误、浏览器限制、兼容性、迁移、FAQ | 契约到底是什么，失败时应如何判断？ |

文档页固定 front matter：`id`、双语标题、描述、关联 API 符号、关联示例 ID、稳定性等级和最后验证版本。教程与配方还包含前置条件、成功结果、失败症状和下一步链接。

## 双语策略

- 中文 Markdown/MDX 是源内容；英文在同一变更中同步更新。
- 代码、包名、导入路径、符号名、参数名、事件名、枚举值、错误文本、URL 和示例 ID 不翻译。
- 可翻译文字包括标题、说明、步骤、图注、注释和可访问性文本。
- 不允许使用机器翻译占位符、空英文页或仅有中文侧边栏项。
- CI 对比两种语言的 doc ID、slug、侧边栏项和示例引用；缺失或失配即失败。

## TypeDoc 与参数级 API 参考

### 生成范围

TypeDoc 的入口仅指向包根公开导出，避免暴露 `src/` 内部实现。TypeDoc 输出 HTML 供直接浏览，输出 JSON 供覆盖检查与 Docusaurus 的符号嵌入卡片使用。

### 每个 API 页面

TypeDoc 自动呈现：签名、重载、泛型、类型链接、可选性、默认值、返回值、所属模块和源代码链接。

每个公开类、函数、方法、属性、事件和选项对象还必须通过 JSDoc/补充 MDX 提供：

1. 一句话用途与适用场景。
2. 参数逐项说明：含义、接受类型、可选性、范围/枚举、默认行为、单位、可组合/互斥关系、性能或数据影响。
3. 返回值、链式返回或 `Promise` 的完成/拒绝时机。
4. `OpResult`、错误事件、异常条件和恢复方式。
5. 最小正确片段，以及关联的完整 Vite 示例。
6. 稳定性边界：稳定、实验性或内部（内部不进入用户 API）。

选项对象必须采用“参数卡”而非只在类型定义里留一行。例如 `map.fitBounds(bounds, options)` 的 `bounds` 应明确 CRS 一致性；`options.padding` 应说明单值/四边对象及与 `maxZoom` 的关系；`options.duration` 应说明 0 为即时、用户操作/新相机调用会中断动画、仍会触发 `moveend`。

API 指南不复制 TypeDoc 的整张参数表，只补充选择依据、组合模式、限制、性能、故障表现和示例链接。这样可以避免两套参数说明漂移。

## 独立 Vite Examples

每个示例对应稳定路由和一个入口模块，开发时可单独启动，生产时可单独构建。页面不嵌入 Docusaurus iframe。

每个页面固定包含：

1. 运行区：真实 canvas 地图、最少操作控件、明确的加载/错误/成功状态。
2. 学习区：目标、前置条件、操作步骤、预期结果、关联 API 与参数。
3. 源码区：完整入口代码、使用资产、可复制代码和回到中英文文档的链接。

每个示例有一个结构化清单项：

```ts
{
  id: 'editing/feature-translate',
  category: '04-editing-history',
  title: { zh: '拖动平移要素', en: 'Translate selected features' },
  docs: ['guides/editing/transform', 'reference/events'],
  api: ['Emap.transformFeature', 'Emap.on', 'FeatureRef'],
  fixtures: ['tiny.geojson'],
  success: '选择要素后拖动，几何改变且可通过撤销恢复'
}
```

清单是 Docusaurus 示例卡、Examples 目录页、API 页面“相关示例”和覆盖校验的共同事实来源。

### 现有示例迁移清单

仓库当前有 **52 个 HTML 浏览器示例**；`duckdb-new-features.test.ts` 和 `duckdb-spatial-ops.test.ts` 是同目录的辅助测试，不作为可浏览示例迁移。此前按目录文件数称为“54 个示例”应更正为“52 个可运行 HTML 示例 + 2 个辅助测试”。

| 分类 | 现有 HTML 示例 |
| --- | --- |
| 01 开始使用 | `geojson-viewer`、`points`、`lines`、`polygons`、`polygon-fill` |
| 02 数据与图层 | `attribute-editing`、`attribute-expressions`、`data-engineering`、`feature-attributes`、`filter-features`、`geoparquet-viewer`、`export-geoparquet`、`export-roundtrip`、`join`、`merge-layers`、`merge-selected`、`rename-layer`、`split-layer` |
| 03 交互与选择 | `interaction-handlers`、`feature-selection`、`box-select`、`lasso-select` |
| 04 编辑与历史 | `china-editing`、`draw-snap-clear`、`draw-snap-edge`、`feature-rotate-scale`、`feature-translate`、`snapshot`、`transaction`、`undo-redo`、`vertex-editing` |
| 05 空间运算 | `buffer`、`check-geometry`、`clip-erase`、`dissolve`、`divide`、`explode`、`innerlines`、`mosaic`、`project`、`rebuild-topology`、`simplify-control`、`simplify`、`snap-layer`、`union` |
| 06 性能与平台 | `crs-switch`、`web-worker` |
| 07 DuckDB 高级数据 | `duckdb-buffer`、`duckdb-geoparquet-query`、`duckdb-overlay`、`duckdb-query`、`duckdb-spatial-ops` |

迁移遵循“先保留行为、再改善讲解”的原则：每个 Vite 示例先复现现有 HTML 的加载顺序、操作与可见结果，再添加结构化说明和目录入口；不在迁移过程中修改库行为。

## 错误处理与可访问性

- 示例页面捕获异步加载和运算失败，显示可操作的错误信息，保留原始 `Error`/`OpResult` 的调试详情。
- 文档说明必须区分用户可恢复错误、数据错误和浏览器/Worker 环境限制。
- 地图 canvas 周围的控件有键盘可操作标签；状态信息以可读文本表达，不能只靠颜色或 canvas 图形。
- 所有示例通过同一数据加载契约：`await source.setData(...)` 后再使用数据集，必要时再 `map.addSource(...)` 和设置视图范围。

## 构建、验证与发布产物

建议提供以下独立与聚合命令：

| 命令 | 证明的内容 |
| --- | --- |
| `docs:dev` / `docs:build` | 双语 Docusaurus 站可运行/可静态生成，内部链接有效 |
| `api:build` | 所有公开导出可被 TypeDoc 解析并生成 API 页面/JSON |
| `examples:dev` / `examples:build` | 52 个示例路由可开发/可生产构建 |
| `docs:check-i18n` | 双语文档、导航和示例引用完整一致 |
| `docs:check-api` | 公开 API、参数 JSDoc、默认行为与关联示例覆盖达到约定门槛 |
| `examples:check` | 清单、路由、入口文件、fixtures、关联文档和 API 符号均存在 |
| `docs:verify` | 依次执行类型检查、API 构建、示例构建、文档构建和覆盖检查 |

关键交互（加载、选择、编辑、撤销重做、相机、Worker、DuckDB）需要保留自动化验证或清单中的明确手动验收步骤。文档构建、TypeDoc 构建、Vite 构建和链接/清单校验全部通过，才可生成最终静态产物。

## 实施切分

1. 建立 workspace、Docusaurus、TypeDoc 和 Vite Examples 骨架，保持当前包构建不变。
2. 建立公开 API JSDoc 规范、TypeDoc 入口和参数/示例覆盖校验。
3. 创建中英文内容骨架、导航和核心“开始使用/概念”文档。
4. 创建 Examples catalog 与公共运行壳，先迁移开始使用和交互/编辑示例。
5. 按七个分类迁移其余 52 个 HTML 示例与 fixtures。
6. 补齐数据运算、DuckDB、排障、迁移与配方文档；接入完整验证命令。

每个阶段都需要验证已有库测试不回归；任何示例行为不一致先修复迁移层，不在没有独立需求时改变 emap 库 API。

## 风险与决策记录

- TypeDoc 只能反映类型和 JSDoc，无法凭空解释业务约束；参数级质量门槛需要人工撰写 JSDoc 与示例关联。
- 中文/英文同步是持续成本；用稳定 ID、清单和构建检查将遗漏变成可见失败。
- 将旧 HTML 同时重写为 Vite 可能引入行为偏差；以逐项迁移、显式成功状态和保留的测试/手动验收步骤控制风险。
- 静态产物避免了部署平台绑定；未来改用 GitHub Pages、Vercel 或自有域名只影响发布脚本与 base URL，不改变内容结构。
