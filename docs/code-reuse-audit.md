# Ponytail 复用、类型边界与命名排查

## 范围与判断标准

本轮检查浏览器端 emap 的源码职责、共享规则、测试工具和文件命名。运行负载按单个浏览器工作区、
大规模矢量/栅格数据、异步 Worker 和可撤销编辑处理，不套用服务端数据库或微服务架构。

采用官方 [Ponytail](https://github.com/DietrichGebert/ponytail/blob/main/skills/ponytail/SKILL.md)、
[audit](https://github.com/DietrichGebert/ponytail/blob/main/skills/ponytail-audit/SKILL.md) 和
[review](https://github.com/DietrichGebert/ponytail/blob/main/skills/ponytail-review/SKILL.md)
的判断顺序：正确、安全、可测试，再减少重复。没有全局安装插件或新增项目依赖。

这是按风险深入的审查，不是每行源码已证明正确的认证。先通过 GitNexus 找职责和调用链，
再对照源码、文本引用和可执行反例；图中的 UNKNOWN 不作为“未使用”的证据。

## 五轮对抗流程

| 回合 | 工作 | 反向检查 |
| --- | --- | --- |
| 1. 独立盘点 | 分别检查 domain/engine、runtime/integrations、工具链、目录命名；另用 TypeScript AST 查找完全相同的函数体 | 区分重复规则与仅仅长得相似的生命周期 |
| 2. 候选反证 | 独立检查兼容性、公开参数契约、错误消息、通配符、取消原因、稀疏路径 | 撤回不能成立的布局漏检和字段语法统一建议 |
| 3. 先复现再实施 | 新增失败回归；修正规则、抽取路径吸附逻辑、整理测试工具 | 保留空列表、取消原因、阈值和原操作策略 |
| 4. 独立反向审查 | 审查已修改代码及连接调用方，不只看 diff | 对抗取消时序、错误优先级、几何边界和迁移遗漏 |
| 5. 整体验证 | 合并后复查引用、类型、架构、构建和完整测试 | 确认组合修改没有引入新边界或公开 API 漂移 |

最终检查结果记录在文末。

## 已确认并修正的问题

### 1. 可选字段列表的错误类型绕过了共享校验

原有共享校验在 `Array.isArray()` 前读取 `.length`，把 `''` 和 `{ length: 0 }` 当作合法空列表；
带 getter 的对象还可能在类型判断前执行 getter。部分操作又在调用校验器前检查非空长度，
导致错误类型完全跳过校验，以“没有指定字段”的方式继续执行命令。

修复统一在现有 [`validateFieldList`](../src/engine/map/ops/_fields.ts#L14)：

- 输入使用 `unknown`，先处理原先允许的 nullish 值，再判断数组类型，再检查元素。
- dissolve、divide、join、union 在原有校验位置始终调用共享规则，不再用真假值或长度跳过它。
- 保留 source/target/divider、表达式许可和互斥参数的原先错误优先级。
- `undefined`、`null`、`[]` 仍表示未指定；空结果仍不写入命令选项。
- 不改变字段名语法、不改 `filterFields` 的 `'*'` selector。

复现与回归见 [`_fields.test.ts`](../src/engine/map/ops/_fields.test.ts#L4) 和
[`field-validation.test.ts`](../test/integration/operations/field-validation.test.ts#L14)。
旧实现运行新增用例有 8 项失败，证明测试确实能暴露问题。

### 2. 取消等待未保留显式的 `null` 原因，MapLibre 重复实现等待

`AbortController.abort(null)` 是合法的调用。原共享 helper 用 `??` 替换原因，
调用方得到的是新建 `AbortError` 而不是 `null`。

[`awaitWithSignal`](../src/shared/await-with-signal.ts#L16) 现在仅在原因为 `undefined` 时回退，
保留 `null`、`false`、`0` 等显式值；取消后清空 settlement cell、移除监听器的机制保持不变。
新增 null 回归在旧 helper 上失败；原 MapLibre 的三阶段 null 行为先被测试锁定。

[`loadMapLibreStyle`](../src/integrations/maplibre/maplibre-overlay-style.ts#L186) 的 transform、
fetch、JSON 三阶段改用现有 helper，不再各自通过 `Promise.race` 等待一个手写中断 Promise。
内部 controller、超时、Fetch signal 传递、外部原因转发和原错误消息转换仍保留。

这不是浏览器 heap/GC 测量结论。可取消消费者不再被 producer reaction 引用的判断来自
原有 detachable-cell 结构及代码审查，监听器余额测试不等价于堆内存证明。

### 3. split / reshape 的路径几何规则重复维护

两处弧数据完整性校验完全相同，路径 arc ID 收集和顶点/边吸附也重复维护。
抽取到内部 [`path-snap.ts`](../src/engine/core/handlers/path-snap.ts#L13)，
由 [reshape](../src/engine/core/handlers/reshape-feature.ts#L137) 和
[split](../src/engine/core/handlers/split-feature.ts#L201) 复用。
范围仅包括稳定的几何规则，不合并 Handler、选择上下文或生命周期。

需要保留的差异：

- split 先检查选择的几何类型和 segment API；缺失条件时不能吸附。
- reshape 没有选择也可以画线；缺少 segment API 时仍可使用顶点吸附。
- 相等距离时顶点优先，距离阈值保持严格小于；反向 arc、有限坐标和数组边界继续校验。
- ring / part 的单选、vertex-only 策略保持原样，不因本次提取被收紧。

### 4. 共享测试工具的职责和位置不一致

将仅供测试使用的 helper 集中到现有 `test/utils/`，保持导出符号和实现不变：

| 原路径 | 新路径 |
| --- | --- |
| `src/integrations/arrow/test-utils.ts` | [`test/utils/arrow.ts`](../test/utils/arrow.ts#L1) |
| `src/engine/map/ops/_test-helpers.ts` | [`test/utils/map-ops.ts`](../test/utils/map-ops.ts#L1) |
| `test/helpers/tasklane-worker.ts` | [`test/utils/tasklane-worker.ts`](../test/utils/tasklane-worker.ts#L1) |

这避免浏览器生产源码目录包含 Node 文件读取测试工具，也消除 `helpers` / `utils`
两处寻找同类测试支持的成本。原构建从公开 entry 生成声明，未发现这些 helper 已进入发布产物，
因此不把本次迁移描述成修复既有的 bundle 泄露。colocated 单测没有移动。
同步更新了 38 个引用文件；独立审查确认 helper 除 import 路径及其格式外内容不变，
没有公开 export、配置、动态路径或旧 import 残留。

## 反证后没有机械修改的候选

| 候选 | 不直接合并的原因 |
| --- | --- |
| `filterFields` 套普通字段名校验 | 公开支持 `['*']`；普通 validator 拒绝 `'*'`，会破坏合法 selector |
| rename/data-fill 直接收紧到另一套字段语法 | 公开参数已有不同约束；没有把语法差异夸大成已证实的 CLI 注入 |
| 测试布局的复合后缀漏检 | `.integration.test.ts` 无配对实现会失败；有配对实现时 `.integration.ts` 本身会被现有规则拒绝，实测推翻初判 |
| GeoPackage 直接换通用输入上限断言 | 配置已统一校验；直接替换会改变现有错误消息，不为两处比较增加可配置消息层 |
| TypeDoc 与 checker 直接共用 front matter 解析 | 重复键分别取首值和末值；畸形列表行为也不同，不把相似代码当成同一契约 |
| 合并所有 Worker client | 协议、资源所有权和结果提交策略不同 |
| 合并单源与多源编辑 runner | 多源操作需要不同的锁定、原子回滚和验证范围 |
| 全仓替换 `any` 或抽象所有 Provider | 第三方/Worker 边界已有明确 lint 例外；不能靠把断言移到调用点制造类型安全的表象 |

上述内容是被反证或不适合直接等同的候选，不是声称已经修复的缺陷。未向外部 issue 系统写入数据。

## 文件夹、文件与 TypeScript 命名结论

TypeScript 官方的 [coding guidelines](https://github.com/microsoft/TypeScript/wiki/Coding-guidelines)
是编译器项目自身的约定，不是要求所有 TS 应用采用同一种文件名的语言标准。
本项目以既有规则和公开路径兼容性为准：

- 保留 `domain`、`engine`、`runtime`、`integrations`、`ui`、`shared` 六个职责区。
- 普通模块和目录延续清晰的 `kebab-case`；类型使用 PascalCase，函数和局部变量使用 camelCase。
- 保留 `index.ts` 入口、`.d.ts` 声明、现有内部 `_*.ts` 分组习惯，不做纯偏好改名。
- 共享测试工具按能力命名，放入 `test/utils/`；单元测试继续与实现同名、同目录，仅增加 `.test`。
- 保留 Playwright 的 `.spec.mjs`、类型契约的 `.test-d.ts`，不要混淆套件职责。
- 保留 Docusaurus 的 `MDXComponents/A/index.tsx` 等框架约定路径，以及包的公开子路径和文档 URL。
- 不因为文件长就拆分；只在真实职责不同或多处共同变化的规则重复时提取。
- 不把 class 私有字段、第三方字段、序列化字段的大范围改名当作“标准 TS”优化。

对 `src/`、`test/`、`scripts/` 的只读命名盘点未发现大小写不敏感的路径冲突；
`src/` 普通 TypeScript 文件与目录符合现有命名惯例。没有为该盘点新增独立命名框架或门禁。

## 验证记录

基线通过 `pnpm run typecheck`、`pnpm run test-layout:check`、`pnpm run architecture:check`、
`pnpm run lint`、`pnpm run build` 和 `pnpm run test:run`。
基线完整测试为 316 个文件通过、1 个文件跳过；4473 项通过、56 项跳过。

最终合并后在父工作区完成：

| 命令 | 结果 |
| --- | --- |
| `pnpm run typecheck` | 通过 |
| `pnpm run typecheck:tests` | 通过 |
| `pnpm run typecheck:contracts` | 通过 |
| `pnpm run test-layout:check` | 通过，241 个 colocated 单测 |
| `pnpm run architecture:check` | 通过，534 个模块，无 runtime cycles |
| `pnpm run api:check-surface` | 通过，根入口和全部公开子入口通过检查 |
| `pnpm run capabilities:check` | 通过，生成 schema 无漂移 |
| `pnpm run lint` | 通过，包含 Biome 和类型感知 ESLint |
| `pnpm run format:check` | 通过 |
| `pnpm run build` | 通过，全部 Rollup entry、声明和 MSDF worker |
| `pnpm run bundle:smoke` | 通过，11 个必需文件、36 个 export targets |
| `pnpm run test:run` | 318 个文件通过、1 个文件跳过；4526 项通过、56 项跳过 |
| `pnpm run test:duckdb` | 显式启用 DuckDB-Wasm 集成，21 个文件、466 项全部通过 |
| `git diff --check` | 通过 |

并发阶段的部分 typecheck/build/test 曾超时；之后串行重跑完成，未放宽测试用例的 timeout。
格式检查发现迁移后一个较长 import 需要换行，修正并重跑通过。没有隐藏失败结果或将超时当成通过。

独立反向审查还包含 46 项取消时序和 69 项字段边界检查，均通过。这些是读取源码的临时验证，
不是新增的持久化测试数量。第 5 轮审查另运行 6 个路径相关测试文件，90 项通过，
并核对 helper 迁移的引用解析和实现一致性。

最终重新建立当前工作区 GitNexus 索引，并运行 `detect-changes --scope all --limit 2000`。
为让工具看到未跟踪的新文件，使用 scratch 中的临时 Git index，未修改工作区真实 index。
检测映射到 57 个文件、56 个符号、4 条执行流，风险 MEDIUM，未报告 partial/truncated。
索引器本身仍有默认执行流数量及动态派发的覆盖边界；图分析不代替全树引用核对和测试证据。

未运行真实浏览器/GPU 交互、heap/GC 测量、性能基准、`pnpm run docs:verify` 或完整发布门禁
`pnpm run release:verify`。本轮没有修改产品文档、公开 API 或示例，新增的是这份维护排查报告；
没有执行 commit、共享分支合并、推送或发布。

依赖安装提示 `apache-arrow` 的 `arrow2csv` bin 缺失；本轮未测试该 CLI，也未修改依赖或锁文件。
可用 `pnpm install --frozen-lockfile` 复现该安装提示。相关 Arrow 库和 DuckDB-Wasm 测试均通过，
不能由此宣称 CLI 可用。当前未接入 Multica，也没有对外写 issue 的授权，因此仅在此记录该外部依赖提醒。
