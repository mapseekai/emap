# Cordis 原生全量替换验收

日期：2026-09-14。工作分支：`refactor/cordis-native`。迁移起点：`fdd3e136`。

## 结论与范围

已将上一次迁移自研的插件内核替换为官方上游 `cordis@4.0.0-rc.10`，不是适配器、双内核、fork 或 vendored 版本。版本被精确锁定；该版本仍为 RC，不应描述为稳定版。本次没有发布 npm 版本，也没有修改既有 GIS 算法依赖版本。

`map.ctx` 是 Cordis 原生 `Context`；插件以 `name / inject / apply / provide` 定义，通过 `ctx.plugin()` 返回原生 `Fiber`。实例状态、依赖变化、effect 回收、restart、配置 update、原生事件和 service isolation 均由上游运行时处理。

## 已删除的自研机制

| 旧机制 | 当前实现 |
| --- | --- |
| `src/kernel/runtime.ts` / `PluginRuntime`、安装图与 `reconcile()` | 官方 `Context / Registry / Fiber` |
| 自研 `ServiceRegistry / ServiceKey / serviceKey()` | 原生 Context declaration merging、`ctx.provide()` 与命名服务 |
| 自研 `EffectScope`、`ctx.defer()` | 原生 `ctx.effect()` 与 Fiber 生命周期 |
| `map.runtime / map.services / map.use / map.getService` | `map.ctx` 和 Cordis 原生 API |
| `/kernel` 发布入口 | `/context` 上游 re-export 与只读诊断 |
| ID 驱动的 enable/disable 兼容层 | 持有真实 Fiber，调用 dispose/restart/update；重新安装使用 ctx.plugin |

`src/kernel/`、`src/runtime/services/keys.ts` 和交互 service token 文件已经删除。`src/runtime/context/` 仅保留上游导出、只读诊断、等待原生过渡、读取上游状态枚举，以及用原生 effect 绑定 AbortController 的浏览器适配，不维护第二套插件图、状态机或释放队列。

## 保留的 GIS 领域实现
拓扑 Dataset、Source、LayerRegistry、编辑与撤销命令、Canvas/LOD、格式目录和 CapabilityRegistry 仍是领域对象；它们不属于插件运行时，不能为了“完全替换”而误删。GIS 高频交互直接调用启动时获得的领域服务，不经过 JSON/RPC。既有 GIS EventDispatcher 作为 `ctx.mapEvents` 保留。

51 个服务字段通过 Cordis declaration merging 定义：工作区 33 个、交互 14 个、格式/能力各 1 个、DuckDB 2 个。所有 Provider、Feature 与 Capability 插件都使用原生 API。地图初始化改为 `await Emap.create(options)` 或 `await map.ready`；控件安装/移除和地图释放也需要等待 Promise。

## 可复现证据

- `test/integration/runtime/cordis-native.test.ts`：原生函数插件、Service 子类、依赖缺失/恢复、隔离、多 Fiber、配置更新、restart、事件解绑、异步 effect 和失败启动清理。
- `test/integration/runtime/controls-native.test.ts`：控件由原生子插件持有，随着 inject 依赖暂停、恢复和释放。
- `test/build/bundle-self-contained.test.ts`：在独立 Node 进程加载生产包，严格比较 `/context` 导出的 Context 与直接导入 `cordis` 的 Context 为同一类；验证实际地图实例、原生 Arrow Fiber 安装/释放，以及已删除 API 不再导出。
- `test/browser/cordis-runtime.spec.mjs`：真实鼠标拖动、Dispose 后停止、重新安装和 Restart 后恢复；Arrow 格式撤销；DuckDB Provider 消失时工具消费者回到 PENDING，恢复 Provider 后工具重新注册。
- `scripts/check-plugin-architecture.mjs`：拒绝自研内核目录/API 回流，检查 runtime import cycles、契约反向依赖、可选 Provider 意外进入核心，以及全部 460 个原始基线文件的归属。

旧自研内核专属测试已由原生 Cordis 行为测试替换；没有把旧状态名或 AggregateError 释放协议重新模拟一遍。测试总数不应与上一轮内核逐项机械对齐，也不能把上一轮通过的结果冒充本次结果。

## 浏览器验收入口

```text
http://127.0.0.1:3001/mapseekai/emap/examples/plugin-runtime/
```

页面显示上游版本和 `Context.is(map.ctx) = true`，使用真实 registry/Fiber 获取插件、服务与 effect；支持 Dispose、Restart、重新安装和可选 Provider。控制台入口是 `emapHarness.map.ctx`，没有旧 runtime/services 兼容入口。四种 preset 的数量来自实际实例，而非静态模拟值。

已检查 3001 返回 HTTP 200，且返回 HTML 与当前 compose 后的文件一致。静态预览不是热更新服务；源码修改后仍需重新 build 和 compose。

## 验收结果

完整 `pnpm run release:verify` 已于 2026-09-14 在本机串行跑完，退出码 **0**。以下结果来自本次同一工作区和生产构建，不是上次自研内核的结果。

| 检查 | 本次结果 |
| --- | --- |
| Biome format | 629 个文件，通过 |
| 根项目 TypeScript | 通过 |
| Examples 独立 TypeScript | 额外执行，通过 |
| 架构检查 | 410 个 production modules；0 runtime import cycles；460 个原始基线文件全部归属 |
| API surface | 10 个正式入口通过，`/context` 替代 `/kernel` |
| Capability schema 漂移检查 | 通过，102 项已有领域操作 schema |
| Production build / declarations | 通过 |
| Bundle smoke | 10 个必需产物、27 个 exports 目标通过 |
| 全量 Vitest | 3388 项：3332 passed、56 skipped、0 failed；194 个文件 passed、1 个 skipped |
| DuckDB-Wasm 集成 | 464/464 passed、0 skipped、0 failed；覆盖默认运行未启用的 56 项集成用例 |
| Examples production build | 通过 |
| TypeDoc / 中英文文档构建 | 通过；TypeDoc 0 warning、0 error |
| 文档 compose / API / i18n / examples check | 全部通过 |
| Chrome / Firefox / WebKit Playwright | 12/12 passed，包含 Cordis 的实际交互与依赖恢复 |
| 三浏览器 Canvas rendering audit | 33/33 检查 passed |
| pack --dry-run | 通过；未执行 publish |
| 生产依赖 audit | 按仓库既有策略通过，见下文例外说明 |
| git diff --check | 通过 |

默认全量测试的 56 项 skipped 不应写成全部执行；独立的 DuckDB-Wasm 命令将它们开启并验证。两轮结果包含重复的普通 DuckDB 单元测试，不能简单相加当作唯一测试数量。

## 证据位置与可复跑性

本机原始日志：`/tmp/emap-cordis-resume-release.log`；退出记录：`/tmp/emap-cordis-resume-release.json`。日志记录执行从 22:15:28 至 22:22:32。临时日志不作为唯一长期证据；上述测试和 release 脚本已经位于仓库，可重新执行。

对全部 `src` 文件及 `package.json`、`pnpm-lock.yaml`、`rollup.config.mjs`、`tsconfig.build.json` 共 601 个文件计算 SHA-256 清单摘要，验收前后完全一致：

```text
4785ceaba5393e46883aa631743af24673e9c66bd016453baa9ffd79667149fd
```

算法为按相对路径排序，向 SHA-256 依次输入每个路径的 UTF-8、NUL 字节及该文件内容的 SHA-256 二进制摘要。验收后仅补齐本报告及迁移清单的状态，没有修改已测试的实现。

复跑完整验收：

```sh
cd /Users/zwishing/code/emap
pnpm run release:verify
pnpm exec tsc -p packages/examples/tsconfig.json --noEmit
```

## 已知边界与发布状态

- Cordis 仍为固定的 `4.0.0-rc.10`，不是正式稳定版；升级上游版本必须重新执行验收。
- Cordis 原生 teardown 错误记录遵循上游 logger 行为；未重新实现旧 AggregateError 协议。同步重计算不保证被强制中断，异步 GIS 提交使用原生 effect 绑定的取消信号防止失效结果提交。
- 渲染审计的 esbuild 二次打包出现 3 条 `ignored-bare-import` tree-shaking 提示；检查继续通过。不能把 TypeDoc 零警告扩展解释为所有工具输出零警告。
- 生产依赖审计沿用仓库已有文档工具链临时豁免策略：1710 个 documentation-only finding 路径允许至 2026-12-31。这是路径计数，不是 1710 个独立漏洞，也不应表述为整个工具链零安全告警。
- 当前改动在 `refactor/cordis-native` 工作区；没有在本次继续执行中提交、推送、合并或发布。旧分支 `refactor/everything-plugin` 的 `fdd3e136` 保持不变。

## 3001 最终回查

完成 compose 后，使用本机已有 `@playwright/test` 的 Chrome channel 打开当前 3001 页面：HTTP 200，`cordis@4.0.0-rc.10 · Context.is(map.ctx) = true`，`customRuntime=false`、`customServices=false`、`ctx.plugin` 是函数，163 个原生 Fiber、102 个 Capability，页面 JavaScript 错误数组为空。记录位于 `/tmp/emap-cordis-resume-preview.json`。这里的 163 是当前示例实例的 Fiber 数量，不是固定的库级插件总数。

验收记录与迁移状态补齐后，再次执行 `format:check`、`architecture:check` 和 `git diff --check`，全部通过。
