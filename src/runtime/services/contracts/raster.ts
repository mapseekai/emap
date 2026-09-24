import type {
  RasterLevel,
  RasterMetadata,
  RasterProcessingStats,
  RasterReference,
  RasterSource,
  RasterStyle,
  RasterWindow,
} from '../../../domain/raster/types';

export interface RasterLayerInfo {
  readonly id: string;
  readonly metadata: RasterMetadata;
  readonly style: RasterStyle;
  readonly visible: boolean;
}
export interface RasterLayerReference {
  readonly id: string;
  readonly source: RasterReference;
  readonly style: RasterStyle;
  readonly visible: boolean;
}
export interface RasterPerformanceTotals {
  readonly planningMs: number;
  readonly planningPasses: number;
  readonly plannedTiles: number;
  readonly canvasUploadMs: number;
  /** Optional for third-party services; cumulative CPU display representation work. */
  readonly canvasPreparedTiles?: number;
  readonly pixelPreparedTiles?: number;
  /** Tiles classified at production time, avoiding a repeated UI-thread alpha scan. */
  readonly pixelPreclassifiedTiles?: number;
  /** Continuous-alpha tiles retain Canvas premultiplication/rounding semantics. */
  readonly pixelAlphaFallbackTiles?: number;
  readonly pixelPrepareMs?: number;
  readonly presentationWaitMs: number;
  readonly presentationFlushes: number;
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
  readonly blockCachePeakBytes: number;
  readonly blockCachePeakEntries: number;
  readonly blockCacheLimitBytes: number;
  readonly blockCacheOversizeSkips: number;
  readonly blockLoadMs: number;
  readonly assembleMs: number;
  readonly colorizeMs: number;
  readonly transferMs: number;
}
export interface RasterPlanningDiagnostics {
  readonly viewportCss: readonly [number, number];
  readonly pixelRatio: number;
  readonly effectivePixelRatio: number;
  readonly viewportDevice: readonly [number, number];
  readonly layerCount: number;
  readonly tileBudgetPerLayer: number;
  readonly displayTileSize: number;
  readonly layers: readonly RasterLayerPlanningDiagnostics[];
}
export interface RasterSelectedLevelDiagnostics {
  readonly level: number;
  readonly tiles: number;
  readonly size: readonly [number, number];
  readonly blockSize: readonly [number, number];
  readonly reduction: number;
  readonly source: NonNullable<RasterLevel['source']> | 'unknown';
  /** Min/max base-source pixels represented by one display pixel across tiles using this level. */
  readonly sourcePixelsPerDisplayPixel: readonly [number, number];
}
export interface RasterLayerPlanningDiagnostics {
  readonly id: string;
  readonly grid: readonly [number, number];
  readonly tiles: number;
  readonly idealViewportTiles: number;
  readonly amplification: number;
  readonly pixelSize: number;
  readonly span: number;
  readonly targetResolution: number;
  readonly sourceResolution: readonly [number, number];
  /** Min/max base-source pixels represented by one display pixel across the current tile grid. */
  readonly sourcePixelsPerDisplayPixel: readonly [number, number] | null;
  /** Populated only when every current display tile chooses the same pyramid level. */
  readonly selectedLevel: number | null;
  readonly selectedLevelSize: readonly [number, number] | null;
  readonly selectedLevelReduction: number | null;
  readonly selectedLevelSource: NonNullable<RasterLevel['source']> | 'unknown' | null;
  /** Exact current tile-plan distribution, independent of worker completion order or cache reuse. */
  readonly selectedLevels: readonly RasterSelectedLevelDiagnostics[];
}
export interface RasterCacheStats {
  readonly cachedBytes: number;
  /** CPU display-cache payload by representation; excludes GPU textures and source decode caches. */
  readonly pixelCacheBytes?: number;
  readonly canvasCacheBytes?: number;
  readonly cachedTiles: number;
  readonly activeReads: number;
  readonly queuedReads: number;
  readonly pendingFrames: number;
  /** Fully completed view batches, distinct from progressive tile presentation. */
  readonly committedFrames: number;
  /** Accepted tile presentations, including partial view updates. */
  readonly presentedTiles: number;
  readonly readRequests: number;
  readonly taskLifecycle: {
    readonly queued: number;
    readonly loadTileStarted: number;
    readonly planSucceeded: number;
    readonly planEmpty: number;
    readonly loadTileFailed: number;
  };
  readonly pumpBlocked: { readonly gestures: number; readonly settleTimer: number };
  readonly taskErrors: readonly {
    readonly stage: 'planRasterTile' | 'loadTile';
    readonly name: string;
    readonly code: string | null;
    readonly message: string;
    readonly selectedLevel: number;
    readonly blockSize: readonly [number, number] | null;
  }[];
  readonly interacting: boolean;
  /** Cumulative counters; snapshot twice to diagnose one navigation operation. */
  readonly performance: RasterPerformanceTotals;
  /** Latest planned view geometry; diagnostic only, not cumulative. */
  readonly planning: RasterPlanningDiagnostics | null;
  /** Cumulative display-tile plans grouped by the pyramid level selected for the current tile. */
  readonly plannedLevels: readonly { readonly level: number; readonly count: number }[];
}
/** Raster sources are independent of editable vector/topology sources. */
export interface RasterContract {
  /** Takes ownership of the source until removal or plugin unload. */
  addSource(id: string, source: RasterSource, style?: RasterStyle): void;
  remove(id: string): void;
  getLayers(): readonly RasterLayerInfo[];
  setStyle(id: string, style: RasterStyle): void;
  setVisibility(id: string, visible: boolean): void;
  /** Raster stack is bottom-first. Omit beforeId to move to the top. */
  moveLayer(id: string, beforeId?: string): void;
  getBounds(id: string): Promise<RasterWindow>;
  queryPixel(
    id: string,
    x: number,
    y: number,
    signal?: AbortSignal,
  ): Promise<readonly number[] | null>;
  toReferences(): readonly RasterLayerReference[];
  getStats(): RasterCacheStats;
  /** Provider-specific background processing counters, or null for legacy sources. */
  getProcessingStats(id: string): RasterProcessingStats | null;
}
