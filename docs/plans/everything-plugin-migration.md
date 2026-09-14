> Historical migration record for commit `fdd3e136`. The custom kernel described below has been removed; see [the native Cordis migration](cordis-native-migration.md) for current APIs.

# emap 全量插件迁移说明

- 工作分支：`refactor/everything-plugin`
- 迁移基线：`41a53a4e`（原包版本 0.11.2）
- 设计决策：`docs/decisions/0008-everything-plugin.md`
- 逐文件归属：`docs/plans/plugin-migration-inventory.json`
- 验证记录：`docs/audits/plugin-migration-validation.md`

## 1. 迁移范围与边界

保留现有矢量拓扑数据模型、点线面绘制、LOD、查询、选择、吸附与编辑算法、撤销/重做、事务、属性处理、格式转换、Mapshaper、DuckDB、Worker、MapLibre、控件及原有测试。算法库、几何值对象和数据类型不逐函数包装成插件；具有运行时资源、可配置装配或可发现能力的模块才注册为插件。

`Emap` 是公开 façade，不再是存放所有数据与具体构造器的大内核。文档状态只有一份，渲染派生缓存和编辑预览各有明确所有者。地图交互与绘图热路径直接调用启动时获取的类型化服务，不通过 JSON/RPC 或 Agent 工具网关。

本次是有明确破坏性接口调整的迁移分支，不代表已经发布新的 npm 版本。原有第三方算法依赖版本保持不变。

## 2. 五层模块归属

| 层 | 具体模块 | 责任与边界 |
| --- | --- | --- |
| Kernel | `src/kernel/`：PluginRuntime、ServiceRegistry、ServiceKey、EffectScope、依赖图、安装回滚、取消与释放 | 不依赖 GIS、DOM、Canvas、MapLibre、Arrow 或 DuckDB。共享 token 不等于共享可变状态。 |
| Service | `src/runtime/services/`：document、source/source-factory、view、projection、scale、layers、cache、selection、query、history、edit-state、policy、execution、render、surface、interaction、routing、controls、validation、snapshot、formats、capabilities | 定义消费者可依赖的契约和 token；不从 provider 实现反向推导类型。当前数据领域依然是 mapshaper 拓扑，不宣称任意数据模型无需适配即可替换。 |
| Provider | `src/engine/providers/workspace/` 实现文档/视图/渲染等服务；`providers/mapshaper/`、`providers/topology/`、`providers/formats/`、`providers/capabilities/`；可选 `providers/maplibre/`、`src/integrations/arrow/`、`src/integrations/duckdb/`；Worker 位于 execution provider | 持有资源和状态、提供服务，释放由插件 scope 管理。Canvas provider 仍复用原 CanvasPainter/RenderScheduler；DuckDB 仍调用原 toolbox；不重写 GIS 算法。 |
| Feature Plugin | `src/runtime/plugins/interactions/`：平移、滚轮、点击/框/套索选择、绘制、顶点、切割、重塑、自动补面、环、部件、测量、变换；`plugins/controls/`、`plugins/validation/` | 声明所需服务；动态注册交互、控件工厂或校验器。控件不再获得整个 Emap 实现。默认 preset 注册工厂但不会替应用添加控件。 |
| AI Capability | `src/runtime/services/capabilities.ts`、`src/runtime/ai/`、`src/runtime/plugins/capabilities/`、`src/integrations/duckdb/capabilities.ts` | 描述、参数 schema、发现、宿主授权、调用、取消边界及有界执行记录。与 UI 复用同一领域操作，不包含模型 API、凭据或自动外发数据。 |

`src/geo`、`src/types`、`src/domain/edit/commands`、`src/engine/map/ops`、`src/renderer` 等已有实现仍是可复用领域模块，归属于对应服务或 provider。这些目录没有被简单改名冒充插件化。

## 3. 装配与生命周期

`editor` 默认提供现有编辑体验；`viewer` 不安装模态编辑交互，但保留文档和分析能力；`headless` 无 DOM、Canvas 和指针监听；`empty` 只安装实例选项，可自定义完整装配。

插件通过 `provides`、`requires` 声明服务。依赖未满足时等待；重复 provider、重复插件 ID、依赖循环及未声明访问在装配时失败。安装组失败会撤销该组效果并恢复原先等待的消费者。`optional` 是明确声明的、按需查询的可选服务，不可缓存其对象为永久依赖；可选 provider 卸载时先停用相关消费者，再重新协调可运行状态。

使用 `ctx.defer()` 记录事件解绑、注册撤销、资源关闭。`remove()` 立即撤销同步资源；`await map.dispose()` 等待异步释放并观察聚合错误。代码信任边界没有变化：接口和依赖声明不是恶意 JavaScript 沙箱。

有状态文档 provider 的替换属于文档生命周期操作，不承诺保留旧文档状态的无损热替换。正在拖拽的编辑 session 会在 provider 卸载时取消预览；异步 Mapshaper 提交使用 scope 的失效检查，防止卸载后提交旧结果。取消不等于强制中断所有正在运行的同步计算。

## 4. 使用方式

### 普通编辑器

```ts
import { Emap } from '@mapseekai/emap';
const map = new Emap({ container: 'map' });
map.controls.add('navigation');
map.controls.add('layers');
console.table(map.runtime.inspect());
```

### 显式加载 MapLibre

```ts
import { Emap } from '@mapseekai/emap';
import { mapLibrePlugin } from '@mapseekai/emap/maplibre';
const map = new Emap({
  container: 'map',
  plugins: [mapLibrePlugin],
  mapLibre: { services: [{ id: 'base', name: 'Base', role: 'basemap', style: '/style.json' }], defaultBasemap: 'base' },
});
```

MapLibre 是可选 peer，不再随核心默认安装或装配。保留 `map.mapLibreServices` 管理入口；传入 `mapLibre` 选项但不安装 provider 会得到明确错误。

### Arrow / GeoParquet / 第三方格式

```ts
import { Emap, TopologySource } from '@mapseekai/emap';
import { arrowFormatsPlugin } from '@mapseekai/emap/arrow';
const map = new Emap({ preset: 'headless', plugins: [arrowFormatsPlugin] });
const source = new TopologySource('upload', { formats: map.formats });
await source.setData({ filename: 'roads.arrow', content: bytes });
await map.addSource('upload', source);
const blob = await source.export({ format: 'geoarrow' });
```

单纯 import 不注册格式。独立源默认拥有自己的 registry；在加入地图前加载可选格式时，必须传入相应 registry。`map.addSource()` 对之后的格式 I/O 建立实例所有权，移除后恢复原 registry。第三方格式可使用 `formatPlugin(codec)` 或显式 `registerFormat(map.formats, codec)` 并保留返回的 disposer。未知自定义扩展名也可注册，不必修改核心名单。

### DuckDB 与统一能力

```ts
import { Emap } from '@mapseekai/emap';
import { duckDbPlugin, duckDbCapabilityPlugins } from '@mapseekai/emap/duckdb';
const map = new Emap({
  preset: 'headless',
  plugins: [duckDbPlugin(), ...duckDbCapabilityPlugins],
});
const result = await map.capabilities.execute('duckdb.buffer', {
  inputs: { input: 'roads' }, params: { distance: 20 },
});
```

示例中的 `roads` 必须已经加载到该工作区，且满足工具 CRS 要求。DuckDB 能力返回独立结果，不暗中替换原数据。低层函数继续支持显式 runtime 参数：`buffer(dataset, options, runtime)`。全局 `setDuckDbRuntime/getDuckDbRuntime` 已删除。外部注入 runtime 默认借用；`owned: true` 才随 provider 关闭，工厂创建的 runtime 默认归 provider 所有。

### Agent 接入

```ts
import { describeAgentTools, invokeAgentTool } from '@mapseekai/emap/ai';
const tools = describeAgentTools(map.capabilities);
const result = await invokeAgentTool(map.capabilities, 'view.getCRS', {});
// 仅把 result.content 交给模型；result.value 留在本地 UI/工作流。
```

Agent 默认只允许只读能力。写入必须由宿主通过 `authorizeCapability` 授权；授权不能放在模型生成的输入参数里。表达式默认仍是 disabled，Agent 网关不放宽 SQL、CRS、几何和事务规则。参数只接受有限 JSON 结构；数据通过源/图层/要素引用传递。执行日志最多保留 200 条元数据，不保存完整输入和数据集，不等于持久化、确定性可重放的事件溯源系统。

## 5. 兼容与验证

保留常用 Emap façade 和原算法 API。明确变化包括格式注册需要 registry、Arrow 不再 import 注册、DuckDB runtime 显式传递、MapLibre 显式 provider、ControlContext 替代整个 Emap、异步释放错误通过 dispose 观察。开发者原有测试中对 Emap 私有字段的访问改为测试专用 provider 桥接，不在生产 façade 加入旧私有 API。

能力 schema 从现有 TypeScript 操作签名生成：`pnpm capabilities:generate`；`pnpm capabilities:check` 防止漂移。`pnpm architecture:check` 检查内核依赖、服务契约反向依赖、运行时循环、可选 provider 的默认入口可达性，以及全部基线文件归属。

验证必须区分源代码类型检查、原有回归、真实 DuckDB 集成、生产构建、所有发布入口、示例、文档和浏览器测试；未执行的检查不得写成通过。最终结果写入审计记录。
