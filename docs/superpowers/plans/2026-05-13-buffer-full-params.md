# Buffer 全参数支持 + bug 修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 mapshaper `-buffer` 的全部参数透传到 emap `BufferOptions`，新增 `mergeFirst` 选项消除"面 buffer 内部线"问题，并修正 `buffer.html` 例子页上点 buffer "看不见" 的单位陷阱。

**Architecture:** 在 `src/map/ops/buffer.ts` 内做参数校验 + camelCase→snake_case 字段映射，命令链由单条 `[target, buffer]` 扩展为可选三条 `[target, dissolve2, buffer]`（仅 polygon + `mergeFirst=true` 时插入 dissolve2）。`BufferOptions` 类型扩展在 `src/map/types.ts`。例子页 `buffer.html` 增加全部新参数的 UI 控件。

**Tech Stack:** TypeScript 5 (strict) · Vitest · mapshaper 0.6 · 工程模式参见 `src/map/ops/_context.ts` 与 `src/map/ops/new-ops.test.ts`。

**Spec:** `docs/superpowers/specs/2026-05-13-buffer-full-params-design.md`

---

## File Structure

| 路径 | 动作 | 责任 |
|---|---|---|
| `src/map/types.ts` | Modify | 扩展 `BufferOptions` 接口（10 个新字段 + JSDoc） |
| `src/map/ops/buffer.ts` | Modify | 校验所有新字段；装配 ParsedCommand 选项；按 `mergeFirst` 决定是否插 `dissolve2` |
| `src/map/ops/buffer.test.ts` | Create | 6 组单元测试（字段透传 / 命令链 / 校验失败） |
| `test/examples/buffer.html` | Modify | 增加 6 个控件 + 单位提示 + 默认 radius `1000` |

---

## Task 1: 扩展 `BufferOptions` 类型

**Files:**
- Modify: `src/map/types.ts:276-290`

- [ ] **Step 1: 替换 `BufferOptions` 接口**

把 `src/map/types.ts` 的现有 `BufferOptions`（line 276-290）整段替换为：

```ts
/** Options for `Emap.bufferLayer`. */
export interface BufferOptions {
  /** Source ID containing the target layer. */
  source: string;
  /** Layer name (or id) of the layer to buffer. */
  target: string;
  /**
   * Buffer radius. Either a positive finite `number` or a mapshaper
   * expression string (evaluated per record).
   *
   * Unit semantics:
   *  - **point** layers — always **metres** (mapshaper does geodetic
   *    circles via `getGeodeticSegmentFunction`), unless {@link planar}
   *    is `true`, in which case it's source-CRS units.
   *  - **polyline / polygon** layers — source-CRS units (degrees for
   *    EPSG:4326, metres for a projected CRS).
   */
  radius: number | string;
  /** Buffer cap style. Default is `round`. Mainly affects polyline output. */
  capStyle?: 'flat' | 'round';
  /** Vertices used to approximate a point-buffer circle. Positive integer. */
  vertices?: number;
  /** Segments per quarter-circle in joins and caps. Positive integer. */
  arcQuality?: number;
  /** Curve-approximation tolerance. Positive finite number. */
  tolerance?: number;
  /** Single-sided buffer; meaningful for polyline layers. */
  type?: 'left' | 'right' | 'outer' | 'inner';
  /** Force planar (Cartesian) computation even for lat/lng data. */
  planar?: boolean;
  /** Enable the v2 buffering algorithm. */
  v2?: boolean;
  /** Max path segments per buffer slice. Performance knob. Positive int. */
  sliceLength?: number;
  /** Backtrack distance, mapshaper-internal performance knob. Positive int. */
  backtrack?: number;
  /**
   * Before buffering, run `-dissolve2` on the target layer so that the
   * whole layer collapses to a single outer outline. Eliminates "inner
   * lines" that appear when adjacent polygons aren't topologically
   * connected. **Only honoured for polygon layers** — silently ignored
   * with a `console.warn` for other geometry types. Default `false`.
   * Note: feature-level properties are lost (`dissolve2` merges them).
   */
  mergeFirst?: boolean;
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 0 errors（新增字段全可选，旧调用不受影响）。

- [ ] **Step 3: Commit**

```bash
git add src/map/types.ts
git commit -m "feat(buffer): extend BufferOptions with all mapshaper -buffer params"
```

---

## Task 2: 写新 `BufferOptions` 字段透传的失败测试

**Files:**
- Create: `src/map/ops/buffer.test.ts`

- [ ] **Step 1: 创建测试文件骨架**

写入 `src/map/ops/buffer.test.ts`：

```ts
// Unit tests for bufferLayer — parameter passthrough, mergeFirst
// command-chain shape, and validation rejects.

import { describe, expect, it, vi } from 'vitest';
import { bufferLayer } from './buffer';
import { OK } from '../op-result';
import type { OpContext } from './_context';
import type { ParsedCommand } from '../../adapter/mapshaper-adapter';
import type { MapshaperLayer, MapshaperDataset } from '../../types/mapshaper-types';

function makeStubCtx(layers: Array<{ name: string; geometry_type?: string }> = [
  { name: 'parks', geometry_type: 'polygon' },
]) {
  const layerObjs: MapshaperLayer[] = layers.map((l) => ({
    name: l.name,
    geometry_type: (l.geometry_type ?? 'polygon') as any,
    shapes: [[[0]]],
  } as MapshaperLayer));
  const dataset: MapshaperDataset = { layers: layerObjs, info: {} } as MapshaperDataset;

  const calls: Array<{ sourceId: string; cmds: ParsedCommand[]; label: string }> = [];
  const ctx: OpContext = {
    host: {
      _removed: false,
      _sources: new globalThis.Map([['s1', {
        getDataset: () => dataset,
        setDataset: () => undefined,
      } as any]]),
      _history: null as any,
      _selection: null as any,
      _activeTransaction: null,
      _validators: null as any,
      _workerPool: null,
      _workerMode: false,
      _workerThreshold: 1e9,
      layers: { resolve: () => null } as any,
      _resolveLayer: () => null,
      _scheduleRender: () => undefined,
      _fireHistoryChange: () => undefined,
      _fireSelectionChange: () => undefined,
      _invalidateShapeCachesForSources: () => undefined,
      _clearSpatialIndexesForSources: () => undefined,
      _allowExpressionEvaluation: () => true,
      fire: () => undefined,
    } as any,
    runDatasetCommand: (() => Promise.resolve(OK)) as any,
    runDatasetCommandParsed: (sourceId, cmds, label) => {
      calls.push({ sourceId, cmds, label });
      return Promise.resolve(OK);
    },
    applyDatasetReplace: (() => OK) as any,
  };
  return { ctx, calls };
}

describe('bufferLayer — parameter passthrough', () => {
  it('forwards every new option as snake_case keys', async () => {
    const { ctx, calls } = makeStubCtx();
    const r = await bufferLayer(ctx, {
      source: 's1',
      target: 'parks',
      radius: 100,
      capStyle: 'flat',
      vertices: 36,
      arcQuality: 4,
      tolerance: 0.5,
      type: 'outer',
      planar: true,
      v2: true,
      sliceLength: 1024,
      backtrack: 8,
    });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const bufferCmd = calls[0].cmds.find((c) => c.name === 'buffer')!;
    expect(bufferCmd.options).toEqual({
      radius: '100',
      cap_style: 'flat',
      vertices: 36,
      arc_quality: 4,
      tolerance: 0.5,
      type: 'outer',
      planar: true,
      v2: true,
      slice_length: 1024,
      backtrack: 8,
    });
  });
});
```

- [ ] **Step 2: 运行测试，确认它现在失败**

Run: `npx vitest run src/map/ops/buffer.test.ts`
Expected: FAIL — `bufferLayer` 还不接受这些新字段，断言不匹配。

---

## Task 3: 在 `buffer.ts` 中实现参数透传

**Files:**
- Modify: `src/map/ops/buffer.ts`

- [ ] **Step 1: 整段替换 `bufferLayer` 实现**

把 `src/map/ops/buffer.ts` 的全部内容替换为：

```ts
// bufferLayer — generate buffer polygons via mapshaper's `-buffer`
// pipeline. Forwards every supported mapshaper option. When
// `mergeFirst` is true on a polygon layer, prepends a `-dissolve2`
// command so the whole layer collapses to a single outer outline
// before buffering (eliminates "inner lines" from non-topologically
// adjacent features).

import { resolveLayerInList } from '../layer-registry';
import { Err, type OpResult } from '../op-result';
import type { BufferOptions } from '../types';
import type { ParsedCommand } from '../../adapter/mapshaper-adapter';
import type { OpContext } from './_context';

const VALID_TYPES = new Set(['left', 'right', 'outer', 'inner']);

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

function isPositiveFinite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

export async function bufferLayer(ctx: OpContext, opts: BufferOptions): Promise<OpResult> {
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  const layer = resolveLayerInList(dataset.layers, opts.target);
  if (!layer) return Err.notFound('layer', opts.target);

  // radius — required, positive finite number OR non-empty expression.
  if (typeof opts.radius === 'number') {
    if (!Number.isFinite(opts.radius) || opts.radius <= 0) {
      return Err.validation('radius', 'must be a positive finite number');
    }
  } else if (typeof opts.radius !== 'string' || opts.radius.trim().length === 0) {
    return Err.validation('radius', 'must be a positive number or non-empty expression');
  }
  if (typeof opts.radius === 'string' && !ctx.host._allowExpressionEvaluation([opts.radius], 'bufferLayer')) {
    return Err.expressionDisabled('bufferLayer');
  }

  // Numeric performance/quality knobs — all optional, all positive.
  if (opts.vertices !== undefined && !isPositiveInt(opts.vertices)) {
    return Err.validation('vertices', 'must be a positive integer');
  }
  if (opts.arcQuality !== undefined && !isPositiveInt(opts.arcQuality)) {
    return Err.validation('arcQuality', 'must be a positive integer');
  }
  if (opts.sliceLength !== undefined && !isPositiveInt(opts.sliceLength)) {
    return Err.validation('sliceLength', 'must be a positive integer');
  }
  if (opts.backtrack !== undefined && !isPositiveInt(opts.backtrack)) {
    return Err.validation('backtrack', 'must be a positive integer');
  }
  if (opts.tolerance !== undefined && !isPositiveFinite(opts.tolerance)) {
    return Err.validation('tolerance', 'must be a positive finite number');
  }
  if (opts.type !== undefined && !VALID_TYPES.has(opts.type)) {
    return Err.validation('type', `must be one of: left, right, outer, inner`);
  }

  // mergeFirst applies only to polygon layers. Anything else: warn + ignore.
  let mergeFirstApplies = false;
  if (opts.mergeFirst === true) {
    if (layer.geometry_type === 'polygon') {
      mergeFirstApplies = true;
    } else {
      console.warn(
        `bufferLayer: mergeFirst ignored for non-polygon layer "${opts.target}" (geometry=${layer.geometry_type}).`,
      );
    }
  }

  // Assemble snake_case option bag. Only include keys the caller actually set.
  const bufferOptions: Record<string, unknown> = { radius: String(opts.radius) };
  if (opts.capStyle) bufferOptions.cap_style = opts.capStyle;
  if (opts.vertices !== undefined) bufferOptions.vertices = opts.vertices;
  if (opts.arcQuality !== undefined) bufferOptions.arc_quality = opts.arcQuality;
  if (opts.tolerance !== undefined) bufferOptions.tolerance = opts.tolerance;
  if (opts.type !== undefined) bufferOptions.type = opts.type;
  if (opts.planar === true) bufferOptions.planar = true;
  if (opts.v2 === true) bufferOptions.v2 = true;
  if (opts.sliceLength !== undefined) bufferOptions.slice_length = opts.sliceLength;
  if (opts.backtrack !== undefined) bufferOptions.backtrack = opts.backtrack;

  const commands: ParsedCommand[] = [
    { name: 'target', options: { target: opts.target } },
  ];
  if (mergeFirstApplies) {
    commands.push({ name: 'dissolve2', options: {} });
  }
  commands.push({ name: 'buffer', options: bufferOptions });

  const label = mergeFirstApplies ? `Buffer (merged) ${opts.target}` : `Buffer ${opts.target}`;
  return ctx.runDatasetCommandParsed(opts.source, commands, label);
}
```

- [ ] **Step 2: 运行 Task 2 测试，确认通过**

Run: `npx vitest run src/map/ops/buffer.test.ts`
Expected: PASS — `forwards every new option as snake_case keys` ✓

- [ ] **Step 3: Commit**

```bash
git add src/map/ops/buffer.ts src/map/ops/buffer.test.ts
git commit -m "feat(buffer): forward all mapshaper -buffer params with snake_case mapping"
```

---

## Task 4: `mergeFirst` 命令链测试（polygon 路径）

**Files:**
- Modify: `src/map/ops/buffer.test.ts`

- [ ] **Step 1: 在 buffer.test.ts 追加测试**

在文件末尾追加：

```ts
describe('bufferLayer — mergeFirst', () => {
  it('inserts dissolve2 before buffer for polygon layers', async () => {
    const { ctx, calls } = makeStubCtx([{ name: 'parks', geometry_type: 'polygon' }]);
    const r = await bufferLayer(ctx, {
      source: 's1', target: 'parks', radius: 50, mergeFirst: true,
    });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const names = calls[0].cmds.map((c) => c.name);
    expect(names).toEqual(['target', 'dissolve2', 'buffer']);
    expect(calls[0].label).toBe('Buffer (merged) parks');
  });

  it('skips dissolve2 and warns for non-polygon layers', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { ctx, calls } = makeStubCtx([{ name: 'roads', geometry_type: 'polyline' }]);
    const r = await bufferLayer(ctx, {
      source: 's1', target: 'roads', radius: 50, mergeFirst: true,
    });
    expect(r.ok).toBe(true);
    const names = calls[0].cmds.map((c) => c.name);
    expect(names).toEqual(['target', 'buffer']);
    expect(calls[0].label).toBe('Buffer roads');
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatch(/mergeFirst ignored.*polyline/);
    warn.mockRestore();
  });

  it('omits dissolve2 when mergeFirst is undefined / false', async () => {
    const { ctx, calls } = makeStubCtx();
    await bufferLayer(ctx, { source: 's1', target: 'parks', radius: 50 });
    expect(calls[0].cmds.map((c) => c.name)).toEqual(['target', 'buffer']);
  });
});
```

- [ ] **Step 2: 运行测试**

Run: `npx vitest run src/map/ops/buffer.test.ts`
Expected: PASS — all 4 tests green.

- [ ] **Step 3: Commit**

```bash
git add src/map/ops/buffer.test.ts
git commit -m "test(buffer): mergeFirst inserts dissolve2 for polygons; warns + skips otherwise"
```

---

## Task 5: 校验失败的测试 + 未设置字段不透传

**Files:**
- Modify: `src/map/ops/buffer.test.ts`

- [ ] **Step 1: 追加校验失败测试**

```ts
describe('bufferLayer — validation', () => {
  it.each([
    ['type', { type: 'sideways' as any }],
    ['vertices', { vertices: 0 }],
    ['vertices', { vertices: 1.5 }],
    ['arcQuality', { arcQuality: -1 }],
    ['tolerance', { tolerance: -0.1 }],
    ['sliceLength', { sliceLength: 0 }],
    ['backtrack', { backtrack: 1.2 }],
  ])('rejects %s with bad value and does not dispatch', async (field, override) => {
    const { ctx, calls } = makeStubCtx();
    const r = await bufferLayer(ctx, {
      source: 's1', target: 'parks', radius: 50,
      ...(override as Partial<import('../types').BufferOptions>),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('validation');
      expect(r.error.field).toBe(field);
    }
    expect(calls).toHaveLength(0);
  });

  it('does not include unset optional keys in the ParsedCommand options', async () => {
    const { ctx, calls } = makeStubCtx();
    await bufferLayer(ctx, { source: 's1', target: 'parks', radius: 50 });
    const bufferCmd = calls[0].cmds.find((c) => c.name === 'buffer')!;
    expect(bufferCmd.options).toEqual({ radius: '50' });
  });
});
```

- [ ] **Step 2: 运行测试**

Run: `npx vitest run src/map/ops/buffer.test.ts`
Expected: PASS — 11 tests green total.

- [ ] **Step 3: 全量测试 sanity 跑一遍**

Run: `npm test -- --run`
Expected: 整个测试套全绿（应仍是 ~760+11 case）。

- [ ] **Step 4: Commit**

```bash
git add src/map/ops/buffer.test.ts
git commit -m "test(buffer): validation rejects bad numeric/enum opts; unset keys omitted"
```

---

## Task 6: 改造 `buffer.html` 例子页

**Files:**
- Modify: `test/examples/buffer.html`

- [ ] **Step 1: 整段替换 `<div id="header">` 与 `<script>` 主体**

把 `test/examples/buffer.html` 的 `<div id="header">…</div>`（line 46-57）整段替换为：

```html
  <div id="header">
    <label>文件: <input id="file-input" type="file" accept=".geojson,.json,.topojson,.zip" /></label>
    <label>目标图层: <select id="target"></select></label>
    <label>半径: <input id="radius" type="text" value="1000" placeholder="数字或表达式"/></label>
    <label>端点样式: <select id="cap">
      <option value="">圆形 (默认)</option>
      <option value="round">圆形</option>
      <option value="flat">平直</option>
    </select></label>
    <label>vertices: <input id="vertices" type="number" min="3" step="1" placeholder="72"/></label>
    <label>arc-quality: <input id="arc-quality" type="number" min="1" step="1" placeholder=""/></label>
    <label>type: <select id="type">
      <option value="">全 (默认)</option>
      <option value="left">left</option>
      <option value="right">right</option>
      <option value="outer">outer</option>
      <option value="inner">inner</option>
    </select></label>
    <label><input id="planar" type="checkbox"/> planar</label>
    <label><input id="v2" type="checkbox"/> v2</label>
    <label><input id="merge-first" type="checkbox"/> 整层合并后再 buffer (面)</label>
    <button id="buffer-btn" disabled>生成缓冲区</button>
    <span id="status">加载数据</span>
    <small style="flex-basis:100%; opacity:0.85; padding-top:4px;">
      单位: 点 buffer 半径 = <strong>米</strong>（勾选 planar 则为源 CRS 单位）；线/面 buffer 半径 = 源 CRS 单位（lat/lng 数据为度）。
    </small>
  </div>
```

- [ ] **Step 2: 整段替换 `bufBtn.addEventListener('click', ...)` 提交逻辑**

把 `<script>` 块里 `bufBtn.addEventListener('click', async () => { ... });` 整段（line 108-130）替换为：

```js
    function readNumber(id) {
      const raw = document.getElementById(id).value.trim();
      if (!raw) return undefined;
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    }

    bufBtn.addEventListener('click', async () => {
      const target = targetSel.value;
      if (!target) return;
      const raw = radiusInput.value.trim();
      if (!raw) return;
      const radius = /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
      const opts = { source: SOURCE_ID, target, radius };
      if (capSel.value) opts.capStyle = capSel.value;
      const vertices = readNumber('vertices');
      if (vertices !== undefined) opts.vertices = vertices;
      const arcQuality = readNumber('arc-quality');
      if (arcQuality !== undefined) opts.arcQuality = arcQuality;
      const typeVal = document.getElementById('type').value;
      if (typeVal) opts.type = typeVal;
      if (document.getElementById('planar').checked) opts.planar = true;
      if (document.getElementById('v2').checked) opts.v2 = true;
      if (document.getElementById('merge-first').checked) opts.mergeFirst = true;
      status.textContent = `正在对 ${target} 生成半径 ${raw} 的缓冲区...`;
      bufBtn.disabled = true;
      try {
        const ok = await map.ops.bufferLayer(opts);
        status.textContent = ok ? `已生成 ${target} 的缓冲区,Ctrl+Z 撤销。` : '生成失败。';
        const src = map.getSource(SOURCE_ID);
        if (src) populate(src);
      } catch (err) {
        status.textContent = `错误: ${err?.message ?? err}`;
        console.error(err);
      } finally {
        bufBtn.disabled = false;
      }
    });
```

- [ ] **Step 3: 构建 dev bundle**

Run: `npm run dev-build`
Expected: 0 错误，`dist/emap-dev.js` 更新。

- [ ] **Step 4: 浏览器手测**

打开 `test/examples/buffer.html`，验证：
1. 载入一个 lat/lng **点**图层（如 `test/examples/data/cities.geojson` 之类），radius 用默认 `1000`，点击"生成缓冲区"——应能看到米级圆圈。
2. 载入一个 lat/lng **面**图层（多相邻面），radius `0.01`，先不勾 `mergeFirst`——观察内部线；再勾上 `mergeFirst` 重新载入并 buffer——内部线消失。
3. 单选 `type=outer` + 线图层，确认渲染出单侧缓冲。
4. Ctrl+Z 一次撤销到 buffer 前。

记录测试结果（PASS / 哪一步失败）。

- [ ] **Step 5: Commit**

```bash
git add test/examples/buffer.html
git commit -m "feat(example): expose all buffer params + mergeFirst + unit hint in buffer.html"
```

---

## Task 7: 更新 CLAUDE.md 的"Where to Make Changes"

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: 在表格 "New mapshaper data op" 行后追加一行**

在 CLAUDE.md "Where to Make Changes" 表格里找到 "New mapshaper data op" 行，紧接其后插入：

```markdown
| Buffer parameter mapping (camelCase ↔ snake_case) | `src/map/ops/buffer.ts` — full `-buffer` option surface |
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: point to buffer.ts for camelCase↔snake_case mapping"
```

---

## Task 8: 最终 sanity 检查

- [ ] **Step 1: 全量测试**

Run: `npm test -- --run`
Expected: 全绿。

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 0 errors。

- [ ] **Step 3: 生产构建**

Run: `npm run build`
Expected: 0 errors；`dist/emap.js`, `dist/emap.mjs`, `dist/emap.d.ts` 都生成。

- [ ] **Step 4: 在 `dist/emap.d.ts` 中确认 `BufferOptions` 新字段都被导出**

Run: `grep -A 25 "interface BufferOptions" dist/emap.d.ts`
Expected: 输出包含 `vertices`, `arcQuality`, `tolerance`, `type`, `planar`, `v2`, `sliceLength`, `backtrack`, `mergeFirst` 全部 9 个新字段。

- [ ] **Step 5: 最终提交（如果有 dist 改动需要单独提交，按项目惯例可跳过）**

dist/ 是 gitignore 的，无需提交。

---

## Spec Coverage Self-Review

| Spec 章节 | 实现 task |
|---|---|
| §3.1 `BufferOptions` 9 新字段 | Task 1 |
| §3.2 emap → mapshaper 字段映射表 | Task 3 (Step 1 内全部覆盖) |
| §4.1 校验顺序 | Task 3 (Step 1) + Task 5 |
| §4.2 仅设置字段才装配 | Task 3 (Step 1) + Task 5 (第二个 it) |
| §4.3 命令链组装 + label | Task 3 (Step 1) + Task 4 |
| §4.4 错误透传（不额外捕获） | Task 3 (Step 1) — 实现里没有 try/catch |
| §5 UI 6 个控件 + 单位提示 + 默认 radius=1000 | Task 6 |
| §6 测试覆盖 6 组 | Task 2/4/5 |
| §7 CLAUDE.md 文档 | Task 7 |
| §9 兼容性（旧调用不变） | Task 1 (新字段全可选) + Task 5 (默认无 dissolve2) |
| §10 风险（组合留给 mapshaper 报错） | Task 3 (无 try/catch) |

**No placeholders. All step code blocks complete. Type names consistent: `BufferOptions`, `bufferLayer`, `mergeFirst`, `arcQuality`, `sliceLength` — same across all tasks.**
