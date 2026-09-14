# ADR 0008: 全量插件化与五层运行时

- 状态：实施中
- 日期：2026-09-14
- 分支：`refactor/everything-plugin`
- 基线：`41a53a4e` / `@mapseekai/emap` 0.11.2
- 原始验证：TypeScript 通过；3,288 tests passed，56 skipped。

## 目标与范围

迁移当前全部数据导入导出、坐标与投影、点线面渲染、LOD、过滤与样式、
查询与选择、拓扑编辑、历史事务、校验、控件、Mapshaper、Worker、
Arrow/GeoParquet、DuckDB 与 MapLibre 集成；不能通过删除功能或跳过测试完成迁移。
`Emap` 保留作为开发者 façade。算法、值对象和协议类型是普通模块，不为每个函数制造插件。

## 五层职责

| 层 | 模块 | 禁止承担的职责 |
| --- | --- | --- |
| Kernel | PluginRuntime、ServiceKey/Registry、EffectScope、依赖图、实例生命周期 | GIS、DOM、渲染器、数据库、业务工具 |
| Service | 文档/数据、视图、图层/样式、查询、选择/高亮、编辑/历史/事务、格式、交互、渲染、控件、处理、执行、校验、能力契约 | 写死具体 provider 或第三方工具名单 |
| Provider | 拓扑文档、投影/视图、Canvas、Mapshaper、Worker、MapLibre、Arrow/Parquet、DuckDB | 产品界面与 Agent 决策 |
| Feature Plugin | 导入导出、快照、选择、导航、绘制、顶点/共享弧编辑、分割/合并/重塑/环/部件、测量、变换、属性、控件、校验、处理工具 | 依赖 Emap 实例或访问未声明的 service |
| AI Capability | 统一发现、输入 schema、数据引用解析、成本/CRS/副作用描述、策略校验、执行记录、工具 adapters | 私自直接改数据、绕过事务、自动信任表达式、自动发送数据到外部模型 |

共享 geometry/topology/style/identifier/options 类型属于领域协议，不是第六套运行时。
源数据、渲染派生数据和交互暂态保持不同职责；不得为插件间通信逐帧全量序列化数据。

## 生命周期与依赖

插件显式声明 `provides`、`requires`，同一 service 同时只允许一个 provider。
依赖尚未满足时等待；新增 provider 后自动激活消费者；移除 provider 先停消费者。
重复注册、依赖循环与未声明访问必须失败。一个安装组失败时撤销这个安装组的效果。
每个地图拥有独立 registry；Symbol.for 只共享不可变 token，不共享实例状态。
事件监听、handler、format、control factory、capability 和异步取消句柄均属于插件 scope。
同步释放立即执行；异步释放可以通过 runtime.settled()/dispose() 等待。
同步 setup 只注册能力，异步 I/O 在 service 方法内执行并接收 scope 的 AbortSignal。

## 数据与性能边界

文档状态是源数据、选择、历史、版本与事务的权威状态；插件不得保存第二份可写源数据。
已有 geometry/attribute version、过期结果拒绝、原子提交和 undo/redo 语义必须保留。
交互和逐点绘制使用初始化时取得的类型化 service 引用，不走 JSON/RPC 或动态工具发现。
重型计算沿用 Worker/DuckDB 受控异步路径，不把所有 service 方法改成异步 RPC。
绘图 provider 可替换不等于所有 provider 自动具有拓扑编辑能力；需要显式声明能力。
文档/历史等有状态 provider 的替换是文档生命周期操作，不承诺无损热替换。

## 入口与装配

默认编辑器 preset 保留目前默认行为，不自动增加用户没有添加的 UI 控件。
viewer/headless/minimal 与自定义装配用于验证能力真的可裁剪，而不只是改文件夹名称。
可选集成必须提供显式插件入口；格式注册不再依靠 import 副作用或 globalThis 注册表。
已有 façade 的常用方法保留。因实例隔离必须修改的注册/配置 API 要同步迁移示例和文档。
禁止保留两套会互相漂移的操作注册、执行与状态更新路径。

## AI 安全语义

AI 与 UI 共用领域操作。schema 验证不取代几何/CRS/事务校验。
工具引用数据集和图层，不能把完整大数据作为模型上下文的默认参数。
破坏性操作须通过调用策略允许；表达式仍默认 disabled。
执行记录不等于持久化的、确定性可重放的事件日志；未实现的能力不能标为已支持。
插件运行在可信代码边界内；TypeScript interface 和 service 声明不是恶意代码沙箱。

## 验收

维护逐文件迁移清单和功能覆盖表；所有基线 production files 必须有归属。
运行类型检查、完整原始测试、新内核/隔离/动态交互/卸载/能力校验测试、build、bundle smoke、
API surface、examples、docs 和可用的 DuckDB/浏览器集成检查。
单独记录未执行或环境失败的检查，不能把它们写成通过。
