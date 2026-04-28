## ADDED Requirements

### Requirement: Three-bundle build artefact contract
`npm run dev-build` and `npm run build` SHALL produce three IIFE bundles in `dist/`:

| File                  | Contents                                          | Mapshaper |
|-----------------------|---------------------------------------------------|-----------|
| `mapshaper-vendor.js` | mapshaper + shim, registers `globalThis.mapshaper` | inlined   |
| `emap.js` (prod) / `emap-dev.js` (dev) | emap application code                  | external  |
| `emap-worker.js`      | worker code                                       | external  |

#### Scenario: Vendor bundle exists in dev build
- **WHEN** `npm run dev-build` completes
- **THEN** `dist/mapshaper-vendor.js` exists and is non-empty

#### Scenario: Vendor bundle exists in prod build
- **WHEN** `npm run build` completes
- **THEN** `dist/mapshaper-vendor.js` exists and is minified (no sourcemap comment in the file body)

#### Scenario: Main bundle declares mapshaper external
- **WHEN** `dist/emap.js` is inspected
- **THEN** the bundled code references `mapshaper` as a global variable, not as inlined source

#### Scenario: Worker pulls vendor via importScripts
- **WHEN** `dist/emap-worker.js` is inspected
- **THEN** the very first executable statement is `importScripts('mapshaper-vendor.js');`

### Requirement: Page load order
The example HTML files SHALL include `<script src="…/mapshaper-vendor.js"></script>` immediately before the existing `<script src="…/emap-dev.js"></script>` (or `emap.js`).

#### Scenario: Every example references vendor before main
- **WHEN** the source of any `test/examples/*.html` file is read
- **THEN** the `mapshaper-vendor.js` script tag appears before the `emap-dev.js` script tag (when both are present)
