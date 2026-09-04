# Architecture decision records

This directory preserves the durable decisions that were previously mixed with completed implementation plans under `docs/superpowers/`.

| ADR | Decision |
| --- | --- |
| [0001](0001-spherical-measurement.md) | Use geodesic measurement for geographic map interaction |
| [0002](0002-duckdb-browser-analysis.md) | Keep DuckDB-Wasm analysis behind an optional subpath |
| [0003](0003-geometric-merge-and-split.md) | Isolate selected-feature merge and split with mini datasets and undoable commands |
| [0004](0004-reshape-ring-part-editing.md) | Model reshape, ring, and multipart edits as validated direct-edit plans |
| [0005](0005-attribute-driven-fill-styling.md) | Separate attribute invalidation from geometry edits and render fill styles in buckets |

ADRs record why the implementation has its current shape. They are not task lists and do not represent unfinished work.
