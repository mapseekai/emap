# 统一可运行示例实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `test/examples` 中的交互示例迁移为文档站唯一实现，使每个示例打开即加载本地数据、继续支持上传，并统一修复 CDN/本地资源、公开路由和单站预览。

**Architecture:** `packages/examples/examples/<id>/index.html` 是唯一示例页面；共享 runtime 按环境加载本地或精确版本 CDN 的核心 IIFE/CSS，fixtures 与 Worker 永远同源。Vite 负责可选 Formats/DuckDB 模块和开发路由，构建规范化脚本把物理 `dist/examples/<id>` 平铺为公开 `dist/<id>`，Docusaurus 只组合这一份最终产物。

**Tech Stack:** TypeScript、Vite 7、Vitest 4、Docusaurus 3、HTML5 File/DataTransfer API、Node.js 构建脚本。

## Global Constraints

- 不新增运行时或前端框架依赖。
- 公开示例 URL 必须保持 `/emap/examples/<id>/`。
- 本地开发与 `docs:preview` 默认使用当前工作区构建，不依赖 CDN。
- CDN 模式只允许精确的 `package.json` 版本，禁止 `latest` 或版本范围，并必须验证 SRI。
- fixtures 与 `emap-worker.js` 必须保持本地同源。
- Formats 与 DuckDB 继续由 Vite 处理，不直接加载原始 jsDelivr ESM。
- 迁移后的示例必须自动显示地图和数据，同时保留用户上传入口。
- 不修改 `emap` 公共 API、地图操作语义或示例界面布局。
- 保留当前工作区中与本任务无关的文档和 `pnpm-workspace.yaml` 修改。
- 修改任何已有函数前，先运行 GitNexus upstream impact；HIGH/CRITICAL 必须暂停并告知用户。
- 提交前运行 GitNexus `detect_changes --scope compare --base-ref 0fca2a3`；若索引不可用，先执行 `npx gitnexus analyze`。

---

## 文件结构与职责

- `docs-meta/examples.ts`：只保存示例元数据、路由、fixture 和文档/API 关联，不包含地图运行实现。
- `packages/examples/src/catalog.ts`：渲染 catalog 并生成真实公开链接。
- `packages/examples/src/main.ts`：只启动 catalog。
- `packages/examples/src/runtime-assets.ts`：计算 local/CDN/fallback 资源 URL 与 SRI 配置。
- `packages/examples/src/example-runtime.ts`：按顺序加载核心资源并提供 fixture 自动注入。
- `packages/examples/src/fixture-manifest.ts`：示例 ID 到输入框/fixture 的声明式映射。
- `packages/examples/build/runtime-assets-plugin.ts`：Vite dev 中提供本地 runtime，build 中输出 vendor/worker 文件并定义版本/SRI 常量。
- `scripts/normalize-examples-build.mjs`：把 Vite 的嵌套示例产物平铺到公开目录。
- `scripts/check-example-cdn.mjs`：CDN 发布模式下验证精确版本文件和 SRI。
- `scripts/compose-docs-release.mjs`：将已经规范化的 examples 复制进 Docusaurus build。
- `packages/examples/examples/<id>/index.html`：每个示例唯一的页面、控件和操作代码。
- `test/docs/example-catalog.test.ts`：静态元数据、页面覆盖、上传入口和迁移完整性。
- `test/docs/example-runtime.test.ts`：runtime 资源选择、回退、fixture URL 和自动上传。
- `test/docs/examples-build.test.ts`：路由规范化和 CDN 校验脚本。
- `test/docs/release-checklist.test.ts`：组合产物与统一预览契约。

---

### Task 1: 建立 GitNexus 基线和静态示例契约

**Files:**
- Modify: `test/docs/example-catalog.test.ts`
- Read: `docs-meta/examples.ts`
- Read: `packages/examples/src/catalog.ts`
- Read: `packages/examples/src/main.ts`

**Interfaces:**
- Consumes: 当前 `examples: readonly ExampleDefinition[]`。
- Produces: Task 2 必须满足的 metadata-only 与真实 catalog 链接契约。

- [ ] **Step 1: 恢复 GitNexus 索引并记录修改符号的 upstream impact**

Run:

```bash
npx gitnexus status
npx gitnexus analyze
npx gitnexus impact renderCatalog --direction upstream --include-tests
npx gitnexus impact render --file packages/examples/src/main.ts --direction upstream --include-tests
npx gitnexus impact loadFixtureBytes --direction upstream --include-tests
npx gitnexus impact loadFixture --direction upstream --include-tests
```

Expected: 索引识别当前仓库；impact 输出调用者、流程和风险。若风险为 HIGH/CRITICAL，停止实现并向用户报告。

- [ ] **Step 2: 写静态契约的失败测试**

将 `test/docs/example-catalog.test.ts` 中依赖 mocked `Emap`、`example.load()` 和 `renderExamplePage()` 的运行时测试替换为 metadata-only 契约，核心断言为：

```ts
expect(example.route).toBe(`/examples/${example.id}/`);
expect(example).not.toHaveProperty('load');
expect(example.source.html).toBe(
  `packages/examples/examples/${example.id}/index.html`,
);
```

五个 getting-started ID 继续使用嵌套路径。保留现有 52 个 ID、双语文字、docs、api、tags、featureFlags、fixtures 和 success 关联；页面存在性、上传入口及 HTML 资源检查在 Task 5 写入并完成 RED/GREEN。

- [ ] **Step 3: 运行测试并确认 RED**

Run:

```bash
npx vitest run test/docs/example-catalog.test.ts --reporter=dot
```

Expected: FAIL，原因包括 `load` 仍存在、source 仍指向 `test/examples`，且 catalog 仍依赖 example-page runtime。

---

### Task 2: 将示例目录元数据改为纯静态数据

**Files:**
- Modify: `docs-meta/examples.ts`
- Modify: `packages/examples/src/catalog.ts`
- Modify: `packages/examples/src/main.ts`
- Delete: `packages/examples/src/example-page.ts`
- Modify: `test/docs/example-catalog.test.ts`

**Interfaces:**
- Consumes: `ExampleDefinition` 的标题、分类、docs、api、fixtures、route 和 success 字段。
- Produces: 不含 `load` 的 `ExampleDefinition`；`examplePublicHref(id: string): string`。

- [ ] **Step 1: 为真实 catalog 链接写失败测试**

```ts
expect(examplePublicHref('buffer')).toBe('/emap/examples/buffer/');
expect(examplePublicHref('getting-started/points')).toBe(
  '/emap/examples/getting-started/points/',
);
```

Catalog DOM 测试断言卡片链接不包含 `#`，且 `href` 等于对应公开 URL。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npx vitest run test/docs/example-catalog.test.ts --reporter=dot`

Expected: FAIL，当前链接是 `#/examples/<id>`。

- [ ] **Step 3: 实现最小静态元数据和链接**

`ExampleDefinition` 保留：

```ts
export interface ExampleDefinition {
  id: string;
  category: string;
  title: LocalizedText;
  description: LocalizedText;
  learningGoals: { zh: readonly string[]; en: readonly string[] };
  docs: readonly string[];
  api: readonly string[];
  tags: readonly string[];
  featureFlags: readonly string[];
  fixtures: readonly string[];
  source: { html: string };
  route: string;
  success: string;
}
```

删除 `docs-meta/examples.ts` 中 `Emap`/control/formats/duckdb imports、seed geometry、`load*`、`setup*`、DOM helper 和 fixture fetch 实现。保留现有 52 个条目的文字与关联字段，将 source 统一生成为：

```ts
const sourceHtml = (id: string) => `packages/examples/examples/${id}/index.html`;
```

Catalog 链接实现：

```ts
export const examplePublicHref = (id: string): string =>
  `/emap/examples/${id.replace(/^\/+|\/+$/g, '')}/`;
```

`main.ts` 只调用 `renderCatalog(root, examples)`；删除 hashchange 与 example-page 分支。

- [ ] **Step 4: 运行静态测试并确认 GREEN**

Run: `npx vitest run test/docs/example-catalog.test.ts --reporter=dot`

Expected: PASS；此时测试只验证 metadata-only 和 catalog 链接，不提前加入 Task 5 的 HTML 迁移断言。

- [ ] **Step 5: 提交元数据简化**

```bash
git add docs-meta/examples.ts packages/examples/src/catalog.ts packages/examples/src/main.ts packages/examples/src/example-page.ts test/docs/example-catalog.test.ts
git commit -m "refactor: make example catalog metadata-only"
```

---

### Task 3: 实现本地优先、CDN 可选的 runtime 资源加载器

**Files:**
- Create: `packages/examples/src/runtime-assets.ts`
- Create: `packages/examples/src/example-runtime.ts`
- Create: `packages/examples/build/runtime-assets-plugin.ts`
- Create: `test/docs/example-runtime.test.ts`
- Modify: `packages/examples/vite.config.ts`

**Interfaces:**
- Produces: `RuntimeAssetSet`、`resolveRuntimeAssets(options)`、`loadExampleRuntime(options?)`、`loadExampleFormats()`、`exampleWorkerUrl()`。
- Consumes: Vite define 常量 `__EMAP_VERSION__`、`__EMAP_ASSET_MODE__`、`__EMAP_ASSET_INTEGRITY__`。

- [ ] **Step 1: 写资源选择与 CDN 回退失败测试**

```ts
expect(resolveRuntimeAssets({ mode: 'local', baseUrl: '/emap/examples/' })).toMatchObject({
  vendor: '/emap/examples/vendor/mapshaper-vendor.js',
  core: '/emap/examples/vendor/emap.js',
  css: '/emap/examples/vendor/emap.css',
  worker: '/emap/examples/emap-worker.js',
});

expect(resolveRuntimeAssets({
  mode: 'cdn',
  baseUrl: '/emap/examples/',
  version: '0.5.0',
})).toMatchObject({
  vendor: 'https://cdn.jsdelivr.net/npm/@zwishing/emap@0.5.0/dist/mapshaper-vendor.js',
  fallbackVendor: '/emap/examples/vendor/mapshaper-vendor.js',
  worker: '/emap/examples/emap-worker.js',
});
```

再通过真实 jsdom `<script>`/`<link>` 元素触发 `error`，断言加载器依次使用 local fallback，且 vendor 成功后才插入 core。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npx vitest run test/docs/example-runtime.test.ts --reporter=dot`

Expected: FAIL，模块尚不存在。

- [ ] **Step 3: 实现 URL 解析和顺序加载**

```ts
export type RuntimeAssetMode = 'local' | 'cdn';

export interface RuntimeAssetSet {
  vendor: string;
  core: string;
  css: string;
  worker: string;
  fallbackVendor?: string;
  fallbackCore?: string;
  fallbackCss?: string;
  integrity: Partial<Record<'vendor' | 'core' | 'css', string>>;
}

export async function loadExampleRuntime(): Promise<typeof globalThis.emap>;
export async function loadExampleFormats(): Promise<typeof import('@zwishing/emap/formats')>;
export function exampleWorkerUrl(): string;
```

禁止 `latest`；CDN 模式缺少 version 或 SRI 时抛出可见错误。script 使用 `crossOrigin = 'anonymous'` 和 `integrity`，失败后只回退一次本地 URL。

- [ ] **Step 4: 实现 Vite runtime asset plugin**

Plugin 在 dev middleware 中只读提供根目录 `dist/mapshaper-vendor.js`、`dist/emap-dev.js`、`dist/emap.css`、`dist/emap-worker.js`；build 时把生产 `emap.js` 等 emit 到 `vendor/`，Worker emit 到根目录。所有目标路径必须显式校验位于仓库 `dist` 和 examples build 内。

- [ ] **Step 5: 运行测试并确认 GREEN**

Run:

```bash
npx vitest run test/docs/example-runtime.test.ts --reporter=dot
npm run typecheck
```

Expected: PASS，无 TypeScript 错误。

- [ ] **Step 6: 提交 runtime loader**

```bash
git add packages/examples/src/runtime-assets.ts packages/examples/src/example-runtime.ts packages/examples/build/runtime-assets-plugin.ts packages/examples/vite.config.ts test/docs/example-runtime.test.ts
git commit -m "feat: load example runtime from local or pinned CDN assets"
```

---

### Task 4: 实现 fixture manifest 和自动上传

**Files:**
- Create: `packages/examples/src/fixture-manifest.ts`
- Modify: `packages/examples/src/example-runtime.ts`
- Modify: `docs-meta/examples.ts`
- Modify: `test/docs/example-runtime.test.ts`
- Create: `packages/examples/public/fixtures/getting-started-geojson-viewer.geojson`
- Create: `packages/examples/public/fixtures/getting-started-points.geojson`
- Create: `packages/examples/public/fixtures/getting-started-lines.geojson`
- Create: `packages/examples/public/fixtures/getting-started-polygons.geojson`
- Create: `packages/examples/public/fixtures/getting-started-polygon-fill.geojson`
- Create: `packages/examples/public/fixtures/example-geoparquet.parquet`

**Interfaces:**
- Produces: `FixtureBinding`、`fixtureManifest`、`fixtureUrl()`、`autoLoadExampleFixtures()`。
- Consumes: catalog fixture metadata和页面现有 file input change handlers。

- [ ] **Step 1: 写 fixture URL 和真实 change 事件失败测试**

```ts
expect(fixtureUrl('fixtures/task-6-polygons.geojson', '/emap/examples/')).toBe(
  '/emap/examples/fixtures/task-6-polygons.geojson',
);
```

jsdom 测试创建真实 `<input type="file">`，注册 `change` listener，mock fetch 返回字节，调用 `autoLoadExampleFixtures()` 后断言 listener 收到具有正确 filename/type/content 的 File。覆盖单文件、multiple 文件、两个 selector 和失败状态文本。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npx vitest run test/docs/example-runtime.test.ts --reporter=dot`

Expected: FAIL，fixture API 尚不存在。

- [ ] **Step 3: 实现 manifest 和自动注入**

```ts
export interface FixtureBinding {
  selector: string;
  paths: readonly string[];
}

export async function autoLoadExampleFixtures(
  id: string,
  root?: Document,
): Promise<void>;
```

默认 selector 为 `#file-input`；DuckDB buffer/query/spatial 使用 `#file`；overlay 分别绑定 `#input-file` 和 `#mask-file`；multiple 示例把所有 path 放入同一个 DataTransfer。Join 除几何文件外还把 CSV fixture 文本写入 `#csv` 并设置可匹配的 key 默认值。

- [ ] **Step 4: 增加入门和 GeoParquet fixture**

五个 GeoJSON fixture 使用现有 seed 数据。GeoParquet fixture 由仓库现有 formats 测试工具生成，必须以 `PAR1` 开头并由测试重新导入验证；不得提交来源不明的二进制文件。

同时把五个 getting-started 条目的 `inline:*` 改为对应本地路径，并让 `geoparquet-viewer` 与 `duckdb-geoparquet-query` 都声明 `fixtures/example-geoparquet.parquet`。其他条目继续复用 Task 6/Task 7 fixtures。

- [ ] **Step 5: 运行测试并确认 GREEN**

Run: `npx vitest run test/docs/example-runtime.test.ts src/formats/geoparquet-io.test.ts --reporter=dot`

Expected: PASS。

- [ ] **Step 6: 提交 fixture runtime**

```bash
git add docs-meta/examples.ts packages/examples/src/fixture-manifest.ts packages/examples/src/example-runtime.ts packages/examples/public/fixtures test/docs/example-runtime.test.ts
git commit -m "feat: auto-load local data through example upload controls"
```

---

### Task 5: 将原始 HTML 迁移为唯一示例页面

**Files:**
- Move: `test/examples/*.html` -> `packages/examples/examples/<id>/index.html`
- Modify: all moved `packages/examples/examples/**/index.html`
- Modify: `test/docs/example-catalog.test.ts`
- Keep: `test/examples/duckdb-new-features.test.ts`
- Keep: `test/examples/duckdb-spatial-ops.test.ts`

**Interfaces:**
- Consumes: `loadExampleRuntime()`、`loadExampleFormats()`、`autoLoadExampleFixtures(id)`、`exampleWorkerUrl()`。
- Produces: 52 个公开页面，每页一个 map surface、一个上传入口和一次初始数据加载。

- [ ] **Step 1: 运行迁移完整性测试并确认 RED**

先向 `test/docs/example-catalog.test.ts` 增加页面完整性断言：

```ts
expect(await fileExists(resolve(example.source.html))).toBe(true);
expect(html).toContain('id="map"');
expect(html).toMatch(/type=["']file["']/);
expect(html).not.toMatch(/\.\.\/\.\.\/(?:dist|src)\//);
expect(html).not.toContain('https://geojson.cn/');
```

Run: `npx vitest run test/docs/example-catalog.test.ts --reporter=dot`

Expected: FAIL，canonical HTML 尚未迁移。

- [ ] **Step 2: 移动五个 getting-started HTML**

按设计映射移动 `geojson-viewer`、`points`、`lines`、`polygons`、`polygon-fill`。其余 HTML 直接移动到同名目录。移动必须保留 Git 历史，不复制后遗留原文件。

- [ ] **Step 3: 移动 Task 6 数据与交互 HTML**

移动 `attribute-editing` 到 `vertex-editing` 的 26 个 Task 6 页面。`china-editing` 删除两个外部 geojson.cn URL 按钮，改为一个本地默认 fixture 加文件上传；`draw-snap-clear` 在现有内联默认数据旁增加上传入口，并让默认加载和上传共用 `loadExampleData(file)`。

- [ ] **Step 4: 移动 Task 7、Worker 与 DuckDB HTML**

移动 `buffer` 到 `duckdb-spatial-ops` 的 21 个页面。Worker URL 改为 `exampleWorkerUrl()`；DuckDB imports 改为 `@zwishing/emap/duckdb`；Formats 页面通过 runtime 的 Vite-managed `loadFormats()` 初始化，不再引用 `../../dist/emap-formats.*`。

- [ ] **Step 5: 统一每个 HTML 的启动片段**

删除：

```html
<link rel="stylesheet" href="../../src/ui/controls.css" />
<script src="../../dist/mapshaper-vendor.js"></script>
<script src="../../dist/emap-dev.js"></script>
```

将主脚本改为 module，并在最前、最后分别加入：

```js
import {
  autoLoadExampleFixtures,
  exampleWorkerUrl,
  loadExampleRuntime,
} from '/src/example-runtime.ts';

const emap = await loadExampleRuntime();
// 原页面注册控件和 change handlers
await autoLoadExampleFixtures('<exact-example-id>');
```

- [ ] **Step 6: 恢复并运行全部静态契约**

Run:

```bash
npx vitest run test/docs/example-catalog.test.ts test/examples --reporter=dot
```

Expected: PASS；`test/examples` 仅剩两个 `.test.ts`；所有 metadata source 指向 canonical HTML；每页无 `../../dist`、`../../src`、geojson.cn 数据 URL 或缺失上传入口。

- [ ] **Step 7: 提交 HTML 迁移**

```bash
git add test/examples packages/examples/examples test/docs/example-catalog.test.ts
git commit -m "refactor: make migrated HTML the canonical examples"
```

---

### Task 6: 规范化构建路由并修复文档组合

**Files:**
- Create: `scripts/normalize-examples-build.mjs`
- Create: `test/docs/examples-build.test.ts`
- Modify: `packages/examples/package.json`
- Modify: `packages/examples/vite.config.ts`
- Modify: `scripts/compose-docs-release.mjs`
- Modify: `test/docs/release-checklist.test.ts`

**Interfaces:**
- Produces: `normalizeExamplesBuild(root: string): Promise<void>`。
- Consumes: Vite `dist/examples/<id>` staging layout。

- [ ] **Step 1: 写嵌套路由规范化失败测试**

临时目录创建 `dist/index.html`、`dist/assets`、`dist/fixtures`、`dist/examples/buffer/index.html` 和嵌套 getting-started 页面，运行脚本后断言：

```ts
expect(await exists('dist/buffer/index.html')).toBe(true);
expect(await exists('dist/getting-started/points/index.html')).toBe(true);
expect(await exists('dist/examples')).toBe(false);
```

再创建冲突目标，断言脚本失败且不覆盖文件。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npx vitest run test/docs/examples-build.test.ts test/docs/release-checklist.test.ts --reporter=dot`

Expected: FAIL，脚本不存在且 compose 仍要求 `examples/buffer`。

- [ ] **Step 3: 实现安全平铺脚本并接入 build**

脚本仅允许处理显式的 `packages/examples/dist` 或测试 `--root` 下对应目录，逐目录复制/rename 后删除空的 `dist/examples`。`packages/examples` build 变为：

```json
"build": "vite build && node ../../scripts/normalize-examples-build.mjs"
```

Vite dev plugin 将 `/emap/examples/<id>/` 内部重写到物理 `/examples/<id>/index.html`。

- [ ] **Step 4: 修改 compose 契约**

`compose-docs-release.mjs` 要求输入 `dist/buffer/index.html`，整体复制后要求输出 `build/examples/buffer/index.html`；显式拒绝 `build/examples/examples`。

- [ ] **Step 5: 运行测试并确认 GREEN**

Run: `npx vitest run test/docs/examples-build.test.ts test/docs/release-checklist.test.ts --reporter=dot`

Expected: PASS。

- [ ] **Step 6: 提交路由修复**

```bash
git add scripts/normalize-examples-build.mjs packages/examples/package.json packages/examples/vite.config.ts scripts/compose-docs-release.mjs test/docs/examples-build.test.ts test/docs/release-checklist.test.ts
git commit -m "fix: publish examples at their documented routes"
```

---

### Task 7: 增加 CDN 发布校验与同版本本地回退

**Files:**
- Create: `scripts/check-example-cdn.mjs`
- Create: `scripts/build-examples-cdn.mjs`
- Modify: `package.json`
- Modify: `packages/examples/package.json`
- Modify: `test/docs/examples-build.test.ts`

**Interfaces:**
- Produces: `verifyCdnAssets({ version, distDir, fetchImpl }): Promise<IntegrityMap>`。
- Consumes: 本地 `dist/mapshaper-vendor.js`、`dist/emap.js`、`dist/emap.css` 和精确 jsDelivr URL。

- [ ] **Step 1: 写精确版本、禁止 latest 和 hash 不匹配测试**

mock fetch 返回本地 bytes 时必须成功并生成 `sha384-...`；URL 含 `latest`、404、内容不同或缺少本地文件时必须失败。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npx vitest run test/docs/examples-build.test.ts --reporter=dot`

Expected: FAIL，CDN checker 尚不存在。

- [ ] **Step 3: 实现 checker 和显式 CDN build 命令**

根脚本新增：

```json
"examples:build:cdn": "node scripts/build-examples-cdn.mjs"
```

wrapper 调用 `verifyCdnAssets()` 得到 integrity map，然后使用 `spawnSync` 运行 examples build，并通过子进程环境传入 `EMAP_EXAMPLES_ASSET_MODE=cdn` 和序列化的 `EMAP_EXAMPLES_ASSET_INTEGRITY`。这样校验结果与 Vite define 使用同一份 hash，且避免平台相关的 shell 环境变量语法。默认 `examples:build` 保持 local。

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `npx vitest run test/docs/examples-build.test.ts --reporter=dot`

Expected: PASS，测试不访问真实网络。

- [ ] **Step 5: 提交 CDN 校验**

```bash
git add scripts/check-example-cdn.mjs scripts/build-examples-cdn.mjs package.json packages/examples/package.json test/docs/examples-build.test.ts
git commit -m "feat: verify pinned CDN assets for published examples"
```

---

### Task 8: 提供统一文档预览并更新说明

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/release-checklist.md`
- Modify: `test/docs/release-checklist.test.ts`

**Interfaces:**
- Produces: `docs:preview`（local、单 origin）和文档化的 `examples:build:cdn` 发布入口。

- [ ] **Step 1: 写统一预览失败测试**

断言 `docs:preview` 依次包含 `build`、`api:build`、`examples:build`、`docs:build`、`docs:compose-examples` 和 docs `serve`，且 checklist 不再建议同时启动两个端口。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npx vitest run test/docs/release-checklist.test.ts --reporter=dot`

Expected: FAIL，当前 Local Preview 仍启动两个服务器。

- [ ] **Step 3: 实现脚本和文档**

`docs:preview` 使用 local examples build 并由一个 Docusaurus serve 提供全部内容。README 将原 `test/examples/*.html` 开发说明替换为 canonical package 目录、`examples:dev` 和 `docs:preview`；checklist 明确 CDN 仅用于已发布且已校验版本。

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `npx vitest run test/docs/release-checklist.test.ts --reporter=dot`

Expected: PASS。

- [ ] **Step 5: 提交统一预览**

```bash
git add package.json README.md docs/release-checklist.md test/docs/release-checklist.test.ts
git commit -m "docs: provide one-origin runnable example preview"
```

---

### Task 9: 完整验证、变更检测和浏览器冒烟

**Files:**
- Verify only; fix only failures directly caused by Tasks 1–8.

**Interfaces:**
- Produces: 可审计的测试、构建、路由和浏览器证据。

- [ ] **Step 1: 运行格式、类型和聚焦测试**

```bash
npm run format:check
npm run typecheck
npx vitest run test/docs test/examples --reporter=dot
```

Expected: 全部 PASS，无 warning/error。

- [ ] **Step 2: 运行生产构建链**

```bash
npm run build
npm run api:build
npm run examples:build
npm run docs:build
npm run docs:compose-examples
npm run docs:check-i18n
npm run docs:check-api
npm run examples:check
```

Expected: 全部 exit 0；`packages/docs/build/examples/examples` 不存在。

- [ ] **Step 3: 启动单站服务并做 HTTP 探针**

启动 Docusaurus serve 后检查：

```text
/emap/examples/
/emap/examples/getting-started/geojson-viewer/
/emap/examples/buffer/
/emap/examples/fixtures/task-6-polygons.geojson
/emap/examples/vendor/emap.js
/emap/examples/emap-worker.js
```

Expected: 全部 HTTP 200；HTML 资源 URL 不包含 `/fixtures/` 根路径或 `/examples/examples/`。

- [ ] **Step 4: 浏览器手动验证代表页面**

验证 getting-started 单文件、merge-layers 多文件、join CSV、GeoParquet、DuckDB overlay、china-editing、draw-snap-clear 和 web-worker。每页必须初始显示地图/数据，重新上传后地图更新，控制台无 404。

- [ ] **Step 5: 运行完整测试**

```bash
npm run test:run
```

Expected: 全部 PASS。

- [ ] **Step 6: 运行 GitNexus 变更检测**

```bash
npx gitnexus detect_changes --scope compare --base-ref 0fca2a3
```

Expected: 只影响 examples catalog/runtime/build、文档组合和预览流程；若出现非预期 engine execution flow，停止并检查 diff。

- [ ] **Step 7: 检查最终工作区范围**

```bash
git status --short
git diff --check 0fca2a3
git diff --stat 0fca2a3
```

Expected: 用户原有文档/workspace 修改保持不变；任务 diff 只包含计划列出的文件和 HTML moves。
