## 1. TopologySource — bounded ZIP
- [x] 1.1 Add `zipLimits?: { maxBytes?: number; maxEntries?: number; maxRatio?: number }` to `TopologySourceOptions` (`src/source/source.ts`).
- [x] 1.2 In `topology-source.ts`, define `DEFAULT_ZIP_LIMITS = { maxBytes: 200 * 1024 * 1024, maxEntries: 5000, maxRatio: 100 }`.
- [x] 1.3 Rewrite `_extractZip(data: Uint8Array)` to enforce `maxEntries` (count entries before walking), `maxBytes` (running sum of `content.byteLength`), `maxRatio` (`uncompressedTotal / data.byteLength` post-walk). Throw on any breach.
- [x] 1.4 Read effective limits from `this._options.zipLimits` (merge over defaults).

## 2. TopologySource — race versioning
- [x] 2.1 Add `private _loadVersion: number = 0` and `private _abortController: AbortController | null = null` fields.
- [x] 2.2 In `setData`, increment `_loadVersion` and abort the previous controller before starting `_updateData`.
- [x] 2.3 In `_updateData`, capture `const version = this._loadVersion` at entry, create a new `AbortController` (replacing the field), pass `signal` to the URL `fetch`.
- [x] 2.4 Before assigning `this._dataset` and before `fire('data')` / `fire('error')`, short-circuit if `version !== this._loadVersion`.
- [x] 2.5 Translate `AbortError` from a stale chain into a silent return (no event), distinct from a real fetch failure on the active chain.

## 3. UI controls — safe icon assignment
- [x] 3.1 In `src/ui/draw-feature-control.ts`, change `icon?: string` → `icon?: string | Node`. Replace the `innerHTML = …` pattern with: build `span.emap-ctrl-icon`, set `textContent` for string, `appendChild` for Node, then `btn.replaceChildren(span)`.
- [x] 3.2 Same change in `src/ui/navigation-control.ts` for the in-file label literals.
- [x] 3.3 Same change in `src/ui/history-control.ts` for undo / redo labels.
- [x] 3.4 Default icons (current `DEFAULT_ICONS` table in draw-feature-control) become plain unicode strings — already are; no string content changes.

## 4. Tests
- [x] 4.1 New `src/source/topology-source.test.ts` (or extend existing) cases:
  - `_extractZip` throws on maxEntries breach (synthetic many-entries zip via fflate).
  - `_extractZip` throws on maxBytes breach.
  - `_extractZip` throws on maxRatio breach (synthetic high-compression zip).
  - Setting `zipLimits` higher allows previously-rejected payloads.
- [x] 4.2 Race test:
  - `setData(a); setData(b)` where `a` resolves slower; only `b` fires `data`, dataset matches `b`.
  - Mock `fetch` to assert `signal.aborted === true` on the first call after the second `setData`.
- [x] 4.3 No new UI-control tests (mechanical change verified by build + manual smoke).

## 5. Validation
- [x] 5.1 `npm test` — all tests pass.
- [x] 5.2 `npm run dev-build` — bundle still builds, no new dependencies in `package.json`.
- [x] 5.3 Manual: open one example HTML with a large legit zip — loads as before with default limits.
