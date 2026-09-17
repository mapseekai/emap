import {
  colorizeRasterTile,
  rasterBands,
  validateRasterStyle,
} from '../../engine/rendering/raster/tile';
import { rasterWarpLocator, validateRasterRender } from '../../engine/rendering/raster/warp';
import { RasterError } from '../../domain/raster/policy';
import { resolveRasterRanges, stretchRasterValue } from '../../domain/raster/statistics';
import type { RasterRenderRequest, RasterRenderResult } from '../../domain/raster/types';
import type { GeoTIFFReader } from './reader';
import type { InterleavedRgb8Window } from './read-window';

function canRenderDirectRgb8(
  source: GeoTIFFReader,
  request: RasterRenderRequest,
  bands: readonly number[],
): boolean {
  const metadata = source.metadata,
    level = metadata.levels.find((value) => value.id === request.read.level);
  return Boolean(
    level &&
      request.style.resampling !== 'bilinear' &&
      metadata.alphaBand === null &&
      !metadata.palette &&
      level.photometric === 2 &&
      level.samples === 3 &&
      bands.length === 3 &&
      bands.every((band) => band >= 0 && band < 3) &&
      level.bits.every((bits) => bits === 8) &&
      level.formats.every((format) => format === 1) &&
      source.supportsInterleavedRgb8(level.id),
  );
}

function colorizeInterleavedRgb8(
  source: GeoTIFFReader,
  request: RasterRenderRequest,
  bands: readonly number[],
  data: InterleavedRgb8Window,
): Uint8ClampedArray<ArrayBuffer> {
  const metadata = source.metadata,
    level = metadata.levels.find((value) => value.id === request.read.level)!,
    ranges = resolveRasterRanges(metadata, request.style, bands),
    identity = ranges.every(([min, max]) => min === 0 && max === 255),
    locate = rasterWarpLocator(request.warp, request.width),
    position: [number, number] = [0, 0],
    window = request.read.window,
    noData = metadata.noData,
    out = new Uint8ClampedArray(request.width * request.height * 4),
    redBand = bands[0],
    greenBand = bands[1],
    blueBand = bands[2],
    rRange = ranges[0],
    gRange = ranges[1],
    bRange = ranges[2];
  for (let y = 0; y < request.height; y++)
    for (let x = 0; x < request.width; x++) {
      const p = locate(x + 0.5, y + 0.5, position);
      if (!p || p[0] < 0 || p[1] < 0 || p[0] >= level.width || p[1] >= level.height) continue;
      const sx = Math.floor(p[0]),
        sy = Math.floor(p[1]);
      if (sx < window[0] || sy < window[1] || sx >= window[2] || sy >= window[3]) continue;
      const sourceOffset = ((sy - window[1]) * data.width + sx - window[0]) * 3,
        rv = data.data[sourceOffset + redBand],
        gv = data.data[sourceOffset + greenBand],
        bv = data.data[sourceOffset + blueBand];
      if (noData !== null && (rv === noData || gv === noData || bv === noData)) continue;
      const target = (y * request.width + x) * 4;
      if (identity) {
        out[target] = rv;
        out[target + 1] = gv;
        out[target + 2] = bv;
      } else {
        out[target] = stretchRasterValue(rv, rRange);
        out[target + 1] = stretchRasterValue(gv, gRange);
        out[target + 2] = stretchRasterValue(bv, bRange);
      }
      out[target + 3] = 255;
    }
  return out;
}

/** Runs in the GeoTIFF Worker. Raw samples never cross the UI boundary for display. */
export async function renderRasterWindow(
  source: GeoTIFFReader,
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
  const directRgb8 = canRenderDirectRgb8(source, request, bands);
  const readStarted = performance.now();
  const data = directRgb8
    ? await source.readInterleavedRgb8Window(request.read, signal)
    : await source.readWindow(request.read, signal);
  const readMs = performance.now() - readStarted;
  signal?.throwIfAborted();
  const colorStarted = performance.now();
  const rgba = directRgb8
    ? colorizeInterleavedRgb8(source, request, bands, data as InterleavedRgb8Window)
    : colorizeRasterTile(
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
        data as Awaited<ReturnType<GeoTIFFReader['readWindow']>>,
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
      nativeDeflateBlocks: delta('nativeDeflateBlocks'),
      nativeDeflateFallbacks: delta('nativeDeflateFallbacks'),
      nativeDeflateMs: delta('nativeDeflateMs'),
      fastLzwBlocks: delta('fastLzwBlocks'),
      fastLzwFallbacks: delta('fastLzwFallbacks'),
      fastLzwMs: delta('fastLzwMs'),
      deinterleaveMs: delta('deinterleaveMs'),
      directRgb8Tiles: directRgb8 ? 1 : 0,
      blockLoadMs,
      assembleMs: Math.max(0, readMs - blockLoadMs),
      colorizeMs,
    },
  };
}
