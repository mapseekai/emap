# Task 6 Report — Error Attribution and Stale-Operation Cancellation

## Commit

`222b875 fix(maplibre): attribute and cancel overlay style work`

## Impact review

GitNexus impact marked `_handleMapError` high risk (direct error, initialization, removal, and destroy flows). `detect_changes(scope: "all")` identified the destroy and initialization processes. The lifecycle paths reviewed were destroy (abort before teardown), recovery (overlay-triggered composite failures retain the basemap), initialization (style preparation remains operation-scoped), and map error handling (owned source lookup now precedes tile publication).

## TDD evidence

- **RED:** The tile error test required an owned `serviceId`; it failed because tile errors were published before source ownership was resolved.
- **GREEN:** `_handleMapError` resolves owned sources before classifying tile events and emits the owning overlay id.
- **RED:** The destroy race test observed an in-flight overlay style fetch with an un-aborted signal.
- **GREEN:** `_abortStylePreparation()` is used when preparations are replaced, removed, and destroyed; the destroy test observes the signal abort and no late lifecycle events.
- Composite style errors are covered as overlay-triggered `style` failures with a fatal `bright` attribution while the intact basemap does not transition to `error`.

## Verification

- `rtk vitest run src/map/maplibre-service-manager.test.ts` — 133 passed.
- `rtk vitest run src/map/maplibre-emap-integration.test.ts` — 7 passed.
- `rtk pnpm run typecheck` — passed (`tsc --noEmit`).

## Concerns

No unhandled rejections or stale events were observed in the focused cancellation test. The scoped Task-6 changes add source-owned tile attribution and destroy-time preparation cancellation; existing style preparation checks already guard current operation and definition revision after fetch completion.

## Follow-up

`422a853 fix(maplibre): classify overlay style preparation errors` adds discrete HTTP non-2xx, rejected-fetch/CORS, invalid JSON, and invalid-style attribution tests. The RED matrix exposed that preparation failures were emitted as `lifecycle`; `_startOverlayReconciliation()` now tags non-abort preparation failures as `style` before publishing. The GREEN matrix passes with the triggering `bright` service id, one fatal event, and an error state.

Final verification after this follow-up: manager tests 137 passed, Emap integration 7 passed, and `tsc --noEmit` passed. GitNexus `detect_changes(scope: "all")` reported low risk and no affected processes.

## Final race completion

- **RED:** Deferred tests exposed an obsolete style-overlay update rolling its prior definition back after a newer update; concurrent active style overlays rejected one public activation with an unrelated `AbortError`; composite rollback failures were emitted as unattributed `lifecycle` errors.
- **GREEN:** An obsolete style-overlay replacement now exits without rollback, in-flight composite preparation joins only another unsettled overlay-triggered composite request, and composite setup failures are classified as `style`.
- Added deterministic deferred coverage for update abort/replacement readiness, remove-during-fetch silence, delayed basemap composite supersession, stale delayed `style.load`, one preparation across concurrent initialization, both orders of two active deferred overlays, and rollback error attribution.
- Verification: `rtk vitest run src/map/maplibre-service-manager.test.ts` — 145 passed; `rtk vitest run src/map/maplibre-emap-integration.test.ts` — 7 passed; `rtk pnpm run typecheck` — passed.
- `detect_changes(scope: "all")` reported high risk across remove/update/initialize processes; review confirmed the new guards only suppress obsolete rollback/coalesce overlapping style-overlay preparation, while current requests retain normal failure publication.

## Review-blocker follow-up

- **RED:** A late second overlay activation could follow an already-captured composite preparation; forced stale `style.load` delivery could target the current request; and the exact 30,000 ms preparation timeout lacked a manager-level contract.
- **GREEN:** Superseded overlay composite requests now follow the replacement request to their shared terminal result, forced events carry a test-only generation token rejected by the manager when stale, and the timeout emits exactly one fatal `bright` style error with error state.
- Runtime reset aborts and invalidates every pending style preparation before teardown without invalidating already-settling failed records.
- Verification: manager 148 passed; Emap integration 7 passed; `tsc --noEmit` passed. `detect_changes(scope: "all")` reported high risk; destroy/reset, initialization, parsed-style completion, and recovery paths were reviewed.

## Runtime-reset deferred preparation regression

- **RED:** An initial composite failure published a fatal `bright` error for a concurrently-started, still-deferred style preparation even though the reset had invalidated that work.
- **GREEN:** The initial-failure fanout excludes records with an in-flight style preparation; `_resetRuntime()` aborts and increments those records before teardown. The deferred fetch regression proves the signal aborts, later resolution cannot produce `bright` ready/error events, and no MapLibre runtime is recreated.
- Verification: focused reset regression passed; manager 149 passed; Emap integration 7 passed; `tsc --noEmit` passed. `detect_changes(scope: "all")` reported low risk with no indexed affected processes.

## Real MapLibre `style.load` request association

- **RED:** An untagged callback captured from an obsolete physical style application completed the newer `_appliedRequest`, incorrectly making the current basemap ready.
- **GREEN:** Each applied request now owns a listener closure capturing its request and generation. Superseding, failure, reset, and teardown detach that closure; an untagged stale callback cannot adopt or complete current work.
- FakeMap captures an actual detached old callback and invokes it without synthetic event properties; the current callback alone completes the request. Teardown coverage continues to verify listener cleanup.
- Verification: focused stale-callback test passed; manager 149 passed; Emap integration 7 passed; `tsc --noEmit` passed.
- `detect_changes(scope: "all")` reported medium risk limited to `_finishParsedStyle` abort/operation paths; review confirmed the listener guards preserve the existing parsed-style generation and operation assertions.

## Prepared-overlay snapshot late join

- **RED:** A second active style overlay joined a request whose prepared-overlay snapshot contained only the first overlay while MapLibre module loading was deferred. The request identity remained unchanged rather than creating a replacement.
- **GREEN:** Coalescing now requires the triggering record to be present in the existing prepared snapshot. A late join replaces the stale request, makes the earlier request a follower, and reapplies the replacement composite after an in-progress initial map construction. The regression asserts both generated source/layer handles are physically present and owned, both overlays are ready, and no `AbortError` is emitted.
- Verification: focused late-join test passed; manager 150 passed; Emap integration 7 passed; `tsc --noEmit` passed.
- `detect_changes(scope: "all")` reported medium risk through cloned service lifecycle processes (constructor, initialization, and removal). Review confirmed the change only associates composite request snapshots with their triggering overlay and re-applies a replacement after stale initial style construction.
