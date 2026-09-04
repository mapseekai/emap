# ADR 0001: Spherical measurement

- Status: Accepted
- Date: 2026-08-14

## Context

Interactive length and area tools must remain meaningful when a source uses either a geographic or projected coordinate reference system. Screen-space distances and planar calculations in longitude and latitude do not provide reliable real-world measurements.

## Decision

- Transform sampled map coordinates to geographic coordinates through the configured CRS transformer.
- Calculate segment distance and polygon area with the WGS84 geodesic model.
- Keep drawing state in the measurement handler and render it through the dedicated measurement overlay instead of temporary source features.
- Report unavailable results for failed transformations and degenerate rings instead of silently switching unit systems.
- Keep measurement interaction outside persistent edit history because it does not change source data.

## Consequences

- Values remain stable across map zoom and projection changes.
- A resolvable CRS is required before the tool can report real-world units.
- Transient measurement graphics do not affect source data, selection, or undo history.

## Verification

The contract is covered by geodesic calculation tests, handler lifecycle tests, overlay rendering tests, and the runnable measurement example.
