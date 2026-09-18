/** Serializable raster metadata. No DOM, storage, decoder or plugin ownership here. */
export type RasterWindow = readonly [number, number, number, number];
export type RasterSamples =
  | Uint8Array
  | Int8Array
  | Uint16Array
  | Int16Array
  | Uint32Array
  | Int32Array
  | Float32Array
  | Float64Array;
export interface RasterLevel {
  readonly id: number;
  /** Physical image backing this level. Third-party RasterSource implementations may omit it. */
  readonly source?: 'base' | 'internal-overview' | 'external-overview';
  readonly width: number;
  readonly height: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  /** Provider-guaranteed upper bound for simultaneously decoded physical blocks. Omit for conservative all-block budgeting. */
  readonly decodedBlockConcurrency?: number;
  readonly samples: number;
  readonly bits: readonly number[];
  readonly formats: readonly number[];
  readonly photometric: number;
  readonly subfileType: number;
}
/** Fixed, source-wide bounded sample statistics; never recomputed per viewport. */
export interface RasterBandStatistics {
  readonly min: number;
  readonly max: number;
  readonly p02: number;
  readonly p98: number;
  readonly count: number;
  readonly approximate: boolean;
}
export interface RasterMetadata {
  readonly filename: string;
  readonly fileSize: number;
  readonly lastModified: number;
  readonly crs: string;
  readonly bounds: RasterWindow;
  /** Pixel-corner origin, not pixel-center coordinates. */
  readonly origin: readonly [number, number];
  readonly resolution: readonly [number, number];
  readonly levels: readonly RasterLevel[];
  readonly noData: number | null;
  readonly alphaBand: number | null;
  readonly palette?: readonly number[];
  readonly statistics?: readonly RasterBandStatistics[];
  readonly bigTiff: boolean;
  readonly overviewFile?: {
    readonly filename: string;
    readonly fileSize: number;
    readonly lastModified: number;
  };
}
export interface RasterReadRequest {
  readonly level: number;
  readonly window: RasterWindow;
  readonly samples: readonly number[];
}
export interface RasterReadResult {
  readonly width: number;
  readonly height: number;
  readonly data: readonly RasterSamples[];
}
export interface RasterStyle {
  /** auto preserves UInt8 colors and applies 2–98% stretch to other numeric types. */
  readonly stretch?: 'auto' | 'minmax' | 'percentile' | 'none';
  /** Zero-based source bands: one for grayscale or three in R/G/B order.
   * Omit for automatic RGB (3+ non-alpha samples), grayscale, or the native palette.
   * Explicit selection bypasses a native palette to display the selected values.
   */
  readonly bands?: readonly number[];
  /** Stable ranges per displayed band. No per-tile min/max seams. */
  readonly ranges?: readonly (readonly [number, number])[];
  readonly opacity?: number;
  readonly resampling?: 'nearest' | 'bilinear';
}
/** JSON-safe external reference. Never contains a File, Blob or raster samples. */
export interface RasterReference {
  readonly kind: 'raster';
  readonly storage: 'external-file';
  readonly format: 'geotiff';
  readonly filename: string;
  readonly fileSize: number;
  readonly lastModified: number;
  readonly crs: string;
  readonly overviewFile?: RasterMetadata['overviewFile'];
}
/** Serializable inverse warp; numbers remain Float64 to preserve map precision. */
export interface RasterWarpMesh {
  readonly mode: 'grid' | 'pixels';
  readonly columns: number;
  readonly step: number;
  readonly points: Float64Array;
}
export interface RasterRenderRequest {
  readonly read: RasterReadRequest;
  readonly width: number;
  readonly height: number;
  readonly warp: RasterWarpMesh;
  readonly style: RasterStyle;
}
export interface RasterTaskDiagnostics {
  readonly workerMs: number;
  readonly fileReadMs: number;
  readonly fileReadBytes: number;
  readonly fileReadOps: number;
  readonly pageCacheHits: number;
  readonly pageCacheMisses: number;
  readonly blockCacheHits: number;
  readonly blockCacheMisses: number;
  readonly blockCacheEvictions: number;
  readonly blockCacheEvictedBytes: number;
  readonly blockCacheAdmittedBytes: number;
  readonly blockCacheBytes: number;
  readonly blockCachePeakBytes: number;
  readonly blockCacheEntries: number;
  readonly blockCachePeakEntries: number;
  readonly blockCacheLimitBytes: number;
  readonly blockCacheOversizeSkips: number;
  readonly nativeDeflateBlocks: number;
  readonly nativeDeflateFallbacks: number;
  readonly nativeDeflateMs: number;
  readonly fastLzwBlocks: number;
  readonly fastLzwFallbacks: number;
  readonly fastLzwMs: number;
  readonly deinterleaveMs: number;
  readonly directRgb8Tiles: number;
  readonly blockLoadMs: number;
  readonly assembleMs: number;
  readonly colorizeMs: number;
}
export interface RasterRenderResult {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8ClampedArray<ArrayBuffer>;
  readonly diagnostics?: RasterTaskDiagnostics;
}
export interface RasterLevelProcessingStats {
  readonly level: number;
  readonly submitted: number;
  readonly completed: number;
  readonly cancelled: number;
  readonly workerMs: number;
  readonly fileReadMs: number;
  readonly fileReadBytes: number;
  readonly fileReadOps: number;
  readonly pageCacheHits: number;
  readonly pageCacheMisses: number;
  readonly blockCacheHits: number;
  readonly blockCacheMisses: number;
  readonly blockCacheEvictions: number;
  readonly blockCacheEvictedBytes: number;
  readonly blockCacheAdmittedBytes: number;
  readonly nativeDeflateBlocks: number;
  readonly nativeDeflateFallbacks: number;
  readonly nativeDeflateMs: number;
  readonly fastLzwBlocks: number;
  readonly fastLzwFallbacks: number;
  readonly fastLzwMs: number;
  readonly deinterleaveMs: number;
  readonly directRgb8Tiles: number;
  readonly blockLoadMs: number;
  readonly assembleMs: number;
  readonly colorizeMs: number;
}
export type RasterNativeDeflateDisabledReason =
  | 'unsupported-compression'
  | 'decompression-stream-unavailable'
  | 'response-unavailable'
  | 'unsupported-predictor'
  | 'mixed-bits'
  | 'unsupported-bits';
export interface RasterNativeDeflateStatus {
  readonly compressionCodes: readonly number[];
  readonly available: boolean;
  readonly eligible: boolean;
  readonly disabledReason: RasterNativeDeflateDisabledReason | null;
}
export interface RasterWorkerBlockStats {
  readonly worker: number;
  readonly requests: number;
  readonly uniqueBlocks: number;
  readonly loads: number;
  readonly uniqueLoadedBlocks: number;
  readonly duplicateLoads: number;
}
export interface RasterProcessingStats {
  readonly workers: number;
  readonly busyWorkers: number;
  readonly peakWorkers: number;
  readonly queuedTasks: number;
  readonly reservedBytes: number;
  /** Cumulative source jobs accepted by the GeoTIFF queue. */
  readonly acceptedTasks: number;
  /** Cumulative jobs actually dispatched to a Worker. */
  readonly dispatchedTasks: number;
  /** Scheduler scans blocked because the decoded-output memory budget would be exceeded. */
  readonly decodeBudgetBlocks: number;
  /** Largest decoded-output reservation requested by any accepted job. */
  readonly largestJobBytes: number;
  /** Configured aggregate decoded-output reservation ceiling. */
  readonly decodeBudgetBytes: number;
  readonly renderedTiles: number;
  readonly lastLevel: number | null;
  /** Cumulative render activity grouped by the actual pyramid level dispatched to workers. */
  readonly levelActivity?: readonly RasterLevelProcessingStats[];
  readonly blockCacheEvictions: number;
  readonly blockCacheEvictedBytes: number;
  readonly blockCacheAdmittedBytes: number;
  readonly blockCacheBytes: number;
  readonly blockCachePeakBytes: number;
  readonly blockCacheEntries: number;
  readonly blockCachePeakEntries: number;
  readonly blockCacheLimitBytes: number;
  readonly blockCacheOversizeSkips: number;
  /** Actual decoded TIFF tile/strip access across all source-owned Workers. */
  readonly physicalBlockRequests: number;
  readonly uniquePhysicalBlocks: number;
  readonly blockLoads: number;
  readonly uniqueLoadedBlocks: number;
  readonly duplicateBlockLoads: number;
  readonly crossWorkerDuplicateLoads: number;
  readonly blockDiagnosticsTruncated: boolean;
  readonly workerBlockStats: readonly RasterWorkerBlockStats[];
  readonly nativeDeflateBlocks: number;
  readonly nativeDeflateFallbacks: number;
  readonly nativeDeflateMs: number;
  readonly nativeDeflateStatus: RasterNativeDeflateStatus;
  readonly fastLzwBlocks: number;
  readonly fastLzwFallbacks: number;
  readonly fastLzwMs: number;
  readonly deinterleaveMs: number;
  readonly directRgb8Tiles: number;
  readonly workerMs: number;
  readonly fileReadMs: number;
  readonly fileReadBytes: number;
  readonly fileReadOps: number;
  readonly pageCacheHits: number;
  readonly pageCacheMisses: number;
  readonly blockCacheHits: number;
  readonly blockCacheMisses: number;
  readonly blockLoadMs: number;
  readonly assembleMs: number;
  readonly colorizeMs: number;
  readonly transferMs: number;
}
export interface RasterSource {
  readonly metadata: RasterMetadata;
  readWindow(request: RasterReadRequest, signal?: AbortSignal): Promise<RasterReadResult>;
  /** Optional provider capability: render off-thread instead of returning raw windows. */
  renderTile?(request: RasterRenderRequest, signal?: AbortSignal): Promise<RasterRenderResult>;
  getProcessingStats?(): RasterProcessingStats;
  /** Internal cumulative counters used to derive per-task diagnostics in a Worker. */
  getTaskDiagnosticsSnapshot?(): Omit<
    RasterTaskDiagnostics,
    'workerMs' | 'assembleMs' | 'colorizeMs' | 'directRgb8Tiles'
  >;
  toReference(): RasterReference;
  dispose(): void;
}
