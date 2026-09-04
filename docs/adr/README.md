# Architecture decision records

These records preserve the durable decisions behind completed implementation plans. They intentionally omit task-by-task instructions, temporary commit sequencing, and generated output.

| ADR | Decision |
| --- | --- |
| [0001](0001-spherical-measurement.md) | Use WGS84 geodesic measurement with an isolated interaction overlay |
| [0002](0002-duckdb-optional-analysis.md) | Keep DuckDB-Wasm analysis behind an optional, explicit runtime boundary |
| [0003](0003-atomic-selected-feature-operations.md) | Apply selected-feature merge and split as atomic geometry, selection, and history changes |
| [0004](0004-topology-editing-modes.md) | Share sketch infrastructure while keeping topology-editing modes explicit |
| [0005](0005-attribute-driven-fill-styling.md) | Make attribute-driven fill styling opt-in, cached, and bucket-rendered |
