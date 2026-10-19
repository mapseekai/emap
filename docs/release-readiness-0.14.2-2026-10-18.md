# 0.14.2 发布复核（2026-10-18）

## 版本与授权边界

- npm 官方 registry 的 `latest` 为 `0.14.2`，该版本已于北京时间
  **2026-10-06 09:37:24** 发布；不是待首次发布的版本。
- npm `gitHead`、初始工作树 HEAD、`origin/master` 和远端 `v0.14.2` 标签解引用均为
  `18bef5e7f8adbd7d3b86749faf8bfad52352ea48`。
- 初始工作树干净。本次修复属于 `Unreleased`，保留版本号及已有发布标签。
- 未执行 npm publish、推送、重新打标签或 GitHub Release 写入。
- 本机环境：macOS 15.6.1 arm64，Node.js 22.23.1，pnpm 11.15.1。

依据：[发布清单](release-checklist.md)、[npm 0.14.2 元数据](https://registry.npmjs.org/@mapseekai%2Femap/0.14.2)。

## 已完成的修复

1. `browser:install` 调整为先安装 Firefox/WebKit，再检查 Chrome。旧命令在发现系统
   Chrome 已存在时提前成功返回，遗漏其后的浏览器；已通过缺失 Firefox 的 GPU 预检复现。
   修复命令成功安装所需浏览器，现有 Chrome 未被强制重装。
2. 为 CHANGELOG 补齐 0.14.1、0.14.2 比较链接，并将 Unreleased 比较基点改为 0.14.2。
3. 以父依赖范围限定四个工具链版本，解除五条新增审计阻塞；未修改审计豁免列表。

| 依赖范围 | 原版本 | 固定版本 | 阻塞公告 |
| --- | --- | --- | --- |
| `express > proxy-addr` | 2.0.7 | 2.0.8 | [GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h) |
| `webpack-dev-server > compression` | 1.8.1 | 1.8.2 | [GHSA-vc2v-76pw-4v95](https://github.com/advisories/GHSA-vc2v-76pw-4v95) |
| `@docusaurus/core > tinypool` | 1.1.1 | 2.1.2 | [GHSA-5gmw-xhrv-c9v3](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3)、[GHSA-85c8-ppgw-ccpr](https://github.com/advisories/GHSA-85c8-ppgw-ccpr) |
| `launch-editor > shell-quote` | 1.10.0 | 1.11.0 | [GHSA-pqg4-j6r4-53mv](https://github.com/advisories/GHSA-pqg4-j6r4-53mv) |

Tinypool 另通过 Docusaurus 使用的 worker options、`workerData` 和 worker state 兼容性断言。
最终 frozen-lockfile 安装通过。

## 发布包检查

- 下载 npm 原始 tarball 并核对 registry 声明的 SHA-512 完整性：通过。
- npm 包与本地生产包均为 **985 个文件**；本地 **37 个 export 目标**和 **81 处相对模块引用**均存在。
- Worker、CSS、声明、SQL WASM、MSDF 资源均包含；未混入源码目录、测试、node_modules、环境文件或 sourcemap。
- 两个包的运行时代码在归一化构建目录字符串及其派生的 SQL.js chunk 文件名后完全一致。
  依赖中的构建机绝对路径使原始 tarball 不能逐字节复现，未将归一化比较描述为字节一致。
- 其余差异是本次 CHANGELOG/安装脚本修正，以及 pnpm 打包时移除的
  `packageManager` / `prepublishOnly` 字段；未改变公共 API 或版本。
- 最终本地 tarball 的 SHA-256：
  `ed4e41792c34a8c6b4013853beb56057a5036d1b581ef2e5aa5a3e3ae01e2423`。
  此包用于本地复核，不能覆盖 npm 上已发布的同名版本。

## 验证记录

完整 `pnpm run release:verify`：**通过，退出码 0**。包含完整本地门禁、Playwright 和三浏览器像素检查。

- 最终锁文件下源码、类型、导出、架构、能力、构建及文档检查通过。
- 单元测试：4,414 通过，56 跳过；DuckDB-Wasm 集成：464 通过。
- 首轮曾有一个 5 秒超时；该用例单独复跑 146ms 通过，后续完整单元套件通过，未放宽超时或断言。
- release checklist 现有回归测试：20 通过。
- 新依赖修复后的生产审计通过，沿用原有、到期日为 **2026-12-31** 的文档工具链临时豁免。
  该结果不表示审计零告警；当次报告仍有 878 条已允许的文档依赖路径。

## 浏览器与导航证据

- Chrome 155.0.8059.40、Playwright Firefox 156.0（revision 1554）、
  Playwright WebKit 26.6（revision 2369）。
- GPU 预检：三者 WebGL2 均正确读回红色像素；Chrome/Firefox WebGPU 创建 adapter/device，
  纹理与 canvas snapshot 均正确读回绿色像素。WebKit 无 WebGPU adapter，按现有发布范围验收。
- 0.14.2 核心导航恢复回归：199 个带标签点、20 个隐藏图层；Chrome/Firefox 的
  Canvas2D/WebGL2/WebGPU，以及 WebKit 的 Canvas2D/WebGL2，共 **8 项通过**。
- Ego Browser 手工流程：中文第一张地图 → 语言切换到同一路由的英文页面；
  `container` 参数 → 静态 API 的有效锚点；两种语言分别进入 GeoJSON 示例、加载默认 fixture、
  通过返回文档链接回到原语言，全部通过。已保存地图截图并关闭临时浏览器任务。
- 最终生产构建的 Chrome/Firefox/WebKit 导航复核：**3 项通过**。每个浏览器均完成两种语言的
  第一张地图 → API 参数锚点 → GeoJSON 示例 → 原语言文档往返，且无 pageerror。
- 完整 Playwright：**945 通过、288 跳过、0 失败**；三浏览器 Canvas 像素检查各 11 项，共 **33 项通过**。
  外部大型 TIFF/向量数据目录及恢复测试 TIFF 路径未提供，相关既有用例按原规则跳过；
  另有既有平台、WebGPU 恢复/缓存及 GC 检测条件的跳过。未以合成数据冒充真实数据验收。
- 4173 端口复用了当前仓库已有的 Vite preview。已确认进程工作目录，并核对其返回的
  HTML、JavaScript、CSS 共 5 个文件与最终构建字节一致。

| 浏览器 | 通过 | 跳过 | 失败 |
| --- | ---: | ---: | ---: |
| Chrome | 344 | 108 | 0 |
| Firefox | 337 | 115 | 0 |
| WebKit | 264 | 65 | 0 |

未将 Playwright WebKit 等同于原生 Safari 验收；原生 Safari/WebGPU 与跨平台、最低 Node 精确版本矩阵未在本机补测。

## 本地证据

原始日志、npm tarball、本地 tarball、文件哈希比较和导航证据保存在：

```text
/private/tmp/emap-release-0.14.2-20261018/
```

主要文件：`npm-metadata.json`、`package-check.json`、`package-comparison.json`、
`package-normalized-comparison.json`、`browser-gpu-final.log`、`release-verify-complete.log`、
`audit-before.json`、`audit-after.log`、`tinypool-compat.log`、`geojson-viewer.png`、
`browser-summary.json`、`pixel-check.json`、`docs-flow.log`、`navigation-recovery-check.log`、
`preview-server-check.json`。
