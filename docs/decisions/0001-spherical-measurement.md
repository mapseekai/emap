# ADR 0001: Spherical measurement

- Status: Accepted
- Date: 2026-08-14
- Supersedes: `docs/superpowers/specs/2026-08-14-spherical-measurement-design.md`

## Context

Interactive measurements may run while the map is displaying either geographic or projected coordinates. Treating longitude and latitude as planar coordinates produces visibly wrong distances and areas, while embedding measurement logic in the control would make it difficult to test and reuse.

## Decision

- Distance and area results use WGS84 geodesic calculations.
- Projected display coordinates are transformed to geographic coordinates before geodesic calculation.
- Invalid or non-transformable samples return no measurement instead of silently falling back to planar units.
- The interaction handler owns sketch state; the geographic calculation remains a separate pure service.
- Rendering labels and overlays is kept outside the calculation layer.

## Consequences

Results remain consistent across map projections and zoom levels. The implementation depends on a reliable CRS transformer and geodesic library, and callers that explicitly need planar engineering measurements must use a separate operation with declared units.
