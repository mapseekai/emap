# ADR 0011 — Direct multi-layer GeoPackage vector import

Status: implemented and release-verified; public surface is unreleased. Scope: vector import only.

Validation: [GeoPackage vector import report](../audits/geopackage-vector-import.md).

## Decision

Use the pinned upstream `@ngageoint/geopackage@4.2.9` package, specifically its
SQL.js/WASM adapter. Do not initialize its Canvas/tiles stack, native SQLite,
feature-to-GeoJSON helpers, or wkx object conversion.

The reader performs a geometry validation/count pass, allocates shared Float64 XY
and Int32 arc-length buffers, and fills them directly from GP Binary/WKB on the
second prepared-statement pass. Attributes become native mapshaper DataTables.
All selected feature tables become layers in one dataset with one ArcCollection
and one topology build. Mapshaper point tuples are created only at the final
native data-model boundary. This is not a GeoJSON import or a whole-file zero-copy claim.

Mixed CRSs are normalized to one explicit/first-selected CRS before topology;
unknown definitions require caller overrides rather than a guessed datum. Mixed
geometry collections are split into dimension-specific sublayers in the same
dataset, retaining independently editable attributes and original table metadata.
Z/M strides are decoded but only XY is stored. Unsupported curved/extended types
and malformed binary data are rejected explicitly. NULL rows and empty tables remain.

## Ownership and execution

The optional `/geopackage` entry provides direct and Worker APIs plus a native
Cordis format plugin. A database belongs to one import and closes on success or
failure. A compiled WASM module can be reused; no shared database or global format
registry is introduced. Disposing the format Fiber cancels pending conversion.

The dedicated classic Worker runs SQLite, decoding, reprojection and topology.
Coordinate buffers are transferred; receiving code only restores native classes.
Input ownership transfers only when explicitly requested. Cancellation terminates
the Worker, and errors never silently fall back to the main thread.

`sql-wasm.wasm` and `mapshaper-vendor.js` are published alongside the Worker.
Examples serve these assets from the same origin. Data, fixture helpers, tests and
docs follow the six-zone source layout and colocated-unit/integration test convention.

## Dependency and validation boundary

The optional native better-sqlite3 build is explicitly disabled. The added package's
image-size dependency is overridden to 2.0.4 rather than adding an audit exception.
Only the SQL adapter is part of the supported emap integration; raster APIs are not exposed.

Tests create real SQLite fixtures without using the production decoder, verify
endianness/envelopes/Z/M, NULL alignment, shared topology, CRS normalization,
64-bit integer preservation, resource bounds and cancellation, and compare real
browser Worker output with main-thread output. Public assets and ESM exports are
included in the existing build and release verification gates.
