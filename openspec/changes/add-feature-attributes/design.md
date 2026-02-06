## Context
Emap renders Mapshaper datasets to a single canvas and does not currently expose any feature hit-testing or attribute inspection APIs. Mapshaper GUI provides hit-testing logic that can be adapted. The requested API should mirror MapLibre¡¯s `queryRenderedFeatures` signature and be easy to call.

## Goals / Non-Goals
- Goals:
  - Provide `Emap.queryRenderedFeatures(geometryOrOptions?, options?)` with MapLibre-like calling patterns.
  - Return attribute properties for matched features, plus identifiers needed for highlight.
  - Support layer filtering.
  - Allow highlighting of matched features with a minimal overlay draw.
- Non-Goals:
  - Attribute editing or popups.
  - Full MapLibre filter syntax.
  - Vector-tile style layering or symbol collision.

## Decisions
- Decision: Implement hit-testing by adapting Mapshaper GUI¡¯s shape hit logic to Emap.
  - Rationale: The Mapshaper GUI already computes pixel-to-geometry hit tests across points/lines/polygons and is proven for Mapshaper datasets.
- Decision: Keep return values minimal (properties + ids + layer/source identifiers) and skip geometry.
  - Rationale: The user only needs attributes; geometry would add cost and ambiguity with splits.
- Decision: Add a lightweight highlight path by re-drawing matched feature shapes after the base render.
  - Rationale: Emap currently renders a single canvas with line art; a second pass is the simplest way to highlight without new layers.
- Decision: Layer filtering is by Mapshaper layer name (or id when present).
  - Rationale: Mapshaper datasets are layer-centric and match the user¡¯s ¡°layer filter¡± requirement.

## Risks / Trade-offs
- Feature detection cost scales with feature count; we will keep a minimal, single-layer hit-test path and avoid extra indexing.
- Point highlighting requires a small addition to point drawing logic to render highlight markers.

## Migration Plan
- No migration required; new API is additive.

## Open Questions
- Confirm highlight styling defaults (color/width) for the first implementation.
