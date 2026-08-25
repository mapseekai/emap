# Task 1 Report: Atomic Dataset and Selection Replacement

## Outcome

Completed the atomic dataset-and-selection replacement path. The prepared mutation runner copies and stale-checks a source dataset, commits the returned final selection with the dataset in one history command, then publishes exactly one source-data event and at most one selection-change event.

## Files

- `src/edit/commands/dataset-replace-selection.ts` — new history command that restores dataset and selection together on `do()`/`undo()` and only publishes a changed selection diff.
- `src/edit/commands/dataset-replace-selection.test.ts` — covers dataset/selection undo behavior and suppression of no-op selection publication.
- `src/map/ops/_context.ts` — exposes `PreparedDatasetMutationResult` and `RunPreparedDatasetMutation` through `OpContext`.
- `src/map/ops/_runner.ts` — adds the prepared mutation runner, atomic commit helper, and `split-selected` effect classification.
- `src/map/ops/_runner.test.ts` — covers payload return, final selection installation, history command, and effect classification.
- `src/map/ops/_test-helpers.ts` and `src/map/ops/merge-selected.test.ts` — supply the new typed context stub required by existing fixtures.
- `src/map/mapshaper-ops.ts` — wires the runner into the façade context.

## Audit and Decisions

- Preserved the inherited implementation after auditing it against every brief requirement; no functional gap or style-only rewrite was needed.
- `DatasetReplaceSelectionCommand` sets the dataset with deferred publication, applies/restores selection snapshots, stores the latest diff, emits source `data` once, and emits a selection notification only when the diff changed.
- `_runPreparedDatasetMutation` uses the established per-source queue, copied working dataset, source/edit-version/transaction stale checks, transaction tracking, cache invalidation, render scheduling, history publication, and typed payload return.
- Existing CLI and prepared parsed-command behavior remains on the existing `DatasetReplaceCommand` path; explicit selection installation is confined to prepared mutations.
- `split-selected` is classified as `shape-count`.

## Impact Analysis

Ran upstream GitNexus impact analysis before the audit:

| Target | Risk | Evidence |
| --- | --- | --- |
| `_runPreparedDatasetCommandParsed` | LOW | 1 direct dependent in Ops; no affected process. |
| `runDatasetMutation` | LOW | 10 transitive dependents; the `rebuildTopology` flow is affected at its runner step. |
| `commitDatasetReplace` | LOW | 1 direct dependent in Map; no affected process. |
| `DatasetReplaceCommand` | LOW | 3 direct dependents; no affected process. |
| `MapshaperOps._ctx` | LOW | No indexed upstream dependent. |

Ran GitNexus `detect_changes({ scope: "all" })` with the linked worktree supplied. It reported medium aggregate risk from 12 changed indexed symbols in six tracked files and one affected flow: `RebuildTopology → EnqueueSourceOperation`, at `runDatasetMutation` step 3. The diff is limited to the intended runner/context/history wiring and fixture updates. The detector reports tracked diff hunks; the two new command files were reviewed directly and covered by the focused test run.

## Verification

Command:

```bash
rtk vitest run src/edit/commands/dataset-replace-selection.test.ts src/map/ops/_runner.test.ts src/map/ops/merge-selected.test.ts
```

Result: `PASS (40) FAIL (0)`.

No project-wide build, lint, formatter, or test suite was run.

## Commits

- `7abec5e feat: commit dataset and selection atomically` — implementation and focused tests.

## Concerns

None in the Task 1 implementation. GitNexus detection does not include untracked files in its changed-symbol list; those two new files were directly audited and exercised by the focused tests.
