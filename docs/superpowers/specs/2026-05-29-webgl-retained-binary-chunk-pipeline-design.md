# WebGL Retained Binary Chunk Pipeline Design

## Goal

Maximize WebGL large-data rendering performance by moving the renderer toward a
deck.gl-style retained binary attribute pipeline while preserving Mapshaper
topology and editing semantics.

The target behavior is:

- `ArcCollection` remains the authoritative topology and editing data model.
- WebGL maintains derived binary snapshots, spatial chunks, worker tasks, and
  retained GPU buffers.
- Navigation frames never rebuild full geometry. They update uniforms and draw
  visible ready chunks.
- Expensive point, line, and polygon conversion runs asynchronously and
  incrementally.
- Complex polygon triangulation no longer blocks the main render path.
- Edits invalidate only affected chunks when enough topology information is
  available, with a safe layer/source fallback.

## Current Problem

The existing WebGL renderer has moved partway toward deck.gl's model:

- Line data has retained spatial chunks.
- Point and line conversion can be deferred to a geometry worker.
- Polygon fills use SolidPolygonLayer-style indexed tessellation through
  `earcut`.
- A geometry worker can build polygon tessellation asynchronously.

However, the renderer still has structural bottlenecks:

- Worker polygon requests send large `shapes` and `vertexData` payloads instead
  of registering a source snapshot once and reusing it.
- Polygon tessellation is keyed at layer/flags granularity rather than chunk
  granularity.
- Complex polygons can still become one large `earcut` task.
- Cache invalidation is mostly source/layer-wide, not chunk-local.
- Rendering code still sits close to conversion code, making it hard to reason
  about draw-only frames versus build frames.

This differs from deck.gl and deck.gl-geoarrow, where data is normalized into
binary attributes, retained by layer, incrementally updated, and drawn without
re-reading object geometry each frame.

## Recommended Architecture

Add a WebGL render-geometry pipeline with four layers:

1. **Binary snapshot layer**
   Captures a renderer-only view of `ArcCollection`, shapes, layer flags, and
   revision metadata. This layer is derived data, not a replacement for
   Mapshaper topology.

2. **Spatial chunk layer**
   Splits source/layer render data into stable chunks with bbox indexes,
   revision metadata, and reverse mappings from arcs/features to chunk ids.

3. **Async build layer**
   Owns worker pool requests. Workers cache registered snapshots and receive
   small chunk build requests instead of full geometry payloads on every render.

4. **Retained draw layer**
   Owns ready typed arrays and GPU models/buffers. A render frame only queries
   visible chunks, draws ready chunks, and schedules missing or dirty chunks.

The high-level flow is:

```text
ArcCollection + shapes + layer flags
  -> WebGLBinarySourceSnapshot
  -> WebGLSpatialChunkIndex
  -> chunk build requests
  -> point/path/polygon typed arrays
  -> retained WebGL buffers
  -> visible chunk draw
```

## Files And Responsibilities

### `src/renderer/webgl/binary-source.ts`

Create this file to own source/layer render snapshots.

Responsibilities:

- Build stable snapshot keys from `sourceId`, `sourceLayerId`,
  `renderRevision`, `retainedInterval`, `origin`, and layer flags identity.
- Read `ArcCollection.getVertexData()` once per relevant revision.
- Preserve `ArcCollection` as the source of truth.
- Expose serializable data for worker registration.
- Avoid doing tessellation, spatial indexing, or GPU work.

Expected core types:

```ts
export interface WebGLBinarySourceKey {
  sourceId: string;
  sourceLayerId: string;
  renderRevision: number;
  retainedInterval: number;
  origin: [number, number];
}

export interface WebGLBinarySourceSnapshot {
  id: string;
  key: WebGLBinarySourceKey;
  shapes: any[];
  vertexData: WebGLArcChunkWorkerVertexData;
  arcCount: number;
  pointCount: number;
}
```

### `src/renderer/webgl/chunk-index.ts`

Create this file to own spatial chunking.

Responsibilities:

- Build `WebGLSpatialChunk[]` from a binary snapshot and optional layer flags.
- Maintain a Flatbush index for chunk bbox lookup.
- Build reverse maps:
  - `arcId -> chunkIds`
  - `featureId -> chunkIds`
- Keep chunk ids stable for a stable snapshot and chunking strategy.

Expected core types:

```ts
export type WebGLGeometryKind = 'point' | 'line' | 'polygon';

export interface WebGLSpatialChunk {
  id: string;
  kind: WebGLGeometryKind;
  bbox: [number, number, number, number];
  arcIds: Uint32Array;
  featureIds: Uint32Array;
  pointCount: number;
}

export interface WebGLSpatialChunkIndex {
  chunks: WebGLSpatialChunk[];
  search(bbox: [number, number, number, number] | number[]): WebGLSpatialChunk[];
  getChunksForArcIds(arcIds: Iterable<number>): string[];
  getChunksForFeatureIds(featureIds: Iterable<number>): string[];
}
```

### `src/renderer/webgl/chunk-cache.ts`

Create this file to own chunk lifecycle state.

Responsibilities:

- Track `empty`, `pending`, `ready`, `dirty`, and `failed` chunk states.
- Deduplicate build requests.
- Keep old ready geometry visible while replacement geometry is pending.
- Expose draw-ready chunks separately from chunks that need scheduling.
- Provide source/layer invalidation and arc/feature-local invalidation.

Expected behavior:

- `getVisibleReadyChunks(viewportBBox)` returns only chunks with draw data.
- `getMissingOrDirtyChunks(viewportBBox)` returns chunks that should be
  scheduled.
- `markPending(chunkId, requestId)` prevents duplicate worker tasks.
- `acceptReady(chunkId, revision, geometry)` ignores stale worker responses.

### `src/renderer/webgl/geometry-worker-client.ts`

Extend this file from a single worker wrapper into a small worker pool and
snapshot registry.

Responsibilities:

- Register a source snapshot once per snapshot id.
- Send transferable typed arrays during registration where safe.
- Build point, line, and polygon chunks by snapshot id and chunk id.
- Preserve the existing public worker enablement options.
- Handle worker startup failure by disabling async geometry without breaking
  Canvas or the basic WebGL path.

Expected worker client commands:

```ts
registerSourceSnapshot(snapshot): Promise<void>;
buildPointChunk(request): Promise<WebGLPointChunkGeometry>;
buildLineChunk(request): Promise<WebGLArcSegmentChunk>;
buildPolygonChunk(request): Promise<WebGLPolygonChunkGeometry>;
dropSourceSnapshot(snapshotId): void;
```

### `src/renderer/webgl/geometry-worker.ts`

Extend this worker to hold registered snapshots.

Responsibilities:

- Store snapshot data in worker memory by `snapshotId`.
- Reconstruct line/path chunk attributes from cached `vertexData`.
- Reconstruct polygon rings for the requested chunk and run `earcut`.
- Return typed arrays with transfer lists.
- Treat very large polygon chunks as splittable/deferred work instead of one
  unbounded synchronous worker task.

The worker must not mutate topology. It only creates renderer-side arrays.

### `src/renderer/webgl-painter.ts`

Keep this as the Painter implementation and retained draw owner.

Responsibilities:

- Continue implementing the existing `Painter` interface.
- Expose optional WebGL fast-path methods for chunked point, line, and polygon
  rendering.
- Draw ready chunk models and schedule missing/dirty chunks through the cache.
- Avoid direct full-layer geometry conversion on navigation frames.
- Keep current fallback methods for small datasets and worker-disabled
  environments.

### `src/map/map.ts`

Keep Map responsible for layer orchestration, not geometry conversion.

Responsibilities:

- Pass stable `sourceId`, `sourceLayerId`, `cacheKey`, `renderRevision`, and
  viewport bounds into WebGL fast-path methods.
- Preserve Canvas fallback behavior.
- Prefer chunked WebGL paths when the painter supports them.
- Invalidate WebGL chunk caches when source topology or display arcs change.

## Chunking Rules

### Points

Point chunks can be grouped by point bbox or fixed point count. Each chunk owns
a positions typed array and optional feature ids.

### Lines

Line chunks should group arcs by arc bbox, matching the existing retained arc
chunk direction. The output remains PathLayer-style segment attributes.

### Polygons

Polygon chunks must not split individual rings arbitrarily. The first
implementation should group whole polygon features by feature bbox. This keeps
ring reconstruction and `earcut` semantics correct.

If a single polygon feature is too large, it should be marked as an oversized
chunk and handled by a second-level strategy:

- schedule it after smaller visible chunks,
- keep the UI responsive while pending,
- optionally split multipolygon parts when topology semantics allow it.

Arbitrary geometric clipping of a ring is not part of the first implementation
because it risks changing fill semantics and topology expectations.

## Cache Keys

Source snapshot key:

```text
sourceId + sourceLayerId + renderRevision + retainedInterval + origin
```

Layer render key:

```text
sourceSnapshotId + layerId + geometryKind + layerArcFlagsId + styleRelevantKey
```

Chunk key:

```text
layerRenderKey + chunkId + chunkRevision
```

The first implementation should keep style out of geometry keys unless style
changes alter geometry. Fill color, opacity, stroke color, and point color are
uniform/attribute-style changes and should not invalidate geometry. Stroke width
may stay uniform-driven if the current shader path supports it.

## Invalidation Strategy

The invalidation API should support both broad and local invalidation:

```ts
invalidateSource(sourceId: string): void;
invalidateLayer(sourceId: string, sourceLayerId: string): void;
invalidateArcIds(arcs: ArcCollection, arcIds: Iterable<number>): void;
invalidateFeatureIds(sourceId: string, sourceLayerId: string, featureIds: Iterable<number>): void;
```

Initial local invalidation can fall back to layer invalidation if the caller
does not provide affected ids. The API still needs local methods so editing
commands can adopt them incrementally.

Editing cases:

- Vertex move: invalidate chunks containing moved arc ids.
- Shared node move: invalidate all chunks containing affected shared arcs.
- Shared edge split: invalidate chunks containing old arc ids and new arc ids.
- Feature create/delete: invalidate chunks containing the affected feature ids,
  or rebuild the layer chunk index if feature count changes.

## Render Behavior

For each WebGL layer frame:

1. Resolve the source/layer snapshot id.
2. Query visible chunks from the spatial index.
3. Draw chunks in `ready` state.
4. Keep drawing old ready geometry for dirty chunks while replacement work is
   pending.
5. Schedule missing or dirty visible chunks.
6. Do not call full-layer `buildPolygonTessellatedGeometry` from the render
   path for large data.

This changes the user experience from "blank until one huge job finishes" to
"visible chunks progressively fill in."

## Deck.gl Alignment

This design mirrors deck.gl concepts without embedding deck.gl as the renderer:

- Binary attributes map to typed arrays owned by chunks.
- `startIndices` and chunk ids describe geometry boundaries.
- Path rendering remains segment-attribute based, like `PathLayer`.
- Polygon rendering remains indexed triangle based, like `SolidPolygonLayer`.
- Attribute buffers are retained until data changes.
- View changes update uniforms and visible ranges rather than rebuilding
  attributes.

It also mirrors deck.gl-geoarrow's high-level lessons:

- Avoid object-per-feature iteration on every frame.
- Prefer binary buffers over intermediate object representations.
- Run polygon triangulation off the main thread.
- Support progressive rendering by batch/chunk.

## Phased Implementation

### Phase 1: Snapshot Registry

Stop sending full `shapes` and `vertexData` on every worker request.

Deliverables:

- `binary-source.ts`
- worker `registerSourceSnapshot`
- worker client snapshot registry
- tests proving repeated renders register once and build by snapshot id

### Phase 2: Point And Line Chunk Cache

Move point and line WebGL fast paths onto the retained chunk cache.

Deliverables:

- `chunk-index.ts`
- `chunk-cache.ts`
- point chunk builder
- line chunk builder using existing segment attributes
- tests proving viewport changes reuse ready chunk buffers

### Phase 3: Polygon Chunk Tessellation

Move polygon fill onto chunk-level worker tessellation.

Deliverables:

- polygon chunk builder
- polygon chunk draw path
- oversized polygon scheduling behavior
- tests proving render does not call full-layer tessellation for large visible
  polygon layers

### Phase 4: Editing Local Invalidation

Connect topology editing to chunk-local invalidation.

Deliverables:

- reverse chunk maps
- invalidation APIs
- integration tests for node move and shared edge split dirtying only affected
  chunks where affected ids are available

## Testing Strategy

Unit tests:

- binary snapshot key stability
- snapshot registration deduplication
- chunk bbox search
- chunk state transitions
- stale worker response rejection
- point, line, and polygon chunk geometry outputs

Painter tests:

- ready chunks draw
- pending chunks skip without blocking
- viewport changes reuse typed arrays and models
- large polygon fill schedules chunks instead of running synchronous
  tessellation

Map tests:

- WebGL line/fill layers pass source/layer/revision/viewport data to fast paths
- Canvas render path remains unchanged
- source invalidation clears derived WebGL chunk caches

Manual performance checks:

- DevTools main thread no longer shows render frames entering `earcut` for
  large polygon layers.
- Pan, zoom, and rotate do not trigger full geometry rebuilds.
- Complex polygon fills appear progressively.
- Editing preserves Mapshaper topology behavior.

## Risks And Mitigations

### Large single polygon features

A single complex polygon can still be expensive even when chunked by feature.
The first mitigation is scheduling: process smaller visible chunks first and
keep the UI responsive. Later work can split multipolygon parts or add a
stencil-fill fallback for pathological features.

### Memory growth

Retained binary chunks and GPU buffers use more memory than rebuilding on demand.
Use an LRU policy per source/layer for offscreen chunks, while preserving ready
chunks near the current viewport.

### Edit invalidation precision

Some editing operations may not initially expose affected arc/feature ids. The
API should support local invalidation from the start, but callers can fall back
to layer invalidation until they provide precise ids.

### Worker startup and transfer failures

If workers fail to start or snapshot registration fails, WebGL should fall back
to the existing synchronous/smaller-data path and Canvas should remain
unaffected.

## Acceptance Criteria

- WebGL large polygon render does not synchronously run full-layer
  `buildPolygonTessellatedGeometry` during render.
- Worker requests after initial registration are small chunk requests, not full
  `shapes + vertexData` payloads.
- Viewport navigation reuses ready geometry and retained GPU models.
- Complex polygon data can progressively render without freezing the main
  thread for seconds.
- Mapshaper `ArcCollection` topology and editing APIs remain unchanged.
- Existing Canvas behavior remains unchanged.
