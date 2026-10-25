// Generated from the public operation signatures by scripts/generate-capability-schemas.mjs.
// Do not edit manually; run pnpm capabilities:generate.
import type { InputSchema } from '../../services/capabilities';

export const operationSchemas = {
  MapshaperOps: {
    clipLayer: {
      parameters: ['opts'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Source ID containing the target layer (and optionally the mask layer).',
          },
          target: {
            type: 'string',
            description: 'Layer name (or id) of the target to be clipped/erased.',
          },
          mask: {
            type: 'string',
            description:
              'Layer name (or id) of the polygon mask living in the same source.\nMutually exclusive with bbox — supply exactly one.',
          },
          bbox: {
            type: 'array',
            prefixItems: [
              {
                type: 'number',
              },
              {
                type: 'number',
              },
              {
                type: 'number',
              },
              {
                type: 'number',
              },
            ],
            minItems: 4,
            maxItems: 4,
            description:
              'Rectangular clip / erase region as `[xmin, ymin, xmax, ymax]` in\nsource-data coordinates. Convenient when no full mask layer exists\n(e.g. crop to viewport, drop everything outside a bounding box).\nMutually exclusive with mask.',
          },
          cleanup: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description:
              "Run mapshaper's `cleanup` step after clip / erase to fix sliver\npolygons / unclosed rings. Recommended when the mask geometry is\ncoarse or the target has overlapping shapes.",
          },
          removeSlivers: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description:
              'Drop sliver polygons produced by the clip / erase. Implies a\npost-step similar to `filter-slivers`.',
          },
        },
        required: ['source', 'target'],
        additionalProperties: false,
      },
    },
    eraseLayer: {
      parameters: ['opts'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Source ID containing the target layer (and optionally the mask layer).',
          },
          target: {
            type: 'string',
            description: 'Layer name (or id) of the target to be clipped/erased.',
          },
          mask: {
            type: 'string',
            description:
              'Layer name (or id) of the polygon mask living in the same source.\nMutually exclusive with bbox — supply exactly one.',
          },
          bbox: {
            type: 'array',
            prefixItems: [
              {
                type: 'number',
              },
              {
                type: 'number',
              },
              {
                type: 'number',
              },
              {
                type: 'number',
              },
            ],
            minItems: 4,
            maxItems: 4,
            description:
              'Rectangular clip / erase region as `[xmin, ymin, xmax, ymax]` in\nsource-data coordinates. Convenient when no full mask layer exists\n(e.g. crop to viewport, drop everything outside a bounding box).\nMutually exclusive with mask.',
          },
          cleanup: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description:
              "Run mapshaper's `cleanup` step after clip / erase to fix sliver\npolygons / unclosed rings. Recommended when the mask geometry is\ncoarse or the target has overlapping shapes.",
          },
          removeSlivers: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description:
              'Drop sliver polygons produced by the clip / erase. Implies a\npost-step similar to `filter-slivers`.',
          },
        },
        required: ['source', 'target'],
        additionalProperties: false,
      },
    },
    dissolveLayer: {
      parameters: ['opts'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Source ID containing the target layer.',
          },
          target: {
            type: 'string',
            description: 'Layer name (or id) of the layer to dissolve.',
          },
          field: {
            type: 'string',
            description:
              'Optional single attribute field to group features by. Convenience\nshorthand for `fields: [field]`. Mutually exclusive with `fields`.',
          },
          fields: {
            type: 'array',
            items: {
              type: 'string',
            },
            description:
              'Multi-field group-by. Invalid entries are rejected with a validation\nerror. An empty array is treated as if unset.',
          },
          sumFields: {
            type: 'array',
            items: {
              type: 'string',
            },
            description:
              "Fields whose numeric values should be summed across each dissolved\ngroup (mapshaper's `sum-fields=` option). Invalid entries are rejected.",
          },
          copyFields: {
            type: 'array',
            items: {
              type: 'string',
            },
            description:
              "Fields whose values should be carried through the dissolve unchanged\n(mapshaper's `copy-fields=` option). The first feature in each group\nprovides the value. Invalid entries are rejected.",
          },
          calc: {
            type: 'string',
            description:
              "Custom JS aggregation expression evaluated per dissolve group\n(mapshaper's `calc=` option). Has access to the standard mapshaper\naggregation context. Forwarded verbatim, quoted.",
          },
          where: {
            type: 'string',
            description:
              "Pre-filter expression — only records where `where` evaluates truthy\nare included in the dissolve (mapshaper's `where=` option).",
          },
          multipart: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description:
              "Make multipart features instead of dissolving polygon boundaries\n(mapshaper's `multipart` flag).",
          },
          name: {
            type: 'string',
            description: "Optional name for the output layer (mapshaper's `name=` option).",
          },
          noReplace: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description: 'Keep the original layer alongside the new dissolved output.',
          },
        },
        required: ['source', 'target'],
        additionalProperties: false,
      },
    },
    bufferLayer: {
      parameters: ['opts'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Source ID containing the target layer.',
          },
          target: {
            type: 'string',
            description: 'Layer name (or id) of the layer to buffer.',
          },
          radius: {
            anyOf: [
              {
                type: 'string',
              },
              {
                type: 'number',
              },
            ],
            description:
              "Buffer radius. Either a positive finite `number` or a mapshaper\nexpression string (evaluated per record).\n\nUnit semantics:\n - **point** layers — always **metres** (mapshaper does geodetic\n   circles via `getGeodeticSegmentFunction`), unless planar\n   is `true`, in which case it's source-CRS units.\n - **polyline / polygon** layers — source-CRS units (degrees for\n   EPSG:4326, metres for a projected CRS).",
          },
          capStyle: {
            anyOf: [
              {
                type: 'string',
                enum: ['flat'],
              },
              {
                type: 'string',
                enum: ['round'],
              },
            ],
            description: 'Buffer cap style. Default is `round`. Mainly affects polyline output.',
          },
          vertices: {
            type: 'number',
            description: 'Vertices used to approximate a point-buffer circle. Positive integer.',
          },
          arcQuality: {
            type: 'number',
            description: 'Segments per quarter-circle in joins and caps. Positive integer.',
          },
          tolerance: {
            type: 'number',
            description: 'Curve-approximation tolerance. Positive finite number.',
          },
          type: {
            anyOf: [
              {
                type: 'string',
                enum: ['left'],
              },
              {
                type: 'string',
                enum: ['right'],
              },
              {
                type: 'string',
                enum: ['outer'],
              },
              {
                type: 'string',
                enum: ['inner'],
              },
            ],
            description: 'Single-sided buffer; meaningful for polyline layers.',
          },
          planar: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description: 'Force planar (Cartesian) computation even for lat/lng data.',
          },
          v2: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description: 'Enable the v2 buffering algorithm.',
          },
          sliceLength: {
            type: 'number',
            description: 'Max path segments per buffer slice. Performance knob. Positive int.',
          },
          backtrack: {
            type: 'number',
            description: 'Backtrack distance, mapshaper-internal performance knob. Positive int.',
          },
        },
        required: ['source', 'target', 'radius'],
        additionalProperties: false,
      },
    },
    applyExpression: {
      parameters: ['opts'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Source ID containing the target layer.',
          },
          target: {
            type: 'string',
            description: 'Layer name (or id) of the layer to update.',
          },
          expression: {
            type: 'string',
            description:
              "JS expression evaluated per feature. Use `this.<field>` to read or write\nrecord attributes; mapshaper's standard feature context (`this.id`,\n`this.area`, `this.bounds`, etc.) is also available. Multiple\ncomma-separated assignments are allowed: `this.a = 1, this.b = 2`.",
          },
          where: {
            type: 'string',
            description:
              "Optional filter expression. Only records for which `where` evaluates to\na truthy value have `expression` applied. Same JS context as\n`expression`. Mirrors mapshaper CLI's `-each EXPR where=...`.",
          },
        },
        required: ['source', 'target', 'expression'],
        additionalProperties: false,
      },
    },
    filterFeatures: {
      parameters: ['opts'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Source ID containing the target layer.',
          },
          target: {
            type: 'string',
            description: 'Layer name (or id) of the layer to filter.',
          },
          expression: {
            type: 'string',
            description:
              'JS expression evaluated per feature. Records that evaluate to false are\ndeleted (mapshaper convention). Same `this` context as\n`Emap.applyExpression`: `this.<field>`, `this.id`, etc.',
          },
          invert: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description: "Flip the predicate (mapshaper's `invert` flag).",
          },
          removeEmpty: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description: "Also delete features with null geometry (mapshaper's `remove-empty`).",
          },
        },
        required: ['source', 'target'],
        additionalProperties: false,
      },
    },
    filterIslands: {
      parameters: ['opts'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Source ID containing the target layer.',
          },
          target: {
            type: 'string',
            description: 'Layer name (or id) of the polygon layer to clean.',
          },
          minArea: {
            type: 'number',
            description: 'Drop islands smaller than this area (source-CRS units²).',
          },
          minVertices: {
            type: 'number',
            description: 'Drop islands with fewer than this many vertices (after dedup).',
          },
          removeEmpty: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description:
              "After dropping islands, also drop features whose shape array becomes\nempty (mapshaper's `remove-empty`). Defaults to keeping empties.",
          },
        },
        required: ['source', 'target'],
        additionalProperties: false,
      },
    },
    filterSlivers: {
      parameters: ['opts'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Source ID containing the target layer.',
          },
          target: {
            type: 'string',
            description: 'Layer name (or id) of the polygon layer to clean.',
          },
          minArea: {
            type: 'number',
            description:
              'Drop polygons whose area falls below this threshold (source-CRS\nunits²). Required — mapshaper has no implicit default.',
          },
          weighted: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description:
              'Use a perimeter-weighted area metric (mapshaper\'s `weighted` flag).\nBetter for elongated slivers where bare area undershoots the\n"looks like a sliver" intuition.',
          },
        },
        required: ['source', 'target', 'minArea'],
        additionalProperties: false,
      },
    },
    filterGeom: {
      parameters: ['opts'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Source ID containing the target layer.',
          },
          target: {
            type: 'string',
            description: 'Layer name (or id) to filter in place.',
          },
          bbox: {
            type: 'array',
            prefixItems: [
              {
                type: 'number',
              },
              {
                type: 'number',
              },
              {
                type: 'number',
              },
              {
                type: 'number',
              },
            ],
            minItems: 4,
            maxItems: 4,
            description:
              'Bounding box `[xmin, ymin, xmax, ymax]` in source coords. Features\nwhose geometry intersects this box are kept; the rest are dropped.',
          },
        },
        required: ['source', 'target', 'bbox'],
        additionalProperties: false,
      },
    },
    explodeLayer: {
      parameters: ['opts'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Source ID containing the target layer.',
          },
          target: {
            type: 'string',
            description: 'Layer name (or id) of the layer whose multi-part features will be split.',
          },
        },
        required: ['source', 'target'],
        additionalProperties: false,
      },
    },
    innerlinesLayer: {
      parameters: ['opts'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Source ID containing the polygon target layer.',
          },
          target: {
            type: 'string',
            description: 'Layer name (or id) of the polygon layer to extract shared edges from.',
          },
          where: {
            type: 'string',
            description:
              "Optional polygon-boundary filter expression. Evaluated with `A` and `B`\nin scope — the two polygons on either side of each candidate boundary —\nso e.g. `A.STATE !== B.STATE` keeps only inter-state borders. Mirrors\nmapshaper's `-innerlines where=...`.",
          },
          name: {
            type: 'string',
            description: 'Optional name for the output polyline layer.',
          },
          noReplace: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description:
              "If true, the original polygon layer is preserved alongside the new\npolyline layer (mapshaper's `no-replace` flag). Default replaces.",
          },
        },
        required: ['source', 'target'],
        additionalProperties: false,
      },
    },
    snapLayer: {
      parameters: ['opts'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Source ID containing the target layer.',
          },
          target: {
            type: 'string',
            description: 'Layer name (or id) of the layer to snap.',
          },
          interval: {
            type: 'number',
            description:
              'Snap distance in source-CRS units. When omitted, mapshaper picks a\nsmall default based on the dataset.',
          },
          endpoints: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description: "Snap only line endpoints (mapshaper's `endpoints` flag).",
          },
          precision: {
            type: 'number',
            description: 'Round all coordinates to a given decimal precision (e.g. 0.000001).',
          },
          fixGeometry: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description:
              "Run a post-snap intersection-cut pass to repair geometry artefacts\nintroduced by rounding / snapping (mapshaper's `fix-geometry` flag).\nRecommended when `precision` or `interval` aggressively collapse\nvertices.",
          },
        },
        required: ['source', 'target'],
        additionalProperties: false,
      },
    },
    cleanLayer: {
      parameters: ['opts'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Source ID containing the target layer.',
          },
          target: {
            type: 'string',
            description: 'Layer name (or id) of the polygon layer to clean.',
          },
          gapFillArea: {
            type: 'number',
            description:
              "Maximum area (in source-CRS units²) of gaps to fill in. Gaps larger\nthan this are kept as holes. Maps to mapshaper's `gap-fill-area=N`.",
          },
          sliverControl: {
            type: 'number',
            description:
              'Sliver-detection sensitivity, typically `0..1`. Lower keeps more\nfeatures; higher removes more. Maps to `sliver-control=N`.',
          },
          snapInterval: {
            type: 'number',
            description: 'Coincident-vertex snap distance for the topology-build pre-pass.',
          },
          noSnap: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description: "Skip the snap pre-pass entirely (mapshaper's `no-snap` flag).",
          },
          allowOverlaps: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description:
              "Allow output polygons to overlap (disables gap fill).\nMaps to mapshaper's `allow-overlaps` flag.",
          },
          overlapRule: {
            anyOf: [
              {
                type: 'string',
                enum: ['min-id'],
              },
              {
                type: 'string',
                enum: ['max-id'],
              },
              {
                type: 'string',
                enum: ['min-area'],
              },
              {
                type: 'string',
                enum: ['max-area'],
              },
            ],
            description:
              "Tie-breaking rule when overlapping polygons are merged: which input\nrecord's attributes win. Maps to `overlap-rule=...`.",
          },
          allowEmpty: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description:
              "Keep features with null geometry instead of removing them.\nMaps to mapshaper's `allow-empty` flag.",
          },
          rewind: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description:
              "Fix CW/CCW winding-order errors in polygon rings.\nMaps to mapshaper's `rewind` flag.",
          },
          onlyArcs: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description:
              "Only delete unused arcs, don't repair gaps / overlaps.\nMaps to mapshaper's `only-arcs` flag.",
          },
          noArcDissolve: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description:
              "Skip the arc-dissolve sub-step.\nMaps to mapshaper's `no-arc-dissolve` flag.",
          },
        },
        required: ['source', 'target'],
        additionalProperties: false,
      },
    },
    mosaicLayer: {
      parameters: ['opts'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Source ID containing the target polygon layer.',
          },
          target: {
            type: 'string',
            description: 'Layer name (or id) of the polygon layer to flatten.',
          },
          snapInterval: {
            type: 'number',
            description:
              "Snap distance for the topology-build pre-pass (mapshaper's `snap-interval=`).",
          },
          noSnap: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description: "Skip the snap pre-pass entirely (mapshaper's `no-snap` flag).",
          },
          noReplace: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description:
              "Keep the original layer alongside the new mosaic (mapshaper's `no-replace`).",
          },
          name: {
            type: 'string',
            description: 'Optional name for the output layer.',
          },
          calc: {
            type: 'string',
            description:
              "JS expression evaluated per output mosaic feature to compute aggregate\nattribute values (mapshaper's `calc=` option). The expression has access\nto the standard mapshaper aggregation context — `sum()`, `min()`,\n`max()`, `count()`, etc. — over the records that contributed to the\nmosaic feature. Forwarded verbatim, quoted.",
          },
        },
        required: ['source', 'target'],
        additionalProperties: false,
      },
    },
    unionLayers: {
      parameters: ['opts'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Source ID containing every target layer.',
          },
          targets: {
            type: 'array',
            items: {
              type: 'string',
            },
            description: 'Two or more polygon layer names to overlay.',
          },
          fields: {
            type: 'array',
            items: {
              type: 'string',
            },
            description: 'Optional list of fields to retain in the output.',
          },
          name: {
            type: 'string',
            description: 'Optional name for the output layer.',
          },
          noReplace: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description: 'Keep the original layers alongside the new union output.',
          },
        },
        required: ['source', 'targets'],
        additionalProperties: false,
      },
    },
    divideLayer: {
      parameters: ['opts'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Source ID containing both target and divider layers.',
          },
          target: {
            type: 'string',
            description: 'Polyline layer name (or id) to be cut by polygon boundaries.',
          },
          divider: {
            type: 'string',
            description: 'Polygon layer name (or id) used as the divider.',
          },
          fields: {
            type: 'array',
            items: {
              type: 'string',
            },
            description:
              'Polygon fields to copy onto each line segment. Defaults to all fields of\nthe divider layer.',
          },
          force: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description: 'Replace existing same-named fields on the line records.',
          },
        },
        required: ['source', 'target', 'divider'],
        additionalProperties: false,
      },
    },
    pointsLayer: {
      parameters: ['opts'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Source ID containing the target layer.',
          },
          target: {
            type: 'string',
            description: 'Layer name (or id) of the layer whose points will be extracted.',
          },
          type: {
            anyOf: [
              {
                type: 'string',
                enum: ['inner'],
              },
              {
                type: 'string',
                enum: ['centroid'],
              },
              {
                type: 'string',
                enum: ['vertices'],
              },
              {
                type: 'string',
                enum: ['endpoints'],
              },
              {
                type: 'string',
                enum: ['midpoints'],
              },
              {
                type: 'string',
                enum: ['interpolated'],
              },
            ],
            description:
              'Extraction mode. Each mode constrains the input geometry: `centroid` /\n`inner` need polygons; `midpoints` / `interpolated` need polylines;\n`vertices` / `endpoints` accept either polygons or polylines.',
          },
          interval: {
            type: 'number',
            description:
              "Sample interval in source-CRS units. Required (and must be positive) for\n`type: 'interpolated'`; ignored otherwise.",
          },
          name: {
            type: 'string',
            description: 'Optional name for the output point layer.',
          },
          noReplace: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description:
              "Keep the original layer alongside the new point layer (mapshaper's `no-replace`).",
          },
        },
        required: ['source', 'target', 'type'],
        additionalProperties: false,
      },
    },
    linesLayer: {
      parameters: ['opts'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Source ID containing the polygon target.',
          },
          target: {
            type: 'string',
            description: 'Polygon layer name (or id) to extract boundaries from.',
          },
          fields: {
            type: 'array',
            items: {
              type: 'string',
            },
            description:
              'Optional category fields. Each polygon boundary inherits the value of\nthe most-coarse field that differs across it; mapshaper emits the\nboundary at the topmost layer in the hierarchy.',
          },
          name: {
            type: 'string',
            description: 'Optional name for the new polyline layer.',
          },
          noReplace: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description: 'Keep the original polygon layer alongside the new polyline output.',
          },
        },
        required: ['source', 'target'],
        additionalProperties: false,
      },
    },
    polygonsLayer: {
      parameters: ['opts'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Source ID containing the polyline target.',
          },
          target: {
            type: 'string',
            description: 'Polyline layer name (or id) to be polygonized.',
          },
          gapTolerance: {
            type: 'number',
            description:
              'Gap-snapping tolerance in source-CRS units. Forwarded only when\npositive; otherwise mapshaper picks its own default.',
          },
          fromRings: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description:
              "If true, take the fast path that assumes the input is already a layer\nof closed paths (mapshaper's `from-rings` flag).",
          },
        },
        required: ['source', 'target'],
        additionalProperties: false,
      },
    },
    simplifyLayer: {
      parameters: ['opts'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: "Source ID. Simplification operates on the source's shared arcs.",
          },
          target: {
            type: 'string',
            description:
              'Optional layer name to scope the operation. When omitted, simplify\napplies to every layer in the source dataset (mapshaper CLI default).',
          },
          percentage: {
            type: 'number',
            description:
              'Percentage of removable vertices to retain, e.g. `10` → `10%`. Must be\nwithin `[0, 100]`. Mutually exclusive with `interval` and `resolution`.',
          },
          interval: {
            type: 'number',
            description:
              'Output resolution as a positive distance in source-CRS units. Mutually\nexclusive with `percentage` and `resolution`.',
          },
          resolution: {
            type: 'string',
            description:
              'Output resolution as a grid string (e.g. `"1000x500"`). Mutually\nexclusive with `percentage` and `interval`.',
          },
          method: {
            anyOf: [
              {
                type: 'string',
                enum: ['dp'],
              },
              {
                type: 'string',
                enum: ['visvalingam'],
              },
              {
                type: 'string',
                enum: ['weighted'],
              },
            ],
            description:
              "Simplification algorithm. Default is `'weighted'` (weighted-Visvalingam),\nmatching mapshaper's CLI default.",
          },
          weighting: {
            type: 'number',
            description: 'Weighted-Visvalingam coefficient (mapshaper default 0.7).',
          },
          planar: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description: 'Treat coordinates as planar (degrees), not 3D spherical.',
          },
          keepShapes: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description: 'Keep small polygon features that would otherwise vanish.',
          },
          lockBox: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description: 'Pin vertices that lie on the dataset bounding box.',
          },
          noRepair: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description: 'Skip the post-simplify topology repair pass.',
          },
        },
        required: ['source'],
        additionalProperties: false,
      },
    },
    projectLayer: {
      parameters: ['opts'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Source ID containing the layer to export.',
          },
          crs: {
            type: 'string',
            description: 'Destination CRS. Required, non-empty after trimming.',
          },
          target: {
            type: 'string',
            description: 'Layer name or id to project on an isolated dataset copy.',
          },
          init: {
            type: 'string',
            description:
              "Source CRS override. Useful when the dataset doesn't have a stored\nCRS or when the stored value is wrong. Same string formats as `crs`.",
          },
          densify: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description:
              "Add intermediate vertices along straight segments to approximate\ncurves under the destination projection (mapshaper's `densify` flag).\nRecommended when projecting from EPSG:4326 to azimuthal or pseudo-\ncylindrical projections to avoid visible angular distortion of long\ngeodesic segments.",
          },
          output: {
            type: 'object',
            properties: {
              format: {
                anyOf: [
                  {
                    type: 'string',
                    enum: ['geojson'],
                  },
                  {
                    type: 'string',
                    enum: ['topojson'],
                  },
                  {
                    type: 'string',
                    enum: ['shapefile'],
                  },
                  {
                    type: 'string',
                    enum: ['msx'],
                  },
                  {
                    type: 'string',
                    enum: ['geoparquet'],
                  },
                  {
                    type: 'string',
                    enum: ['geoarrow'],
                  },
                  {
                    type: 'string',
                    enum: ['flatgeobuf'],
                  },
                  {
                    type: 'object',
                    properties: {
                      toString: {
                        anyOf: [],
                        description: 'Returns a string representation of a string.',
                      },
                      charAt: {
                        anyOf: [],
                        description: 'Returns the character at the specified index.',
                      },
                      charCodeAt: {
                        anyOf: [],
                        description:
                          'Returns the Unicode value of the character at the specified location.',
                      },
                      concat: {
                        anyOf: [],
                        description:
                          'Returns a string that contains the concatenation of two or more strings.',
                      },
                      indexOf: {
                        anyOf: [],
                        description: 'Returns the position of the first occurrence of a substring.',
                      },
                      lastIndexOf: {
                        anyOf: [],
                        description: 'Returns the last occurrence of a substring in the string.',
                      },
                      localeCompare: {
                        anyOf: [],
                        description:
                          'Determines whether two strings are equivalent in the current locale.\nDetermines whether two strings are equivalent in the current or specified locale.',
                      },
                      match: {
                        anyOf: [],
                        description:
                          'Matches a string with a regular expression, and returns an array containing the results of that search.\nMatches a string or an object that supports being matched against, and returns an array\ncontaining the results of that search, or null if no matches are found.',
                      },
                      replace: {
                        anyOf: [],
                        description:
                          'Replaces text in a string, using a regular expression or search string.\nPasses a string and {@linkcode replaceValue} to the `[Symbol.replace]` method on {@linkcode searchValue}. This method is expected to implement its own replacement algorithm.\nReplaces text in a string, using an object that supports replacement within a string.',
                      },
                      search: {
                        anyOf: [],
                        description:
                          'Finds the first substring match in a regular expression search.',
                      },
                      slice: {
                        anyOf: [],
                        description: 'Returns a section of a string.',
                      },
                      split: {
                        anyOf: [],
                        description:
                          'Split a string into substrings using the specified separator and return them as an array.',
                      },
                      substring: {
                        anyOf: [],
                        description:
                          'Returns the substring at the specified location within a String object.',
                      },
                      toLowerCase: {
                        anyOf: [],
                        description:
                          'Converts all the alphabetic characters in a string to lowercase.',
                      },
                      toLocaleLowerCase: {
                        anyOf: [],
                        description:
                          "Converts all alphabetic characters to lowercase, taking into account the host environment's current locale.",
                      },
                      toUpperCase: {
                        anyOf: [],
                        description:
                          'Converts all the alphabetic characters in a string to uppercase.',
                      },
                      toLocaleUpperCase: {
                        anyOf: [],
                        description:
                          "Returns a string where all alphabetic characters have been converted to uppercase, taking into account the host environment's current locale.",
                      },
                      trim: {
                        anyOf: [],
                        description:
                          'Removes the leading and trailing white space and line terminator characters from a string.',
                      },
                      length: {
                        type: 'number',
                        description: 'Returns the length of a String object.',
                      },
                      substr: {
                        anyOf: [],
                        description:
                          'Gets a substring beginning at the specified location and having the specified length.',
                      },
                      valueOf: {
                        anyOf: [],
                        description: 'Returns the primitive value of the specified object.',
                      },
                      codePointAt: {
                        anyOf: [],
                        description:
                          'Returns a nonnegative integer Number less than 1114112 (0x110000) that is the code point\nvalue of the UTF-16 encoded code point starting at the string element at position pos in\nthe String resulting from converting this object to a String.\nIf there is no element at that position, the result is undefined.\nIf a valid UTF-16 surrogate pair does not begin at pos, the result is the code unit at pos.',
                      },
                      includes: {
                        anyOf: [],
                        description:
                          'Returns true if searchString appears as a substring of the result of converting this\nobject to a String, at one or more positions that are\ngreater than or equal to position; otherwise, returns false.',
                      },
                      endsWith: {
                        anyOf: [],
                        description:
                          'Returns true if the sequence of elements of searchString converted to a String is the\nsame as the corresponding elements of this object (converted to a String) starting at\nendPosition – length(this). Otherwise returns false.',
                      },
                      normalize: {
                        anyOf: [],
                        description:
                          'Returns the String value result of normalizing the string into the normalization form\nnamed by form as specified in Unicode Standard Annex #15, Unicode Normalization Forms.',
                      },
                      repeat: {
                        anyOf: [],
                        description:
                          'Returns a String value that is made from count copies appended together. If count is 0,\nthe empty string is returned.',
                      },
                      startsWith: {
                        anyOf: [],
                        description:
                          'Returns true if the sequence of elements of searchString converted to a String is the\nsame as the corresponding elements of this object (converted to a String) starting at\nposition. Otherwise returns false.',
                      },
                      anchor: {
                        anyOf: [],
                        description:
                          'Returns an `<a>` HTML anchor element and sets the name attribute to the text value',
                      },
                      big: {
                        anyOf: [],
                        description: 'Returns a `<big>` HTML element',
                      },
                      blink: {
                        anyOf: [],
                        description: 'Returns a `<blink>` HTML element',
                      },
                      bold: {
                        anyOf: [],
                        description: 'Returns a `<b>` HTML element',
                      },
                      fixed: {
                        anyOf: [],
                        description: 'Returns a `<tt>` HTML element',
                      },
                      fontcolor: {
                        anyOf: [],
                        description:
                          'Returns a `<font>` HTML element and sets the color attribute value',
                      },
                      fontsize: {
                        anyOf: [],
                        description:
                          'Returns a `<font>` HTML element and sets the size attribute value',
                      },
                      italics: {
                        anyOf: [],
                        description: 'Returns an `<i>` HTML element',
                      },
                      link: {
                        anyOf: [],
                        description:
                          'Returns an `<a>` HTML element and sets the href attribute value',
                      },
                      small: {
                        anyOf: [],
                        description: 'Returns a `<small>` HTML element',
                      },
                      strike: {
                        anyOf: [],
                        description: 'Returns a `<strike>` HTML element',
                      },
                      sub: {
                        anyOf: [],
                        description: 'Returns a `<sub>` HTML element',
                      },
                      sup: {
                        anyOf: [],
                        description: 'Returns a `<sup>` HTML element',
                      },
                      padStart: {
                        anyOf: [],
                        description:
                          'Pads the current string with a given string (possibly repeated) so that the resulting string reaches a given length.\nThe padding is applied from the start (left) of the current string.',
                      },
                      padEnd: {
                        anyOf: [],
                        description:
                          'Pads the current string with a given string (possibly repeated) so that the resulting string reaches a given length.\nThe padding is applied from the end (right) of the current string.',
                      },
                      trimEnd: {
                        anyOf: [],
                        description:
                          'Removes the trailing white space and line terminator characters from a string.',
                      },
                      trimStart: {
                        anyOf: [],
                        description:
                          'Removes the leading white space and line terminator characters from a string.',
                      },
                      trimLeft: {
                        anyOf: [],
                        description:
                          'Removes the leading white space and line terminator characters from a string.',
                      },
                      trimRight: {
                        anyOf: [],
                        description:
                          'Removes the trailing white space and line terminator characters from a string.',
                      },
                      matchAll: {
                        anyOf: [],
                        description:
                          'Matches a string with a regular expression, and returns an iterable of matches\ncontaining the results of that search.',
                      },
                      replaceAll: {
                        anyOf: [],
                        description:
                          'Replace all instances of a substring in a string, using a regular expression or search string.',
                      },
                      at: {
                        anyOf: [],
                        description:
                          'Returns a new String consisting of the single UTF-16 code unit located at the specified index.',
                      },
                    },
                    required: [
                      'toString',
                      'charAt',
                      'charCodeAt',
                      'concat',
                      'indexOf',
                      'lastIndexOf',
                      'localeCompare',
                      'match',
                      'replace',
                      'search',
                      'slice',
                      'split',
                      'substring',
                      'toLowerCase',
                      'toLocaleLowerCase',
                      'toUpperCase',
                      'toLocaleUpperCase',
                      'trim',
                      'length',
                      'substr',
                      'valueOf',
                      'codePointAt',
                      'includes',
                      'endsWith',
                      'normalize',
                      'repeat',
                      'startsWith',
                      'anchor',
                      'big',
                      'blink',
                      'bold',
                      'fixed',
                      'fontcolor',
                      'fontsize',
                      'italics',
                      'link',
                      'small',
                      'strike',
                      'sub',
                      'sup',
                      'padStart',
                      'padEnd',
                      'trimEnd',
                      'trimStart',
                      'trimLeft',
                      'trimRight',
                      'matchAll',
                      'replaceAll',
                      'at',
                    ],
                    additionalProperties: false,
                  },
                ],
                description: 'Browser export format. Defaults to `geojson`.',
              },
              filename: {
                type: 'string',
                description:
                  'Suggested local filename returned with the Blob. Defaults from the target layer and format.',
              },
            },
            additionalProperties: false,
            description:
              'Detached browser-file output. The projected data is never loaded into the current map.',
          },
        },
        required: ['source', 'crs', 'target'],
        additionalProperties: false,
      },
    },
    affineLayer: {
      parameters: ['opts'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Source ID containing the target layer.',
          },
          target: {
            type: 'string',
            description: 'Layer name (or id). When omitted, the whole dataset is transformed.',
          },
          shift: {
            type: 'array',
            prefixItems: [
              {
                type: 'number',
              },
              {
                type: 'number',
              },
            ],
            minItems: 2,
            maxItems: 2,
            description: 'Translate by `[dx, dy]` in source coords.',
          },
          rotate: {
            type: 'number',
            description: 'Rotate by this many degrees (positive = counter-clockwise).',
          },
          scale: {
            anyOf: [
              {
                type: 'number',
              },
              {
                type: 'array',
                prefixItems: [
                  {
                    type: 'number',
                  },
                  {
                    type: 'number',
                  },
                ],
                minItems: 2,
                maxItems: 2,
              },
            ],
            description:
              'Scale factor. A single number scales uniformly; a `[sx, sy]` pair\nscales each axis independently.',
          },
          anchor: {
            type: 'array',
            prefixItems: [
              {
                type: 'number',
              },
              {
                type: 'number',
              },
            ],
            minItems: 2,
            maxItems: 2,
            description:
              "Anchor `[x, y]` for rotation / scale. Defaults to the layer's\nbbox centre when omitted.",
          },
          where: {
            type: 'string',
            description:
              'Optional JS predicate — only features matching `where` are\ntransformed. Subject to `expressionPolicy` gating.',
          },
        },
        required: ['source'],
        additionalProperties: false,
      },
    },
    renameLayer: {
      parameters: ['opts'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Source ID containing the target layer.',
          },
          target: {
            type: 'string',
            description: 'Layer name (or id) to rename.',
          },
          name: {
            type: 'string',
            description:
              'New layer name. Trimmed; must be non-empty and not collide with another existing layer.',
          },
        },
        required: ['source', 'target', 'name'],
        additionalProperties: false,
      },
    },
    mergeLayers: {
      parameters: ['opts'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Source ID containing every target layer.',
          },
          targets: {
            type: 'array',
            items: {
              type: 'string',
            },
            description: 'Two or more layer names (or ids) to combine into one.',
          },
          name: {
            type: 'string',
            description: 'Optional name for the output layer.',
          },
          force: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description:
              "Allow merging layers with different geometry types or inconsistent data\nfields (mapshaper's `force` flag). Without this, mismatched-geometry\ntargets are rejected up-front to avoid an opaque mid-pipeline error.",
          },
          flatten: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description:
              "For polygon merges: rebuild as a flat mosaic with higher-id polygons\nwinning overlaps (mapshaper's `flatten` flag). Ignored by mapshaper\nfor non-polygon inputs.",
          },
        },
        required: ['source', 'targets'],
        additionalProperties: false,
      },
    },
    splitLayer: {
      parameters: ['opts'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Source ID containing the target layer.',
          },
          target: {
            type: 'string',
            description: 'Layer name (or id) to partition.',
          },
          expression: {
            type: 'string',
            description:
              "Field name (e.g. `'STATE'`) or JS expression for grouping. mapshaper\nauto-detects: a bare field reference uses that field's value; otherwise\nthe string is evaluated per feature as JS. Forwarded verbatim.",
          },
          noReplace: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description: 'Keep the original layer alongside the new split outputs.',
          },
        },
        required: ['source', 'target', 'expression'],
        additionalProperties: false,
      },
    },
    dropLayer: {
      parameters: ['opts'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Source ID containing the layer to delete.',
          },
          target: {
            type: 'string',
            description: 'Layer name (or id) to remove from the source dataset.',
          },
        },
        required: ['source', 'target'],
        additionalProperties: false,
      },
    },
    sortFeatures: {
      parameters: ['opts'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Source ID containing the target layer.',
          },
          target: {
            type: 'string',
            description: 'Layer name (or id) whose features will be sorted in place.',
          },
          expression: {
            type: 'string',
            description:
              "JS expression evaluated per feature to produce the sort key. Bare field\nnames (`'POP'`) work because mapshaper exposes record fields as locals.",
          },
          descending: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description: 'Sort descending. Default `false` (ascending).',
          },
        },
        required: ['source', 'target', 'expression'],
        additionalProperties: false,
      },
    },
    uniqueFeatures: {
      parameters: ['opts'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Source ID containing the target layer.',
          },
          target: {
            type: 'string',
            description: 'Layer name (or id) to dedupe within.',
          },
          expression: {
            type: 'string',
            description:
              "JS expression evaluated per feature to produce the dedupe id. Forwarded\nverbatim (a bare field name like `'STATE_FIPS'` works). For full-record\ndedupe pass `'JSON.stringify(this.properties)'`.",
          },
          maxCount: {
            type: 'number',
            description:
              'Maximum features per id; default `1`. Must be a positive integer when\nsupplied (`> 0`).',
          },
          invert: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description: "Keep duplicates and drop unique features instead (mapshaper's `invert`).",
          },
        },
        required: ['source', 'target', 'expression'],
        additionalProperties: false,
      },
    },
    filterFields: {
      parameters: ['opts'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Source ID containing the target layer.',
          },
          target: {
            type: 'string',
            description: 'Layer name (or id) whose attribute schema will be slimmed.',
          },
          fields: {
            type: 'array',
            items: {
              type: 'string',
            },
            description:
              'Field names to retain. Each entry must be a non-empty string with no\n`,` characters. Use `[\'*\']` for "drop all" (mapshaper convention).',
          },
          invert: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description: "Drop the listed fields and keep the rest (mapshaper's `invert` flag).",
          },
        },
        required: ['source', 'target', 'fields'],
        additionalProperties: false,
      },
    },
    renameFields: {
      parameters: ['opts'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Source ID containing the target layer.',
          },
          target: {
            type: 'string',
            description: 'Layer name (or id) whose fields will be renamed.',
          },
          mapping: {
            type: 'object',
            properties: {},
            additionalProperties: {
              type: 'string',
            },
            description:
              'Map of `oldName -> newName`. Both keys and values must be non-empty\nafter trimming and contain neither `,` nor `=` (those would break\nthe comma-and-equals serialization mapshaper expects).',
          },
        },
        required: ['source', 'target', 'mapping'],
        additionalProperties: false,
      },
    },
    classifyFeatures: {
      parameters: ['opts'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Source id.',
          },
          target: {
            type: 'string',
            description: 'Target layer name.',
          },
          field: {
            type: 'string',
            description: 'Attribute field to classify on.',
          },
          method: {
            anyOf: [
              {
                type: 'string',
                enum: ['quantile'],
              },
              {
                type: 'string',
                enum: ['equal-interval'],
              },
              {
                type: 'string',
                enum: ['nice'],
              },
              {
                type: 'string',
                enum: ['categorical'],
              },
            ],
            description: 'Break method.',
          },
          classes: {
            type: 'number',
            description: 'Number of classes for sequential methods (default 4).',
          },
          breaks: {
            type: 'array',
            items: {
              type: 'number',
            },
            description: 'Explicit interior breaks (overrides method-computed breaks).',
          },
          categories: {
            type: 'array',
            items: {
              anyOf: [
                {
                  type: 'string',
                },
                {
                  type: 'number',
                },
              ],
            },
            description:
              'Category list for categorical method (default: distinct values in order of appearance).',
          },
          colors: {
            type: 'array',
            items: {
              type: 'string',
            },
            description:
              'Class colors; length must equal classes (sequential) or categories.length (categorical).',
          },
          saveAs: {
            type: 'string',
            description: "Field to bake into; default 'fill'.",
          },
          nullValue: {
            type: 'string',
            description: 'Null fill color (default: theme muted).',
          },
          otherColor: {
            type: 'string',
            description: 'Unlisted-category color for categorical (default: nullValue).',
          },
          invert: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description: 'Reverse color ramp order.',
          },
        },
        required: ['source', 'target', 'field', 'method', 'colors'],
        additionalProperties: false,
      },
    },
    joinTable: {
      parameters: ['opts'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Source ID containing the target layer.',
          },
          target: {
            type: 'string',
            description: 'Target layer name (or id) to receive joined attributes.',
          },
          data: {
            anyOf: [
              {
                type: 'object',
                properties: {
                  csv: {
                    anyOf: [
                      {
                        type: 'string',
                      },
                      {
                        anyOf: [],
                      },
                    ],
                  },
                  json: {
                    anyOf: [],
                  },
                  layer: {
                    anyOf: [],
                  },
                },
                required: ['csv'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: {
                  json: {
                    anyOf: [
                      {
                        type: 'string',
                      },
                      {
                        anyOf: [],
                      },
                      {
                        type: 'array',
                        items: {},
                      },
                      {
                        type: 'object',
                        properties: {},
                        additionalProperties: {},
                      },
                    ],
                  },
                  csv: {
                    anyOf: [],
                  },
                  layer: {
                    anyOf: [],
                  },
                },
                required: ['json'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: {
                  layer: {
                    type: 'string',
                  },
                  csv: {
                    anyOf: [],
                  },
                  json: {
                    anyOf: [],
                  },
                },
                required: ['layer'],
                additionalProperties: false,
              },
            ],
            description: 'Where to read the source records from.',
          },
          keys: {
            type: 'array',
            prefixItems: [
              {
                type: 'string',
              },
              {
                type: 'string',
              },
            ],
            minItems: 2,
            maxItems: 2,
            description:
              'Join keys, `[targetKey, sourceKey]`. Both must be non-empty trimmed\nstrings. Forwarded as `keys=<target>,<source>`.',
          },
          fields: {
            type: 'array',
            items: {
              type: 'string',
            },
            description: 'Fields to copy from the source. Defaults to all but the source key.',
          },
          prefix: {
            type: 'string',
            description: "Prefix for joined-in field names (e.g. `'p_'` → `p_pop`, `p_gdp`).",
          },
          where: {
            type: 'string',
            description: 'JS expression to filter source records before join.',
          },
          calc: {
            type: 'string',
            description: 'JS expression for many-to-one aggregation.',
          },
          unjoined: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description:
              "Keep target records that didn't match any source record (mapshaper's `unjoined`).",
          },
          unmatched: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description:
              "Output unmatched source records as a separate layer (mapshaper's `unmatched`).",
          },
        },
        required: ['source', 'target', 'data', 'keys'],
        additionalProperties: false,
      },
    },
    dataFill: {
      parameters: ['opts'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Source ID containing the target layer.',
          },
          target: {
            type: 'string',
            description: 'Layer name (or id).',
          },
          field: {
            type: 'string',
            description: 'Field name whose null/empty values should be back-filled.',
          },
          weightField: {
            type: 'string',
            description:
              'Optional weighting field — when filling from multiple eligible\nneighbours, prefer the one with the largest value of this field\n(e.g. weight by `area` so big neighbours dominate).',
          },
          contiguous: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description:
              "Restrict fills so a contiguous block of features can only adopt\none value (mapshaper's `contiguous` flag). Without it, isolated\npockets within a region can pick up different fill values.",
          },
        },
        required: ['source', 'target', 'field'],
        additionalProperties: false,
      },
    },
    rebuildTopology: {
      parameters: ['opts'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Source ID whose dataset will be rebuilt.',
          },
          snapInterval: {
            type: 'number',
            description:
              'Coincident-vertex snap distance in source-CRS units. When omitted,\nmapshaper auto-detects based on the dataset bounds.',
          },
          noSnap: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description:
              "Skip the snap pre-pass entirely. Faster, but won't fix near-coincident\nvertices that should share an arc.",
          },
          rebuildTopology: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
            description:
              "Force a `buildTopology` rerun even when the cut-detection pass found\nno changes. Useful after pure translates that didn't intersect anything\nnew but still need shared arcs re-derived against neighbours.",
          },
        },
        required: ['source'],
        additionalProperties: false,
      },
    },
    checkGeometry: {
      parameters: ['opts'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Source ID whose dataset will be inspected.',
          },
          tolerance: {
            type: 'number',
            description:
              'Override the auto-derived intersection-tolerance epsilon. Forwarded to\n`findSegmentIntersections.tolerance`. Source-CRS units.',
          },
        },
        required: ['source'],
        additionalProperties: false,
      },
    },
    intersectionPointsLayer: {
      parameters: ['opts'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Source ID containing the target.',
          },
          target: {
            type: 'string',
            description:
              'Polygon or polyline layer name (or id) whose self-intersections will be extracted.',
          },
          name: {
            type: 'string',
            description:
              'Optional name for the new point layer. Defaults to\n`${target}-intersections`. Must not collide with an existing layer\nin the same dataset.',
          },
          tolerance: {
            type: 'number',
            description:
              'Override the auto-derived intersection-tolerance epsilon. Forwarded\nto `findSegmentIntersections.tolerance`. Source-CRS units. Must be\na positive finite number when supplied.',
          },
        },
        required: ['source', 'target'],
        additionalProperties: false,
      },
    },
    mergeSelected: {
      parameters: ['options'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          attributeSource: {
            type: 'object',
            properties: {
              id: {
                type: 'number',
              },
              source: {
                type: 'string',
              },
              layer: {
                type: 'string',
              },
            },
            required: ['id', 'source', 'layer'],
            additionalProperties: false,
            description:
              'Selected feature whose complete record supplies every output attribute.\nMust belong to the current same-source, same-layer selection.\nWhen omitted, the first selected feature supplies the attributes.',
          },
        },
        additionalProperties: false,
      },
    },
    splitSelected: {
      parameters: ['options'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          cutter: {
            anyOf: [
              {
                type: 'object',
                properties: {
                  type: {
                    type: 'string',
                    enum: ['point'],
                  },
                  coordinates: {
                    type: 'array',
                    prefixItems: [
                      {
                        type: 'number',
                      },
                      {
                        type: 'number',
                      },
                    ],
                    minItems: 2,
                    maxItems: 2,
                  },
                },
                required: ['type', 'coordinates'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: {
                  type: {
                    type: 'string',
                    enum: ['polyline'],
                  },
                  coordinates: {
                    type: 'array',
                    items: {
                      type: 'array',
                      prefixItems: [
                        {
                          type: 'number',
                        },
                        {
                          type: 'number',
                        },
                      ],
                      minItems: 2,
                      maxItems: 2,
                    },
                  },
                },
                required: ['type', 'coordinates'],
                additionalProperties: false,
              },
            ],
          },
        },
        required: ['cutter'],
        additionalProperties: false,
      },
    },
    reshapeSelected: {
      parameters: ['options'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          line: {
            type: 'array',
            items: {
              type: 'array',
              prefixItems: [
                {
                  type: 'number',
                },
                {
                  type: 'number',
                },
              ],
              minItems: 2,
              maxItems: 2,
            },
          },
        },
        required: ['line'],
        additionalProperties: false,
      },
    },
    autoCompletePolygon: {
      parameters: ['options'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          line: {
            type: 'array',
            items: {
              type: 'array',
              prefixItems: [
                {
                  type: 'number',
                },
                {
                  type: 'number',
                },
              ],
              minItems: 2,
              maxItems: 2,
            },
          },
        },
        required: ['line'],
        additionalProperties: false,
      },
    },
    addRing: {
      parameters: ['options'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          ring: {
            type: 'array',
            items: {
              type: 'array',
              prefixItems: [
                {
                  type: 'number',
                },
                {
                  type: 'number',
                },
              ],
              minItems: 2,
              maxItems: 2,
            },
          },
        },
        required: ['ring'],
        additionalProperties: false,
      },
    },
    deleteRing: {
      parameters: ['options'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          point: {
            type: 'array',
            prefixItems: [
              {
                type: 'number',
              },
              {
                type: 'number',
              },
            ],
            minItems: 2,
            maxItems: 2,
          },
        },
        required: ['point'],
        additionalProperties: false,
      },
    },
    fillRing: {
      parameters: ['options'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          point: {
            type: 'array',
            prefixItems: [
              {
                type: 'number',
              },
              {
                type: 'number',
              },
            ],
            minItems: 2,
            maxItems: 2,
          },
        },
        required: ['point'],
        additionalProperties: false,
      },
    },
    addPart: {
      parameters: ['options'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          coordinates: {
            type: 'array',
            items: {
              type: 'array',
              prefixItems: [
                {
                  type: 'number',
                },
                {
                  type: 'number',
                },
              ],
              minItems: 2,
              maxItems: 2,
            },
          },
        },
        required: ['coordinates'],
        additionalProperties: false,
      },
    },
    deletePart: {
      parameters: ['options'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          point: {
            type: 'array',
            prefixItems: [
              {
                type: 'number',
              },
              {
                type: 'number',
              },
            ],
            minItems: 2,
            maxItems: 2,
          },
          tolerance: {
            type: 'number',
          },
        },
        required: ['point'],
        additionalProperties: false,
      },
    },
  },
  AttributeOps: {
    setFeatureProperty: {
      parameters: ['ref', 'key', 'value'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          ref: {
            type: 'object',
            properties: {
              id: {
                type: 'number',
              },
              source: {
                type: 'string',
              },
              layer: {
                type: 'string',
              },
            },
            required: ['id', 'source', 'layer'],
            additionalProperties: false,
          },
          key: {
            type: 'string',
          },
          value: {},
        },
        required: ['ref', 'key', 'value'],
        additionalProperties: false,
      },
    },
    setFeatureProperties: {
      parameters: ['ref', 'props'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          ref: {
            type: 'object',
            properties: {
              id: {
                type: 'number',
              },
              source: {
                type: 'string',
              },
              layer: {
                type: 'string',
              },
            },
            required: ['id', 'source', 'layer'],
            additionalProperties: false,
          },
          props: {
            type: 'object',
            properties: {},
            additionalProperties: {},
          },
        },
        required: ['ref', 'props'],
        additionalProperties: false,
      },
    },
    addField: {
      parameters: ['opts'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
          },
          target: {
            type: 'string',
          },
          field: {
            type: 'string',
          },
          defaultValue: {},
        },
        required: ['source', 'target', 'field'],
        additionalProperties: false,
      },
    },
    removeField: {
      parameters: ['opts'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
          },
          target: {
            type: 'string',
          },
          field: {
            type: 'string',
          },
        },
        required: ['source', 'target', 'field'],
        additionalProperties: false,
      },
    },
    renameField: {
      parameters: ['opts'],
      flatten: true,
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
          },
          target: {
            type: 'string',
          },
          from: {
            type: 'string',
          },
          to: {
            type: 'string',
          },
        },
        required: ['source', 'target', 'from', 'to'],
        additionalProperties: false,
      },
    },
  },
  EditSessions: {
    splitSharedNode: {
      parameters: ['ref', 'vertexId'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          ref: {
            type: 'object',
            properties: {
              id: {
                type: 'number',
              },
              source: {
                type: 'string',
              },
              layer: {
                type: 'string',
              },
            },
            required: ['id', 'source', 'layer'],
            additionalProperties: false,
          },
          vertexId: {
            type: 'number',
          },
        },
        required: ['ref', 'vertexId'],
        additionalProperties: false,
      },
    },
    translateSelected: {
      parameters: ['dx', 'dy'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          dx: {
            type: 'number',
          },
          dy: {
            type: 'number',
          },
        },
        required: ['dx', 'dy'],
        additionalProperties: false,
      },
    },
    rotateSelected: {
      parameters: ['angleDegrees', 'origin'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          angleDegrees: {
            type: 'number',
          },
          origin: {
            type: 'array',
            prefixItems: [
              {
                type: 'number',
              },
              {
                type: 'number',
              },
            ],
            minItems: 2,
            maxItems: 2,
          },
        },
        required: ['angleDegrees'],
        additionalProperties: false,
      },
    },
    scaleSelected: {
      parameters: ['sx', 'sy', 'origin'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          sx: {
            type: 'number',
          },
          sy: {
            type: 'number',
          },
          origin: {
            type: 'array',
            prefixItems: [
              {
                type: 'number',
              },
              {
                type: 'number',
              },
            ],
            minItems: 2,
            maxItems: 2,
          },
        },
        required: ['sx'],
        additionalProperties: false,
      },
    },
  },
  LayerServiceImpl: {
    addLayer: {
      parameters: ['layer', 'before'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          layer: {
            anyOf: [
              {
                type: 'object',
                properties: {
                  type: {
                    type: 'string',
                    enum: ['fill'],
                  },
                  paint: {
                    type: 'object',
                    properties: {
                      'fill-color': {
                        anyOf: [
                          {
                            type: 'string',
                          },
                          {
                            type: 'array',
                            items: {},
                          },
                        ],
                      },
                      'fill-opacity': {
                        type: 'number',
                      },
                      'line-color': {
                        anyOf: [
                          {
                            type: 'string',
                          },
                          {
                            type: 'array',
                            items: {},
                          },
                        ],
                      },
                      'line-width': {
                        type: 'number',
                      },
                      'line-dasharray': {
                        type: 'array',
                        items: {
                          type: 'number',
                        },
                        description: 'Alternating dash and gap lengths in CSS pixels.',
                      },
                      'line-dashstyle': {
                        anyOf: [
                          {
                            type: 'array',
                            items: {},
                          },
                          {
                            type: 'string',
                            enum: ['solid'],
                          },
                          {
                            type: 'string',
                            enum: ['dash'],
                          },
                          {
                            type: 'string',
                            enum: ['dot'],
                          },
                          {
                            type: 'string',
                            enum: ['dash-dot'],
                          },
                          {
                            type: 'string',
                            enum: ['arrow-dot'],
                          },
                        ],
                        description:
                          'Named dash pattern. `arrow-dot` replaces repeated dots with directional arrows.',
                      },
                      'line-arrow-spacing': {
                        type: 'number',
                        description:
                          'Arrow-to-arrow spacing in CSS pixels for `arrow-dot`. Default `32`.',
                      },
                      'line-arrow-size': {
                        type: 'number',
                        description:
                          'Arrow wing length in CSS pixels for `arrow-dot`. Default `6`.',
                      },
                    },
                    additionalProperties: false,
                  },
                  symbol: {
                    type: 'object',
                    properties: {
                      layout: {
                        type: 'object',
                        properties: {
                          visibility: {
                            anyOf: [
                              {
                                type: 'string',
                                enum: ['visible'],
                              },
                              {
                                type: 'string',
                                enum: ['none'],
                              },
                            ],
                            description:
                              'Hides the attached text/icon only, not the parent geometry.',
                          },
                          'text-field': {
                            anyOf: [
                              {
                                type: 'string',
                              },
                              {
                                type: 'array',
                                items: {},
                              },
                            ],
                            description:
                              'Literal text or the existing safe expression subset; no token-template expansion.',
                          },
                          'text-size': {
                            type: 'number',
                          },
                          'text-font': {
                            type: 'array',
                            items: {
                              type: 'string',
                            },
                            description:
                              'One font family/face. MSDF keeps its own Noto/custom-font resolver.',
                          },
                          'text-offset': {
                            type: 'array',
                            prefixItems: [
                              {
                                type: 'number',
                              },
                              {
                                type: 'number',
                              },
                            ],
                            minItems: 2,
                            maxItems: 2,
                            description:
                              'em units, converted to the existing screen-pixel placement offset.',
                          },
                          'text-allow-overlap': {
                            anyOf: [
                              {
                                type: 'boolean',
                                enum: [false],
                              },
                              {
                                type: 'boolean',
                                enum: [true],
                              },
                            ],
                          },
                          'text-padding': {
                            type: 'number',
                          },
                          'icon-image': {
                            type: 'string',
                            description:
                              'Name in symbol.images. Images retain the existing URL/rect cache.',
                          },
                          'icon-size': {
                            type: 'number',
                            description:
                              'Multiplier of symbol.images[name].size; never a CSS-pixel height.',
                          },
                          'icon-anchor': {
                            anyOf: [
                              {
                                type: 'string',
                                enum: ['left'],
                              },
                              {
                                type: 'string',
                                enum: ['right'],
                              },
                              {
                                type: 'string',
                                enum: ['center'],
                              },
                              {
                                type: 'string',
                                enum: ['top'],
                              },
                              {
                                type: 'string',
                                enum: ['bottom'],
                              },
                              {
                                type: 'string',
                                enum: ['top-left'],
                              },
                              {
                                type: 'string',
                                enum: ['top-right'],
                              },
                              {
                                type: 'string',
                                enum: ['bottom-left'],
                              },
                              {
                                type: 'string',
                                enum: ['bottom-right'],
                              },
                            ],
                          },
                          'icon-rotate': {
                            type: 'number',
                          },
                          'icon-offset': {
                            type: 'array',
                            prefixItems: [
                              {
                                type: 'number',
                              },
                              {
                                type: 'number',
                              },
                            ],
                            minItems: 2,
                            maxItems: 2,
                            description:
                              'Multiplied by icon-size, then rotated with the icon, before conversion to screen pixels.',
                          },
                        },
                        additionalProperties: false,
                      },
                      paint: {
                        type: 'object',
                        properties: {
                          'text-color': {
                            type: 'string',
                          },
                          'text-halo-color': {
                            type: 'string',
                          },
                          'text-halo-width': {
                            type: 'number',
                          },
                          'icon-opacity': {
                            type: 'number',
                          },
                          'icon-color': {
                            type: 'string',
                            description:
                              'Existing alpha-mask tint; does not require a MapLibre SDF sprite.',
                          },
                        },
                        additionalProperties: false,
                      },
                      images: {
                        type: 'object',
                        properties: {},
                        additionalProperties: {
                          type: 'object',
                          properties: {
                            url: {
                              type: 'string',
                            },
                            size: {
                              anyOf: [
                                {
                                  type: 'number',
                                },
                                {
                                  type: 'array',
                                  prefixItems: [
                                    {
                                      type: 'number',
                                    },
                                    {
                                      type: 'number',
                                    },
                                  ],
                                  minItems: 2,
                                  maxItems: 2,
                                },
                              ],
                              description:
                                'Reference CSS-pixel height (preserving aspect) or [width,height], independent of source image resolution.',
                            },
                            rect: {
                              type: 'array',
                              prefixItems: [
                                {
                                  type: 'number',
                                },
                                {
                                  type: 'number',
                                },
                                {
                                  type: 'number',
                                },
                                {
                                  type: 'number',
                                },
                              ],
                              minItems: 4,
                              maxItems: 4,
                              description:
                                'Optional original-image pixel crop, as in IconOptions.rect.',
                            },
                          },
                          required: ['url', 'size'],
                          additionalProperties: false,
                        },
                        description:
                          'Local named image definitions; the same URL is shared by the existing renderer cache.',
                      },
                      labeling: {
                        type: 'object',
                        properties: {
                          enabled: {
                            anyOf: [
                              {
                                type: 'boolean',
                                enum: [false],
                              },
                              {
                                type: 'boolean',
                                enum: [true],
                              },
                            ],
                          },
                          fontUrl: {
                            type: 'string',
                          },
                          fontWeight: {
                            anyOf: [
                              {
                                type: 'number',
                              },
                              {
                                type: 'string',
                                enum: ['normal'],
                              },
                              {
                                type: 'string',
                                enum: ['bold'],
                              },
                            ],
                          },
                          fontStyle: {
                            anyOf: [
                              {
                                type: 'string',
                                enum: ['normal'],
                              },
                              {
                                type: 'string',
                                enum: ['italic'],
                              },
                            ],
                          },
                          placement: {
                            anyOf: [
                              {
                                type: 'string',
                                enum: ['auto'],
                              },
                              {
                                type: 'string',
                                enum: ['horizontal'],
                              },
                              {
                                type: 'string',
                                enum: ['parallel'],
                              },
                            ],
                          },
                          priority: {
                            anyOf: [
                              {
                                type: 'number',
                              },
                              {
                                type: 'array',
                                items: {},
                              },
                            ],
                          },
                          maxLabels: {
                            type: 'number',
                          },
                          minScale: {
                            type: 'number',
                          },
                          maxScale: {
                            type: 'number',
                          },
                        },
                        additionalProperties: false,
                        description:
                          'Advanced text labeling controls that do not fit the MapLibre-inspired layout/paint subset.',
                      },
                      icon: {
                        type: 'object',
                        properties: {
                          enabled: {
                            anyOf: [
                              {
                                type: 'boolean',
                                enum: [false],
                              },
                              {
                                type: 'boolean',
                                enum: [true],
                              },
                            ],
                          },
                          anchor: {
                            type: 'array',
                            prefixItems: [
                              {
                                type: 'number',
                              },
                              {
                                type: 'number',
                              },
                            ],
                            minItems: 2,
                            maxItems: 2,
                            description:
                              'Native fractional anchors not expressible by the nine named icon-anchor values.',
                          },
                        },
                        additionalProperties: false,
                        description:
                          'Icon-only compatibility controls for native anchors/enabled state.',
                      },
                    },
                    additionalProperties: false,
                    description:
                      'Preferred attached symbol settings. When present, label/icon are materialized compatibility views.',
                  },
                  label: {
                    type: 'object',
                    properties: {
                      enabled: {
                        anyOf: [
                          {
                            type: 'boolean',
                            enum: [false],
                          },
                          {
                            type: 'boolean',
                            enum: [true],
                          },
                        ],
                      },
                      field: {
                        type: 'string',
                        description:
                          'Attribute column. Mutually exclusive with text. Null/missing values are not labelled.',
                      },
                      text: {
                        anyOf: [
                          {
                            type: 'string',
                          },
                          {
                            type: 'array',
                            items: {},
                          },
                        ],
                        description:
                          'Literal text or the existing safe style-expression subset (no JavaScript evaluation).',
                      },
                      fontFamily: {
                        type: 'string',
                      },
                      fontUrl: {
                        type: 'string',
                        description:
                          'Font outline URL for MSDF (TTF/OTF/WOFF1); resolved by the host, fetched locally in its Worker.',
                      },
                      fontSize: {
                        type: 'number',
                        description:
                          'Base CSS-pixel size; zoom-out stops at 12px, or this size when it is smaller.',
                      },
                      fontWeight: {
                        anyOf: [
                          {
                            type: 'number',
                          },
                          {
                            type: 'string',
                            enum: ['normal'],
                          },
                          {
                            type: 'string',
                            enum: ['bold'],
                          },
                        ],
                      },
                      fontStyle: {
                        anyOf: [
                          {
                            type: 'string',
                            enum: ['normal'],
                          },
                          {
                            type: 'string',
                            enum: ['italic'],
                          },
                        ],
                      },
                      color: {
                        type: 'string',
                      },
                      haloColor: {
                        type: 'string',
                      },
                      haloWidth: {
                        type: 'number',
                      },
                      offset: {
                        type: 'array',
                        prefixItems: [
                          {
                            type: 'number',
                          },
                          {
                            type: 'number',
                          },
                        ],
                        minItems: 2,
                        maxItems: 2,
                        description: 'CSS pixel offset applied after placement.',
                      },
                      placement: {
                        anyOf: [
                          {
                            type: 'string',
                            enum: ['auto'],
                          },
                          {
                            type: 'string',
                            enum: ['horizontal'],
                          },
                          {
                            type: 'string',
                            enum: ['parallel'],
                          },
                        ],
                        description: 'Auto: above points, parallel to lines, interior of polygons.',
                      },
                      allowOverlap: {
                        anyOf: [
                          {
                            type: 'boolean',
                            enum: [false],
                          },
                          {
                            type: 'boolean',
                            enum: [true],
                          },
                        ],
                      },
                      priority: {
                        anyOf: [
                          {
                            type: 'number',
                          },
                          {
                            type: 'array',
                            items: {},
                          },
                        ],
                        description:
                          'Higher priorities are placed first; ties use parent layer order and feature ID.',
                      },
                      minScale: {
                        type: 'number',
                        description:
                          'CRS-agnostic |mx| limits, in CSS pixels per source coordinate unit.',
                      },
                      maxScale: {
                        type: 'number',
                      },
                      maxLabels: {
                        type: 'number',
                      },
                      padding: {
                        type: 'number',
                        description: 'Collision spacing in CSS pixels, including the text halo.',
                      },
                    },
                    additionalProperties: false,
                    description: 'Attached feature labels; not a standalone render/tree layer.',
                  },
                  id: {
                    type: 'string',
                  },
                  source: {
                    type: 'string',
                  },
                  'source-layer': {
                    type: 'string',
                  },
                  layout: {
                    type: 'object',
                    properties: {
                      visibility: {
                        anyOf: [
                          {
                            type: 'string',
                            enum: ['visible'],
                          },
                          {
                            type: 'string',
                            enum: ['none'],
                          },
                        ],
                      },
                    },
                    additionalProperties: false,
                  },
                  filter: {
                    type: 'array',
                    items: {},
                    description:
                      '显示过滤器：MapLibre 子集表达式，必须逐要素求值为 boolean。数据不动，只影响渲染/拾取/属性过滤视图。',
                  },
                  styleSource: {
                    type: 'string',
                    enum: ['mapshaper'],
                    description:
                      '显式 opt-in：按图层类型读取 mapshaper 兼容烘焙颜色字段（fill / stroke）。',
                  },
                },
                required: ['type', 'id', 'source'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: {
                  type: {
                    type: 'string',
                    enum: ['line'],
                  },
                  paint: {
                    type: 'object',
                    properties: {
                      'line-color': {
                        anyOf: [
                          {
                            type: 'string',
                          },
                          {
                            type: 'array',
                            items: {},
                          },
                        ],
                      },
                      'line-width': {
                        type: 'number',
                      },
                      'line-dasharray': {
                        type: 'array',
                        items: {
                          type: 'number',
                        },
                        description: 'Alternating dash and gap lengths in CSS pixels.',
                      },
                      'line-dashstyle': {
                        anyOf: [
                          {
                            type: 'array',
                            items: {},
                          },
                          {
                            type: 'string',
                            enum: ['solid'],
                          },
                          {
                            type: 'string',
                            enum: ['dash'],
                          },
                          {
                            type: 'string',
                            enum: ['dot'],
                          },
                          {
                            type: 'string',
                            enum: ['dash-dot'],
                          },
                          {
                            type: 'string',
                            enum: ['arrow-dot'],
                          },
                        ],
                        description:
                          'Named dash pattern. `arrow-dot` replaces repeated dots with directional arrows.',
                      },
                      'line-arrow-spacing': {
                        type: 'number',
                        description:
                          'Arrow-to-arrow spacing in CSS pixels for `arrow-dot`. Default `32`.',
                      },
                      'line-arrow-size': {
                        type: 'number',
                        description:
                          'Arrow wing length in CSS pixels for `arrow-dot`. Default `6`.',
                      },
                    },
                    additionalProperties: false,
                  },
                  symbol: {
                    type: 'object',
                    properties: {
                      layout: {
                        type: 'object',
                        properties: {
                          visibility: {
                            anyOf: [
                              {
                                type: 'string',
                                enum: ['visible'],
                              },
                              {
                                type: 'string',
                                enum: ['none'],
                              },
                            ],
                            description:
                              'Hides the attached text/icon only, not the parent geometry.',
                          },
                          'text-field': {
                            anyOf: [
                              {
                                type: 'string',
                              },
                              {
                                type: 'array',
                                items: {},
                              },
                            ],
                            description:
                              'Literal text or the existing safe expression subset; no token-template expansion.',
                          },
                          'text-size': {
                            type: 'number',
                          },
                          'text-font': {
                            type: 'array',
                            items: {
                              type: 'string',
                            },
                            description:
                              'One font family/face. MSDF keeps its own Noto/custom-font resolver.',
                          },
                          'text-offset': {
                            type: 'array',
                            prefixItems: [
                              {
                                type: 'number',
                              },
                              {
                                type: 'number',
                              },
                            ],
                            minItems: 2,
                            maxItems: 2,
                            description:
                              'em units, converted to the existing screen-pixel placement offset.',
                          },
                          'text-allow-overlap': {
                            anyOf: [
                              {
                                type: 'boolean',
                                enum: [false],
                              },
                              {
                                type: 'boolean',
                                enum: [true],
                              },
                            ],
                          },
                          'text-padding': {
                            type: 'number',
                          },
                          'icon-image': {
                            type: 'string',
                            description:
                              'Name in symbol.images. Images retain the existing URL/rect cache.',
                          },
                          'icon-size': {
                            type: 'number',
                            description:
                              'Multiplier of symbol.images[name].size; never a CSS-pixel height.',
                          },
                          'icon-anchor': {
                            anyOf: [
                              {
                                type: 'string',
                                enum: ['left'],
                              },
                              {
                                type: 'string',
                                enum: ['right'],
                              },
                              {
                                type: 'string',
                                enum: ['center'],
                              },
                              {
                                type: 'string',
                                enum: ['top'],
                              },
                              {
                                type: 'string',
                                enum: ['bottom'],
                              },
                              {
                                type: 'string',
                                enum: ['top-left'],
                              },
                              {
                                type: 'string',
                                enum: ['top-right'],
                              },
                              {
                                type: 'string',
                                enum: ['bottom-left'],
                              },
                              {
                                type: 'string',
                                enum: ['bottom-right'],
                              },
                            ],
                          },
                          'icon-rotate': {
                            type: 'number',
                          },
                          'icon-offset': {
                            type: 'array',
                            prefixItems: [
                              {
                                type: 'number',
                              },
                              {
                                type: 'number',
                              },
                            ],
                            minItems: 2,
                            maxItems: 2,
                            description:
                              'Multiplied by icon-size, then rotated with the icon, before conversion to screen pixels.',
                          },
                        },
                        additionalProperties: false,
                      },
                      paint: {
                        type: 'object',
                        properties: {
                          'text-color': {
                            type: 'string',
                          },
                          'text-halo-color': {
                            type: 'string',
                          },
                          'text-halo-width': {
                            type: 'number',
                          },
                          'icon-opacity': {
                            type: 'number',
                          },
                          'icon-color': {
                            type: 'string',
                            description:
                              'Existing alpha-mask tint; does not require a MapLibre SDF sprite.',
                          },
                        },
                        additionalProperties: false,
                      },
                      images: {
                        type: 'object',
                        properties: {},
                        additionalProperties: {
                          type: 'object',
                          properties: {
                            url: {
                              type: 'string',
                            },
                            size: {
                              anyOf: [
                                {
                                  type: 'number',
                                },
                                {
                                  type: 'array',
                                  prefixItems: [
                                    {
                                      type: 'number',
                                    },
                                    {
                                      type: 'number',
                                    },
                                  ],
                                  minItems: 2,
                                  maxItems: 2,
                                },
                              ],
                              description:
                                'Reference CSS-pixel height (preserving aspect) or [width,height], independent of source image resolution.',
                            },
                            rect: {
                              type: 'array',
                              prefixItems: [
                                {
                                  type: 'number',
                                },
                                {
                                  type: 'number',
                                },
                                {
                                  type: 'number',
                                },
                                {
                                  type: 'number',
                                },
                              ],
                              minItems: 4,
                              maxItems: 4,
                              description:
                                'Optional original-image pixel crop, as in IconOptions.rect.',
                            },
                          },
                          required: ['url', 'size'],
                          additionalProperties: false,
                        },
                        description:
                          'Local named image definitions; the same URL is shared by the existing renderer cache.',
                      },
                      labeling: {
                        type: 'object',
                        properties: {
                          enabled: {
                            anyOf: [
                              {
                                type: 'boolean',
                                enum: [false],
                              },
                              {
                                type: 'boolean',
                                enum: [true],
                              },
                            ],
                          },
                          fontUrl: {
                            type: 'string',
                          },
                          fontWeight: {
                            anyOf: [
                              {
                                type: 'number',
                              },
                              {
                                type: 'string',
                                enum: ['normal'],
                              },
                              {
                                type: 'string',
                                enum: ['bold'],
                              },
                            ],
                          },
                          fontStyle: {
                            anyOf: [
                              {
                                type: 'string',
                                enum: ['normal'],
                              },
                              {
                                type: 'string',
                                enum: ['italic'],
                              },
                            ],
                          },
                          placement: {
                            anyOf: [
                              {
                                type: 'string',
                                enum: ['auto'],
                              },
                              {
                                type: 'string',
                                enum: ['horizontal'],
                              },
                              {
                                type: 'string',
                                enum: ['parallel'],
                              },
                            ],
                          },
                          priority: {
                            anyOf: [
                              {
                                type: 'number',
                              },
                              {
                                type: 'array',
                                items: {},
                              },
                            ],
                          },
                          maxLabels: {
                            type: 'number',
                          },
                          minScale: {
                            type: 'number',
                          },
                          maxScale: {
                            type: 'number',
                          },
                        },
                        additionalProperties: false,
                        description:
                          'Advanced text labeling controls that do not fit the MapLibre-inspired layout/paint subset.',
                      },
                      icon: {
                        type: 'object',
                        properties: {
                          enabled: {
                            anyOf: [
                              {
                                type: 'boolean',
                                enum: [false],
                              },
                              {
                                type: 'boolean',
                                enum: [true],
                              },
                            ],
                          },
                          anchor: {
                            type: 'array',
                            prefixItems: [
                              {
                                type: 'number',
                              },
                              {
                                type: 'number',
                              },
                            ],
                            minItems: 2,
                            maxItems: 2,
                            description:
                              'Native fractional anchors not expressible by the nine named icon-anchor values.',
                          },
                        },
                        additionalProperties: false,
                        description:
                          'Icon-only compatibility controls for native anchors/enabled state.',
                      },
                    },
                    additionalProperties: false,
                    description:
                      'Preferred attached symbol settings. When present, label/icon are materialized compatibility views.',
                  },
                  label: {
                    type: 'object',
                    properties: {
                      enabled: {
                        anyOf: [
                          {
                            type: 'boolean',
                            enum: [false],
                          },
                          {
                            type: 'boolean',
                            enum: [true],
                          },
                        ],
                      },
                      field: {
                        type: 'string',
                        description:
                          'Attribute column. Mutually exclusive with text. Null/missing values are not labelled.',
                      },
                      text: {
                        anyOf: [
                          {
                            type: 'string',
                          },
                          {
                            type: 'array',
                            items: {},
                          },
                        ],
                        description:
                          'Literal text or the existing safe style-expression subset (no JavaScript evaluation).',
                      },
                      fontFamily: {
                        type: 'string',
                      },
                      fontUrl: {
                        type: 'string',
                        description:
                          'Font outline URL for MSDF (TTF/OTF/WOFF1); resolved by the host, fetched locally in its Worker.',
                      },
                      fontSize: {
                        type: 'number',
                        description:
                          'Base CSS-pixel size; zoom-out stops at 12px, or this size when it is smaller.',
                      },
                      fontWeight: {
                        anyOf: [
                          {
                            type: 'number',
                          },
                          {
                            type: 'string',
                            enum: ['normal'],
                          },
                          {
                            type: 'string',
                            enum: ['bold'],
                          },
                        ],
                      },
                      fontStyle: {
                        anyOf: [
                          {
                            type: 'string',
                            enum: ['normal'],
                          },
                          {
                            type: 'string',
                            enum: ['italic'],
                          },
                        ],
                      },
                      color: {
                        type: 'string',
                      },
                      haloColor: {
                        type: 'string',
                      },
                      haloWidth: {
                        type: 'number',
                      },
                      offset: {
                        type: 'array',
                        prefixItems: [
                          {
                            type: 'number',
                          },
                          {
                            type: 'number',
                          },
                        ],
                        minItems: 2,
                        maxItems: 2,
                        description: 'CSS pixel offset applied after placement.',
                      },
                      placement: {
                        anyOf: [
                          {
                            type: 'string',
                            enum: ['auto'],
                          },
                          {
                            type: 'string',
                            enum: ['horizontal'],
                          },
                          {
                            type: 'string',
                            enum: ['parallel'],
                          },
                        ],
                        description: 'Auto: above points, parallel to lines, interior of polygons.',
                      },
                      allowOverlap: {
                        anyOf: [
                          {
                            type: 'boolean',
                            enum: [false],
                          },
                          {
                            type: 'boolean',
                            enum: [true],
                          },
                        ],
                      },
                      priority: {
                        anyOf: [
                          {
                            type: 'number',
                          },
                          {
                            type: 'array',
                            items: {},
                          },
                        ],
                        description:
                          'Higher priorities are placed first; ties use parent layer order and feature ID.',
                      },
                      minScale: {
                        type: 'number',
                        description:
                          'CRS-agnostic |mx| limits, in CSS pixels per source coordinate unit.',
                      },
                      maxScale: {
                        type: 'number',
                      },
                      maxLabels: {
                        type: 'number',
                      },
                      padding: {
                        type: 'number',
                        description: 'Collision spacing in CSS pixels, including the text halo.',
                      },
                    },
                    additionalProperties: false,
                    description: 'Attached feature labels; not a standalone render/tree layer.',
                  },
                  id: {
                    type: 'string',
                  },
                  source: {
                    type: 'string',
                  },
                  'source-layer': {
                    type: 'string',
                  },
                  layout: {
                    type: 'object',
                    properties: {
                      visibility: {
                        anyOf: [
                          {
                            type: 'string',
                            enum: ['visible'],
                          },
                          {
                            type: 'string',
                            enum: ['none'],
                          },
                        ],
                      },
                    },
                    additionalProperties: false,
                  },
                  filter: {
                    type: 'array',
                    items: {},
                    description:
                      '显示过滤器：MapLibre 子集表达式，必须逐要素求值为 boolean。数据不动，只影响渲染/拾取/属性过滤视图。',
                  },
                  styleSource: {
                    type: 'string',
                    enum: ['mapshaper'],
                    description:
                      '显式 opt-in：按图层类型读取 mapshaper 兼容烘焙颜色字段（fill / stroke）。',
                  },
                },
                required: ['type', 'id', 'source'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: {
                  type: {
                    type: 'string',
                    enum: ['circle'],
                  },
                  icon: {
                    type: 'object',
                    properties: {
                      url: {
                        type: 'string',
                      },
                      enabled: {
                        anyOf: [
                          {
                            type: 'boolean',
                            enum: [false],
                          },
                          {
                            type: 'boolean',
                            enum: [true],
                          },
                        ],
                      },
                      size: {
                        anyOf: [
                          {
                            type: 'number',
                          },
                          {
                            type: 'array',
                            prefixItems: [
                              {
                                type: 'number',
                              },
                              {
                                type: 'number',
                              },
                            ],
                            minItems: 2,
                            maxItems: 2,
                          },
                        ],
                        description:
                          'Height in CSS pixels, retaining aspect ratio, or explicit [width, height]. Default 32.',
                      },
                      anchor: {
                        type: 'array',
                        prefixItems: [
                          {
                            type: 'number',
                          },
                          {
                            type: 'number',
                          },
                        ],
                        minItems: 2,
                        maxItems: 2,
                        description:
                          'Normalized anchor in the cropped image. [0.5, 1] places a pin tip on the point.',
                      },
                      rotation: {
                        type: 'number',
                        description:
                          'Clockwise rotation around the anchor, in screen-space degrees.',
                      },
                      offset: {
                        type: 'array',
                        prefixItems: [
                          {
                            type: 'number',
                          },
                          {
                            type: 'number',
                          },
                        ],
                        minItems: 2,
                        maxItems: 2,
                        description: 'Screen-space CSS pixel offset, applied after rotation.',
                      },
                      opacity: {
                        type: 'number',
                      },
                      tint: {
                        type: 'string',
                        description:
                          'Optional alpha-mask recoloring. Omit to preserve the original image colors.',
                      },
                      rect: {
                        type: 'array',
                        prefixItems: [
                          {
                            type: 'number',
                          },
                          {
                            type: 'number',
                          },
                          {
                            type: 'number',
                          },
                          {
                            type: 'number',
                          },
                        ],
                        minItems: 4,
                        maxItems: 4,
                        description: 'Pixel crop [x, y, width, height] in a shared sprite image.',
                      },
                    },
                    required: ['url'],
                    additionalProperties: false,
                    description:
                      'Optional image symbol replacing the circle, retaining layer/feature identity.',
                  },
                  pointLod: {
                    anyOf: [
                      {
                        type: 'boolean',
                        enum: [false],
                      },
                      {
                        type: 'object',
                        properties: {
                          cellSize: {
                            type: 'number',
                          },
                        },
                        additionalProperties: false,
                      },
                    ],
                    description:
                      'Automatic density thinning; false draws all points. Cell size is in CSS pixels (default 8).',
                  },
                  paint: {
                    type: 'object',
                    properties: {
                      'circle-color': {
                        anyOf: [
                          {
                            type: 'string',
                          },
                          {
                            type: 'array',
                            items: {},
                          },
                        ],
                      },
                      'circle-radius': {
                        type: 'number',
                      },
                      'circle-fill': {
                        anyOf: [
                          {
                            type: 'boolean',
                            enum: [false],
                          },
                          {
                            type: 'boolean',
                            enum: [true],
                          },
                        ],
                      },
                      'circle-shape': {
                        anyOf: [
                          {
                            type: 'array',
                            items: {},
                          },
                          {
                            type: 'string',
                            enum: ['circle'],
                          },
                          {
                            type: 'string',
                            enum: ['square'],
                          },
                          {
                            type: 'string',
                            enum: ['triangle'],
                          },
                          {
                            type: 'string',
                            enum: ['triangle-down'],
                          },
                          {
                            type: 'string',
                            enum: ['diamond'],
                          },
                          {
                            type: 'string',
                            enum: ['pentagon'],
                          },
                          {
                            type: 'string',
                            enum: ['star'],
                          },
                          {
                            type: 'string',
                            enum: ['cross'],
                          },
                          {
                            type: 'string',
                            enum: ['x'],
                          },
                          {
                            type: 'string',
                            enum: ['hexagon'],
                          },
                          {
                            type: 'string',
                            enum: ['octagon'],
                          },
                        ],
                      },
                    },
                    additionalProperties: false,
                  },
                  symbol: {
                    type: 'object',
                    properties: {
                      layout: {
                        type: 'object',
                        properties: {
                          visibility: {
                            anyOf: [
                              {
                                type: 'string',
                                enum: ['visible'],
                              },
                              {
                                type: 'string',
                                enum: ['none'],
                              },
                            ],
                            description:
                              'Hides the attached text/icon only, not the parent geometry.',
                          },
                          'text-field': {
                            anyOf: [
                              {
                                type: 'string',
                              },
                              {
                                type: 'array',
                                items: {},
                              },
                            ],
                            description:
                              'Literal text or the existing safe expression subset; no token-template expansion.',
                          },
                          'text-size': {
                            type: 'number',
                          },
                          'text-font': {
                            type: 'array',
                            items: {
                              type: 'string',
                            },
                            description:
                              'One font family/face. MSDF keeps its own Noto/custom-font resolver.',
                          },
                          'text-offset': {
                            type: 'array',
                            prefixItems: [
                              {
                                type: 'number',
                              },
                              {
                                type: 'number',
                              },
                            ],
                            minItems: 2,
                            maxItems: 2,
                            description:
                              'em units, converted to the existing screen-pixel placement offset.',
                          },
                          'text-allow-overlap': {
                            anyOf: [
                              {
                                type: 'boolean',
                                enum: [false],
                              },
                              {
                                type: 'boolean',
                                enum: [true],
                              },
                            ],
                          },
                          'text-padding': {
                            type: 'number',
                          },
                          'icon-image': {
                            type: 'string',
                            description:
                              'Name in symbol.images. Images retain the existing URL/rect cache.',
                          },
                          'icon-size': {
                            type: 'number',
                            description:
                              'Multiplier of symbol.images[name].size; never a CSS-pixel height.',
                          },
                          'icon-anchor': {
                            anyOf: [
                              {
                                type: 'string',
                                enum: ['left'],
                              },
                              {
                                type: 'string',
                                enum: ['right'],
                              },
                              {
                                type: 'string',
                                enum: ['center'],
                              },
                              {
                                type: 'string',
                                enum: ['top'],
                              },
                              {
                                type: 'string',
                                enum: ['bottom'],
                              },
                              {
                                type: 'string',
                                enum: ['top-left'],
                              },
                              {
                                type: 'string',
                                enum: ['top-right'],
                              },
                              {
                                type: 'string',
                                enum: ['bottom-left'],
                              },
                              {
                                type: 'string',
                                enum: ['bottom-right'],
                              },
                            ],
                          },
                          'icon-rotate': {
                            type: 'number',
                          },
                          'icon-offset': {
                            type: 'array',
                            prefixItems: [
                              {
                                type: 'number',
                              },
                              {
                                type: 'number',
                              },
                            ],
                            minItems: 2,
                            maxItems: 2,
                            description:
                              'Multiplied by icon-size, then rotated with the icon, before conversion to screen pixels.',
                          },
                        },
                        additionalProperties: false,
                      },
                      paint: {
                        type: 'object',
                        properties: {
                          'text-color': {
                            type: 'string',
                          },
                          'text-halo-color': {
                            type: 'string',
                          },
                          'text-halo-width': {
                            type: 'number',
                          },
                          'icon-opacity': {
                            type: 'number',
                          },
                          'icon-color': {
                            type: 'string',
                            description:
                              'Existing alpha-mask tint; does not require a MapLibre SDF sprite.',
                          },
                        },
                        additionalProperties: false,
                      },
                      images: {
                        type: 'object',
                        properties: {},
                        additionalProperties: {
                          type: 'object',
                          properties: {
                            url: {
                              type: 'string',
                            },
                            size: {
                              anyOf: [
                                {
                                  type: 'number',
                                },
                                {
                                  type: 'array',
                                  prefixItems: [
                                    {
                                      type: 'number',
                                    },
                                    {
                                      type: 'number',
                                    },
                                  ],
                                  minItems: 2,
                                  maxItems: 2,
                                },
                              ],
                              description:
                                'Reference CSS-pixel height (preserving aspect) or [width,height], independent of source image resolution.',
                            },
                            rect: {
                              type: 'array',
                              prefixItems: [
                                {
                                  type: 'number',
                                },
                                {
                                  type: 'number',
                                },
                                {
                                  type: 'number',
                                },
                                {
                                  type: 'number',
                                },
                              ],
                              minItems: 4,
                              maxItems: 4,
                              description:
                                'Optional original-image pixel crop, as in IconOptions.rect.',
                            },
                          },
                          required: ['url', 'size'],
                          additionalProperties: false,
                        },
                        description:
                          'Local named image definitions; the same URL is shared by the existing renderer cache.',
                      },
                      labeling: {
                        type: 'object',
                        properties: {
                          enabled: {
                            anyOf: [
                              {
                                type: 'boolean',
                                enum: [false],
                              },
                              {
                                type: 'boolean',
                                enum: [true],
                              },
                            ],
                          },
                          fontUrl: {
                            type: 'string',
                          },
                          fontWeight: {
                            anyOf: [
                              {
                                type: 'number',
                              },
                              {
                                type: 'string',
                                enum: ['normal'],
                              },
                              {
                                type: 'string',
                                enum: ['bold'],
                              },
                            ],
                          },
                          fontStyle: {
                            anyOf: [
                              {
                                type: 'string',
                                enum: ['normal'],
                              },
                              {
                                type: 'string',
                                enum: ['italic'],
                              },
                            ],
                          },
                          placement: {
                            anyOf: [
                              {
                                type: 'string',
                                enum: ['auto'],
                              },
                              {
                                type: 'string',
                                enum: ['horizontal'],
                              },
                              {
                                type: 'string',
                                enum: ['parallel'],
                              },
                            ],
                          },
                          priority: {
                            anyOf: [
                              {
                                type: 'number',
                              },
                              {
                                type: 'array',
                                items: {},
                              },
                            ],
                          },
                          maxLabels: {
                            type: 'number',
                          },
                          minScale: {
                            type: 'number',
                          },
                          maxScale: {
                            type: 'number',
                          },
                        },
                        additionalProperties: false,
                        description:
                          'Advanced text labeling controls that do not fit the MapLibre-inspired layout/paint subset.',
                      },
                      icon: {
                        type: 'object',
                        properties: {
                          enabled: {
                            anyOf: [
                              {
                                type: 'boolean',
                                enum: [false],
                              },
                              {
                                type: 'boolean',
                                enum: [true],
                              },
                            ],
                          },
                          anchor: {
                            type: 'array',
                            prefixItems: [
                              {
                                type: 'number',
                              },
                              {
                                type: 'number',
                              },
                            ],
                            minItems: 2,
                            maxItems: 2,
                            description:
                              'Native fractional anchors not expressible by the nine named icon-anchor values.',
                          },
                        },
                        additionalProperties: false,
                        description:
                          'Icon-only compatibility controls for native anchors/enabled state.',
                      },
                    },
                    additionalProperties: false,
                    description:
                      'Preferred attached symbol settings. When present, label/icon are materialized compatibility views.',
                  },
                  label: {
                    type: 'object',
                    properties: {
                      enabled: {
                        anyOf: [
                          {
                            type: 'boolean',
                            enum: [false],
                          },
                          {
                            type: 'boolean',
                            enum: [true],
                          },
                        ],
                      },
                      field: {
                        type: 'string',
                        description:
                          'Attribute column. Mutually exclusive with text. Null/missing values are not labelled.',
                      },
                      text: {
                        anyOf: [
                          {
                            type: 'string',
                          },
                          {
                            type: 'array',
                            items: {},
                          },
                        ],
                        description:
                          'Literal text or the existing safe style-expression subset (no JavaScript evaluation).',
                      },
                      fontFamily: {
                        type: 'string',
                      },
                      fontUrl: {
                        type: 'string',
                        description:
                          'Font outline URL for MSDF (TTF/OTF/WOFF1); resolved by the host, fetched locally in its Worker.',
                      },
                      fontSize: {
                        type: 'number',
                        description:
                          'Base CSS-pixel size; zoom-out stops at 12px, or this size when it is smaller.',
                      },
                      fontWeight: {
                        anyOf: [
                          {
                            type: 'number',
                          },
                          {
                            type: 'string',
                            enum: ['normal'],
                          },
                          {
                            type: 'string',
                            enum: ['bold'],
                          },
                        ],
                      },
                      fontStyle: {
                        anyOf: [
                          {
                            type: 'string',
                            enum: ['normal'],
                          },
                          {
                            type: 'string',
                            enum: ['italic'],
                          },
                        ],
                      },
                      color: {
                        type: 'string',
                      },
                      haloColor: {
                        type: 'string',
                      },
                      haloWidth: {
                        type: 'number',
                      },
                      offset: {
                        type: 'array',
                        prefixItems: [
                          {
                            type: 'number',
                          },
                          {
                            type: 'number',
                          },
                        ],
                        minItems: 2,
                        maxItems: 2,
                        description: 'CSS pixel offset applied after placement.',
                      },
                      placement: {
                        anyOf: [
                          {
                            type: 'string',
                            enum: ['auto'],
                          },
                          {
                            type: 'string',
                            enum: ['horizontal'],
                          },
                          {
                            type: 'string',
                            enum: ['parallel'],
                          },
                        ],
                        description: 'Auto: above points, parallel to lines, interior of polygons.',
                      },
                      allowOverlap: {
                        anyOf: [
                          {
                            type: 'boolean',
                            enum: [false],
                          },
                          {
                            type: 'boolean',
                            enum: [true],
                          },
                        ],
                      },
                      priority: {
                        anyOf: [
                          {
                            type: 'number',
                          },
                          {
                            type: 'array',
                            items: {},
                          },
                        ],
                        description:
                          'Higher priorities are placed first; ties use parent layer order and feature ID.',
                      },
                      minScale: {
                        type: 'number',
                        description:
                          'CRS-agnostic |mx| limits, in CSS pixels per source coordinate unit.',
                      },
                      maxScale: {
                        type: 'number',
                      },
                      maxLabels: {
                        type: 'number',
                      },
                      padding: {
                        type: 'number',
                        description: 'Collision spacing in CSS pixels, including the text halo.',
                      },
                    },
                    additionalProperties: false,
                    description: 'Attached feature labels; not a standalone render/tree layer.',
                  },
                  id: {
                    type: 'string',
                  },
                  source: {
                    type: 'string',
                  },
                  'source-layer': {
                    type: 'string',
                  },
                  layout: {
                    type: 'object',
                    properties: {
                      visibility: {
                        anyOf: [
                          {
                            type: 'string',
                            enum: ['visible'],
                          },
                          {
                            type: 'string',
                            enum: ['none'],
                          },
                        ],
                      },
                    },
                    additionalProperties: false,
                  },
                  filter: {
                    type: 'array',
                    items: {},
                    description:
                      '显示过滤器：MapLibre 子集表达式，必须逐要素求值为 boolean。数据不动，只影响渲染/拾取/属性过滤视图。',
                  },
                  styleSource: {
                    type: 'string',
                    enum: ['mapshaper'],
                    description:
                      '显式 opt-in：按图层类型读取 mapshaper 兼容烘焙颜色字段（fill / stroke）。',
                  },
                },
                required: ['type', 'id', 'source'],
                additionalProperties: false,
              },
            ],
          },
          before: {
            type: 'string',
          },
        },
        required: ['layer'],
        additionalProperties: false,
      },
    },
    removeLayer: {
      parameters: ['id'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
          },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
    getLayer: {
      parameters: ['id'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
          },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
    getLayers: {
      parameters: [],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
    getRenderedLayers: {
      parameters: [],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
    setLayerVisibility: {
      parameters: ['id', 'visibility'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
          },
          visibility: {
            anyOf: [
              {
                type: 'string',
                enum: ['visible'],
              },
              {
                type: 'string',
                enum: ['none'],
              },
            ],
          },
        },
        required: ['id', 'visibility'],
        additionalProperties: false,
      },
    },
    setPaintProperty: {
      parameters: ['id', 'name', 'value'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
          },
          name: {
            type: 'string',
          },
          value: {},
        },
        required: ['id', 'name', 'value'],
        additionalProperties: false,
      },
    },
    setLayerSymbol: {
      parameters: ['id', 'symbol'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
          },
          symbol: {
            anyOf: [
              {
                type: 'null',
              },
              {
                type: 'object',
                properties: {
                  layout: {
                    type: 'object',
                    properties: {
                      visibility: {
                        anyOf: [
                          {
                            type: 'string',
                            enum: ['visible'],
                          },
                          {
                            type: 'string',
                            enum: ['none'],
                          },
                        ],
                        description: 'Hides the attached text/icon only, not the parent geometry.',
                      },
                      'text-field': {
                        anyOf: [
                          {
                            type: 'string',
                          },
                          {
                            type: 'array',
                            items: {},
                          },
                        ],
                        description:
                          'Literal text or the existing safe expression subset; no token-template expansion.',
                      },
                      'text-size': {
                        type: 'number',
                      },
                      'text-font': {
                        type: 'array',
                        items: {
                          type: 'string',
                        },
                        description:
                          'One font family/face. MSDF keeps its own Noto/custom-font resolver.',
                      },
                      'text-offset': {
                        type: 'array',
                        prefixItems: [
                          {
                            type: 'number',
                          },
                          {
                            type: 'number',
                          },
                        ],
                        minItems: 2,
                        maxItems: 2,
                        description:
                          'em units, converted to the existing screen-pixel placement offset.',
                      },
                      'text-allow-overlap': {
                        anyOf: [
                          {
                            type: 'boolean',
                            enum: [false],
                          },
                          {
                            type: 'boolean',
                            enum: [true],
                          },
                        ],
                      },
                      'text-padding': {
                        type: 'number',
                      },
                      'icon-image': {
                        type: 'string',
                        description:
                          'Name in symbol.images. Images retain the existing URL/rect cache.',
                      },
                      'icon-size': {
                        type: 'number',
                        description:
                          'Multiplier of symbol.images[name].size; never a CSS-pixel height.',
                      },
                      'icon-anchor': {
                        anyOf: [
                          {
                            type: 'string',
                            enum: ['left'],
                          },
                          {
                            type: 'string',
                            enum: ['right'],
                          },
                          {
                            type: 'string',
                            enum: ['center'],
                          },
                          {
                            type: 'string',
                            enum: ['top'],
                          },
                          {
                            type: 'string',
                            enum: ['bottom'],
                          },
                          {
                            type: 'string',
                            enum: ['top-left'],
                          },
                          {
                            type: 'string',
                            enum: ['top-right'],
                          },
                          {
                            type: 'string',
                            enum: ['bottom-left'],
                          },
                          {
                            type: 'string',
                            enum: ['bottom-right'],
                          },
                        ],
                      },
                      'icon-rotate': {
                        type: 'number',
                      },
                      'icon-offset': {
                        type: 'array',
                        prefixItems: [
                          {
                            type: 'number',
                          },
                          {
                            type: 'number',
                          },
                        ],
                        minItems: 2,
                        maxItems: 2,
                        description:
                          'Multiplied by icon-size, then rotated with the icon, before conversion to screen pixels.',
                      },
                    },
                    additionalProperties: false,
                  },
                  paint: {
                    type: 'object',
                    properties: {
                      'text-color': {
                        type: 'string',
                      },
                      'text-halo-color': {
                        type: 'string',
                      },
                      'text-halo-width': {
                        type: 'number',
                      },
                      'icon-opacity': {
                        type: 'number',
                      },
                      'icon-color': {
                        type: 'string',
                        description:
                          'Existing alpha-mask tint; does not require a MapLibre SDF sprite.',
                      },
                    },
                    additionalProperties: false,
                  },
                  images: {
                    type: 'object',
                    properties: {},
                    additionalProperties: {
                      type: 'object',
                      properties: {
                        url: {
                          type: 'string',
                        },
                        size: {
                          anyOf: [
                            {
                              type: 'number',
                            },
                            {
                              type: 'array',
                              prefixItems: [
                                {
                                  type: 'number',
                                },
                                {
                                  type: 'number',
                                },
                              ],
                              minItems: 2,
                              maxItems: 2,
                            },
                          ],
                          description:
                            'Reference CSS-pixel height (preserving aspect) or [width,height], independent of source image resolution.',
                        },
                        rect: {
                          type: 'array',
                          prefixItems: [
                            {
                              type: 'number',
                            },
                            {
                              type: 'number',
                            },
                            {
                              type: 'number',
                            },
                            {
                              type: 'number',
                            },
                          ],
                          minItems: 4,
                          maxItems: 4,
                          description:
                            'Optional original-image pixel crop, as in IconOptions.rect.',
                        },
                      },
                      required: ['url', 'size'],
                      additionalProperties: false,
                    },
                    description:
                      'Local named image definitions; the same URL is shared by the existing renderer cache.',
                  },
                  labeling: {
                    type: 'object',
                    properties: {
                      enabled: {
                        anyOf: [
                          {
                            type: 'boolean',
                            enum: [false],
                          },
                          {
                            type: 'boolean',
                            enum: [true],
                          },
                        ],
                      },
                      fontUrl: {
                        type: 'string',
                      },
                      fontWeight: {
                        anyOf: [
                          {
                            type: 'number',
                          },
                          {
                            type: 'string',
                            enum: ['normal'],
                          },
                          {
                            type: 'string',
                            enum: ['bold'],
                          },
                        ],
                      },
                      fontStyle: {
                        anyOf: [
                          {
                            type: 'string',
                            enum: ['normal'],
                          },
                          {
                            type: 'string',
                            enum: ['italic'],
                          },
                        ],
                      },
                      placement: {
                        anyOf: [
                          {
                            type: 'string',
                            enum: ['auto'],
                          },
                          {
                            type: 'string',
                            enum: ['horizontal'],
                          },
                          {
                            type: 'string',
                            enum: ['parallel'],
                          },
                        ],
                      },
                      priority: {
                        anyOf: [
                          {
                            type: 'number',
                          },
                          {
                            type: 'array',
                            items: {},
                          },
                        ],
                      },
                      maxLabels: {
                        type: 'number',
                      },
                      minScale: {
                        type: 'number',
                      },
                      maxScale: {
                        type: 'number',
                      },
                    },
                    additionalProperties: false,
                    description:
                      'Advanced text labeling controls that do not fit the MapLibre-inspired layout/paint subset.',
                  },
                  icon: {
                    type: 'object',
                    properties: {
                      enabled: {
                        anyOf: [
                          {
                            type: 'boolean',
                            enum: [false],
                          },
                          {
                            type: 'boolean',
                            enum: [true],
                          },
                        ],
                      },
                      anchor: {
                        type: 'array',
                        prefixItems: [
                          {
                            type: 'number',
                          },
                          {
                            type: 'number',
                          },
                        ],
                        minItems: 2,
                        maxItems: 2,
                        description:
                          'Native fractional anchors not expressible by the nine named icon-anchor values.',
                      },
                    },
                    additionalProperties: false,
                    description:
                      'Icon-only compatibility controls for native anchors/enabled state.',
                  },
                },
                additionalProperties: false,
              },
            ],
          },
        },
        required: ['id', 'symbol'],
        additionalProperties: false,
      },
    },
    removeLayerSymbol: {
      parameters: ['id'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
          },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
    setSymbolLayoutProperty: {
      parameters: ['id', 'name', 'value'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
          },
          name: {
            anyOf: [],
          },
          value: {
            anyOf: [
              {
                type: 'null',
              },
              {
                anyOf: [],
              },
            ],
          },
        },
        required: ['id', 'name', 'value'],
        additionalProperties: false,
      },
    },
    setSymbolPaintProperty: {
      parameters: ['id', 'name', 'value'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
          },
          name: {
            anyOf: [],
          },
          value: {
            anyOf: [
              {
                type: 'null',
              },
              {
                anyOf: [],
              },
            ],
          },
        },
        required: ['id', 'name', 'value'],
        additionalProperties: false,
      },
    },
    setLayerIcon: {
      parameters: ['id', 'options'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
          },
          options: {
            anyOf: [
              {
                type: 'null',
              },
              {
                type: 'object',
                properties: {
                  url: {
                    type: 'string',
                  },
                  enabled: {
                    anyOf: [
                      {
                        type: 'boolean',
                        enum: [false],
                      },
                      {
                        type: 'boolean',
                        enum: [true],
                      },
                    ],
                  },
                  size: {
                    anyOf: [
                      {
                        type: 'number',
                      },
                      {
                        type: 'array',
                        prefixItems: [
                          {
                            type: 'number',
                          },
                          {
                            type: 'number',
                          },
                        ],
                        minItems: 2,
                        maxItems: 2,
                      },
                    ],
                    description:
                      'Height in CSS pixels, retaining aspect ratio, or explicit [width, height]. Default 32.',
                  },
                  anchor: {
                    type: 'array',
                    prefixItems: [
                      {
                        type: 'number',
                      },
                      {
                        type: 'number',
                      },
                    ],
                    minItems: 2,
                    maxItems: 2,
                    description:
                      'Normalized anchor in the cropped image. [0.5, 1] places a pin tip on the point.',
                  },
                  rotation: {
                    type: 'number',
                    description: 'Clockwise rotation around the anchor, in screen-space degrees.',
                  },
                  offset: {
                    type: 'array',
                    prefixItems: [
                      {
                        type: 'number',
                      },
                      {
                        type: 'number',
                      },
                    ],
                    minItems: 2,
                    maxItems: 2,
                    description: 'Screen-space CSS pixel offset, applied after rotation.',
                  },
                  opacity: {
                    type: 'number',
                  },
                  tint: {
                    type: 'string',
                    description:
                      'Optional alpha-mask recoloring. Omit to preserve the original image colors.',
                  },
                  rect: {
                    type: 'array',
                    prefixItems: [
                      {
                        type: 'number',
                      },
                      {
                        type: 'number',
                      },
                      {
                        type: 'number',
                      },
                      {
                        type: 'number',
                      },
                    ],
                    minItems: 4,
                    maxItems: 4,
                    description: 'Pixel crop [x, y, width, height] in a shared sprite image.',
                  },
                },
                required: ['url'],
                additionalProperties: false,
              },
            ],
          },
        },
        required: ['id', 'options'],
        additionalProperties: false,
      },
    },
    setLayerLabel: {
      parameters: ['id', 'options'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
          },
          options: {
            anyOf: [
              {
                type: 'null',
              },
              {
                type: 'object',
                properties: {
                  enabled: {
                    anyOf: [
                      {
                        type: 'boolean',
                        enum: [false],
                      },
                      {
                        type: 'boolean',
                        enum: [true],
                      },
                    ],
                  },
                  field: {
                    type: 'string',
                    description:
                      'Attribute column. Mutually exclusive with text. Null/missing values are not labelled.',
                  },
                  text: {
                    anyOf: [
                      {
                        type: 'string',
                      },
                      {
                        type: 'array',
                        items: {},
                      },
                    ],
                    description:
                      'Literal text or the existing safe style-expression subset (no JavaScript evaluation).',
                  },
                  fontFamily: {
                    type: 'string',
                  },
                  fontUrl: {
                    type: 'string',
                    description:
                      'Font outline URL for MSDF (TTF/OTF/WOFF1); resolved by the host, fetched locally in its Worker.',
                  },
                  fontSize: {
                    type: 'number',
                    description:
                      'Base CSS-pixel size; zoom-out stops at 12px, or this size when it is smaller.',
                  },
                  fontWeight: {
                    anyOf: [
                      {
                        type: 'number',
                      },
                      {
                        type: 'string',
                        enum: ['normal'],
                      },
                      {
                        type: 'string',
                        enum: ['bold'],
                      },
                    ],
                  },
                  fontStyle: {
                    anyOf: [
                      {
                        type: 'string',
                        enum: ['normal'],
                      },
                      {
                        type: 'string',
                        enum: ['italic'],
                      },
                    ],
                  },
                  color: {
                    type: 'string',
                  },
                  haloColor: {
                    type: 'string',
                  },
                  haloWidth: {
                    type: 'number',
                  },
                  offset: {
                    type: 'array',
                    prefixItems: [
                      {
                        type: 'number',
                      },
                      {
                        type: 'number',
                      },
                    ],
                    minItems: 2,
                    maxItems: 2,
                    description: 'CSS pixel offset applied after placement.',
                  },
                  placement: {
                    anyOf: [
                      {
                        type: 'string',
                        enum: ['auto'],
                      },
                      {
                        type: 'string',
                        enum: ['horizontal'],
                      },
                      {
                        type: 'string',
                        enum: ['parallel'],
                      },
                    ],
                    description: 'Auto: above points, parallel to lines, interior of polygons.',
                  },
                  allowOverlap: {
                    anyOf: [
                      {
                        type: 'boolean',
                        enum: [false],
                      },
                      {
                        type: 'boolean',
                        enum: [true],
                      },
                    ],
                  },
                  priority: {
                    anyOf: [
                      {
                        type: 'number',
                      },
                      {
                        type: 'array',
                        items: {},
                      },
                    ],
                    description:
                      'Higher priorities are placed first; ties use parent layer order and feature ID.',
                  },
                  minScale: {
                    type: 'number',
                    description:
                      'CRS-agnostic |mx| limits, in CSS pixels per source coordinate unit.',
                  },
                  maxScale: {
                    type: 'number',
                  },
                  maxLabels: {
                    type: 'number',
                  },
                  padding: {
                    type: 'number',
                    description: 'Collision spacing in CSS pixels, including the text halo.',
                  },
                },
                additionalProperties: false,
              },
            ],
          },
        },
        required: ['id', 'options'],
        additionalProperties: false,
      },
    },
    setFilter: {
      parameters: ['id', 'expression'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
          },
          expression: {
            anyOf: [
              {
                type: 'null',
              },
              {
                type: 'array',
                items: {},
              },
            ],
          },
        },
        required: ['id', 'expression'],
        additionalProperties: false,
      },
    },
    getFilter: {
      parameters: ['id'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
          },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
    moveLayer: {
      parameters: ['id', 'beforeId'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
          },
          beforeId: {
            type: 'string',
          },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
  },
  SourceServiceImpl: {
    createLayer: {
      parameters: ['id', 'options'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
          },
          options: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
              },
              geometryType: {
                anyOf: [
                  {
                    type: 'string',
                    enum: ['point'],
                  },
                  {
                    type: 'string',
                    enum: ['polyline'],
                  },
                  {
                    type: 'string',
                    enum: ['polygon'],
                  },
                ],
              },
              crs: {
                type: 'string',
                description: "Input CRS; registered sources use the map's project CRS.",
              },
              fields: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: {
                      type: 'string',
                    },
                    type: {
                      anyOf: [
                        {
                          type: 'string',
                          enum: ['string'],
                        },
                        {
                          type: 'string',
                          enum: ['number'],
                        },
                        {
                          type: 'string',
                          enum: ['boolean'],
                        },
                      ],
                    },
                    defaultValue: {
                      anyOf: [
                        {
                          type: 'null',
                        },
                        {
                          type: 'string',
                        },
                        {
                          type: 'number',
                        },
                        {
                          type: 'boolean',
                          enum: [false],
                        },
                        {
                          type: 'boolean',
                          enum: [true],
                        },
                      ],
                    },
                  },
                  required: ['name', 'type'],
                  additionalProperties: false,
                },
              },
            },
            required: ['name', 'geometryType', 'crs'],
            additionalProperties: false,
          },
        },
        required: ['id', 'options'],
        additionalProperties: false,
      },
    },
    removeSource: {
      parameters: ['id'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
          },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
    getSource: {
      parameters: ['id'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
          },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
  },
  ProjectionServiceImpl: {
    setCRS: {
      parameters: ['crs'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          crs: {
            type: 'string',
          },
        },
        required: ['crs'],
        additionalProperties: false,
      },
    },
    reproject: {
      parameters: ['targetCrs'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          targetCrs: {
            type: 'string',
          },
        },
        required: ['targetCrs'],
        additionalProperties: false,
      },
    },
  },
  ViewServiceImpl: {
    getCRS: {
      parameters: [],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
    setGeometryLod: {
      parameters: ['options'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          options: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'object',
                properties: {
                  pixelTolerance: {
                    type: 'number',
                  },
                },
                additionalProperties: false,
              },
            ],
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
    setScreenPathFiltering: {
      parameters: ['enabled'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          enabled: {
            anyOf: [
              {
                type: 'boolean',
                enum: [false],
              },
              {
                type: 'boolean',
                enum: [true],
              },
            ],
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
    getCenter: {
      parameters: [],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
    getZoom: {
      parameters: [],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
    getTransform: {
      parameters: [],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
    getExtent: {
      parameters: [],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
    reset: {
      parameters: [],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
    zoomIn: {
      parameters: [],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
    zoomOut: {
      parameters: [],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
    jumpTo: {
      parameters: ['o'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          o: {
            type: 'object',
            properties: {
              center: {
                type: 'array',
                prefixItems: [
                  {
                    type: 'number',
                  },
                  {
                    type: 'number',
                  },
                ],
                minItems: 2,
                maxItems: 2,
                description: 'Target centre in projected/data coords (= P8 `mapCoord` space).',
              },
              zoom: {
                type: 'number',
                description:
                  'Target zoom (WebMercator convenience; converted via host.scaleFromZoom).',
              },
              scale: {
                type: 'number',
                description: 'Target scale (= |mx|); CRS-agnostic. Takes precedence over `zoom`.',
              },
            },
            additionalProperties: false,
          },
        },
        required: ['o'],
        additionalProperties: false,
      },
    },
    setCenter: {
      parameters: ['center'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          center: {
            type: 'array',
            prefixItems: [
              {
                type: 'number',
              },
              {
                type: 'number',
              },
            ],
            minItems: 2,
            maxItems: 2,
          },
        },
        required: ['center'],
        additionalProperties: false,
      },
    },
    setZoom: {
      parameters: ['zoom'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          zoom: {
            type: 'number',
          },
        },
        required: ['zoom'],
        additionalProperties: false,
      },
    },
    easeTo: {
      parameters: ['o'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          o: {
            type: 'object',
            properties: {
              center: {
                type: 'array',
                prefixItems: [
                  {
                    type: 'number',
                  },
                  {
                    type: 'number',
                  },
                ],
                minItems: 2,
                maxItems: 2,
                description: 'Target centre in projected/data coords (= P8 `mapCoord` space).',
              },
              zoom: {
                type: 'number',
                description:
                  'Target zoom (WebMercator convenience; converted via host.scaleFromZoom).',
              },
              scale: {
                type: 'number',
                description: 'Target scale (= |mx|); CRS-agnostic. Takes precedence over `zoom`.',
              },
              duration: {
                type: 'number',
                description: 'ms. Default 1000 for ease/fly. Ignored when animate:false.',
              },
              easing: {
                anyOf: [],
                description: 't∈[0,1] → eased t. Default Tween.sineInOut.',
              },
              animate: {
                anyOf: [
                  {
                    type: 'boolean',
                    enum: [false],
                  },
                  {
                    type: 'boolean',
                    enum: [true],
                  },
                ],
                description: 'false (or duration:0) ⇒ jump (no animation). Default true.',
              },
            },
            additionalProperties: false,
          },
        },
        required: ['o'],
        additionalProperties: false,
      },
    },
    panTo: {
      parameters: ['center', 'o'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          center: {
            type: 'array',
            prefixItems: [
              {
                type: 'number',
              },
              {
                type: 'number',
              },
            ],
            minItems: 2,
            maxItems: 2,
          },
          o: {
            type: 'object',
            properties: {
              duration: {
                type: 'number',
                description: 'ms. Default 1000 for ease/fly. Ignored when animate:false.',
              },
              easing: {
                anyOf: [],
                description: 't∈[0,1] → eased t. Default Tween.sineInOut.',
              },
              animate: {
                anyOf: [
                  {
                    type: 'boolean',
                    enum: [false],
                  },
                  {
                    type: 'boolean',
                    enum: [true],
                  },
                ],
                description: 'false (or duration:0) ⇒ jump (no animation). Default true.',
              },
            },
            additionalProperties: false,
          },
        },
        required: ['center'],
        additionalProperties: false,
      },
    },
    panBy: {
      parameters: ['offset', 'o'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          offset: {
            type: 'array',
            prefixItems: [
              {
                type: 'number',
              },
              {
                type: 'number',
              },
            ],
            minItems: 2,
            maxItems: 2,
          },
          o: {
            type: 'object',
            properties: {
              duration: {
                type: 'number',
                description: 'ms. Default 1000 for ease/fly. Ignored when animate:false.',
              },
              easing: {
                anyOf: [],
                description: 't∈[0,1] → eased t. Default Tween.sineInOut.',
              },
              animate: {
                anyOf: [
                  {
                    type: 'boolean',
                    enum: [false],
                  },
                  {
                    type: 'boolean',
                    enum: [true],
                  },
                ],
                description: 'false (or duration:0) ⇒ jump (no animation). Default true.',
              },
            },
            additionalProperties: false,
          },
        },
        required: ['offset'],
        additionalProperties: false,
      },
    },
    zoomTo: {
      parameters: ['zoom', 'o'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          zoom: {
            type: 'number',
          },
          o: {
            type: 'object',
            properties: {
              duration: {
                type: 'number',
                description: 'ms. Default 1000 for ease/fly. Ignored when animate:false.',
              },
              easing: {
                anyOf: [],
                description: 't∈[0,1] → eased t. Default Tween.sineInOut.',
              },
              animate: {
                anyOf: [
                  {
                    type: 'boolean',
                    enum: [false],
                  },
                  {
                    type: 'boolean',
                    enum: [true],
                  },
                ],
                description: 'false (or duration:0) ⇒ jump (no animation). Default true.',
              },
            },
            additionalProperties: false,
          },
        },
        required: ['zoom'],
        additionalProperties: false,
      },
    },
    flyTo: {
      parameters: ['o'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          o: {
            type: 'object',
            properties: {
              curve: {
                type: 'number',
                description: 'van-Wijk curvature. Default 1.42.',
              },
              speed: {
                type: 'number',
                description: 'Average flight speed (screenfuls/sec). Overrides duration if set.',
              },
              center: {
                type: 'array',
                prefixItems: [
                  {
                    type: 'number',
                  },
                  {
                    type: 'number',
                  },
                ],
                minItems: 2,
                maxItems: 2,
                description: 'Target centre in projected/data coords (= P8 `mapCoord` space).',
              },
              zoom: {
                type: 'number',
                description:
                  'Target zoom (WebMercator convenience; converted via host.scaleFromZoom).',
              },
              scale: {
                type: 'number',
                description: 'Target scale (= |mx|); CRS-agnostic. Takes precedence over `zoom`.',
              },
              duration: {
                type: 'number',
                description: 'ms. Default 1000 for ease/fly. Ignored when animate:false.',
              },
              easing: {
                anyOf: [],
                description: 't∈[0,1] → eased t. Default Tween.sineInOut.',
              },
              animate: {
                anyOf: [
                  {
                    type: 'boolean',
                    enum: [false],
                  },
                  {
                    type: 'boolean',
                    enum: [true],
                  },
                ],
                description: 'false (or duration:0) ⇒ jump (no animation). Default true.',
              },
            },
            additionalProperties: false,
          },
        },
        required: ['o'],
        additionalProperties: false,
      },
    },
    stop: {
      parameters: [],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
    project: {
      parameters: ['x', 'y'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          x: {
            type: 'number',
          },
          y: {
            type: 'number',
          },
        },
        required: ['x', 'y'],
        additionalProperties: false,
      },
    },
    unproject: {
      parameters: ['px', 'py'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          px: {
            type: 'number',
          },
          py: {
            type: 'number',
          },
        },
        required: ['px', 'py'],
        additionalProperties: false,
      },
    },
  },
  SelectionServiceImpl: {
    setHighlightedFeatures: {
      parameters: ['features', 'style'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          features: {
            type: 'array',
            items: {
              anyOf: [
                {
                  type: 'object',
                  properties: {
                    id: {
                      type: 'number',
                    },
                    source: {
                      type: 'string',
                    },
                    layer: {
                      type: 'string',
                    },
                  },
                  required: ['id', 'source', 'layer'],
                  additionalProperties: false,
                },
                {
                  type: 'object',
                  properties: {
                    id: {
                      type: 'number',
                    },
                    source: {
                      type: 'string',
                    },
                    layer: {
                      type: 'string',
                    },
                    geometryType: {
                      type: 'string',
                    },
                    properties: {
                      type: 'object',
                      properties: {},
                      additionalProperties: {},
                    },
                  },
                  required: ['id', 'source', 'layer', 'geometryType', 'properties'],
                  additionalProperties: false,
                },
              ],
            },
          },
          style: {
            type: 'object',
            properties: {
              color: {
                type: 'string',
              },
              width: {
                type: 'number',
              },
              radius: {
                type: 'number',
              },
              fill: {
                anyOf: [
                  {
                    type: 'boolean',
                    enum: [false],
                  },
                  {
                    type: 'boolean',
                    enum: [true],
                  },
                ],
              },
              fillOpacity: {
                type: 'number',
                description:
                  "Fill opacity applied to highlighted polygon interiors, multiplied with\n`color`'s own alpha (MapLibre `fill-opacity` semantics). Unset or `0`\nkeeps polygon highlights outline-only; `fill` remains point-only.",
              },
            },
            additionalProperties: false,
          },
        },
        required: ['features'],
        additionalProperties: false,
      },
    },
    clearHighlightedFeatures: {
      parameters: [],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
    setHighlightStyle: {
      parameters: ['style'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          style: {
            type: 'object',
            properties: {
              color: {
                type: 'string',
              },
              width: {
                type: 'number',
              },
              radius: {
                type: 'number',
              },
              fill: {
                anyOf: [
                  {
                    type: 'boolean',
                    enum: [false],
                  },
                  {
                    type: 'boolean',
                    enum: [true],
                  },
                ],
              },
              fillOpacity: {
                type: 'number',
                description:
                  "Fill opacity applied to highlighted polygon interiors, multiplied with\n`color`'s own alpha (MapLibre `fill-opacity` semantics). Unset or `0`\nkeeps polygon highlights outline-only; `fill` remains point-only.",
              },
            },
            additionalProperties: false,
          },
        },
        required: ['style'],
        additionalProperties: false,
      },
    },
    select: {
      parameters: ['features', 'options'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          features: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: {
                  type: 'number',
                },
                source: {
                  type: 'string',
                },
                layer: {
                  type: 'string',
                },
              },
              required: ['id', 'source', 'layer'],
              additionalProperties: false,
            },
          },
          options: {
            type: 'object',
            properties: {
              mode: {
                anyOf: [
                  {
                    type: 'string',
                    enum: ['replace'],
                  },
                  {
                    type: 'string',
                    enum: ['add'],
                  },
                  {
                    type: 'string',
                    enum: ['toggle'],
                  },
                ],
              },
            },
            additionalProperties: false,
          },
        },
        required: ['features'],
        additionalProperties: false,
      },
    },
    deselect: {
      parameters: ['features'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          features: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: {
                  type: 'number',
                },
                source: {
                  type: 'string',
                },
                layer: {
                  type: 'string',
                },
              },
              required: ['id', 'source', 'layer'],
              additionalProperties: false,
            },
          },
        },
        required: ['features'],
        additionalProperties: false,
      },
    },
    clearSelection: {
      parameters: [],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
    getSelection: {
      parameters: [],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
    isSelected: {
      parameters: ['feature'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          feature: {
            type: 'object',
            properties: {
              id: {
                type: 'number',
              },
              source: {
                type: 'string',
              },
              layer: {
                type: 'string',
              },
            },
            required: ['id', 'source', 'layer'],
            additionalProperties: false,
          },
        },
        required: ['feature'],
        additionalProperties: false,
      },
    },
  },
  HistoryServiceImpl: {
    undo: {
      parameters: [],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
    redo: {
      parameters: [],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
    canUndo: {
      parameters: [],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
    canRedo: {
      parameters: [],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
    clearHistory: {
      parameters: [],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  },
  QueryServiceImpl: {
    queryFeatures: {
      parameters: ['geometryOrOptions', 'options'],
      flatten: false,
      inputSchema: {
        type: 'object',
        properties: {
          geometryOrOptions: {
            anyOf: [
              {
                type: 'array',
                prefixItems: [
                  {
                    type: 'number',
                  },
                  {
                    type: 'number',
                  },
                ],
                minItems: 2,
                maxItems: 2,
              },
              {
                type: 'array',
                prefixItems: [
                  {
                    type: 'array',
                    prefixItems: [
                      {
                        type: 'number',
                      },
                      {
                        type: 'number',
                      },
                    ],
                    minItems: 2,
                    maxItems: 2,
                  },
                  {
                    type: 'array',
                    prefixItems: [
                      {
                        type: 'number',
                      },
                      {
                        type: 'number',
                      },
                    ],
                    minItems: 2,
                    maxItems: 2,
                  },
                ],
                minItems: 2,
                maxItems: 2,
              },
              {
                type: 'object',
                properties: {
                  layers: {
                    type: 'array',
                    items: {
                      type: 'string',
                    },
                  },
                },
                additionalProperties: false,
              },
            ],
          },
          options: {
            type: 'object',
            properties: {
              layers: {
                type: 'array',
                items: {
                  type: 'string',
                },
              },
            },
            additionalProperties: false,
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
} as const satisfies Record<
  string,
  Record<string, { parameters: readonly string[]; flatten: boolean; inputSchema: InputSchema }>
>;
