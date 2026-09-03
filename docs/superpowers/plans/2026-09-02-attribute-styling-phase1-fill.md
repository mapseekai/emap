# 属性驱动样式 Phase 1（面填色）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 fill 图层支持按属性字段着色：`classifyFeatures` op 烘焙样式字段 + MapLibre 子集 paint 表达式 + PerFeatureStyleResolver 桶化渲染，含双计数器失效契约。

**Architecture:** 样式是普通 DataTable 字段（mapshaper `-classify` 烘焙，断点权威在 emap）；`StyleResolver` 按 `(表达式指纹, dataset 引用, attributeVersion, layerId)` 缓存 `styleIds/LUT/fillBuckets`；`drawPolygonFill` 经 `PolygonFillOptions.styleBuckets` 逐桶渲染；静态图层路径完全不变。

**Tech Stack:** TypeScript、vitest（colocated `*.test.ts`）、mapshaper 0.6.113（锁定，不升级）、Canvas2D。

**Spec:** `docs/superpowers/specs/2026-09-02-attribute-driven-styling-design.md`（缓存键、失效矩阵、worker 路由、错误分层以 spec 为准）。

## Global Constraints

- mapshaper 锁定 0.6.113；classify 内部选项键已核实：`field/method/classes/breaks/categories/colors/invert/null_value/save_as/other`。
- 新 op 必须在 `src/map/ops/_runner.ts` 的 `COMMAND_EFFECTS` 登记；`classify: 'attribute-only'`（AGENTS.md 硬规则）。
- ops/map 模块不直接 import `mapshaper`（经 ctx runner / adapter）；坐标数学走 `AffineTransform`。
- 计数器约定：`editVersion` 服务空间索引/几何缓存；`attributeVersion` 服务样式 resolver；`_runner` stale guard 两者都比。
- 测试命令：`pnpm vitest run <file>`（或 `rtk vitest run <file>`）；类型检查 `pnpm typecheck`；提交前对改动文件跑 `pnpm exec biome format --write <files>`。
- 每个 Task 完成后单独 commit。**禁止 `git add -A`**：工作区可能有无关预存改动；
  每步只 `git add` 该 Task 列出的精确路径；`docs/superpowers/` 被 gitignore，
  提交 spec/plan 更新需 `git add -f`。
- **GitNexus 硬门禁（AGENTS.md）**：编辑任何函数/class/method 前，先对其跑
  `impact({ target: "<符号名>", direction: "upstream" })`，返回 HIGH/CRITICAL
  必须先向用户报告再继续；每次 commit 前跑
  `detect_changes({ repo: "emap", scope: "staged" })`，确认仅影响本 Task 预期
  symbols/flows 后方可提交。各 Task 的 Step 0 已列出待改符号清单。

---

### Task 1: attributeVersion 计数器、bump 覆盖与 stale guard 双计数器

- [ ] **Step 0: impact gate**——对 `markSourceChanged`、`FeatureCreateCommand`、
  `FeatureDeleteCommand`、`BulkFeatureDeleteCommand`、`FeatureDeleteWithSelectionCommand`、
  `SplitFeaturesCommand`、`FieldAddCommand`、`FieldRemoveCommand`、`FieldRenameCommand`、
  `FeaturePropertyChangeCommand`、`_runPreparedDatasetMutation`、`_runPreparedEditCommand`
  逐个跑 GitNexus `impact`（upstream）；HIGH/CRITICAL 先报告用户。

**Files:**
- Modify: `src/types/mapshaper-types.ts:261-294`（`editVersion`/`bumpEditVersion` 旁）
- Modify: `src/index.ts:175`
- Modify: `src/edit/commands/_shared.ts`
- Modify: `src/edit/commands/feature-create.ts`（2 处 markSourceChanged）
- Modify: `src/edit/commands/feature-delete.ts`（wrapper 2 处 + 两个裸命令 options/do/undo）
- Modify: `src/edit/commands/split-features.ts`（do/undo 2 处）
- Modify: `src/edit/commands/field-add.ts`、`field-remove.ts`、`field-rename.ts`、`feature-property-change.ts`（options 加 `dataset`，do/undo bump）
- Modify: `src/map/delete-selected.ts:38`、`src/edit/commands/vertex-delete.ts:155`（传 source）
- Modify: `src/core/handlers/draw-feature.ts`（`_commitFeature` records.push 后 bump）
- Modify: `src/map/ops/_runner.ts`（4 条 stale guard + replace 计数器保留）
- Test: `src/edit/commands/version-bump.test.ts`（新建）；`src/map/ops/_runner.test.ts`（扩展）

**Interfaces:**
- Produces: `bumpAttributeVersion(dataset)`；`markAttributesChanged(source)`；`markShapeCountChanged(source)`；`MapshaperDataset.attributeVersion?: number`。Task 4/6 依赖。

- [ ] **Step 1: 失败测试 — 计数器与命令 bump 覆盖**

`src/edit/commands/version-bump.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { bumpAttributeVersion, bumpEditVersion } from '../../types/mapshaper-types';
import { FeatureCreateCommand } from './feature-create';
import { BulkFeatureDeleteCommand, FeatureDeleteCommand } from './feature-delete';
import { FieldAddCommand } from './field-add';
import { FeaturePropertyChangeCommand } from './feature-property-change';

function makeSource(dataset: unknown) {
  return {
    getDataset: () => dataset,
    getArcs: () => null,
    markDisplayArcsDirty: () => {},
    fire: () => {},
  } as any;
}

describe('bumpAttributeVersion', () => {
  it('initialises undefined to 0 then increments', () => {
    const d: any = {};
    bumpAttributeVersion(d);
    expect(d.attributeVersion).toBe(1);
    bumpAttributeVersion(d);
    expect(d.attributeVersion).toBe(2);
    expect(() => bumpAttributeVersion(null)).not.toThrow();
  });
});

describe('shape-count commands bump attributeVersion (same-reference)', () => {
  it('FeatureDeleteCommand do/undo bump both counters', () => {
    const dataset: any = { editVersion: 0, attributeVersion: 0 };
    const records = [{ a: 0 }, { a: 1 }];
    const layer: any = { shapes: [['s0'], ['s1']], data: { getRecords: () => records } };
    const cmd = new FeatureDeleteCommand({
      layer,
      featureId: 1,
      shape: layer.shapes[1],
      record: records[1],
      source: makeSource(dataset),
    });
    cmd.do();
    expect(dataset.editVersion).toBe(1);
    expect(dataset.attributeVersion).toBe(1);
    cmd.undo();
    expect(dataset.attributeVersion).toBe(2);
  });

  it('BulkFeatureDeleteCommand do/undo bump attributeVersion', () => {
    const dataset: any = { attributeVersion: 0 };
    const records = [{ a: 0 }, { a: 1 }];
    const layer: any = { shapes: [['s0'], ['s1']], data: { getRecords: () => records } };
    const cmd = new BulkFeatureDeleteCommand({
      layer,
      snapshots: [{ id: 0, shape: ['s0'], record: { a: 0 } }],
      source: makeSource(dataset),
    });
    cmd.do();
    expect(dataset.attributeVersion).toBe(1);
    cmd.undo();
    expect(dataset.attributeVersion).toBe(2);
  });
});

describe('attribute commands bump attributeVersion only', () => {
  it('FieldAddCommand do/undo bump attributeVersion, not editVersion', () => {
    const dataset: any = { editVersion: 0, attributeVersion: 0 };
    const records = [{ name: 'A' }];
    const layer: any = { data: { getRecords: () => records } };
    const cmd = new FieldAddCommand({ layer, field: 'pop', defaultValue: 0, dataset });
    cmd.do();
    expect(dataset.attributeVersion).toBe(1);
    expect(dataset.editVersion).toBe(0);
    cmd.undo();
    expect(dataset.attributeVersion).toBe(2);
  });

  it('FeaturePropertyChangeCommand do/undo bump attributeVersion', () => {
    const dataset: any = { attributeVersion: 0 };
    const records = [{ name: 'A' }];
    const layer: any = { data: { getRecords: () => records } };
    const cmd = new FeaturePropertyChangeCommand({
      layer,
      featureId: 0,
      prev: {},
      next: { pop: 1 },
      dataset,
    } as any);
    cmd.do();
    expect(dataset.attributeVersion).toBe(1);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run src/edit/commands/version-bump.test.ts`
Expected: FAIL（`bumpAttributeVersion` 未导出；options 无 source/dataset）

- [ ] **Step 3: 实现计数器与 helper**

`src/types/mapshaper-types.ts`（`editVersion` 字段注释后追加；`bumpEditVersion` 后追加）：

```ts
  /**
   * Monotonic counter for attribute/record mutations that don't touch
   * geometry. Owns style-resolution cache invalidation; spatial-index
   * caches key on `editVersion` and are NOT rebuilt for pure attribute
   * edits. emap-owned; mapshaper never sets it.
   */
  attributeVersion?: number;
```

```ts
/** Bump the attribute/record revision. See {@link bumpEditVersion}. */
export function bumpAttributeVersion(dataset: MapshaperDataset | null | undefined): void {
  if (!dataset) return;
  dataset.attributeVersion = (dataset.attributeVersion ?? 0) + 1;
}
```

`src/index.ts:175` 导出改为：

```ts
export { isPathLayer, isPointLayer, bumpEditVersion, bumpAttributeVersion } from './types/mapshaper-types';
```

`src/edit/commands/_shared.ts`（import 加 `bumpAttributeVersion`，文件尾追加）：

```ts
/** Records-only change: invalidates style resolution, not spatial indexes. */
export function markAttributesChanged(source: TopologySource): void {
  bumpAttributeVersion(asMutableTopologySource(source).getDataset?.());
}

/** Feature count/membership change: geometry AND attribute invalidation. */
export function markShapeCountChanged(source: TopologySource): void {
  markSourceChanged(source);
  markAttributesChanged(source);
}
```

- [ ] **Step 4: 接入 shape-count 命令与首次提交路径**

- `feature-create.ts`：两处 `markSourceChanged(o.source)` → `markShapeCountChanged(o.source)`，import 同步。
- `feature-delete.ts`：`FeatureDeleteWithSelectionCommand` 两处 `markSourceChanged(...)` → `markShapeCountChanged(...)`；`FeatureDeleteCommandOptions`/`BulkFeatureDeleteCommandOptions` 增加 `/** Owning source; bumps revisions on do/undo. */ source: TopologySource;`；两个裸命令的 do/undo 在非早退路径末尾调 `markShapeCountChanged(this.opts.source)`（import `type TopologySource` from '../../source/source'）。
- `split-features.ts`：do/undo 两处 `markSourceChanged(source)` → `markShapeCountChanged(source)`。
- `delete-selected.ts:38`：`new BulkFeatureDeleteCommand({ layer: target, snapshots, source })`（该函数作用域内的 source 对象）；`vertex-delete.ts:155` 同样传 `source`。
- `draw-feature.ts:_commitFeature()`：records.push 块之后、`source.refreshDisplayArcs()` 之前插入 `markShapeCountChanged(source);`（import from '../../edit/commands/_shared'）。
- 纯属性命令：`field-add.ts`/`field-remove.ts`/`field-rename.ts`/`feature-property-change.ts` 的 options 增加 `dataset: MapshaperDataset`；do/undo 末尾 `bumpAttributeVersion(this.opts.dataset)`。caller 迁移：grep `new FieldAddCommand(\|new FieldRemoveCommand(\|new FieldRenameCommand(\|new FeaturePropertyChangeCommand(`（`src/map/attribute-ops.ts` 等），每个构造点传 `dataset`（caller 均有 source/dataset 在作用域；attribute-ops 经 `this._emap` resolve 的 source.getDataset()）。

- [ ] **Step 5: _runner stale guard 双计数器 + replace 保留**

`_runner.ts` 四处 stale 检查（`runPreparedDatasetMutation` ~295-305、直接编辑 ~358-373、多 source ~498/536、worker 命令 ~650/667）统一改为同时快照/比较两计数器：

```ts
const originalEditVersion = original.editVersion ?? 0;
const originalAttrVersion = original.attributeVersion ?? 0;
// ...
if (
  source.getDataset() !== original ||
  (original.editVersion ?? 0) !== originalEditVersion ||
  (original.attributeVersion ?? 0) !== originalAttrVersion ||
  host._activeTransaction !== transaction ||
  (transaction !== null && !transaction.isOpen)
) {
  return Err.staleOperation(sourceId, label);
}
```

dataset replace 提交点（构造 `DatasetReplaceCommand`/`DatasetReplaceSelectionCommand` 处，`new DatasetReplace` 锚点）：setDataset 前把计数器搬到 `after`：

```ts
after.editVersion = before.editVersion ?? 0;
after.attributeVersion = before.attributeVersion ?? 0;
```

- [ ] **Step 6: 失败测试 — stale guard 与 replace 单调**

`_runner.test.ts` 追加（仿 327-336 既有用例）：

```ts
it('rejects with stale-operation when attributeVersion changed during planning', async () => {
  const dataset: any = { layers: [], arcs: null, editVersion: 0, attributeVersion: 0 };
  const source = { getDataset: () => dataset };
  const host = makeHost(source);
  const command = { do: vi.fn(), undo: vi.fn() };
  const result = await _runPreparedEditCommand(host as any, 's', 'X', () => {
    dataset.attributeVersion = 1; // direct attribute edit slipped in
    return { value: undefined, command, affectedSourceIds: ['s'] };
  });
  expect(result).toMatchObject({ ok: false, error: { kind: 'stale-operation' } });
});
```

worker 在飞回归（仿同文件 worker 路径既有用例）：worker op 未 settle 时 `dataset.attributeVersion += 1` → `Err.staleOperation`，不提交旧结果。

- [ ] **Step 7: 运行测试通过 + typecheck**

Run: `pnpm vitest run src/edit/commands/version-bump.test.ts src/map/ops/_runner.test.ts src/edit/commands/feature-delete.test.ts src/edit/commands/feature-create.test.ts src/edit/commands/field-add.test.ts src/edit/commands/feature-property-change.test.ts`
Expected: PASS（既有命令测试若因 options 新增必填字段失败，同步迁移构造点）
Run: `pnpm typecheck` — Expected: 0 errors

- [ ] **Step 8: Commit**

```bash
# 提交前：detect_changes({ repo: 'emap', scope: 'staged' }) → 仅预期命令类/计数器
git add src/types/mapshaper-types.ts src/index.ts src/edit/commands/_shared.ts \
  src/edit/commands/feature-create.ts src/edit/commands/feature-delete.ts \
  src/edit/commands/split-features.ts src/edit/commands/field-add.ts \
  src/edit/commands/field-remove.ts src/edit/commands/field-rename.ts \
  src/edit/commands/feature-property-change.ts src/edit/commands/version-bump.test.ts \
  src/edit/commands/vertex-delete.ts src/map/delete-selected.ts \
  src/core/handlers/draw-feature.ts src/map/ops/_runner.ts src/map/ops/_runner.test.ts \
  src/map/attribute-ops.ts
# （attribute-ops.ts 等 caller 以 Step 4 grep 实际迁移结果为准增删）
git commit -m "feat: attributeVersion 双计数器失效（命令/突变点 bump 覆盖 + stale guard 双比较）"
```

---

### Task 2: 表达式求值器（MapLibre 静态子集）

- [ ] **Step 0: impact gate**——纯新文件，无既有符号修改；跳过 impact。

**Files:**
- Create: `src/map/style-expression.ts`
- Test: `src/map/style-expression.test.ts`

**Interfaces:**
- Produces: `StyleExpression`（`readonly unknown[]`）、`CompiledExpression`、`compileStyleExpression(expr)`、`isStyleExpression(v)`、`StyleExpressionError`。Task 6/8 依赖。

- [ ] **Step 1: 失败测试**

`src/map/style-expression.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { compileStyleExpression, isStyleExpression, StyleExpressionError } from './style-expression';

const rec = { pop: 100, name: 'A', flag: true };

describe('compileStyleExpression atoms', () => {
  it('get returns field or null', () => {
    expect(compileStyleExpression(['get', 'pop'])(rec)).toBe(100);
    expect(compileStyleExpression(['get', 'missing'])(rec)).toBeNull();
    expect(compileStyleExpression(['get', 'pop'])(null)).toBeNull();
  });
  it('literal scalars evaluate to themselves', () => {
    expect(compileStyleExpression(5 as any)(rec)).toBe(5);
    expect(compileStyleExpression('#fff' as any)(rec)).toBe('#fff');
  });
  it('comparisons coerce numbers and strict-equal others', () => {
    expect(compileStyleExpression(['>', ['get', 'pop'], 50])(rec)).toBe(true);
    expect(compileStyleExpression(['<=', ['get', 'pop'], 100])(rec)).toBe(true);
    expect(compileStyleExpression(['==', ['get', 'name'], 'A'])(rec)).toBe(true);
    expect(compileStyleExpression(['==', ['get', 'pop'], '100'])(rec)).toBe(false);
    expect(compileStyleExpression(['<', ['get', 'name'], 1])(rec)).toBe(false); // NaN → false
  });
  it('logic atoms', () => {
    expect(compileStyleExpression(['!', ['get', 'flag']])(rec)).toBe(false);
    expect(compileStyleExpression(['all', ['>', ['get', 'pop'], 1], ['get', 'flag']])(rec)).toBe(true);
    expect(compileStyleExpression(['any', ['==', ['get', 'name'], 'B'], ['get', 'flag']])(rec)).toBe(true);
  });
  it('match with fallback', () => {
    const fn = compileStyleExpression(['match', ['get', 'name'], 'A', '#111', '#999']);
    expect(fn(rec)).toBe('#111');
    expect(fn({ name: 'B' })).toBe('#999');
    expect(compileStyleExpression(['match', ['get', 'name'], ['A', 'B'], 1, 0] as any)(rec)).toBe(1);
  });
  it('step boundaries', () => {
    const fn = compileStyleExpression(['step', ['get', 'pop'], '#a', 100, '#b', 200, '#c']);
    expect(fn({ pop: 50 })).toBe('#a');
    expect(fn({ pop: 100 })).toBe('#b');
    expect(fn({ pop: 999 })).toBe('#c');
    expect(fn({ pop: null })).toBe('#a'); // 非数 → 第一段
  });
  it('interpolate linear numeric with clamping', () => {
    const fn = compileStyleExpression(['interpolate', 'linear', ['get', 'pop'], 0, 0, 100, 10]);
    expect(fn({ pop: 50 })).toBe(5);
    expect(fn({ pop: -5 })).toBe(0);
    expect(fn({ pop: 500 })).toBe(10);
  });
  it('interpolate linear hex colors', () => {
    const fn = compileStyleExpression(['interpolate', 'linear', ['get', 'pop'], 0, '#000000', 100, '#ffffff']);
    expect(fn({ pop: 50 })).toBe('rgb(128,128,128)');
  });
  it('interpolate with color outputs quantizes input to 256 global levels (bucket cardinality bound)', () => {
    const fn = compileStyleExpression(['interpolate', 'linear', ['get', 'pop'], 0, '#000000', 100, '#ffffff']);
    expect(fn({ pop: 1 })).toBe(fn({ pop: 1.001 })); // 同全域桶
    expect(fn({ pop: 50 })).toBe('rgb(128,128,128)'); // 0.5 可精确表示，不变
  });
  it('multi-stop color interpolate keeps total distinct outputs ≤ 257', () => {
    const fn = compileStyleExpression([
      'interpolate', 'linear', ['get', 'v'],
      0, '#000000', 33, '#ff0000', 66, '#00ff00', 100, '#ffffff',
    ]);
    const distinct = new Set<string>();
    for (let k = 0; k < 2000; k++) distinct.add(String(fn({ v: (k * 100) / 1999 })));
    expect(distinct.size).toBeLessThanOrEqual(257);
  });
});

describe('validation', () => {
  it('rejects unknown op / bad arity at compile time', () => {
    expect(() => compileStyleExpression(['bogus', 1] as any)).toThrow(StyleExpressionError);
    expect(() => compileStyleExpression(['get'] as any)).toThrow(StyleExpressionError);
    expect(() => compileStyleExpression(['interpolate', 'cubic', ['get', 'pop'], 0, 0] as any)).toThrow(StyleExpressionError);
    expect(() => compileStyleExpression(['step', ['get', 'pop']] as any)).toThrow(StyleExpressionError);
  });
  it('isStyleExpression narrows arrays with string op', () => {
    expect(isStyleExpression(['get', 'a'])).toBe(true);
    expect(isStyleExpression('#fff')).toBe(false);
    expect(isStyleExpression([])).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run src/map/style-expression.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`src/map/style-expression.ts` 完整实现：

```ts
// style-expression — MapLibre 静态表达式子集求值器（纯函数、无 eval）。
// 支持原子：get / match / step / interpolate(linear) / == != < <= > >= / ! / all / any。
// 编译期结构校验（非法即抛 StyleExpressionError），运行期零分配闭包。

export type StyleExpression = readonly unknown[];
export type CompiledExpression = (record: Record<string, unknown> | null | undefined) => unknown;

export class StyleExpressionError extends Error {
  override readonly name = 'StyleExpressionError';
}

/** 颜色插值 t 的量化级数（spec §4.2 桶基数策略，默认 256）。 */
const INTERPOLATE_LEVELS = 256;

export function isStyleExpression(value: unknown): value is StyleExpression {
  return Array.isArray(value) && value.length > 0 && typeof value[0] === 'string';
}

export function compileStyleExpression(expr: StyleExpression | string | number | boolean | null): CompiledExpression {
  return compileNode(expr, '$');
}

function fail(path: string, msg: string): never {
  throw new StyleExpressionError(`${path}: ${msg}`);
}

type Node = (rec: Record<string, unknown> | null | undefined) => unknown;

function compileNode(node: unknown, path: string): Node {
  if (!isStyleExpression(node)) {
    if (node === null || typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
      const c = node;
      return () => c;
    }
    fail(path, `unsupported value ${JSON.stringify(node)}`);
  }
  const [op, ...args] = node as unknown[];
  const at = (i: number) => `${path}[${i + 1}]`;
  switch (op) {
    case 'get': {
      if (args.length !== 1 || typeof args[0] !== 'string') fail(path, `get expects 1 string field`);
      const field = args[0] as string;
      return (rec) => (rec as any)?.[field] ?? null;
    }
    case '==': case '!=': {
      const [a, b] = binary(node as unknown[], path);
      const fa = compileNode(a, at(0)), fb = compileNode(b, at(1));
      return op === '==' ? (r) => fa(r) === fb(r) : (r) => fa(r) !== fb(r);
    }
    case '<': case '<=': case '>': case '>=': {
      const [a, b] = binary(node as unknown[], path);
      const fa = compileNode(a, at(0)), fb = compileNode(b, at(1));
      return (r) => {
        const x = Number(fa(r)), y = Number(fb(r));
        if (Number.isNaN(x) || Number.isNaN(y)) return false;
        return op === '<' ? x < y : op === '<=' ? x <= y : op === '>' ? x > y : x >= y;
      };
    }
    case '!': {
      if (args.length !== 1) fail(path, `! expects 1 arg`);
      const f = compileNode(args[0], at(0));
      return (r) => !f(r);
    }
    case 'all': case 'any': {
      if (args.length === 0) fail(path, `${op} expects >=1 args`);
      const fs = args.map((a, i) => compileNode(a, at(i)));
      return op === 'all' ? (r) => fs.every((f) => !!f(r)) : (r) => fs.some((f) => !!f(r));
    }
    case 'match': {
      if (args.length < 3) fail(path, `match expects input, pairs…, fallback`);
      const input = compileNode(args[0], at(0));
      const pairCount = args.length - 2;
      if (pairCount % 2 !== 0) fail(path, `match pairs must be even`);
      const cases: Array<[unknown, Node]> = [];
      for (let i = 1; i < args.length - 1; i += 2) {
        cases.push([args[i], compileNode(args[i + 1], at(i + 1))]);
      }
      const fallback = compileNode(args[args.length - 1], at(args.length - 1));
      return (r) => {
        const v = input(r);
        for (const [k, out] of cases) {
          if (Array.isArray(k) && !isStyleExpression(k)) {
            if ((k as unknown[]).some((x) => x === v)) return out(r);
          } else if (k === v) return out(r);
        }
        return fallback(r);
      };
    }
    case 'step': {
      // step args = [input, out0, (stop, out)…] → 偶数且 ≥ 4
      if (args.length < 4 || args.length % 2 !== 0) fail(path, `step expects input, out0, (stop, out)…`);
      const input = compileNode(args[0], at(0));
      const outs: Node[] = [compileNode(args[1], at(1))];
      const stops: number[] = [];
      for (let i = 2; i < args.length; i += 2) {
        const s = args[i];
        if (typeof s !== 'number') fail(at(i), `step stop must be number`);
        if (stops.length > 0 && s <= stops[stops.length - 1]) fail(at(i), `step stops must ascend`);
        stops.push(s);
        outs.push(compileNode(args[i + 1], at(i + 1)));
      }
      return (r) => {
        const v = Number(input(r));
        let idx = 0;
        if (!Number.isNaN(v)) while (idx < stops.length && v >= stops[idx]) idx++;
        return outs[idx](r);
      };
    }
    case 'interpolate': {
      // interpolate args = ['linear', input, (stop, out)…] → 偶数且 ≥ 6（至少两对 stop/out）
      if (args.length < 6 || args[0] !== 'linear' || args.length % 2 !== 0)
        fail(path, `interpolate expects 'linear', input, (stop, out)…`);
      const input = compileNode(args[1], at(1));
      const stops: number[] = [];
      const outs: Node[] = [];
      // 颜色输出对的连续插值会产出 K≈N 种颜色；量化输入到全域 256 级以约束桶基数
      //（spec §4.2）。数值输出不量化（精确语义留给 radius 等场景）。
      // ≤257 保证仅适用于全静态输出：动态输出（如 ['get','color']）不受此帽约束，
      // 其基数由 resolver 的 K>256 warn 兜底（spec §4.2 双机制）。
      let quantize = false;
      for (let i = 2; i < args.length; i += 2) {
        const s = args[i];
        if (typeof s !== 'number') fail(at(i), `interpolate stop must be number`);
        if (stops.length > 0 && s <= stops[stops.length - 1]) fail(at(i), `stops must ascend`);
        stops.push(s);
        outs.push(compileNode(args[i + 1], at(i + 1)));
        if (typeof args[i + 1] === 'string' && parseColor(args[i + 1])) quantize = true;
      }
      return (r) => {
        const raw = Number(input(r));
        if (Number.isNaN(raw)) return outs[0](r);
        if (raw <= stops[0]) return outs[0](r);
        if (raw >= stops[stops.length - 1]) return outs[outs.length - 1](r);
        // 颜色插值：把输入值量化到全域 [stops[0], stops[last]] 的 256 个端点含桶，
        // 再定位段插值——总输出 ≤ 257（逐段量化 t 的上界是 256×段数，不满足全局桶帽）。
        const v = quantize
          ? stops[0] +
            ((stops[stops.length - 1] - stops[0]) *
              Math.round(((raw - stops[0]) / (stops[stops.length - 1] - stops[0])) * INTERPOLATE_LEVELS)) /
              INTERPOLATE_LEVELS
          : raw;
        let i = 0;
        while (v >= stops[i + 1]) i++;
        const t = (v - stops[i]) / (stops[i + 1] - stops[i]);
        const a = outs[i](r), b = outs[i + 1](r);
        if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t;
        const ca = parseColor(a), cb = parseColor(b);
        if (ca && cb) {
          return `rgb(${Math.round(ca[0] + (cb[0] - ca[0]) * t)},${Math.round(ca[1] + (cb[1] - ca[1]) * t)},${Math.round(ca[2] + (cb[2] - ca[2]) * t)})`;
        }
        return t < 0.5 ? a : b;
      };
    }
    default:
      fail(path, `unknown expression op "${String(op)}"`);
  }
}

function binary(node: unknown[], path: string): [unknown, unknown] {
  if (node.length !== 3) fail(path, `${String(node[0])} expects 2 args`);
  return [node[1], node[2]];
}

function parseColor(v: unknown): [number, number, number] | null {
  if (typeof v !== 'string') return null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(v);
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3]];
  return null;
}
```

- [ ] **Step 4: 运行通过 + typecheck + commit**

Run: `pnpm vitest run src/map/style-expression.test.ts && pnpm typecheck`
Expected: PASS / 0 errors
Commit:（先 `detect_changes({ repo: 'emap', scope: 'staged' })` 核对仅新增求值器）`git add src/map/style-expression.ts src/map/style-expression.test.ts && git commit -m "feat: MapLibre 子集表达式求值器（get/match/step/interpolate/比较/逻辑）"`

---

### Task 3: 断点与计数算法

- [ ] **Step 0: impact gate**——纯新文件（`_classify-breaks.ts`），无既有符号修改；跳过 impact。

**Files:**
- Create: `src/map/ops/_classify-breaks.ts`
- Test: `src/map/ops/_classify-breaks.test.ts`

**Interfaces:**
- Produces: `quantileBreaks`、`equalIntervalBreaks`、`niceBreaks`、`classIndexOf`、`summarizeSequential`、`summarizeCategorical`。Task 4 依赖。

- [ ] **Step 1: 失败测试**

`_classify-breaks.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import {
  classIndexOf,
  equalIntervalBreaks,
  niceBreaks,
  quantileBreaks,
  summarizeCategorical,
  summarizeSequential,
} from './_classify-breaks';

describe('breaks', () => {
  it('quantile of 1..100 into 4 classes', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(quantileBreaks(values, 4)).toEqual([25, 50, 75]);
  });
  it('equal-interval 0..100 into 4', () => {
    expect(equalIntervalBreaks(0, 100, 4)).toEqual([25, 50, 75]);
  });
  it('nice rounds step to 1/2/2.5/5×10^k', () => {
    expect(niceBreaks(3, 97, 4)).toEqual([25, 50, 75]);
    expect(niceBreaks(0, 43, 4)).toEqual([12.5, 25, 37.5]);
  });
  it('classIndexOf: boundary belongs to upper class; below-first → 0', () => {
    expect(classIndexOf(9, [10, 25])).toBe(0);
    expect(classIndexOf(10, [10, 25])).toBe(1);
    expect(classIndexOf(999, [10, 25])).toBe(2);
  });
});

describe('summaries honour 划分不变量', () => {
  it('sequential counts + nullCount === total', () => {
    const s = summarizeSequential([1, 20, 30, null, undefined, Number.NaN], [10, 25]);
    expect(s.counts).toEqual([1, 1, 1]);
    expect(s.nullCount).toBe(3);
  });
  it('categorical counts + otherCount + nullCount === total', () => {
    const s = summarizeCategorical(['a', 'b', 'c', 'c', null, 7], ['a', 'b']);
    expect(s.counts).toEqual([1, 1]);
    expect(s.otherCount).toBe(3); // 'c'×2, 7
    expect(s.nullCount).toBe(1);
  });
  it('empty input', () => {
    expect(summarizeSequential([], [1]).counts).toEqual([0, 0]);
    expect(summarizeCategorical([], ['x'])).toEqual({ counts: [0], otherCount: 0, nullCount: 0 });
  });
});
```

- [ ] **Step 2: 运行确认失败** — `pnpm vitest run src/map/ops/_classify-breaks.test.ts` → FAIL

- [ ] **Step 3: 实现**

`_classify-breaks.ts`：

```ts
// _classify-breaks — classifyFeatures 的断点/计数纯函数。断点权威在 emap：
// mapshaper 只收显式 breaks/colors 做逐记录映射。

/** Interior breaks (length classes-1) at quantile positions. 输入须已升序。 */
export function quantileBreaks(sorted: readonly number[], classes: number): number[] {
  const n = sorted.length;
  if (n === 0) return [];
  const out: number[] = [];
  for (let i = 1; i < classes; i++) {
    out.push(sorted[Math.floor((i * (n - 1)) / classes)]);
  }
  return out;
}

export function equalIntervalBreaks(min: number, max: number, classes: number): number[] {
  const step = (max - min) / classes;
  return Array.from({ length: classes - 1 }, (_, i) => min + step * (i + 1));
}

/** Nice-number breaks：取不大于 rough 的 nice 单位（1/2/2.5/5×10^k），
 * 把 [min,max] 向外形舍到单位整数倍，再等分为 classes 段取内部断点。 */
export function niceBreaks(min: number, max: number, classes: number): number[] {
  const rough = (max - min) / classes;
  if (!(rough > 0) || !Number.isFinite(rough)) return equalIntervalBreaks(min, max, classes);
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  const unit = (norm >= 5 ? 5 : norm >= 2.5 ? 2.5 : norm >= 2 ? 2 : 1) * mag;
  const lo = Math.floor(min / unit) * unit;
  const hi = Math.ceil(max / unit) * unit;
  return equalIntervalBreaks(lo, hi, classes).map((v) => +v.toFixed(10));
}

/** 边界归上段（v >= break 前进）；低于首断点 → 0。 */
export function classIndexOf(value: number, breaks: readonly number[]): number {
  let idx = 0;
  while (idx < breaks.length && value >= breaks[idx]) idx++;
  return idx;
}

function isNullish(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v));
}

export function summarizeSequential(
  values: readonly unknown[],
  breaks: readonly number[],
): { counts: number[]; nullCount: number } {
  const counts = new Array<number>(breaks.length + 1).fill(0);
  let nullCount = 0;
  for (const v of values) {
    if (isNullish(v)) nullCount++;
    else counts[classIndexOf(Number(v), breaks)]++;
  }
  return { counts, nullCount };
}

export function summarizeCategorical(
  values: readonly unknown[],
  categories: readonly (string | number)[],
): { counts: number[]; otherCount: number; nullCount: number } {
  const index = new Map<unknown, number>(categories.map((c, i) => [c, i]));
  const counts = new Array<number>(categories.length).fill(0);
  let otherCount = 0;
  let nullCount = 0;
  for (const v of values) {
    if (isNullish(v)) nullCount++;
    else {
      const i = index.get(v as string | number);
      if (i === undefined) otherCount++;
      else counts[i]++;
    }
  }
  return { counts, otherCount, nullCount };
}
```

- [ ] **Step 4: 运行通过 + commit**

Run: `pnpm vitest run src/map/ops/_classify-breaks.test.ts && pnpm typecheck`
Commit:（先 detect_changes 核对）`git add src/map/ops/_classify-breaks.ts src/map/ops/_classify-breaks.test.ts && git commit -m "feat: classify 断点/计数纯函数（quantile/equal-interval/nice/categorical 汇总）"`

---

### Task 4: classifyFeatures op

- [ ] **Step 0: impact gate**——`classify-features.ts` 为新文件；对既有修改点
  `COMMAND_EFFECTS`（_runner.ts）、`MapshaperOps` facade（mapshaper-ops.ts）跑
  `impact`（upstream）；本 Task 只加行/加方法，不改既有行为。

**Files:**
- Create: `src/map/ops/classify-features.ts`
- Modify: `src/map/ops/_runner.ts:78`（COMMAND_EFFECTS 加 `classify: 'attribute-only'`）
- Modify: `src/map/types.ts`（`ClassifyFeaturesOptions`、`ClassificationResult`）
- Modify: `src/map/mapshaper-ops.ts`（facade 方法）
- Modify: `src/index.ts`（导出类型）
- Test: `src/map/ops/classify-features.test.ts`、`src/map/ops/classify-features.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 `bumpAttributeVersion`；Task 3 全部函数；`OpContext`（`host._sources`、`runDatasetCommandParsed`）；`ParsedCommand = { name: string; options: Record<string, unknown> }`；`resolveLayerInList` from `../layer-registry`；`Err/OpResult` from `../op-result`；`EMAP_THEME_COLORS` from `../../theme/colors`。
- Produces: `classifyFeatures(ctx, opts): Promise<OpResult<ClassificationResult>>`；facade `map.ops.classifyFeatures(opts)`。

- [ ] **Step 1: 失败测试（unit，stub ctx）**

`classify-features.test.ts`（仿 `split-selected.test.ts` 的 `makeStubCtx`）：

```ts
import { describe, expect, it, vi } from 'vitest';
import { classifyFeatures } from './classify-features';
import { makeStubCtx } from './_test-helpers';

function ctxWithLayer(records: Array<Record<string, unknown>>) {
  const { ctx } = makeStubCtx();
  const layer = { geometry_type: 'polygon', shapes: [[[0]]], data: { getRecords: () => records } };
  const dataset: any = { layers: [layer], arcs: null, editVersion: 0, attributeVersion: 0 };
  (ctx.host._sources.get as any) = vi.fn().mockReturnValue({ getDataset: () => dataset });
  const run = vi.fn().mockResolvedValue({ ok: true, value: undefined });
  (ctx as any).runDatasetCommandParsed = run;
  return { ctx, dataset, run };
}

describe('classifyFeatures validation', () => {
  it('rejects missing field / non-numeric sequential / classes<2 / empty colors', async () => {
    const { ctx } = ctxWithLayer([{ pop: 1 }]);
    await expect(
      classifyFeatures(ctx, { source: 's', target: 'l', field: 'nope', method: 'quantile', classes: 4, colors: ['#111'] } as any),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'validation' } });
    await expect(
      classifyFeatures(ctx, { source: 's', target: 'l', field: 'pop', method: 'quantile', classes: 1, colors: ['#111', '#222'] } as any),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      classifyFeatures(ctx, { source: 's', target: 'l', field: 'pop', method: 'quantile', classes: 4, colors: [] } as any),
    ).resolves.toMatchObject({ ok: false });
  });

  it('emits explicit breaks/colors/null_value and bumps attributeVersion', async () => {
    const { ctx, dataset, run } = ctxWithLayer([{ pop: 10 }, { pop: 20 }, { pop: 30 }, { pop: 40 }]);
    const res = await classifyFeatures(ctx, {
      source: 's', target: 'l', field: 'pop', method: 'equal-interval', classes: 2,
      colors: ['#111111', '#999999'], nullValue: '#eeeeee',
    } as any);
    expect(res.ok).toBe(true);
    const commands = run.mock.calls[0][1];
    expect(commands[0]).toEqual({ name: 'target', options: { target: 'l' } });
    expect(commands[1].name).toBe('classify');
    expect(commands[1].options).toMatchObject({
      field: 'pop', breaks: [25], colors: ['#111111', '#999999'],
      save_as: 'fill', null_value: '#eeeeee',
    });
    expect(dataset.attributeVersion).toBe(1);
    expect(res).toMatchObject({ value: { kind: 'sequential', breaks: [25], counts: [2, 2], nullColor: '#eeeeee', nullCount: 0, featureCount: 4 } });
  });

  it('categorical echoes effective other/null colors and counts', async () => {
    const { ctx, run } = ctxWithLayer([{ t: 'a' }, { t: 'z' }, { t: null }]);
    const res = await classifyFeatures(ctx, {
      source: 's', target: 'l', field: 't', method: 'categorical',
      categories: ['a'], colors: ['#111111'], nullValue: '#eeeeee', otherColor: '#123456',
    } as any);
    expect(classifyOptionsOf(run)).toMatchObject({ categories: ['a'], other: '#123456', null_value: '#eeeeee' });
    expect(res).toMatchObject({ value: { kind: 'categorical', counts: [1], otherCount: 1, nullCount: 1, otherColor: '#123456', nullColor: '#eeeeee' } });
  });
});

function classifyOptionsOf(run: any) {
  return run.mock.calls[0][1][1].options;
}
```

- [ ] **Step 2: 运行确认失败** — `pnpm vitest run src/map/ops/classify-features.test.ts` → FAIL

- [ ] **Step 3: 实现 op**

`src/map/types.ts` 追加（TypeDoc 注释完整，`@example` 必备——`docs:check-api` 要求）：

```ts
/** Options for `Emap.ops.classifyFeatures`. */
export interface ClassifyFeaturesOptions {
  source: string;
  target: string;
  field: string;
  method: 'quantile' | 'equal-interval' | 'nice' | 'categorical';
  classes?: number;
  breaks?: number[];
  categories?: (string | number)[];
  colors: string[];
  saveAs?: string;
  nullValue?: string;
  otherColor?: string;
  invert?: boolean;
}

export type ClassificationResult =
  | {
      kind: 'sequential';
      method: 'quantile' | 'equal-interval' | 'nice';
      breaks: number[];
      colors: string[];
      counts: number[];
      nullColor: string;
      nullCount: number;
      saveAs: string;
      featureCount: number;
    }
  | {
      kind: 'categorical';
      categories: (string | number)[];
      colors: string[];
      counts: number[];
      otherColor: string;
      otherCount: number;
      nullColor: string;
      nullCount: number;
      saveAs: string;
      featureCount: number;
    };
```

`src/map/ops/classify-features.ts`：

```ts
// classifyFeatures — 属性分级烘焙。断点/类别与计数在 emap 侧计算（权威），
// mapshaper -classify 只收显式 breaks/categories/colors 做逐记录字段写入。
// null/other 始终传 effective 色并回显（见 spec §4.1）。

import type { ParsedCommand } from '../../adapter/mapshaper-adapter';
import { EMAP_THEME_COLORS } from '../../theme/colors';
import { bumpAttributeVersion } from '../../types/mapshaper-types';
import { resolveLayerInList } from '../layer-registry';
import { Err, type OpResult } from '../op-result';
import type { ClassificationResult, ClassifyFeaturesOptions } from '../types';
import type { OpContext } from './_context';
import {
  equalIntervalBreaks,
  niceBreaks,
  quantileBreaks,
  summarizeCategorical,
  summarizeSequential,
} from './_classify-breaks';

export async function classifyFeatures(
  ctx: OpContext,
  opts: ClassifyFeaturesOptions,
): Promise<OpResult<ClassificationResult>> {
  const source = ctx.host._sources.get(opts.source);
  const dataset = source?.getDataset?.();
  if (!source || !dataset) return Err.notFound('source', opts.source);
  const layer = resolveLayerInList(dataset.layers, opts.target);
  if (!layer) return Err.notFound('layer', opts.target);
  const records = layer.data?.getRecords?.() ?? [];
  if (opts.colors.length === 0) return Err.validation('colors', 'at least one color required');

  const values = records.map((r) => r?.[opts.field]);
  if (!(opts.field in (records[0] ?? {})) && records.length > 0 && values.every((v) => v === undefined)) {
    return Err.validation('field', `field "${opts.field}" not found`);
  }

  const nullColor = opts.nullValue ?? EMAP_THEME_COLORS.muted;
  const otherColor = opts.otherColor ?? nullColor;
  const saveAs = opts.saveAs ?? 'fill';
  const options: Record<string, unknown> = {
    field: opts.field,
    colors: opts.colors,
    save_as: saveAs,
    null_value: nullColor,
  };
  if (opts.invert) options.invert = true;

  let result: ClassificationResult;

  if (opts.method === 'categorical') {
    const categories =
      opts.categories ??
      [...new Set(values.filter((v) => v !== null && v !== undefined && !Number.isNaN(v)))] as (
        string | number)[];
    if (categories.length !== opts.colors.length)
      return Err.validation('colors', `colors.length must equal categories.length (${categories.length})`);
    const { counts, otherCount, nullCount } = summarizeCategorical(values, categories);
    options.method = 'categorical';
    options.categories = categories;
    options.other = otherColor;
    result = {
      kind: 'categorical', categories: [...categories], colors: [...opts.colors],
      counts, otherColor, otherCount, nullColor, nullCount, saveAs,
      featureCount: records.length,
    };
  } else {
    const numeric = values.filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));
    if (numeric.length === 0) return Err.validation('field', `field "${opts.field}" has no numeric values`);
    if (numeric.length !== values.length - values.filter((v) => v == null || (typeof v === 'number' && Number.isNaN(v))).length)
      return Err.validation('field', `field "${opts.field}" is not numeric`);
    const classes = opts.classes ?? 4;
    if (opts.breaks === undefined && (!Number.isInteger(classes) || classes < 2))
      return Err.validation('classes', 'classes must be an integer >= 2');
    const sorted = [...numeric].sort((a, b) => a - b);
    const breaks =
      opts.breaks ??
      (opts.method === 'quantile'
        ? quantileBreaks(sorted, classes)
        : opts.method === 'nice'
          ? niceBreaks(sorted[0], sorted[sorted.length - 1], classes)
          : equalIntervalBreaks(sorted[0], sorted[sorted.length - 1], classes));
    if (opts.colors.length !== breaks.length + 1)
      return Err.validation('colors', `colors.length must equal breaks.length + 1 (${breaks.length + 1})`);
    const { counts, nullCount } = summarizeSequential(values, breaks);
    options.breaks = breaks;
    result = {
      kind: 'sequential', method: opts.method, breaks, colors: [...opts.colors],
      counts, nullColor, nullCount, saveAs, featureCount: records.length,
    };
  }

  const commands: ParsedCommand[] = [
    { name: 'target', options: { target: opts.target } },
    { name: 'classify', options },
  ];
  const ran = await ctx.runDatasetCommandParsed(
    opts.source, commands, `Classify ${opts.target} by ${opts.field}`,
  );
  if (!ran.ok) return ran as OpResult<never>;
  // 主线程路径就地改 records；bump 使样式缓存失效（worker 替换路径由引用兜底）。
  bumpAttributeVersion(ctx.host._sources.get(opts.source)?.getDataset?.());
  return { ok: true, value: result };
}
```

`_runner.ts` COMMAND_EFFECTS 的 attribute-only 段追加一行：`classify: 'attribute-only',`。

`mapshaper-ops.ts` facade（仿 renameFields:252）：

```ts
  classifyFeatures(opts: ClassifyFeaturesOptions): Promise<OpResult<ClassificationResult>> {
    return classifyFeatures(this._ctx, opts);
  }
```

（同步 import；`src/index.ts` 导出 `ClassifyFeaturesOptions`/`ClassificationResult` 类型。）

- [ ] **Step 4: unit 通过**

Run: `pnpm vitest run src/map/ops/classify-features.test.ts && pnpm typecheck`
Expected: PASS / 0 errors（若 `makeStubCtx` 不含 `_sources` mock，按其现有形态适配 stub——先读 `_test-helpers.ts`）

- [ ] **Step 5: 集成测试（真实 adapter 烘焙 + undo）**

在 `src/map/map.test.ts` 追加 describe 块（fixture 仿 `setupDataEngineeringMap`
约 5198 行，但不 spy mapshaper internals——让真实 `-classify` 在真数据集上跑；
`createBareMap`/`setPrivate`/`EditHistory` 与既有 fixture 同源 import）：

```ts
describe('Emap classifyFeatures (real baking + undo)', () => {
  it('bakes explicit fill colors incl. effective null; undo restores records', async () => {
    const adapter = getDefaultMapshaperAdapter();
    const dataset = await adapter.runImport('-i "d.geojson"', {
      'd.geojson': JSON.stringify({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: { pop: 10 }, geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] } },
          { type: 'Feature', properties: { pop: 90 }, geometry: { type: 'Polygon', coordinates: [[[2,2],[3,2],[3,3],[2,3],[2,2]]] } },
          { type: 'Feature', properties: { pop: null }, geometry: { type: 'Polygon', coordinates: [[[4,4],[5,4],[5,5],[4,5],[4,4]]] } },
        ],
      }),
    });
    const map = createBareMap();
    // runner 的 dataset 命令是 copy+replace 契约（setDataset(after)）：
    // stub 必须让引用可变，断言一律读 current。
    let current: any = dataset;
    (map as any)._sources.set('src1', {
      id: 'src1', type: 'topology',
      getDataset: () => current,
      getLayers: () => current.layers,
      setDataset: (next: any) => { current = next; },
      refreshDisplayArcs: vi.fn(),
      fire: vi.fn(),
    });
    const res = await map.ops.classifyFeatures({
      source: 'src1', target: 'd', field: 'pop', method: 'equal-interval',
      classes: 2, colors: ['#111111', '#999999'], nullValue: '#eeeeee',
    });
    expect(res.ok).toBe(true);
    let records = current.layers[0].data.getRecords();
    expect(records.map((r) => r.fill)).toEqual(['#111111', '#999999', '#eeeeee']);
    expect(current.attributeVersion).toBeGreaterThanOrEqual(1);
    expect(map.undo()).toBe(true); // replace 撤销 → current 指回 before
    records = current.layers[0].data.getRecords();
    expect(records.map((r) => r.fill)).toEqual([undefined, undefined, undefined]);
  });
});
```

- [ ] **Step 6: 全量相关测试 + commit**

Run: `pnpm vitest run src/map/ops/classify-features.test.ts src/map/ops/_runner.test.ts src/map/map.test.ts && pnpm typecheck`
```bash
# 提交前：detect_changes({ repo: 'emap', scope: 'staged' }) 核对
git add src/map/ops/classify-features.ts src/map/ops/classify-features.test.ts \
  src/map/ops/_runner.ts src/map/ops/_runner.test.ts src/map/types.ts \
  src/map/mapshaper-ops.ts src/index.ts src/map/map.test.ts
git commit -m "feat: classifyFeatures op（显式断点转发 + 判别联合返回 + effective null/other 色）"
```

---

### Task 5: worker 路由 recordCount 扩展

- [ ] **Step 0: impact gate**——对 `shouldUseWorkerForHeads`、`shouldUseWorker`、
  `WorkerRoutingFn`、`getWorkerCountHint` 跑 `impact`（upstream）；HIGH/CRITICAL 先报告。

**Files:**
- Modify: `src/map/worker-routing.ts`
- Modify: `src/map/ops/_runner.ts:599-603`（recordCount 计算与传参）
- Test: `src/map/worker-routing.test.ts`（若已存在则扩展；先 glob 确认）

**Interfaces:**
- Produces: `shouldUseWorkerForHeads(heads, vertexCount, mode, threshold, recordCount?)`；`WorkerRoutingFn` info 增 `recordCount: number`。

- [ ] **Step 1: 失败测试**

```ts
describe('recordCount routing', () => {
  it('classify routes by recordCount even at vertexCount=0', () => {
    expect(shouldUseWorkerForHeads(['classify'], 0, 'auto', 100, 10_000)).toBe(true);
    expect(shouldUseWorkerForHeads(['classify'], 0, 'auto', 100, 50)).toBe(false);
  });
  it('non-record commands ignore recordCount', () => {
    expect(shouldUseWorkerForHeads(['simplify'], 0, 'auto', 100, 10_000)).toBe(false);
  });
  it('WorkerRoutingFn receives recordCount; legacy callbacks unaffected', () => {
    // 仿既有 WorkerRoutingFn 调用点测试：info.recordCount 存在且默认 0
  });
});
```

- [ ] **Step 2: 实现**

`worker-routing.ts`：

```ts
/** Commands whose cost scales with record count, not vertex count. */
const RECORD_SCALE_COMMANDS: ReadonlySet<string> = new Set(['classify', 'style']);
```

`shouldUseWorkerForHeads` 签名加 `recordCount = 0`，在 vertex 判定前插入：

```ts
  if (heads.some((h) => RECORD_SCALE_COMMANDS.has(h))) {
    return recordCount >= effectiveThreshold;
  }
```

`WorkerRoutingFn` info 增 `recordCount: number`。`_runner.ts` ~599：

```ts
const vertexCount = working.arcs?.getPointCount?.() ?? 0;
const recordCount = working.layers.reduce(
  (n, l) => n + (l.data?.getRecords?.()?.length ?? 0),
  0,
);
```

两处使用点（默认决策 + 用户回调 info）都传入 recordCount。

- [ ] **Step 3: 通过 + commit**

Run: `pnpm vitest run src/map/worker-routing.test.ts src/map/ops/_runner.test.ts && pnpm typecheck`
```bash
# 提交前：detect_changes({ repo: 'emap', scope: 'staged' }) 核对
git add src/map/worker-routing.ts src/map/worker-routing.test.ts src/map/ops/_runner.ts
git commit -m "feat: worker 路由 recordCount 主键（classify/style 按记录数卸载）"
```

---

### Task 6: StyleResolver

- [ ] **Step 0: impact gate**——纯新文件（`style-resolver.ts`），无既有符号修改；跳过 impact。

**Files:**
- Create: `src/map/style-resolver.ts`
- Test: `src/map/style-resolver.test.ts`

**Interfaces:**
- Consumes: Task 2 `compileStyleExpression/isStyleExpression`；`EMAP_THEME_COLORS`；`MapshaperDataset.attributeVersion`。
- Produces（Task 8 依赖）:

```ts
export interface ResolvedFillStyle { color: string }
export interface StyleResolution {
  styleIds: Uint32Array;
  styles: readonly ResolvedFillStyle[];
  fillBuckets: Uint32Array[];
}
export class StyleResolver {
  resolveFill(args: {
    layerId: string;
    paint: FillLayerPaint | undefined;
    styleSource: 'mapshaper' | undefined;
    dataset: MapshaperDataset;
    layer: MapshaperLayer;
  }): StyleResolution | null;
}
```

- [ ] **Step 1: 失败测试**

`style-resolver.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { StyleResolver } from './style-resolver';

function makeLayer(records: Array<Record<string, unknown>>, shapes: unknown[] | null = null) {
  return {
    geometry_type: 'polygon',
    shapes: shapes ?? records.map((_, i) => [[i]]),
    data: { getRecords: () => records },
  } as any;
}
const dataset = { layers: [], arcs: null, editVersion: 0, attributeVersion: 0 } as any;

describe('StyleResolver.resolveFill', () => {
  it('returns null for static layers (no expression, no opt-in)', () => {
    const r = new StyleResolver();
    expect(r.resolveFill({ layerId: 'a', paint: { 'fill-color': '#fff' }, styleSource: undefined, dataset, layer: makeLayer([{}]) })).toBeNull();
  });
  it('evaluates match expression into LUT + buckets', () => {
    const r = new StyleResolver();
    const layer = makeLayer([{ t: 'a' }, { t: 'b' }, { t: 'a' }]);
    const res = r.resolveFill({
      layerId: 'a',
      paint: { 'fill-color': ['match', ['get', 't'], 'a', '#111111', '#999999'] },
      styleSource: undefined, dataset, layer,
    })!;
    expect(res.styles.map((s) => s.color)).toEqual(['#111111', '#999999']);
    expect([...res.styleIds]).toEqual([0, 1, 0]);
    expect([...res.fillBuckets[0]]).toEqual([0, 2]);
    expect([...res.fillBuckets[1]]).toEqual([1]);
  });
  it('declared static fill-color wins over styleSource opt-in', () => {
    const r = new StyleResolver();
    const layer = makeLayer([{ fill: '#123456' }]);
    expect(
      r.resolveFill({ layerId: 'a', paint: { 'fill-color': '#ffffff' }, styleSource: 'mapshaper', dataset, layer }),
    ).toBeNull();
  });
  it('opt-in reads baked fill field; eval/type errors land in null bucket (theme)', () => {
    const r = new StyleResolver();
    const layer = makeLayer([{ fill: '#123456' }, { fill: 42 }, {}]);
    const res = r.resolveFill({ layerId: 'a', paint: undefined, styleSource: 'mapshaper', dataset, layer })!;
    expect(res.styles[0].color).toBe('#123456');
    // 42 与缺失 → null 桶（最后一个 style，主题色）
    const nullStyle = res.styles.length - 1;
    expect([...res.styleIds]).toEqual([0, nullStyle, nullStyle]);
  });
  it('continuous interpolate stays bucket-bounded (≤ 257 + null)', () => {
    const r = new StyleResolver();
    const records = Array.from({ length: 1000 }, (_, i) => ({ v: i / 10 }));
    const layer = makeLayer(records);
    const res = r.resolveFill({
      layerId: 'a',
      paint: { 'fill-color': ['interpolate', 'linear', ['get', 'v'], 0, '#000000', 100, '#ffffff'] },
      styleSource: undefined, dataset, layer,
    })!;
    expect(res.styles.length).toBeLessThanOrEqual(258);
  });
  it('K above threshold fires onWarn and still renders', () => {
    const warns: Array<{ layerId: string; buckets: number }> = [];
    const r = new StyleResolver({ onWarn: (w) => warns.push(w) });
    const records = Array.from({ length: 300 }, (_, i) => ({ t: `c${i}` }));
    const layer = makeLayer(records);
    // match 300 个不同类别 → K=301（含 null），超 256 阈值
    const matchExpr: unknown[] = ['match', ['get', 't']];
    records.forEach((rec, i) => matchExpr.push(`c${i}`, `#000${String(i).padStart(3, '0')}`));
    matchExpr.push('#ffffff');
    const res = r.resolveFill({ layerId: 'L9', paint: { 'fill-color': matchExpr as any }, styleSource: undefined, dataset, layer });
    expect(res).not.toBeNull();
    expect(warns).toEqual([{ layerId: 'L9', buckets: 301 }]);
  });
  it('rebuild failure keeps stale cache and warns (no blank frame)', () => {
    const warns: unknown[] = [];
    const r = new StyleResolver({ onWarn: (w) => warns.push(w) });
    const layer = makeLayer([{ t: 'a' }]);
    const good: any = { 'fill-color': ['get', 't'] };
    const first = r.resolveFill({ layerId: 'a', paint: good, styleSource: undefined, dataset, layer });
    // 指纹变化 + 求值器抛错（非法结构绕过 addLayer 校验直达 resolver 的场景）
    const bad: any = { 'fill-color': ['bogus-op', 1] };
    const second = r.resolveFill({ layerId: 'a', paint: bad, styleSource: undefined, dataset, layer });
    expect(second).toBe(first);
    expect(warns.length).toBe(1);
  });
  it('cache: same key returns identical reference; attributeVersion bump rebuilds', () => {
    const r = new StyleResolver();
    const layer = makeLayer([{ t: 'a' }]);
    const paint: any = { 'fill-color': ['get', 't'] };
    const a1 = r.resolveFill({ layerId: 'a', paint, styleSource: undefined, dataset, layer });
    const a2 = r.resolveFill({ layerId: 'a', paint, styleSource: undefined, dataset, layer });
    expect(a2).toBe(a1);
    (dataset as any).attributeVersion = 1;
    const a3 = r.resolveFill({ layerId: 'a', paint, styleSource: undefined, dataset, layer });
    expect(a3).not.toBe(a1);
  });
  it('dataset reference swap invalidates', () => {
    const r = new StyleResolver();
    const layer = makeLayer([{ t: 'a' }]);
    const paint: any = { 'fill-color': ['get', 't'] };
    const a1 = r.resolveFill({ layerId: 'a', paint, styleSource: undefined, dataset, layer });
    const other = { ...dataset } as any;
    expect(r.resolveFill({ layerId: 'a', paint, styleSource: undefined, dataset: other, layer })).not.toBe(a1);
  });
});
```

- [ ] **Step 2: 运行确认失败** — `pnpm vitest run src/map/style-resolver.test.ts` → FAIL

- [ ] **Step 3: 实现**

`src/map/style-resolver.ts`：

```ts
// StyleResolver — paint 表达式/烘焙字段 → 每 shape 样式 LUT 与填充桶。
// 缓存键 (表达式指纹, dataset 引用, attributeVersion, layerId)；
// editVersion 不在键中（顶点级编辑不影响样式）。桶构建立在主线程。

import { EMAP_THEME_COLORS } from '../theme/colors';
import type { MapshaperDataset, MapshaperLayer } from '../types/mapshaper-types';
import type { FillLayerPaint } from './layer';
import { compileStyleExpression, isStyleExpression, type CompiledExpression, type StyleExpression } from './style-expression';

export interface ResolvedFillStyle {
  color: string;
}

export interface StyleResolution {
  styleIds: Uint32Array;
  styles: readonly ResolvedFillStyle[];
  fillBuckets: Uint32Array[];
}

interface CacheEntry {
  fingerprint: string;
  dataset: MapshaperDataset;
  attributeVersion: number;
  resolution: StyleResolution;
}

/** K 超阈值/重建失败时的诊断回调；map 接线到 EventDispatcher 'warning' 事件。 */
export interface StyleWarn {
  layerId: string;
  buckets?: number;
  error?: unknown;
}

export class StyleResolver {
  private _cache = new Map<string, CacheEntry>();

  constructor(private readonly _opts: { onWarn?: (warn: StyleWarn) => void } = {}) {}

  resolveFill(args: {
    layerId: string;
    paint: FillLayerPaint | undefined;
    styleSource: 'mapshaper' | undefined;
    dataset: MapshaperDataset;
    layer: MapshaperLayer;
  }): StyleResolution | null {
    const fillSpec = args.paint?.['fill-color'];
    // 逐键回退第 1 级：显式标量 paint 优先——已声明 fill-color 的图层
    // 永远走静态 painter 路径，styleSource 不得劫持（spec §4.2）。
    if (typeof fillSpec === 'string') return null;
    const expr = isStyleExpression(fillSpec) ? fillSpec : null;
    const baked = expr === null && args.styleSource === 'mapshaper';
    if (expr === null && !baked) return null; // 完全未声明：静态默认色

    const fingerprint = JSON.stringify(fillSpec ?? null) + '|' + (args.styleSource ?? '');
    const hit = this._cache.get(args.layerId);
    const attrVersion = args.dataset.attributeVersion ?? 0;
    if (
      hit &&
      hit.dataset === args.dataset &&
      hit.attributeVersion === attrVersion &&
      hit.fingerprint === fingerprint
    ) {
      return hit.resolution;
    }
    try {
      return this._rebuild(args, expr, fingerprint, attrVersion);
    } catch (error) {
      // 重建失败：保留旧缓存 stale 渲染 + warn，不出现空白帧（spec §6）。
      this._opts.onWarn?.({ layerId: args.layerId, error });
      return hit?.resolution ?? null;
    }
  }

  private _rebuild(
    args: Parameters<StyleResolver['resolveFill']>[0],
    expr: StyleExpression | null,
    fingerprint: string,
    attrVersion: number,
  ): StyleResolution {
    const records = args.layer.data?.getRecords?.() ?? [];
    const shapes = args.layer.shapes ?? [];
    const compiled: CompiledExpression | null = expr ? compileStyleExpression(expr) : null;

    const styles: ResolvedFillStyle[] = [];
    const styleIndex = new Map<string, number>();
    const nullColor = EMAP_THEME_COLORS.muted;
    const styleIds = new Uint32Array(shapes.length);

    for (let i = 0; i < shapes.length; i++) {
      let color: unknown = null;
      try {
        if (compiled) color = compiled(records[i]);
        else color = records[i]?.['fill'];
      } catch {
        color = null; // 渲染期隔离：单条异常 → null 桶
      }
      if (typeof color !== 'string' || color.length === 0) color = nullColor;
      let idx = styleIndex.get(color);
      if (idx === undefined) {
        idx = styles.length;
        styleIndex.set(color, idx);
        styles.push({ color });
      }
      styleIds[i] = idx;
    }

    if (styles.length > 256) {
      this._opts.onWarn?.({ layerId: args.layerId, buckets: styles.length });
    }
    const bucketLists: number[][] = styles.map(() => []);
    for (let i = 0; i < styleIds.length; i++) bucketLists[styleIds[i]].push(i);
    const resolution: StyleResolution = {
      styleIds,
      styles,
      fillBuckets: bucketLists.map((list) => Uint32Array.from(list)),
    };
    this._cache.set(args.layerId, {
      fingerprint, dataset: args.dataset, attributeVersion: attrVersion, resolution,
    });
    return resolution;
  }
}
```

- [ ] **Step 4: 通过 + commit**

Run: `pnpm vitest run src/map/style-resolver.test.ts && pnpm typecheck`
Commit:（先 detect_changes 核对）`git add src/map/style-resolver.ts src/map/style-resolver.test.ts && git commit -m "feat: StyleResolver（样式 LUT + fillBuckets + 指纹/引用/attributeVersion 缓存键）"`

---

### Task 7: Painter styleBuckets

- [ ] **Step 0: impact gate**——对 `drawPolygonFill`、`PolygonFillOptions` 跑
  `impact`（upstream）；既有渲染路径零回归为前提。

**Files:**
- Modify: `src/renderer/painter.ts:59-62`（`PolygonFillOptions` 加 `styleBuckets`）
- Modify: `src/renderer/canvas-painter.ts`（`drawPolygonFill` 重构出按索引填充的内层例程）
- Test: `src/renderer/canvas-painter.buckets.test.ts`

**Interfaces:**
- Produces（Task 8 依赖）：

```ts
export interface FillStyleBuckets {
  buckets: readonly Uint32Array[];
  colors: readonly string[];
}
// PolygonFillOptions 增加：styleBuckets?: FillStyleBuckets;
```

- [ ] **Step 1: 失败测试**

`canvas-painter.buckets.test.ts`（harness 逐条对齐 `canvas-painter.batch.test.ts:1-45`
的构造模式：`window` stub → 真 `CanvasPainter` + stub ctx + 私有 `_transform`/`_pixelRatio` 注入）：

```ts
import { describe, expect, it } from 'vitest';

(globalThis as any).window = { devicePixelRatio: 1 };

import { CanvasPainter } from './canvas-painter';

function makeFillHarness(shapeCount: number) {
  const styleSets: string[] = [];
  const fills: Array<string | undefined> = [];
  let tracedParts = 0;
  const ctx: any = {
    canvas: { width: 100, height: 100 },
    globalAlpha: 1,
    set fillStyle(v: string) { styleSets.push(v); },
    get fillStyle() { return ''; },
    beginPath() {},
    fill(rule?: string) { fills.push(rule); },
    moveTo() {}, lineTo() {}, closePath() {}, clearRect() {},
  };
  const canvas = { getContext: () => ctx, width: 100, height: 100, style: {} };
  const painter = new CanvasPainter(canvas as any);
  (painter as any)._transform = { mx: 1, my: 1, bx: 0, by: 0 };
  (painter as any)._pixelRatio = 1;
  const arcs: any = {
    size: () => shapeCount,
    getVertexData: () => ({ nn: Int32Array.from({ length: shapeCount }, () => 2) }),
    getShapeIter: () => {
      tracedParts++;
      let done = false;
      return { x: 0, y: 0, hasNext() { if (done) return false; done = true; return true; } };
    },
  };
  const shapes = Array.from({ length: shapeCount }, (_, i) => [[i]]);
  return { painter, arcs, shapes, styleSets, fills, traced: () => tracedParts };
}

describe('drawPolygonFill styleBuckets', () => {
  it('sets fillStyle once per non-empty bucket; every shape traced exactly once', () => {
    const { painter, arcs, shapes, styleSets, fills, traced } = makeFillHarness(3);
    painter.drawPolygonFill(shapes, arcs, '#000000', undefined, undefined, {
      styleBuckets: {
        buckets: [Uint32Array.from([0, 2]), Uint32Array.from([1])],
        colors: ['#111111', '#999999'],
      },
    });
    expect(styleSets).toEqual(['#111111', '#999999']); // 每桶恰好一次（_resolveColor 对合法 hex 原样返回）
    expect(traced()).toBe(3); // 覆盖完备：跨桶无重复无遗漏
    expect(fills.length).toBeGreaterThanOrEqual(2); // flush 次数由批次边界决定，不断言等于桶数
  });
  it('omitting styleBuckets keeps the legacy single-style path', () => {
    const { painter, arcs, shapes, styleSets, traced } = makeFillHarness(2);
    painter.drawPolygonFill(shapes, arcs, '#123456');
    expect(styleSets).toEqual(['#123456']);
    expect(traced()).toBe(2);
  });
});
```

- [ ] **Step 2: 运行确认失败** — `pnpm vitest run src/renderer/canvas-painter.buckets.test.ts` → FAIL

- [ ] **Step 3: 实现**

`painter.ts`：

```ts
export interface FillStyleBuckets {
  /** styleId → 该桶的 shape 索引（升序、去重）。 */
  buckets: readonly Uint32Array[];
  /** styleId → 颜色，与 buckets 等长。 */
  colors: readonly string[];
}

export interface PolygonFillOptions {
  viewBBox?: readonly [number, number, number, number] | number[] | null;
  /** 存在时逐桶填充（每桶一次样式切换）；缺省走原单样式路径。 */
  styleBuckets?: FillStyleBuckets;
}
```

`canvas-painter.ts` `drawPolygonFill` 重构：把现有 shape 循环抽成 `_fillShapeIndices(shapes, arcs, indices | null, filter, viewBBox)`（`indices=null` 表示 0..length-1），保留全部既有批处理/剔除逻辑；外层：

```ts
    const buckets = options.styleBuckets;
    if (buckets) {
      for (let b = 0; b < buckets.buckets.length; b++) {
        if (buckets.buckets[b].length === 0) continue;
        ctx.fillStyle = this._resolveColor(buckets.colors[b], 'muted');
        this._fillShapeIndices(shapes, arcs, buckets.buckets[b], filter, viewBBox);
      }
    } else {
      ctx.fillStyle = this._resolveColor(fillColor, 'muted');
      this._fillShapeIndices(shapes, arcs, null, filter, viewBBox);
    }
```

（opacity/globalAlpha 处理位置不变，包住整个桶循环。）

- [ ] **Step 4: 通过 + 静态零回归 + commit**

Run: `pnpm vitest run src/renderer/ && pnpm typecheck`
Expected: 全部既有 painter 测试通过（零回归）+ 新测试通过
Commit:（先 detect_changes 核对，确认无渲染路径意外波及）`git add src/renderer/painter.ts src/renderer/canvas-painter.ts src/renderer/canvas-painter.buckets.test.ts && git commit -m "feat: drawPolygonFill 支持 styleBuckets 逐桶填充（静态路径不变）"`

---

### Task 8: 类型、校验与渲染集成

- [ ] **Step 0: impact gate**——对 `renderLayers`/`renderFillLayer`（layer-renderer.ts）、
  `addLayer`、`setPaintProperty`、`Emap._renderLayers` 跑 `impact`（upstream）；
  渲染热路径预计 HIGH/CRITICAL，向用户报告影响面后再实施。

**Files:**
- Modify: `src/map/layer.ts`（`fill-color` 类型放宽 + `styleSource`）
- Modify: `src/map/map.ts`（`addLayer`/`setPaintProperty` 表达式校验；`_styleResolver` 字段；`_renderLayers` ctx 注入；`renderFillLayer` 传 dataset）
- Modify: `src/map/layer-renderer.ts`（`LayerRendererContext` + `renderLayers`/`renderFillLayer`）
- Test: `src/map/layer-renderer.style.test.ts`；`src/map/map.test.ts` 追加 addLayer 校验用例

**Interfaces:**
- Consumes: Task 2/6/7 全部产物。
- Produces: `LayerSpecificationBase.styleSource?: 'mapshaper'`；`FillPaint['fill-color']?: string | StyleExpression`。

- [ ] **Step 1: 失败测试**

`layer-renderer.style.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest';
import { renderLayers } from './layer-renderer';
import { StyleResolver } from './style-resolver';

// 仿 layer-renderer.test.ts 既有 harness（makeSource/viewport/painter stub）
it('fill layer with expression renders via styleBuckets', () => {
  const dataset: any = { editVersion: 0, attributeVersion: 0 };
  const ml: any = {
    geometry_type: 'polygon',
    shapes: [[[0]], [[1]]],
    data: { getRecords: () => [{ t: 'a' }, { t: 'b' }] },
  };
  const painter = { drawPolygonFill: vi.fn(), drawArcs: vi.fn(), drawPoints: vi.fn() };
  const ctx = makeCtx({
    layers: [{ id: 'L', type: 'fill', source: 's', paint: { 'fill-color': ['match', ['get', 't'], 'a', '#111111', '#999999'] } as any }],
    ml, dataset, painter,
  });
  renderLayers(ctx, 1, 1);
  const call = painter.drawPolygonFill.mock.calls[0];
  expect(call[5].styleBuckets.colors).toEqual(['#111111', '#999999']);
  expect([...call[5].styleBuckets.buckets[0]]).toEqual([0]);
  expect([...call[5].styleBuckets.buckets[1]]).toEqual([1]);
});

it('static fill layer does not touch resolver output', () => {
  const painter = { drawPolygonFill: vi.fn(), drawArcs: vi.fn(), drawPoints: vi.fn() };
  const ctx = makeCtx({ layers: [{ id: 'L', type: 'fill', source: 's', paint: { 'fill-color': '#abcdef' } }], painter });
  renderLayers(ctx, 1, 1);
  expect(painter.drawPolygonFill.mock.calls[0][5]?.styleBuckets).toBeUndefined();
});
```

`map.test.ts` 追加：

```ts
it('addLayer rejects invalid style expressions synchronously', () => {
  expect(() =>
    map.addLayer({ id: 'x', type: 'fill', source: 'src1', paint: { 'fill-color': ['bogus', 1] as any } }),
  ).toThrow(/StyleExpression/);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run src/map/layer-renderer.style.test.ts src/map/map.test.ts` → FAIL

- [ ] **Step 3: 实现**

`layer.ts`：

```ts
import type { StyleExpression } from './style-expression';

export interface FillPaint {
  'fill-color'?: string | StyleExpression;
  'fill-opacity'?: number;
}

interface LayerSpecificationBase {
  id: string;
  source: string;
  'source-layer'?: string;
  layout?: LayerLayout;
  /** 显式 opt-in：读取 mapshaper 兼容烘焙样式字段（fill/stroke/stroke-width/r）。 */
  styleSource?: 'mapshaper';
}
```

`layer-renderer.ts`：

```ts
export interface LayerRendererContext {
  // …既有字段…
  styleResolver: StyleResolver;
}
```

`renderLayers` fill 分支传 dataset：`renderFillLayer(ctx, layer, ml, arcs, editVersion, lineScale, source.getDataset?.())`；`renderFillLayer` 加参数并在 drawPolygonFill 前：

```ts
  const resolution = dataset
    ? ctx.styleResolver.resolveFill({
        layerId: layer.id,
        paint: fillPaint,
        styleSource: layer.styleSource,
        dataset,
        layer: ml,
      })
    : null;
  ctx.painter.drawPolygonFill(
    ml.shapes!,
    arcs,
    fillColor,
    cullParts ? viewportFilter : undefined,
    fillOpacity,
    {
      viewBBox: cullParts ? ctx.viewport.getViewBounds() : null,
      ...(resolution
        ? { styleBuckets: { buckets: resolution.fillBuckets, colors: resolution.styles.map((s) => s.color) } }
        : {}),
    },
  );
```

`map.ts`：
- import + 字段 `private _styleResolver = new StyleResolver({ onWarn: (w) => this.fire('warning', w) });`
- `_renderLayers` ctx 对象加 `styleResolver: this._styleResolver`；
- `addLayer`/`setPaintProperty` 校验：

```ts
function assertValidPaint(id: string, paint: Record<string, unknown> | undefined): void {
  if (!paint) return;
  for (const [key, value] of Object.entries(paint)) {
    if (isStyleExpression(value)) {
      try {
        compileStyleExpression(value);
      } catch (err) {
        throw new Error(`Layer "${id}" paint "${key}": ${(err as Error).message}`);
      }
    }
  }
}
```

（`addLayer` 在 source 存在性检查后调用 `assertValidPaint(layer.id, layer.paint)`；`setPaintProperty` 在赋值前对新 value 校验。）

- [ ] **Step 4: 通过 + 零回归 + commit**

Run: `pnpm vitest run src/map/layer-renderer.test.ts src/map/layer-renderer.style.test.ts src/map/map.test.ts && pnpm typecheck`
Expected: PASS（既有 renderer 测试零回归）
Commit:（先 detect_changes 核对渲染热路径影响面）`git add src/map/layer.ts src/map/map.ts src/map/layer-renderer.ts src/map/layer-renderer.style.test.ts src/map/map.test.ts && git commit -m "feat: fill 图层接入 StyleResolver（表达式/烘焙字段 opt-in）与 paint 校验"`

---

### Task 9: 端到端集成与基准

- [ ] **Step 0: impact gate**——只加测试与基准文件，无既有符号修改；跳过 impact。

**Files:**
- Modify: `src/map/map.test.ts`（`setupDataEngineeringMap` fixture 追加 e2e 用例）
- Create: `src/map/style-resolver.bench.test.ts`（env-gated，不进默认 CI）

- [ ] **Step 1: e2e 用例（写失败测试）**

`src/map/map.test.ts` 追加（undo 断言已在 Task 4 集成测试覆盖，这里专注
classify→渲染链路；fixture 与 Task 4 相同）：

```ts
describe('attribute-driven fill render (e2e)', () => {
  it('classifyFeatures then styleSource fill layer renders via styleBuckets', async () => {
    const adapter = getDefaultMapshaperAdapter();
    const dataset = await adapter.runImport('-i "d.geojson"', {
      'd.geojson': JSON.stringify({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: { pop: 10 }, geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] } },
          { type: 'Feature', properties: { pop: 90 }, geometry: { type: 'Polygon', coordinates: [[[2,2],[3,2],[3,3],[2,3],[2,2]]] } },
          { type: 'Feature', properties: { pop: null }, geometry: { type: 'Polygon', coordinates: [[[4,4],[5,4],[5,5],[4,5],[4,4]]] } },
        ],
      }),
    });
    const map = createBareMap();
    let current: any = dataset; // copy+replace 契约：引用可变 stub
    (map as any)._sources.set('src1', {
      id: 'src1', type: 'topology',
      getDataset: () => current,
      getLayers: () => current.layers,
      getArcs: () => current.arcs,
      getDisplayArcs: () => null,
      getSimplifyFloor: () => 0,
      setDataset: (next: any) => { current = next; },
      refreshDisplayArcs: vi.fn(),
      fire: vi.fn(),
    });
    await map.ops.classifyFeatures({
      source: 'src1', target: 'd', field: 'pop', method: 'equal-interval',
      classes: 2, colors: ['#111111', '#999999'], nullValue: '#eeeeee',
    });
    map.addLayer({ id: 'L', type: 'fill', source: 'src1', 'source-layer': 'd', styleSource: 'mapshaper' } as any);
    const painter = { drawPolygonFill: vi.fn(), drawArcs: vi.fn(), drawPoints: vi.fn() };
    setPrivate(map, '_painter', painter);
    (map as any)._renderLayers(1, 1);
    const opts = painter.drawPolygonFill.mock.calls[0][5];
    expect(opts.styleBuckets.colors.slice(0, 2)).toEqual(['#111111', '#999999']);
    expect(opts.styleBuckets.colors).toHaveLength(3); // 第三桶 = null（主题色）
    expect([...opts.styleBuckets.buckets[0]]).toEqual([0]);
    expect([...opts.styleBuckets.buckets[1]]).toEqual([1]);
    expect([...opts.styleBuckets.buckets[2]]).toEqual([2]);
  });
});
```

- [ ] **Step 2: 基准（env-gated）**

`style-resolver.bench.test.ts`：

```ts
import { describe, it } from 'vitest';
import { StyleResolver } from './style-resolver';

const RUN = process.env.STYLE_BENCH === '1';

describe.skipIf(!RUN)('style resolution bench (STYLE_BENCH=1)', () => {
  for (const n of [100_000, 1_000_000]) {
    it(`resolves ${n} records and reports ms`, () => {
      const records = Array.from({ length: n }, (_, i) => ({ pop: i % 100 }));
      const layer: any = { shapes: records.map((_, i) => [[i]]), data: { getRecords: () => records } };
      const dataset: any = { attributeVersion: 0 };
      const r = new StyleResolver();
      const paint: any = { 'fill-color': ['step', ['get', 'pop'], '#a', 25, '#b', 50, '#c', 75, '#d'] };
      const t0 = performance.now();
      r.resolveFill({ layerId: 'b', paint, styleSource: undefined, dataset, layer });
      const cold = performance.now() - t0;
      const t1 = performance.now();
      r.resolveFill({ layerId: 'b', paint, styleSource: undefined, dataset, layer });
      const warm = performance.now() - t1;
      console.log(JSON.stringify({ records: n, coldMs: +cold.toFixed(2), warmMs: +warm.toFixed(2) }));
      expect(warm).toBeLessThan(1); // 缓存命中 ≈ 0
    });
  }
});
```

Run: `STYLE_BENCH=1 pnpm vitest run src/map/style-resolver.bench.test.ts`
Expected: PASS 并输出 cold/warm 数值 → 把数值回填到 spec §5（α/阈值参考点）与 §9。

- [ ] **Step 3: 通过 + commit**

Run: `pnpm vitest run src/map/map.test.ts && STYLE_BENCH=1 pnpm vitest run src/map/style-resolver.bench.test.ts`
```bash
# 提交前：detect_changes({ repo: 'emap', scope: 'staged' }) 核对
git add src/map/map.test.ts src/map/style-resolver.bench.test.ts
git add -f docs/superpowers/specs/2026-09-02-attribute-driven-styling-design.md
git commit -m "test: 属性填色 e2e（classify→渲染）与 env-gated 基准；spec 回填基准数值"
```

---

### Task 10: 文档与收尾

- [ ] **Step 0: impact gate**——纯文档；跳过 impact。

**Files:**
- Modify: `packages/docs/docs/guides/styling.md` + `packages/docs/i18n/en/.../styling.md`（新增"属性驱动样式"小节：classifyFeatures 烘焙 + styleSource opt-in + paint 表达式子集与示例）
- Modify: `CHANGELOG.md`

- [ ] **Step 1: 文档与 changelog**——写清：字段命名兼容 mapshaper（fill/stroke/stroke-width/r）、opt-in 语义（绝不隐式生效）、表达式子集清单、ClassificationResult 判别联合与不变量、undo 行为。
- [ ] **Step 2: 全量门禁**

Run: `pnpm format:check && pnpm typecheck && pnpm test:run && pnpm docs:check-api`
Expected: 全绿（`docs:check-api` 校验新导出的 TypeDoc 完整性）

- [ ] **Step 3: Commit**

```bash
# 提交前：detect_changes({ repo: 'emap', scope: 'staged' }) 核对（应为零代码影响）
git add packages/docs/docs/guides/styling.md \
  packages/docs/i18n/en/docusaurus-plugin-content-docs/current/guides/styling.md \
  CHANGELOG.md
git commit -m "docs: 属性驱动样式指南与 changelog（Phase 1 fill）"
```

---

## Self-Review 记录

- Spec 覆盖：失效矩阵+stale guard 双计数器+首次提交路径(T1)、表达式+interpolate 颜色量化(T2)、断点权威+判别联合+effective 色(T3/T4)、worker recordCount(T5)、resolver+缓存键+null 桶+桶基数 warn+重建失败 stale(T6)、painter 断言不变量(T7)、逐键回退（静态标量优先于 styleSource）+opt-in+校验(T8)、e2e+undo+基准(T9)、文档(T10)。resolver worker task 卸载由 spec §5 落地门控决定：T9 基准回填后，10 万 records 主线程重建超 §4.2 预算上限 → 同 Phase 补 worker offload task（协议见 spec §5 Worker 路由契约）+ round-trip/transferable/确定性 styleId 测试；未超则归入 Phase 2。T9 Step 2 基准输出必须含该判定结论。
- 类型一致性：`StyleResolution`/`FillStyleBuckets`/`resolveFill`/`StyleWarn` 签名在 T6→T7→T8 一致；`ParsedCommand` 形态与 `_define.ts` 一致；classify 选项键与 0.6.113 bundle 核实一致；op-result 无 `Ok` 导出，用 `{ ok: true, value }` 字面量；styleBuckets 经 `PolygonFillOptions` 传入（spec §4.4 已对齐为 options 袋）。
- e2e stub 契约：runner 是 copy+replace（`setDataset(after)`），stub 用可变 `current` 引用，断言读 `current`；undo 由 replace 撤销恢复引用。
- commit 步骤全部精确路径化（禁 `git add -A`）；gitignored spec/plan 用 `git add -f`。
