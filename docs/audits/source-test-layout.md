# 源码、测试布局与全文档收尾验收

验证日期：2026-09-15。分支：`refactor/cordis-native`。

## 完成范围

源码按 `domain / engine / runtime / integrations / ui / shared` 六区组织。143 个源码单元测试与实现同目录同名；跨模块测试移至 `test/integration`，公开类型契约位于 `test/types`，构建验证位于 `test/build`。原生 Cordis 是唯一插件运行时。

README、中文 README、CHANGELOG、使用指南、双语架构页、ADR 和发布清单已与现有代码同步；历史版本与已废弃设计保留历史标识。公开 package subpath 保持不变，声明文件目标已适配新目录；TypeDoc 用显式模块名保持公开 API 链接稳定。

## 最终验证

完整 `pnpm run release:verify` 从 2026-09-14 23:55:56 运行至 2026-09-15 00:01:21，退出码 **0**。

- 格式、根项目/公开类型/Examples 类型检查、测试布局、架构、API surface 与 schema 漂移检查通过。
- 生产构建、全部 27 个 package export 目标、bundle smoke 通过。
- 全量 Vitest：3332 passed、56 skipped、0 failed；独立 DuckDB-Wasm：464/464 passed。
- Examples、TypeDoc、中英文文档构建、API/i18n/示例目录检查通过。
- 三浏览器 Playwright、Canvas rendering audit、pack dry-run、生产依赖审计通过。

默认跳过项由独立 DuckDB 测试路径开启；不同测试命令结果不能相加当作唯一用例数。依赖审计仍沿用仓库明确记录的文档工具链临时例外，不等于没有安全告警。

本机原始记录：`/tmp/emap-layout-release-final5.log` 和 `/tmp/emap-layout-release-final5.json`。生成物不作为手工维护源码；执行同一命令可复验。

本次仅整理、验证并提交代码，不发布 npm 包或部署生产环境。
