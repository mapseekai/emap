## 1. Command class
- [x] 1.1 Create `src/edit/commands/feature-translate.ts` exporting `FeatureTranslateCommand` with options `{ source, dx, dy, arcIds[], pointFeatures[] }` where each `pointFeatures[i] = { layer, featureId }`.
- [x] 1.2 `do()` walks `arcIds`, slices each arc's vertex range from `arcs.getVertexData()`, adds `(dx, dy)` to xx/yy in place, then calls `arcs.updateArcBounds(arcId)` per arc. Then walks `pointFeatures` and adds the offset to each shape coord array. Calls `source.refreshDisplayArcs()` once at the end.
- [x] 1.3 `undo()` does the same with `(-dx, -dy)`.

## 2. Emap method
- [x] 2.1 Add `Emap.translateSelected(dx: number, dy: number): boolean` in `src/map/map.ts`.
- [x] 2.2 Returns `false` for empty selection or `dx === 0 && dy === 0`.
- [x] 2.3 Group selection by source. For each source: resolve the layers, collect unique abs-arc-ids referenced by selected path features, and collect `(layer, featureId)` for selected point features.
- [x] 2.4 Build one `FeatureTranslateCommand` per source. If the selection touches multiple sources, build a `CompositeCommand` of those.
- [x] 2.5 Call `cmd.do()`, push it, fire `historychange`, schedule render. Do NOT clear the selection — feature ids stay valid because we mutate geometry in place.

## 3. Re-export
- [x] 3.1 Re-export `FeatureTranslateCommand`, `FeatureTranslateCommandOptions`, and `TranslatedPointFeature` from `src/index.ts`.

## 4. Tests
- [x] 4.1 Add `src/edit/commands/feature-translate.test.ts` covering: arc xx/yy offsets correctly with mocked `arcs`, `updateArcBounds` is called once per arc per pass, `refreshDisplayArcs` is called once per pass, undo restores exact prior values, point shapes are mutated and restored, multipoint handling, mixed path+point in one command, label reflects feature count.
- [x] 4.2 Add an `Emap translateSelected` describe block in `src/map/map.test.ts` covering: empty selection / zero offset returns `false`; path feature collects arc ids (positive AND ~-encoded); arc-id deduplication across multiple selected features; point-shape translation; selection NOT cleared; one historychange per call; one undo reverses everything; multi-source selection wraps in CompositeCommand and one undo reverses all sources; composes with other commands (no history barrier).

## 5. Example
- [x] 5.1 Add `test/examples/feature-translate.html`. Loads a dataset, click to select features, arrow keys to nudge by 1 unit (Shift+Arrow for 10 units). `HistoryControl` for undo.

## 6. Validation
- [x] 6.1 `npm test` — all tests pass. *(190 / 190 across 17 files.)*
