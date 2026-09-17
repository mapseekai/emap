import {
  colorizeRasterTile,
  rasterBands,
  validateRasterStyle,
} from '../../engine/rendering/raster/tile';
import { rasterWarpLocator, validateRasterRender } from '../../engine/rendering/raster/warp';
import { RasterError } from '../../domain/raster/policy';
import type {
  RasterRenderRequest,
  RasterRenderResult,
  RasterSource,
} from '../../domain/raster/types';

/** Runs in the GeoTIFF Worker. Raw samples never cross the UI boundary for display. */
export async function renderRasterWindow(
  source: RasterSource,
  request: RasterRenderRequest,
  signal?: AbortSignal,
): Promise<RasterRenderResult> {
  signal?.throwIfAborted();
  const workerStarted = performance.now();
  const before = source.getTaskDiagnosticsSnapshot?.();
  validateRasterRender(source.metadata, request);
  validateRasterStyle(source.metadata, request.style);
  const bands = rasterBands(source.metadata, request.style);
  const needed = [
    ...bands,
    ...(source.metadata.alphaBand === null ? [] : [source.metadata.alphaBand]),
  ];
  if (needed.some((band) => !request.read.samples.includes(band)))
    throw new RasterError('INVALID_BANDS', 'Display request omits a selected color or alpha band.');
  const level = source.metadata.levels.find((value) => value.id === request.read.level)!;
  const readStarted = performance.now();
  const data = await source.readWindow(request.read, signal);
  const readMs = performance.now() - readStarted;
  signal?.throwIfAborted();
  const colorStarted = performance.now();
  const rgba = colorizeRasterTile(
    source.metadata,
    {
      request: request.read,
      warp: request.warp,
      level,
      bands,
      width: request.width,
      height: request.height,
      locate: rasterWarpLocator(request.warp, request.width),
    },
    data,
    request.style,
  );
  const colorizeMs = performance.now() - colorStarted;
  signal?.throwIfAborted();
  const after = source.getTaskDiagnosticsSnapshot?.();
  const delta = (key: keyof NonNullable<typeof before>) =>
    before && after ? after[key] - before[key] : 0;
  const blockLoadMs = delta('blockLoadMs');
  return {
    width: request.width,
    height: request.height,
    rgba,
    diagnostics: {
      workerMs: performance.now() - workerStarted,
      fileReadMs: delta('fileReadMs'),
      fileReadBytes: delta('fileReadBytes'),
      fileReadOps: delta('fileReadOps'),
      pageCacheHits: delta('pageCacheHits'),
      pageCacheMisses: delta('pageCacheMisses'),
      blockCacheHits: delta('blockCacheHits'),
      blockCacheMisses: delta('blockCacheMisses'),
      blockCacheEvictions: delta('blockCacheEvictions'),
      blockCacheEvictedBytes: delta('blockCacheEvictedBytes'),
      blockCacheAdmittedBytes: delta('blockCacheAdmittedBytes'),
      blockCacheBytes: after?.blockCacheBytes ?? 0,
      blockCachePeakBytes: after?.blockCachePeakBytes ?? 0,
      blockCacheEntries: after?.blockCacheEntries ?? 0,
      blockCachePeakEntries: after?.blockCachePeakEntries ?? 0,
      blockCacheLimitBytes: after?.blockCacheLimitBytes ?? 0,
      blockCacheOversizeSkips: delta('blockCacheOversizeSkips'),
      blockLoadMs,
      assembleMs: Math.max(0, readMs - blockLoadMs),
      colorizeMs,
    },
  };
}
