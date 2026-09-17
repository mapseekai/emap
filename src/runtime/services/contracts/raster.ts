import type {
  RasterMetadata,
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
export interface RasterCacheStats {
  readonly cachedBytes: number;
  readonly cachedTiles: number;
  readonly activeReads: number;
  readonly queuedReads: number;
  readonly pendingFrames: number;
  /** Fully completed view batches, distinct from progressive tile presentation. */
  readonly committedFrames: number;
  /** Accepted tile presentations, including partial view updates. */
  readonly presentedTiles: number;
  readonly readRequests: number;
  readonly interacting: boolean;
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
}
