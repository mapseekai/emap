# 依赖库问题自动反馈规范（emap）

## 生效与授权

每项任务开始前，从 `git rev-parse --show-toplevel` 返回的本仓库根目录完整读取本文件和 [dependencies.toml](dependencies.toml)，在开发、集成、调试、测试和功能实现的全过程主动执行。进入子目录不改变规则路径。上下文压缩后若规则已不可见，应重读；配置或依赖变化后应重新核验。

用户已授权：通过现有 `multica` CLI 向正确的依赖项目创建有依据的 Bug、API 不足或能力需求 Issue，以及添加必要的新证据评论；确认缺失且归属明确时补齐必要项目和 GitHub 资源关联。该授权不要求逐次提醒或再次批准，也不取代主机权限控制。复用全局 Multica、代码导航、文档查询和测试规范及适用 Skills。

只读分析依赖源码；不改依赖仓库、`node_modules`、vendor，不生成或扩展依赖补丁。已有补丁是版本环境的一部分，需要注明，不在本流程中修改。不自动分配、启动或重跑其他 Agent；不使用 assignee、agent、squad、rerun、autopilot 等动作推动上游修复。反馈后继续本项目任务，必要时在当前项目的授权范围内做小范围绕行。不得因等待上游而停下独立工作。

这是任务内的主动行为规范，没有后台监控进程。发现漏洞时遵循本仓库 `SECURITY.md` 的私密报告途径；此处的普通 Issue 授权不覆盖公开披露或另行发送安全报告。

## 判断根因与目标

1. 先排除本项目调用、参数、配置、版本兼容、错误使用生命周期及已有 API 被遗漏等问题。阅读实际安装版本的类型、实现、官方文档和已有测试；文档查询遵循当前 Context7 规范。未经执行的推断要标为静态分析，不能写成已复现。
2. 对依赖 Bug 提供可独立复现的失败；对缺失能力描述具体场景、现有 API 为什么不足及验收条件。尚不清楚根因时继续缩小复现，不把猜测作为确定缺陷提交。
3. 通用渲染、几何编辑、CRS、数据处理和生命周期能力优先归属提供这些能力的底层库，避免在每个应用中复制实现。**本仓库本身就是 eMAP**：`@mapseekai/emap` 及 `packages/examples` 的 workspace 引用属于本项目，eMAP 核心或本地适配问题按当前任务处理并使用 emap 项目跟踪，不能虚构为外部依赖。
4. 按调用链区分引擎核心、本地 `src/integrations` / 插件适配和更下层依赖。例如 Worker 队列自身问题可能归 tasklane，EPSG 数据问题可能归 epsg-index，投影算法问题需区分实际调用的 mproj/proj4，渲染后端问题需区分 eMAP 与 luma.gl。仅因某包出现在栈中不足以归责。外部插件只有实际参与复现时才补入映射；本次没有安装的其他项目包不照搬进来。
5. 一个根因原则上只开一个 Issue。跨层问题在主根因 Issue 中说明各层责任并链接相关记录；只有独立、可验收的根因才分别开单。

## 依赖与绑定核验

`dependencies.toml` 是人工可读的路由快照，不是 Codex 原生配置或自动 include。它覆盖所有直接声明的外部包、workspace 包和本次在直接/间接依赖中发现的自有包；其余间接依赖遇到问题时按相同步骤补齐，不把未列入映射解释为不需要反馈。

- 每次反馈记录 manifest 范围、锁文件解析值、实际安装版本、触发调用者到该版本的依赖链及必要的 peer/patch 信息。使用 `rtk proxy pnpm list --recursive --depth Infinity --json`、`pnpm why <包名> --recursive`、锁文件及实际解析路径下的 `package.json` 交叉核对。实际安装目录优先于顶层包链接；同包多版本分别记录，不能把锁文件中的未安装平台可选包称为已运行版本。
- `@zwishing` / `@mapseekai` scope 和 GitHub owner 只是发现线索。核对已安装元数据、发布来源、GitHub 当前仓库 ID、重定向、fork 的 parent/source。例如 `@zwishing/epsg-index@3.0.0` 指向的旧地址已迁移到 `mapseekai/epsg-index`，其 parent 是 `derhuerst/epsg-index`，旧 homepage 不能用作提交目标。
- `dependencies.<包>.target` 指向 `targets` 中已核验的路由。每次操作仍应显式传 `--workspace-id`，提交/列表显式传 `--project`。获取项目及 `github_repo` 资源，核对工作区、项目 ID、规范仓库地址及迁移关系；不依赖 CLI 当前默认工作区或名称模糊匹配。
- 未设置 `target` 表示**尚无已确认的 Multica 项目绑定**，不是默认为 emap。搜索已授权工作区全部项目，包括不同状态/旧名称，并读取资源按规范仓库 URL 比对。当前 CLI 的 `project list` 和 `project resource list` 返回数组且无分页参数；升级后遵循实际帮助与响应，遇到截断或完整性不明则停止写入，保留草稿。
- 确认缺失、仓库归属明确且确有问题需要交接时，可在已授权工作区创建必要依赖项目并 `--repo` 关联；已有项目仅缺关联则添加资源，迁移则更新对应资源，避免重复项目/资源。第三方项目是本工作区的依赖跟踪目标，不表示外部维护者已入驻。其他工作区、目标歧义或无法确认来源时记录缺口，不猜 ID、地址，也不擅自转发 GitHub Issue。

以下示例中的 `DF_WS`、`DF_PROJECT`、`DF_REPO`、`DF_ISSUE`、`DF_BODY` 必须从已核验映射/响应及本地草稿取得；不是待照抄的默认值。先查当前 CLI `--help`，不要为了匹配示例升级或安装替代工具。

```sh
rtk proxy multica --workspace-id "$DF_WS" project list --output json
rtk proxy multica --workspace-id "$DF_WS" project get "$DF_PROJECT" --output json
rtk proxy multica --workspace-id "$DF_WS" project resource list "$DF_PROJECT" --output json
# 仅在上述核验确认必要且缺失时执行其中一种：
rtk proxy multica --workspace-id "$DF_WS" project create --title "$DF_TITLE" --repo "$DF_REPO" --output json
rtk proxy multica --workspace-id "$DF_WS" project resource add "$DF_PROJECT" --type github_repo --url "$DF_REPO" --output json
```

## 提交前查重（按实测 Multica 0.3.38）

1. 在正确工作区，用包名（含旧 scope）、API/符号名、错误原文和中英文症状关键词分开搜索，始终加 `--include-closed`。返回 JSON 是 `{ "issues": [...] }`。当前 `issue search` **没有 `--project` 或 offset/cursor 参数**：保存完整结果，在本地按 `project_id` 精确筛选；跨项目同根因记录也应查看，不擅自移动它们。
2. 搜索 `--limit` 只限制返回量，不能证明无重复。无论是否命中，都补充 `issue list --project` 的完整分页，且不加状态过滤，以覆盖开放、done、cancelled 等所有状态。返回 `{issues, has_more, limit, offset, total}`；下一页使用响应 `offset + limit`，一直到 `has_more=false`。按 Issue ID 去重，核对唯一数量与 `total`；分页过程中数量漂移、重复/缺页或空页仍声称有下一页时重新读取，不能把截断结果当作“无重复”。
3. 本地检索完整标题/正文，再 `issue get` 读取候选详情及必要评论。当前评论列表可折叠已解决线程；需历史证据时使用 `--full`，不要用 `--summary` 作为完整证据。若使用 `--recent` / `--thread --tail`，必须按实际返回的 `before` 和 `before-id` 成对分页；拿不到游标就不能声称看完历史。
4. 同根因复用现有 Issue，关闭的也应先确认修复版本、回归或需求差异。只有新的复现、环境、影响或验收证据才评论，不重复贴相同内容或仅发“催进度”。不自动改状态、分配人员或唤醒 Agent。已有标签优先复用；标签操作先查 CLI 帮助。
5. 建单保留 CLI 默认重复检查，**不使用 `--allow-duplicate`**。若默认检查拒绝，应查看其指向的问题；不能绕过拒绝强行建单。

```sh
rtk proxy multica --workspace-id "$DF_WS" issue search "$DF_QUERY" --include-closed --limit 100 --output json
rtk proxy multica --workspace-id "$DF_WS" issue list --project "$DF_PROJECT" --limit 100 --offset 0 --output json
# 按返回 has_more / offset / limit 继续取后续页，再逐项核对候选：
rtk proxy multica --workspace-id "$DF_WS" issue get "$DF_ISSUE" --output json
rtk proxy multica --workspace-id "$DF_WS" issue comment list "$DF_ISSUE" --full --output json
```

## 可交接正文与提交

正文写入 UTF-8 文件，使用 `--description-file`；评论使用 `--content-file`，不用命令行内联多行正文。保存经过脱敏的最小合成样本和必要日志，不上传凭据、token、连接串、私有业务数据或整份无关调试输出。源代码位置使用提交 SHA + 仓库相对路径 + 行号，未提交内容明确标记。

每份 Issue 至少包含以下信息，未知项写明未知及原因：

```markdown
# 问题 / 能力需求
类型：Bug / API 不足 / 功能缺失 / 通用能力
描述、用户影响、触发条件及严重程度：
归属理由：已排除的调用/配置/版本问题；核心/适配/底层的证据：

## 来源和环境
来源项目：emap，https://github.com/mapseekai/emap
来源提交 SHA / 分支；工作区 clean/dirty；相关修改已提交/未提交：
目标 GitHub 仓库（规范地址、fork/迁移关系）：
目标 Multica workspace ID / project ID：
包名、声明范围、锁定版本、实际安装版本（可多个）及触发依赖链：
现有 patch/override；OS/架构、Node/pnpm、浏览器/DPR/GPU/Worker 等相关环境：

## 最小复现或需求场景
前置条件和最小数据；步骤/命令；现有 API 的限制：
实际结果；精确错误/日志；已执行的测试及结果：
源码 / 测试文件:行号；未执行验证及原因（静态推断单独注明）：

## 预期和验收
预期行为或具体 API 能力：
其他 Agent 可验证的验收条件及回归边界：

## 查重与本项目进展
查询时间、关键词、workspace/project、搜索 limit、完整列表分页/total 核对：
候选/相关 Issue ID 和已核实链接；复用或排除原因：
本项目绕行方案、约束、当前阻塞点和可继续工作：
```

```sh
rtk proxy multica --workspace-id "$DF_WS" issue create --project "$DF_PROJECT" --title "$DF_TITLE" --description-file "$DF_BODY" --output json
# 评论命令无 --project：先用 issue get 核实其 project_id，再评论。
rtk proxy multica --workspace-id "$DF_WS" issue comment add "$DF_ISSUE" --content-file "$DF_BODY" --output json
```

提交后立即 `issue get` 核对 `workspace_id`、`project_id`、正文、标识及目标仓库；评论后回读新增评论。报告真实 identifier / UUID 和已核实的链接，区分已创建、复用、仅保存草稿。CLI 未返回 Web URL 时从已配置 Multica 实例的实际 Issue 页面/已验证链接格式取得；无法核实则明确注明链接尚未取得，不编造。

任何创建/评论/项目绑定响应不明确或超时，先按标题、正文特征、时间及目标重新查询，确认是否成功；未确认前不重试写入，避免生成重复。创建后发现目标不符时停止进一步写入并报告，不擅自删除或移动记录。

## 失败留档与继续开发

网络、认证、权限、查重或目标绑定失败时，在仓库已忽略的 `.agent/dependency-feedback/pending/` 保存完整 UTF-8 草稿（文件名建议 UTC 时间 + 包名 + 简短主题）。先用 `git check-ignore -v` 核验目录仍被忽略；不要为此改 `.gitignore`。若目录不再被忽略/不可写，使用主机允许的临时目录并在任务报告说明实际路径。

在草稿附录记录失败时间、脱敏命令/错误、已完成查重证据、目标映射/具体缺口、是否处于“创建结果未知”、可能的 identifier 及下一步；完整待提交正文不能仅留一句摘要。报告阻塞并继续独立工作，不改凭据、扩大权限、安装替代工具或新建 HTTP 客户端来绕过失败。

后续任务开始时检查 pending，只在相关且可安全推进时重试；必须重新核验依赖、绑定并重新查重，不能复用旧“无重复”结论。成功后记录真实 ID/链接/回读结果，将该草稿移到同一忽略目录下的 `submitted/`，避免再提交。没有真实问题时不创建演示或验证 Issue。

## 启用、维护与验证边界

- 在当前项目根目录或其子目录新开 Codex 项目会话即可加载入口；已运行会话不能据此假定热更新。项目必须处于受信任状态，本规则不更改信任、权限、模型、凭据或全局配置。
- [官方配置参考](https://learn.chatgpt.com/docs/config-file/config-reference) 将 `developer_instructions` 定义为额外 developer 指令。[配置优先级](https://learn.chatgpt.com/docs/config-file/config-basic) 说明可信项目 `.codex/config.toml` 的加载和子目录覆盖。入口是 TOML 字符串中的阅读指令，Markdown 路径不是 TOML include；不使用替换内置指令的 `model_instructions_file`。
- 本次初始项目没有 `developer_instructions`。以后新增规则要合并到现有字符串，保留其他键。更近的子目录配置、命令行覆盖或同名上层规则可能改变有效内容；不能假定跨层字符串自动拼接。
- 变更 manifest/锁文件、升级依赖、迁移仓库或调整 Multica 绑定后，更新映射中的版本、来源证据、目标和核验日期。扫描直接及间接依赖的 scope 和仓库 owner；区分未安装的 optional 包、workspace、外部插件及已有补丁。映射中未绑定的第三方依赖在实际问题出现时先补齐已确认路由。
- 已核验 Codex CLI **0.162.1** 支持 `codex debug prompt-input`；在根目录与实际子目录 `packages/examples` 分别运行，解析 JSON，断言 role 为 `developer` 的消息包含完整入口字符串。该命令不调用模型，不会自动读取入口指向的文件，也不测试在线 Issue 写入；`--strict-config` 当前不支持 `codex debug`，不要组合使用。
- **入口已注入 ≠ 模型已实际读取并执行规则**。要验证后者，应在新项目会话中观察读取两份文件的工具记录及具体任务里的归属/查重/留档行为；不为验证启动上游 Agent 或创建无意义 Issue。本次只运行加载诊断、格式/覆盖检查及 Multica 只读查询，并核验必要的仓库关联更新。

```sh
# 从 emap 根目录执行；不使用 -c 覆盖来伪造加载成功：
rtk proxy codex debug prompt-input
# 在 packages/examples 作为当前目录执行同一命令。
```
