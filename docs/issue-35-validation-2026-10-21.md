# Polygon winding repair — issue #35

Issue: <https://github.com/mapseekai/emap/issues/35>

Branch: `zwishing/fix-35-polygon-winding`, based on `32e08d1f`.
The work was isolated from the concurrently edited issue #34 checkout.

The drawing handler now imports each new polygon as an explicit shell on a
detached dataset, validates it, and uses its normalized coordinates for both
the initial arc and the redo snapshot. Invalid drafts emit a validation error,
clear the sketch, and leave geometry, records, and history untouched.

Arrow native and WKB conversion reject unassigned nonzero-area rings instead
of silently discarding an entire polygon or one of its parts. The diagnostic
identifies the layer and zero-based feature index. DuckDB retains that diagnostic
in its existing error cause chain and fails before executing overlay SQL.
Null, empty and zero-area export semantics remain unchanged; this guard is not
a general polygon validity checker.

Existing wrong-direction polygons can be repaired explicitly with:

```ts
const result = await map.ops.cleanLayer({
  source: sourceId,
  target: layerId,
  rewind: true,
  onlyArcs: true,
  noArcDissolve: true,
  allowEmpty: true,
  noSnap: true,
});
```

This limited mode validates the repaired copy before commit, preserves feature
ids, records, selection, other layers, shared arc coordinates, holes and islands.
Ambiguous/self-intersecting or degenerate geometry is rejected atomically.
It retains the existing dataset-replacement history barrier: the repair can be
undone/redone, while earlier captured-object edits become stale. No user project
is automatically migrated. Ordinary clean modes keep their existing behavior.

Two sequential adversarial reviews were completed:

1. Geometry/history review: both drawing directions and closure gestures,
   repeated undo/redo, nonfinite and degenerate coordinates, self-intersections,
   multiple shells, holes, islands, shared boundaries and failed-repair atomicity.
   The added counterexamples passed.
2. Conversion/caller review: native/WKB partial and complete orphan-ring loss,
   legitimate empty geometries, DuckDB error causes and SQL suppression, other
   layer preservation, and real Canvas2D/WebGL2 pointer interaction. An explicit
   `allowOverlaps: false` incorrectly selected the ordinary clean path and cleared
   selection; a failing regression demonstrated it, and the condition was fixed.

Validation in the isolated worktree:

- Drawing, ring operations and Arrow suites: 196 tests passed before the two
  additional first-review counterexamples; those counterexamples also passed.
- Final drawing/legacy-repair and real DuckDB-Wasm overlay suites: 20 tests passed,
  including clipping both freshly drawn directions before/after redo and reading
  persisted TopoJSON results back as one expected feature with attributes.
- Existing `cleanLayer` tests: 12 passed (unrelated map tests were filtered out).
- Chrome Canvas2D/WebGL2: 4 pointer-interaction tests passed, including close-click,
  double-click, undo/redo, add-hole, fill-hole, delete-hole and unchanged neighbors.
- Source/test typechecks, production and example builds, Biome, ESLint,
  architecture checks and test-layout checks passed. GitNexus change analysis
  reported the expected shared Arrow/DuckDB impact; source and callers were also
  inspected directly where the graph could not resolve calls.

Not tested: hosted Loom save/exit/project-reopen UI, real user projects, Firefox,
Safari, WebGPU, large-data load/soak, or the complete release gate. Loom-specific
error presentation and fill-tool copy are outside this engine issue. No package
was published and no remote branch or issue state was changed.
