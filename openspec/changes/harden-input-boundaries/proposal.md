# Change: Harden input boundaries — ZIP extraction limits, control-icon HTML safety, setData race versioning

## Why
A code review of `topology-source.ts` and `draw-feature-control.ts` surfaced three input-boundary issues that are all benign in the trusted-authoring scenarios emap was originally written for, but become real footguns the moment an emap-based tool exposes any of these surfaces to end users (drag-and-drop ZIP loaders, configurable plugins, fast UI swaps between datasets):

1. **ZIP extraction has no resource ceiling.** `_extractZip` calls `unzipSync(data)` and trusts the result. A maliciously crafted zip can decompress to gigabytes (zip bomb) or contain hundreds of thousands of entries (entry-count DoS). The browser tab freezes / OOMs before any emap code can react.
2. **`DrawFeatureControl.icon` is innerHTML.** The option is documented as "Button icon HTML" and is interpolated into `innerHTML`. A library consumer who plumbs a user-supplied string into `icon` (theming dialog, settings JSON, untrusted plugin config) gets a DOM XSS for free. Same shape exists in `history-control.ts` and `navigation-control.ts` for their hardcoded labels — those are dev-controlled today but the assignment pattern is the same.
3. **`TopologySource.setData` races on rapid re-entries.** `setData(a); setData(b)` kicks off two async `_updateData()` chains; whichever finishes last wins. With URL inputs (network latency varies wildly) the late-resolving stale request can clobber the fresh one, and the `data` event order doesn't match the call order.

None of these are remotely exploitable through the current public API on a trusted page, but all three are easy to harden and the cost of leaving them is "any consumer that surfaces these inputs to users has to discover and re-fix them itself".

## What Changes

### `TopologySource._extractZip` — bounded extraction
- Accept `TopologySourceOptions.zipLimits?: { maxBytes?: number; maxEntries?: number; maxRatio?: number }`.
  - `maxBytes`: cap on the **summed uncompressed size** of all kept entries. Default `200 * 1024 * 1024` (200 MB).
  - `maxEntries`: cap on the number of entries fflate yields. Default `5000`.
  - `maxRatio`: cap on `uncompressedTotal / compressedInput`. Default `100`. Triggered post-extraction.
- After `unzipSync`, walk entries; track running totals; the moment any cap trips, throw `Error('ZIP extraction limit exceeded: …')`. The existing try/catch in `_updateData` already converts thrown errors into `fire('error', { error })` — no new event plumbing needed.
- Defaults are intentionally generous so legit shapefile zips keep working unchanged. Apps that load adversarial zips can lower them.

### `setData` race — request versioning
- `TopologySource` gains `private _loadVersion: number = 0`. `setData()` increments it; `_updateData()` captures `version = this._loadVersion` at entry and re-checks before every state mutation:
  - Before `this._dataset = await new Promise(...)` resolves into the field.
  - Before `this.fire('data')` / `this.fire('error')`.
- Stale chains short-circuit silently (no event); the active chain owns the eventual `data` / `error` fire.
- URL input adds `AbortController` — the previous controller is aborted at the start of every new `_updateData()` so the in-flight `fetch` cancels instead of running to completion just to be discarded.

### Control icon — string-only by default
- Change the typed contract: `icon?: string | Node`.
  - `string` is rendered via `textContent` (safe; covers the 99% case of unicode glyph icons like `"✏"` or `"⤴"`).
  - `Node` is appended as-is (caller's responsibility — they're already constructing DOM, so any escaping is theirs).
- Affects `DrawFeatureControl`, `NavigationControl`'s zoom-in / zoom-out / fit labels, `HistoryControl`'s undo / redo labels.
- Span structure stays identical (same CSS classes), only the assignment changes from `innerHTML = …` to `replaceChildren(span)` with `span.textContent = icon` (string branch) or `span.appendChild(icon)` (Node branch).

## Impact
- Affected specs:
  - `source-loading` (new) — TopologySource zip-limit + race-versioning contract.
  - `ui` (new) — control-icon assignment safety contract.
- Affected code:
  - `src/source/topology-source.ts` — `zipLimits` option, `_loadVersion`, `_abortController`, bounded `_extractZip`.
  - `src/source/source.ts` — `TopologySourceOptions` type adds `zipLimits`.
  - `src/ui/draw-feature-control.ts`, `src/ui/navigation-control.ts`, `src/ui/history-control.ts` — `icon`/`label` typed as `string | Node`, `innerHTML` replaced with `textContent` / `appendChild`.
  - Tests: new `topology-source.test.ts` cases for zip-limit triggers and stale-version dropping; existing UI-control tests (none today) unaffected.
- No new dependencies. No bundle-size impact (`AbortController` is browser-built-in).

## Migration
- `zipLimits` defaults are large enough that no existing application needs to opt in. Apps that load >200 MB zips need `zipLimits: { maxBytes: ... }`.
- `icon: string` for SVG markup will visibly break (literal `<svg>...</svg>` text rendered into the button). Consumers who genuinely want SVG icons must pass a `Node` (e.g. `parser.parseFromString(svg, 'image/svg+xml').documentElement`). The library's own examples currently use unicode characters and are unaffected.
- `setData` callers see no behavioural change unless they were relying on rapid re-entrant `setData` calls each producing their own `data` event. That was always racy; the new contract collapses to "only the latest setData fires data/error".

## Notes
- **Why not introduce a sanitizer**: pulling DOMPurify in for two `innerHTML` sites is ~25 KB minified for a problem that the type-system change solves at zero cost. Plain-text icons cover all current call sites.
- **Why not a streaming unzip**: fflate has `unzip` (streaming) but the API is callback-based and the existing call site is fully synchronous from mapshaper's perspective. The bounded `unzipSync` + post-walk approach is a one-line change with the same guarantees for our DoS threat model (we never start mapshaper import until the full extraction is bounded). True streaming becomes worthwhile only if we want to abort at the first oversize entry without buffering the rest, which is a much bigger refactor.
- **Why per-(string|Node) icon, not always-Node**: every example today writes `icon: '✏'`. Forcing `Node` would break every consumer for no safety win — `textContent = '✏'` is already safe.
- **Why version + AbortController, not a single-flight queue**: queuing means `setData(a); setData(b); setData(c)` runs all three in order; the user expects only `c` to matter. Versioning is the simpler "last write wins" the call site already expects.
