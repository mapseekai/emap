# Geometric Merge of Selected Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `map.ops.mergeSelected()` perform a true polygon union while preserving unselected geometry and allowing the caller to choose the merged feature's attribute source.

**Architecture:** Add a prepared parsed-command runner that mutates only the runner's copied dataset before normal main-thread/worker dispatch. Move selection-specific merge logic into its own op module, isolate selected shapes in a temporary layer, run polygon `dissolve2` or the existing non-polygon `dissolve`, then merge the one-feature result back into the original layer. The example exposes the attribute source through a workbench select.

**Tech Stack:** TypeScript, Vitest, mapshaper 0.6.113 parsed commands, HTML/DOM example harness, TypeDoc.

## Global Constraints

- Polygon merging removes shared and overlap-internal boundaries and returns multipart geometry for disconnected selections.
- Point and polyline merge behavior remains unchanged.
- All selected features must belong to one source and one layer.
- The caller may choose any selected `FeatureRef` as the result attribute source; omission uses the first selected ref.
- Unselected geometry must remain unchanged, including when it overlaps selected polygons.
- Preparation mutates only the runner's copied dataset; the live dataset must never receive temporary layers, fields, or records.
- Preserve main-thread/worker routing, one-entry undo/redo, selection clearing on success, and no mutation on failure.
- Use `LayerRegistry.resolve(...)`; do not add direct layer searches to runtime code.
- Add `dissolve2: 'shape-count'` to `COMMAND_EFFECTS`.
- Do not import mapshaper outside `src/adapter/mapshaper-adapter.ts`, worker entry, vendor, type, or shim boundaries.
- Prefix every shell command with `rtk`.

---

### Task 1: Prepared Parsed-Command Runner

**Files:**
- Modify: `src/map/ops/_context.ts:14-52`
- Modify: `src/map/ops/_runner.ts:68-109,205-265`
- Modify: `src/map/mapshaper-ops.ts:20-26,114-121`
- Test: `src/map/ops/_runner.test.ts:4-47`

**Interfaces:**
- Consumes: `MapshaperDataset`, `ParsedCommand`, existing `runDatasetMutation()` and main-thread/worker command dispatch.
- Produces:

```ts
export type PrepareDatasetCommand = (
  working: MapshaperDataset,
  original: MapshaperDataset,
) => void;

export type RunPreparedDatasetCommandParsed = (
  sourceId: string,
  commands: ParsedCommand[],
  label: string,
  prepare: PrepareDatasetCommand,
  inputFiles?: Record<string, Uint8Array | string>,
) => Promise<OpResult>;
```

`OpContext` gains `runPreparedDatasetCommandParsed`. `_runner.ts` exports `_runPreparedDatasetCommandParsed(...)` with the corresponding leading `host` argument.

- [ ] **Step 1: Run impact and reference analysis before changing runner symbols**

Run GitNexus impact for `_runDatasetCommandParsed`, `runDatasetCommand`, `OpContext`, and `MapshaperOps`. Run LSP references for `_runDatasetCommandParsed` and `OpContext`. Stop and report before editing if any result is HIGH or CRITICAL.

- [ ] **Step 2: Add failing effect-classification coverage**

Add this case beside the existing dissolve case in `src/map/ops/_runner.test.ts`:

```ts
['-target X -dissolve2', 'shape-count'],
```

Run:

```bash
rtk pnpm exec vitest run src/map/ops/_runner.test.ts
```

Expected: FAIL because `dissolve2` is currently classified as `unknown`.

- [ ] **Step 3: Add failing prepared-runner behavior coverage**

Add a focused test around the exported prepared runner that supplies a host/source fixture, spies on the adapter's copied working dataset, and uses:

```ts
const prepare = vi.fn((working: MapshaperDataset) => {
  working.layers[0].name = 'prepared';
});
```

Assert:

```ts
expect(prepare).toHaveBeenCalledTimes(1);
expect(original.layers[0].name).toBe('original');
expect(datasetReceivedByRunParsedCommands.layers[0].name).toBe('prepared');
```

Also configure the worker fixture once and assert the packed worker dataset contains `prepared`, proving preparation occurs before worker dispatch.

Run the focused test and confirm it fails because the prepared runner does not exist.

- [ ] **Step 4: Implement the prepared runner without duplicating commit logic**

In `_context.ts`, add the two types above and the required `runPreparedDatasetCommandParsed` member.

In `_runner.ts`:

```ts
export function _runPreparedDatasetCommandParsed(
  host: EmapHostInternal,
  sourceId: string,
  commands: ParsedCommand[],
  label: string,
  prepare: PrepareDatasetCommand,
  inputFiles?: Record<string, Uint8Array | string>,
): Promise<OpResult> {
  const heads = commands.map((command) => command.name);
  return runDatasetCommand(
    host,
    sourceId,
    { kind: 'parsed', commands, heads, cmd: heads.map((head) => `-${head}`).join(' ') },
    label,
    inputFiles,
    prepare,
  );
}
```

Extend the private `runDatasetCommand(...)` with an optional final `prepare` argument. Inside its existing `runDatasetMutation()` callback, invoke:

```ts
prepare?.(working, original);
```

before vertex counting and the worker-routing decision. Do not call `copyDataset()` again and do not add a second commit path.

Wire the new function in `MapshaperOps._ctx`:

```ts
runPreparedDatasetCommandParsed: (sourceId, commands, label, prepare, inputFiles) =>
  _runPreparedDatasetCommandParsedShared(
    this._emap,
    sourceId,
    commands,
    label,
    prepare,
    inputFiles,
  ),
```

Add `dissolve2: 'shape-count'` beside `dissolve` in `COMMAND_EFFECTS`.

- [ ] **Step 5: Verify the runner seam**

Run:

```bash
rtk pnpm exec vitest run src/map/ops/_runner.test.ts
rtk pnpm run typecheck
```

Expected: all focused tests pass; TypeScript diagnostics are clean.

- [ ] **Step 6: Commit the runner seam**

Run `detect_changes({scope: "unstaged"})`; confirm only runner/context/facade flows are affected. Then:

```bash
rtk git add src/map/ops/_context.ts src/map/ops/_runner.ts src/map/mapshaper-ops.ts src/map/ops/_runner.test.ts
rtk git commit -m "refactor(ops): prepare copied datasets before command dispatch"
```

---

### Task 2: True Selected-Feature Geometry Merge

**Files:**
- Create: `src/map/ops/merge-selected.ts`
- Create: `src/map/ops/merge-selected.test.ts`
- Modify: `src/map/ops/dissolve.ts:1-3,77-162`
- Modify: `src/map/mapshaper-ops.ts:27-67,241-245`
- Modify: `src/map/types.ts` near selection-driven operation option records
- Modify: `src/index.ts:12-70`
- Create: `src/map/merge-selected.test-d.ts`
- Modify: `src/map/ops/_runner.test.ts` only if the Task 1 classification case was not committed there
- Test: `src/map/map.test.ts:2248-2626`

**Interfaces:**
- Consumes: `OpContext.runPreparedDatasetCommandParsed`, `LayerRegistry.resolve`, `MapshaperAdapter.createDataTable`, `FeatureRef`, `ParsedCommand`.
- Produces:

```ts
/** Options controlling a same-layer selected-feature merge. */
export interface MergeSelectedOptions {
  /**
   * Selected feature whose complete record supplies every output attribute.
   * Must belong to the current same-source, same-layer selection.
   * When omitted, the first selected feature supplies the attributes.
   */
  attributeSource?: FeatureRef;
}

export async function mergeSelected(
  ctx: OpContext,
  options?: MergeSelectedOptions,
): Promise<OpResult>;
```

`MapshaperOps.mergeSelected(options?: MergeSelectedOptions)` delegates to this function. `MergeSelectedOptions` is exported from `@mapseekai/emap`.

- [ ] **Step 1: Run impact and exported-symbol references**

Run GitNexus impact for `mergeSelected`, `MapshaperOps.mergeSelected`, and `FeatureRef`. Run LSP references for both existing `mergeSelected` definitions before moving or changing them. Warn and stop on HIGH or CRITICAL results.

- [ ] **Step 2: Write validation and option tests first**

In `src/map/ops/merge-selected.test.ts`, build a stub context with selected refs, one source, one polygon layer, and a captured prepared-runner call. Add tests that assert:

```ts
await expectValidation(mergeSelected(ctx)); // zero selected
await expectValidation(mergeSelected(ctxWithOneSelected));
await expectValidation(mergeSelected(ctxWithCrossLayerSelection));
await expectValidation(mergeSelected(ctxWithCrossSourceSelection));
await expectValidation(
  mergeSelected(ctx, {
    attributeSource: { source: 'src1', layer: 'parcels', id: 99 },
  }),
);
```

Add a compatibility case where `options` is omitted and the first ref in selection order is used as the temporary records' attribute source.

Run:

```bash
rtk pnpm exec vitest run src/map/ops/merge-selected.test.ts
```

Expected: FAIL because the new module and option type do not exist.

- [ ] **Step 3: Write preparation and command-plan tests**

Use a working dataset with three records and select IDs `0` and `2`, choosing ID `2` for attributes. Invoke the captured preparation callback and assert:

```ts
expect(working.layers[0].shapes).toEqual([unselectedShape]);
expect(working.layers[0].data?.getRecords()).toEqual([unselectedRecord]);
expect(temporary.shapes).toEqual([selectedShape0, selectedShape2]);
expect(temporary.data?.getRecords()).toEqual([
  { name: 'chosen', area: 30 },
  { name: 'chosen', area: 30 },
]);
expect(original).toEqual(originalSnapshot);
```

For a polygon layer, assert command names are exactly:

```ts
['target', 'dissolve2', 'target', 'merge-layers']
```

For polyline and point layers, assert `dissolve` replaces `dissolve2` and every other command remains identical.

Assert the temporary name differs from every existing working-layer name and the final merge command restores the original layer name.

- [ ] **Step 4: Add real mapshaper geometry regressions before implementation**

Extend `src/map/map.test.ts`'s real-pipeline merge section with literal GeoJSON fixtures and hand-derived expectations:

1. Adjacent unit squares merge to one polygon with area `2` and no shared `x = 1` interior segment.
2. Squares `[0,0]-[2,2]` and `[1,0]-[3,2]` merge to area `6`, not `8`.
3. Disconnected unit squares return one feature with `MultiPolygon` geometry.
4. A fully contained unselected polygon, which overlaps the selected union without segment crossings, exports with exactly the same coordinates before and after and remains a separate feature.
5. Selecting A then B with `attributeSource: B` yields B's complete record, including a field named `has,comma`.
6. Omitting options yields A's record.
7. Undo restores every original feature, record, field, and layer name; redo restores the merged dataset; neither state contains a temporary layer or `__emap_*` field.

Export the resulting target layer through the adapter's existing GeoJSON exporter and assert observable GeoJSON geometry/attributes rather than internal arc IDs.

Run the focused map test and confirm the overlap, attribute-source, and internal-field assertions fail under the current implementation.

- [ ] **Step 5: Implement the isolated merge operation**

Move `mergeSelected` out of `dissolve.ts` into `merge-selected.ts`; leave `dissolveLayer` unchanged.

Validation must happen before runner dispatch:

```ts
if (refs.length < 2) {
  return Err.validation('selection', 'select at least two features');
}
```

Resolve the live target through `ctx.host.layers.resolve(sourceId, layerId)`, derive its stable layer index from the source's layer array, validate shapes/data/selected IDs, and validate the attribute-source ref.

Generate a collision-free temporary name from the working dataset, e.g. `__emap_merge_selected`, `__emap_merge_selected_2`, and so on.

The preparation callback must:

- find the working target by captured layer index;
- read the chosen record before changing arrays;
- partition shapes and records in one O(n) pass using a dynamic `Set<number>` of selected IDs;
- replace the original working layer's shapes/data with unselected entries;
- append a temporary layer with selected shapes and one fresh `{ ...chosenRecord }` per selected shape;
- use `getDefaultMapshaperAdapter().createDataTable(...)`, not a direct mapshaper import.

Build parsed commands:

```ts
const dissolveName = layer.geometry_type === 'polygon' ? 'dissolve2' : 'dissolve';
const commands: ParsedCommand[] = [
  { name: 'target', options: { target: temporaryName } },
  { name: dissolveName, options: { copy_fields: fields } },
  { name: 'target', options: { target: `${layerId},${temporaryName}` } },
  { name: 'merge-layers', options: { force: true, name: layerId } },
];
```

Use the prepared parsed runner with label `Merge N features`. Do not stamp live records and do not add rollback mutation code.

- [ ] **Step 6: Update the facade and public type surface**

Add `MergeSelectedOptions` to `src/map/types.ts`, import it into `mapshaper-ops.ts`, update the method signature, import `mergeSelected` from `./ops/merge-selected`, and export the option type from `src/index.ts` alongside the other map operation options.

Create `src/map/merge-selected.test-d.ts`:

```ts
import type { Emap, FeatureRef, MergeSelectedOptions } from '../index';

declare const map: Emap;
declare const ref: FeatureRef;

const options = { attributeSource: ref } satisfies MergeSelectedOptions;
map.ops.mergeSelected();
map.ops.mergeSelected(options);

// @ts-expect-error attributeSource must be a complete FeatureRef.
map.ops.mergeSelected({ attributeSource: { id: 1 } });
```

Use LSP diagnostics on every changed TypeScript file.

- [ ] **Step 7: Verify core geometry, attributes, history, and compatibility**

Run:

```bash
rtk pnpm exec vitest run src/map/ops/merge-selected.test.ts src/map/map.test.ts src/map/ops/_runner.test.ts
rtk pnpm run typecheck
```

Expected: all validation, geometry, attribute-source, unselected-geometry, undo/redo, point, and line tests pass.

- [ ] **Step 8: Commit the core operation**

Run CodeGraph on the changed symbols and `detect_changes({scope: "unstaged"})`. Confirm affected flows are limited to dataset operation dispatch, selection invalidation, history, and the public ops facade. Then:

```bash
rtk git add src/map/ops/merge-selected.ts src/map/ops/merge-selected.test.ts src/map/ops/dissolve.ts src/map/mapshaper-ops.ts src/map/types.ts src/map/merge-selected.test-d.ts src/index.ts src/map/map.test.ts src/map/ops/_runner.test.ts
rtk git commit -m "fix(ops): geometrically union selected polygon features"
```

---

### Task 3: Attribute-Source UI in the Merge Example

**Files:**
- Modify: `packages/examples/examples/merge-selected/index.html:17-118`
- Modify: `docs-meta/examples.ts:145-148`
- Create: `test/examples/merge-selected.test.ts`
- Modify: `test/docs/example-catalog.test.ts` only if the new page behavior requires catalog harness support

**Interfaces:**
- Consumes: `map.getSelection()`, `map.features.get(ref)`, `map.ops.mergeSelected({ attributeSource })`, `selectionchange`.
- Produces: workbench select `#attribute-source` whose option values map back to complete selected `FeatureRef` objects.

- [ ] **Step 1: Write failing example behavior tests**

Create a jsdom harness that executes the real module script with a fake Emap runtime. Drive selection events and assert:

```ts
expect(attributeSource.disabled).toBe(true); // fewer than two refs
expect(mergeButton.disabled).toBe(true);
```

After two same-layer refs with records `{ name: 'A' }` and `{ fullname: '河北省' }`:

```ts
expect([...attributeSource.options].map((option) => option.textContent)).toEqual([
  '要素 0 — A',
  '要素 1 — 河北省',
]);
expect(attributeSource.value).toBe(serializedFirstRef);
expect(mergeButton.disabled).toBe(false);
```

Change the dropdown to the second ref, click merge, and assert:

```ts
expect(map.ops.mergeSelected).toHaveBeenCalledWith({
  attributeSource: { source: 'src1', layer: 'parcels', id: 1 },
});
```

Add cases for preserving the chosen source while it remains selected and disabling merge for mixed source/layer selections.

Run:

```bash
rtk pnpm exec vitest run test/examples/merge-selected.test.ts
```

Expected: FAIL because `#attribute-source` and option forwarding do not exist.

- [ ] **Step 2: Implement the workbench select**

Add this field above the merge button:

```html
<div class="emap-example-field">
  <label for="attribute-source">属性来源</label>
  <select id="attribute-source" disabled></select>
</div>
```

Maintain an in-memory `Map<string, FeatureRef>` keyed by a stable serialized ref. On every `selectionchange`:

- verify there are at least two refs and all source/layer values match;
- rebuild option labels from `map.features.get(ref)?.properties` using `name`, then `fullname`, then ID only;
- preserve the selected key if still present;
- synchronize highlight, clear button, merge button, select disabled state, and an explanatory status for invalid mixed selections.

On merge, resolve the selected key to a ref and handle the structured result correctly:

```ts
const result = await map.ops.mergeSelected({ attributeSource });
if (!result.ok) {
  status.textContent = `合并失败: ${result.error.message}`;
  return;
}
status.textContent = `已合并所选要素，属性来自 ${attributeSourceLabel}，Ctrl+Z 撤销。`;
```

Do not branch on the `OpResult` object itself; both success and failure results are objects. Include the chosen option label in the success status.

- [ ] **Step 3: Update example metadata**

Change the bilingual `merge-selected` description to state that selected polygons are geometrically unioned and the user chooses the output attribute source. Keep the existing fixture and catalog placement.

- [ ] **Step 4: Verify the example contract**

Run:

```bash
rtk pnpm exec vitest run test/examples/merge-selected.test.ts test/docs/example-catalog.test.ts
rtk pnpm run examples:check
rtk pnpm run typecheck
```

Expected: all tests and checks pass.

- [ ] **Step 5: Commit the example**

Run CodeGraph impact for the example page and metadata. Then:

```bash
rtk git add packages/examples/examples/merge-selected/index.html docs-meta/examples.ts test/examples/merge-selected.test.ts test/docs/example-catalog.test.ts
rtk git commit -m "feat(examples): choose merge attribute source"
```

---

### Task 4: Documentation, Generated API, and Final Verification

**Files:**
- Modify: `packages/docs/docs/guides/selection.md:126-175`
- Modify: `packages/docs/i18n/en/docusaurus-plugin-content-docs/current/guides/selection.md:128-170`
- Modify: `CHANGELOG.md:8-10`
- Regenerate: `packages/docs/static/api/**`
- Test: `test/docs/typedoc-config.test.ts`

**Interfaces:**
- Documents `MergeSelectedOptions`, polygon union/multipart behavior, attribute-source selection, same-layer restriction, success selection clearing, and undo/redo.

- [ ] **Step 1: Add the bilingual selection-guide contract**

Add a section before “选择与数据操作” / “Selection and data operations” with this API shape:

```ts
const selected = map.getSelection();
const result = await map.ops.mergeSelected({
  attributeSource: selected[1],
});

if (!result.ok) {
  console.error(result.error.message);
}
```

State explicitly:

- polygon overlap/shared boundaries become a geometric union;
- disconnected polygons become one multipart feature;
- all refs must share source/layer;
- omitted `attributeSource` uses the first selected ref;
- success clears selection and is one undoable history step.

Add `MergeSelectedOptions` to both guides' frontmatter `api` arrays so TypeDoc receives the runnable-example association, and add its generated API link after `FeatureRef` in each visible API list.

- [ ] **Step 2: Add an Unreleased changelog entry**

Under `## [Unreleased]`, add `### Fixed` and one concise bullet stating that selected polygon merging now removes overlap/shared internal boundaries, preserves unselected geometry, and accepts a selected attribute source.

- [ ] **Step 3: Regenerate and verify TypeDoc**

Run:

```bash
rtk pnpm run api:build
rtk pnpm exec vitest run test/docs/typedoc-config.test.ts
rtk pnpm run docs:check-api
rtk pnpm run docs:check-i18n
```

Confirm the generated API contains `MergeSelectedOptions` and the updated `MapshaperOps.mergeSelected(options?)` signature.

- [ ] **Step 4: Run the complete verification suite**

Run:

```bash
rtk pnpm run format:check
rtk pnpm run typecheck
rtk pnpm run examples:check
rtk pnpm run test:run
```

Expected: zero formatting/type/check failures; the full Vitest suite passes with only the repository's established skips.

The user owns browser verification. Do not launch a browser unless they explicitly request it in the implementation session.

- [ ] **Step 5: Review affected scope**

Run CodeGraph over every changed source/test/doc path and GitNexus `detect_changes({scope: "unstaged"})`. Confirm:

- public impact is the optional `MergeSelectedOptions` parameter;
- runtime impact is limited to selected-feature merging and prepared command dispatch;
- `dissolve2` participates in `shape-count` selection invalidation;
- no unrelated operation, example, or docs flow changed.

- [ ] **Step 6: Commit documentation and generated output**

```bash
rtk git add CHANGELOG.md packages/docs/docs/guides/selection.md packages/docs/i18n/en/docusaurus-plugin-content-docs/current/guides/selection.md packages/docs/static/api test/docs/typedoc-config.test.ts
rtk git commit -m "docs: document geometric selected-feature merge"
```

After the commit, run `detect_changes({scope: "compare", base_ref: "master"})` for final scope evidence.
