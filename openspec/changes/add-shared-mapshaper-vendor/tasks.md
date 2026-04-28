## 1. Vendor entry
- [x] 1.1 Create `src/vendor/mapshaper-vendor.ts`. Imports `../shim` first, then `mapshaper`, then assigns `(globalThis as any).mapshaper = mapshaper`.

## 2. Rollup
- [x] 2.1 Convert `rollup.config.mjs` into a 3-entry array.
- [x] 2.2 Vendor entry: input `src/vendor/mapshaper-vendor.ts`, output `dist/mapshaper-vendor.js`, IIFE, full plugin chain (no externals).
- [x] 2.3 Main entry: add `external: ['mapshaper']` + `output.globals: { mapshaper: 'mapshaper' }`.
- [x] 2.4 Worker entry: same `external` + `globals`. Add `output.banner: "importScripts('mapshaper-vendor.js');"` so the worker pulls the vendor file at boot.
- [x] 2.5 Confirm dev + prod builds produce all three files with sourcemaps in dev, minified in prod.

## 3. Examples
- [x] 3.1 Add `<script src="../../dist/mapshaper-vendor.js"></script>` before the existing emap-dev script in every `test/examples/*.html`. Mechanical bulk edit.

## 4. Verification
- [x] 4.1 `npm run dev-build` produces three files. Measure sizes; record in proposal.
- [x] 4.2 Open one example HTML in a browser (manual), load a small GeoJSON, confirm rendering + a heavy op (e.g. `dissolveLayer`) work both with and without `useWorker: true`.
- [x] 4.3 `npm test` still passes (vitest doesn't use Rollup; should be unaffected).
