# Cordis 原生替换迁移记录

分支：`refactor/cordis-native`。起点：`fdd3e136`。决策：[ADR 0009](../decisions/0009-native-cordis.md)。本分支没有改动原 GIS 算法依赖版本，也没有发布 npm 版本。

## 实现范围

自研内核与服务 token 已删除。51 个服务契约改为 Cordis Context declaration merging；所有 Provider、交互、控件工厂、格式与 Capability 插件使用原生 `inject / apply / ctx.effect / ctx.provide`。原有 editor/viewer/headless/empty preset 保留业务范围，但使用原生插件定义。

公开地图入口改为 `await Emap.create(options)` 或 `await map.ready`。应用通过 `map.ctx.plugin(plugin)` 安装，使用原生 Fiber 做 Dispose、Restart、Update。`map.addControl()`、`map.removeControl()`、`map.controls.add()` 现在需要等待 Promise。地图和控件的资源由 Cordis 管理，不提供旧内核兼容层。

`src/runtime/context` 只包含上游 re-export、只读诊断、原生过渡等待和 AbortController effect 适配。格式注册表、GIS 数据状态、渲染缓存、工具目录及撤销记录是领域状态，不是第二个插件运行时。

## 人工验证

打开 `http://127.0.0.1:3001/mapseekai/emap/examples/plugin-runtime/`。页面显示 `cordis@4.0.0-rc.10` 与 `Context.is(map.ctx) = true`。在右侧地图实际拖动，再对 drag-pan 执行 Dispose、重新安装与 Restart。安装 Arrow 观察扩展格式组；安装 DuckDB 观察工具增加、惰性数据库状态，以及 Provider 卸载后工具 Fiber 回到 PENDING。四种 preset 都由实际实例取数。

在该示例控制台可以使用 `emapHarness.map.ctx` 与 `emapHarness.inspect()`。不存在 `emapHarness.map.runtime` 或 `emapHarness.map.services`。

## 自动验证命令

```sh
pnpm typecheck
pnpm exec tsc -p packages/examples/tsconfig.json --noEmit
pnpm architecture:check
pnpm capabilities:check
pnpm test:run
pnpm test:duckdb
pnpm build
pnpm bundle:smoke
pnpm examples:build
pnpm docs:build
pnpm docs:compose-examples
pnpm docs:check-api
pnpm docs:check-i18n
pnpm examples:check
pnpm browser:check
pnpm pack --dry-run
```

本次完整 `pnpm run release:verify` 已通过（退出码 0）。全量 3332 passed / 56 skipped / 0 failed，独立 DuckDB-Wasm 464/464 passed，三浏览器 12/12 passed；默认跳过的集成用例已由独立命令执行。详细证据、发布状态和已知边界见 [验收记录](../audits/cordis-native-migration.md)。
