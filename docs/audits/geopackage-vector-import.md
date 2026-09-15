# GeoPackage 矢量直接导入验收

日期：2026-09-15。工作区：MacBook Air `/Users/zwishing/code/emap`。
分支：`refactor/cordis-native`。起点：`444169e0`（此前的 Cordis、源码/测试布局和文档重构已推送）。
本记录只覆盖新增 GeoPackage 导入与相应集成修复，不代表 npm 发布。

## 已实现的转换边界

使用已安装并锁定的 `@ngageoint/geopackage@4.2.9`，仅通过其 `SqljsAdapter` 读取 SQLite WASM。没有用 GeoJSON、WKX 几何树或 PathImporter 作为转换中间层，也不读取瓦片像素。

```text
GeoPackage bytes
  → SQLite WASM / feature table metadata / prepared statements
  → GeoPackage Binary header + WKB
  → first-pass validation and coordinate counts
  → Float64Array XY + Int32Array path lengths
  → native layers / DataTable / one ArcCollection
  → one dataset-wide shared topology build
```

线面坐标直接写入共享数值数组；点只在最终 mapshaper PointShape 边界还原为其要求的 XY 元组。属性直接构造 DataTable。多个矢量表进入同一 Dataset，不生成一组互不关联的 Dataset。

混合 GeometryCollection 按几何族拆为子图层，仍属于同一 Dataset；NULL、EMPTY、空表和属性保持可定位。大整数超出 Number 安全范围时使用十进制字符串；BLOB 使用 Uint8Array。不同表 CRS 先归一，再建立拓扑，不仅改写 CRS 标签。

## Worker 与 Cordis

`importGeoPackageInWorker()` 把 SQLite、解码、重投影和拓扑构建放在专用 classic Worker。返回 transferable 坐标缓冲区，主线程恢复 ArcCollection/DataTable。默认转移输入副本；只有显式 `transferInput: true` 才允许分离完整输入缓冲区。

取消、Worker 错误、messageerror、postMessage 失败和进度回调异常都必须关闭 Worker，不静默回退主线程。`geoPackagePlugin()` 是原生 Cordis 格式插件；释放 Fiber 撤销格式并取消尚未完成的导入，不删除已成功载入的数据。

## 代码与测试位置

| 路径 | 责任 |
| --- | --- |
| `src/integrations/geopackage/sqlite.ts` | NGA SQLite WASM 适配、只读连接、表/字段/SRS 元数据 |
| `src/integrations/geopackage/binary.ts` | GP header、独立大小端、ISO/EWKB、Z/M stride、安全边界 |
| `src/integrations/geopackage/import.ts` | 两遍扫描、TypedArray、属性、跨表 CRS、统一 Dataset/拓扑 |
| `src/integrations/geopackage/worker.ts`、`worker-entry.ts`、`transfer.ts` | Worker 所有权、取消、传输、原生对象恢复 |
| `src/integrations/geopackage/plugin.ts` | 原生 Cordis 格式贡献 |
| `test/integration/geopackage/import.test.ts` | 真实 SQLite、多表、跨表共享弧、精度、属性、取消、Fiber 生命周期 |
| `test/browser/geopackage.spec.mjs` | 真实 Worker/主线程一致性、同源 WASM、重复导入与取消 |
| `test/utils/geopackage.ts`、`scripts/generate-geopackage-fixture.py` | 不依赖生产解码器的 SQLite/WKB 测试样本 |

单元测试按 `binary.ts/binary.test.ts`、`worker.ts/worker.test.ts` 等同目录同名组织；跨模块测试独立放在 `test/integration/`。没有删除原有用例、降低断言或关闭检查来让 GeoPackage 验收通过。

## 同时修复的集成问题

- 通用 Worker transferable 收集器识别全部 ArrayBufferView，不再只处理 Uint8Array；避免按顶点枚举 Float64Array，并对相同底层缓冲区去重。
- Capability schema 生成器忽略 Symbol 类型键，避免依赖增加后 TypeScript 内部 Symbol 编号造成无意义漂移。生成文件与回归测试已一致。
- 新增 `/geopackage` 发布入口、Worker/WASM 文件白名单、示例资源服务及声明/TypeDoc 入口；核心入口不导入该可选运行时代码。
- 依照原请求安装 NGA 包，保持 `better-sqlite3` 本机构建关闭；已有 image-size 版本约束不通过新增 audit 豁免绕过。

## 发布资源与文档入口

发布文件为 `dist/emap-geopackage.mjs`、`dist/emap-geopackage-worker.js`、`dist/sql-wasm.wasm`；Worker 还需同目录的 `mapshaper-vendor.js`。模块 import 本身不会注册格式或启动数据库。

中文使用说明：`packages/docs/docs/data/geopackage.md`；英文使用说明位于对应 i18n 路径。README、CHANGELOG、格式/架构指南、示例目录和 ADR 0011 已同步。预览入口为 `/mapseekai/emap/examples/geopackage-viewer/`。

## 本轮验证

### 专项检查与本轮修复

本轮重新执行 GeoPackage 单元/集成测试，27/27 通过。全量测试发现并修复新示例的统一页眉、上传控件选择器和 TypeDoc 入口清单三处接入遗漏；相应目录/运行时/文档测试 82/82 通过，没有删除断言。

三浏览器 GeoPackage 专项检查中，第一次 Firefox 取消场景出现一次不稳定结果，单浏览器连续三轮未复现。取消测试改为等到新 Worker 的真实 WASM 请求已经发出后再取消，解除请求后再验证数据；移除任意固定等待，并额外比较完整图层形状和属性。修改后三浏览器 9/9 通过。记录：`/tmp/emap-gpkg-resume-browser2.log`。

### 资源与支持范围

- 只导入矢量表，不提供 GeoPackage 写出、栅格/瓦片显示或曲线线性化；不支持的几何明确失败。
- Z/M 会按正确 stride 读取，但只保留 XY 坐标；元数据记录维度情况，不声称三维无损转换。
- 默认 2 GiB 输入预算和 2 GiB 解码坐标预算不是总内存上限。SQLite 内存、属性对象、拓扑临时空间和 Worker 输入副本另有成本；不承诺任意 2 GiB 文件均能在浏览器中完成。
- `maxLayers` 限制候选 feature 表数量；混合几何表可能产生多个几何族子图层。核心 mapshaper 数据模型不支持在同一 layer 内混合点、线、面。
- 同一执行环境复用上游编译后的 WASM 模块，首次初始化决定其加载地址；每次导入仍是独立数据库连接。专用 Worker 每次重新初始化自己的执行环境。
- 主线程取消通过批次让出执行权生效，无法抢占已经运行的同步拓扑构建；需要可强制终止时采用 Worker API。

### 最终完整门禁

2026-09-15 07:33:47–07:40:03（UTC+08:00），`pnpm run release:verify` 全链执行完成，退出码 **0**。

| 检查 | 结果 |
| --- | --- |
| 格式、核心/类型契约/Examples TypeScript | 通过 |
| 测试布局 | 147 个同名同目录单元测试，检查通过 |
| 架构与原生 Cordis 边界 | 419 个生产模块，0 runtime import cycles，460 个原始基线文件有归属 |
| 公开 API 与 Capability schema | 11 个入口，schema 一致性通过 |
| Production build / 声明文件 / Bundle smoke | 通过；31 个 package exports 目标存在 |
| 全量 Vitest | 3362 passed / 56 skipped / 0 failed，共 3418 项；199 个文件通过、1 个文件跳过 |
| 独立 DuckDB-Wasm | 464/464 passed |
| Examples / TypeDoc / 中英文 Docusaurus | 全部通过，TypeDoc 0 warning / 0 error |
| 文档 API / i18n / 示例目录 | 全部通过 |
| Chrome / Firefox / WebKit Playwright | 21/21 passed，包含新增 GeoPackage 的 9 项浏览器执行 |
| 三浏览器 Canvas 像素检查 | 33/33 passed |
| pack --dry-run | 通过；未发布 npm 包 |
| 生产依赖审计 | 按仓库已有策略通过，见下文说明 |
| git diff --check | 通过 |

跳过数按实际输出记录，不声称全部测试都执行；独立 DuckDB 命令开启其 WASM 集成路径，但两次运行包含重复普通用例，不能相加当作唯一测试数量。

依赖审计保留已有的 1410 条 documentation-only finding 路径临时豁免，截止 2026-12-31；这是依赖路径数，不是独立漏洞数，不意味着整个工具链零告警。测试中的负面输入诊断和打包工具非阻断提示没有被描述成产品错误，也没有通过屏蔽测试绕过。

### 本机 3001 实际验收

已打开 `http://127.0.0.1:3001/mapseekai/emap/examples/geopackage-viewer/` 并检查返回的页面，不是只检查 HTTP 状态。默认 Worker 导入 1 个 Source/Dataset、4 个图层、6 条记录，ArcCollection 的坐标缓冲区为 Float64Array；真实 Canvas 检测到 345083 个有颜色像素。

对导入点 `[116.31, 39.93]` 开启原生编辑会话，平移到 `[116.311, 39.932]`，提交后可撤销；撤销恢复原坐标，仍为同一个注册 Source。页面 `pageerror` 数组为空，导入错误为 null。操作只发生在独立验收浏览器的内存中，没有改写上传文件。

### 原始日志与代码一致性

- 完整门禁：`/tmp/emap-gpkg-resume-release2.log`。
- 命令/时间/退出码：`/tmp/emap-gpkg-resume-release2.json`。
- 3001 页面、渲染与编辑恢复：`/tmp/emap-gpkg-resume-preview.json`。
- 图索引刷新：`/tmp/emap-gpkg-resume-graph.log`；原始图工具跳过超大自动生成 EPSG 数据文件。

对 `src/test/scripts/docs-meta`、Examples 源码/构建插件/HTML，以及核心 package/lock/build/test 配置共 804 个文件计算路径和内容摘要；本轮验收前后完全一致：

```text
f70774ac32156c173fb84b8b73ac888abb72f8daf38f5489f8d27374605ab670
```

摘要算法：路径排序，依次写入路径 UTF-8、NUL 和文件内容的 SHA-256 二进制摘要。验收后仅补充报告与 ADR 状态，不修改上述已验证实现。临时日志不是唯一证据，仓库中的专项测试、真实 SQLite 样例、浏览器用例和完整 release 脚本均可重跑。

### Git 状态

此前重构已提交推送为 `444169e0`，本轮再次核实远端分支与该提交一致。GeoPackage 能力和本验收报告是该提交之后的本地工作区改动；本轮没有自动提交、推送、打标签或发布。

### 最后影响检查

在最终示例与测试修复后再次以 `--index-only` 刷新 GitNexus，没有生成或覆盖代理规则文件。`detect-changes --scope all` 对已有 Git 跟踪文件报告 28 个变更文件、25 个符号、0 个命中执行流程，风险等级 low。该统计不包括未跟踪的新模块，不能当作新模块无影响的证明；新模块已由上述源码阅读、27 项专项测试、全量门禁和真实浏览器验收覆盖。

最终图工具记录：`/tmp/emap-gpkg-final-graph.log`、`/tmp/emap-gpkg-final-impact.txt`。报告补齐后再次执行格式和 diff 空白检查，通过。
