import {
  colorizeRasterTile,
  rasterBands,
  validateRasterStyle,
} from '../../engine/rendering/raster/tile';
import { rasterWarpLocator, validateRasterRender } from '../../engine/rendering/raster/warp';
import { RasterError } from '../../domain/raster/policy';
import { resolveRasterRanges, stretchRasterValue } from '../../domain/raster/statistics';
import type {
  RasterReadRequest,
  RasterReadResult,
  RasterRenderRequest,
  RasterRenderResult,
  RasterTaskDiagnostics,
} from '../../domain/raster/types';
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

function unionReadRequest(requests: readonly RasterRenderRequest[]): RasterReadRequest {
  const first = requests[0].read;
  if (
    requests.some(
      (request) =>
        request.read.level !== first.level ||
        request.read.samples.length !== first.samples.length ||
        request.read.samples.some((sample, index) => sample !== first.samples[index]),
    )
  )
    throw new RasterError('INVALID_RASTER_BATCH', 'Batched raster tiles must use one level and sample set.');
  return {
    level: first.level,
    samples: [...first.samples],
    window: [
      Math.min(...requests.map((request) => request.read.window[0])),
      Math.min(...requests.map((request) => request.read.window[1])),
      Math.max(...requests.map((request) => request.read.window[2])),
      Math.max(...requests.map((request) => request.read.window[3])),
    ],
  };
}

function mergeOpaque(target: Uint8ClampedArray<ArrayBuffer>, source: Uint8ClampedArray<ArrayBuffer>) {
  for (let offset = 0; offset < source.length; offset += 4)
    if (source[offset + 3]) {
      target[offset] = source[offset];
      target[offset + 1] = source[offset + 1];
      target[offset + 2] = source[offset + 2];
      target[offset + 3] = source[offset + 3];
    }
}

function diagnostics(
  source: GeoTIFFReader,
  before: ReturnType<GeoTIFFReader['getTaskDiagnosticsSnapshot']>,
  workerStarted: number,
  readMs: number,
  colorizeMs: number,
  directRgb8Tiles: number,
): RasterTaskDiagnostics {
  const after = source.getTaskDiagnosticsSnapshot();
  const delta = (key: keyof typeof before) => after[key] - before[key];
  const blockLoadMs = delta('blockLoadMs');
  return {
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
    blockCacheBytes: after.blockCacheBytes,
    blockCachePeakBytes: after.blockCachePeakBytes,
    blockCacheEntries: after.blockCacheEntries,
    blockCachePeakEntries: after.blockCachePeakEntries,
    blockCacheLimitBytes: after.blockCacheLimitBytes,
    blockCacheOversizeSkips: delta('blockCacheOversizeSkips'),
    nativeDeflateBlocks: delta('nativeDeflateBlocks'),
    nativeDeflateFallbacks: delta('nativeDeflateFallbacks'),
    nativeDeflateMs: delta('nativeDeflateMs'),
    fastLzwBlocks: delta('fastLzwBlocks'),
    fastLzwFallbacks: delta('fastLzwFallbacks'),
    fastLzwMs: delta('fastLzwMs'),
    deinterleaveMs: delta('deinterleaveMs'),
    directRgb8Tiles,
    blockLoadMs,
    assembleMs: Math.max(0, readMs - blockLoadMs),
    colorizeMs,
  };
}

/** Storage-aware row batching: one union source read is shared by sibling display tiles. */
export async function renderRasterBatch(
  source: GeoTIFFReader,
  requests: readonly RasterRenderRequest[],
  signal?: AbortSignal,
): Promise<readonly RasterRenderResult[]> {
  signal?.throwIfAborted();
  if (!requests.length || requests.length > 16)
    throw new RasterError('INVALID_RASTER_BATCH', 'Raster render batches must contain 1–16 tiles.');
  const workerStarted = performance.now();
  const before = source.getTaskDiagnosticsSnapshot();
  for (const request of requests) {
    validateRasterRender(source.metadata, request);
    validateRasterStyle(source.metadata, request.style);
  }
  const combined = unionReadRequest(requests);
  const bandsByRequest = requests.map((request) => {
    const bands = rasterBands(source.metadata, request.style);
    const needed = [
      ...bands,
      ...(source.metadata.alphaBand === null ? [] : [source.metadata.alphaBand]),
    ];
    if (needed.some((band) => !request.read.samples.includes(band)))
      throw new RasterError('INVALID_BANDS', 'Display request omits a selected color or alpha band.');
    return bands;
  });
  const level = source.metadata.levels.find((value) => value.id === combined.level)!;
  const directRgb8 = requests.every((request, index) =>
    canRenderDirectRgb8(source, request, bandsByRequest[index]),
  );
  const outputs = requests.map(
    (request) => new Uint8ClampedArray(request.width * request.height * 4),
  );
  let readMs = 0,
    colorizeMs = 0;
  const chunks = source.splitRowStripedReadRequests(
    combined,
    requests.some((request) => request.style.resampling === 'bilinear') ? 1 : 0,
  );
  for (const chunk of chunks) {
    signal?.throwIfAborted();
    const readStarted = performance.now();
    const data = directRgb8
      ? await source.readInterleavedRgb8Window(chunk, signal)
      : await source.readWindow(chunk, signal);
    readMs += performance.now() - readStarted;
    const colorStarted = performance.now();
    for (let index = 0; index < requests.length; index++) {
      const request = { ...requests[index], read: chunk };
      const partial = directRgb8
        ? colorizeInterleavedRgb8(source, request, bandsByRequest[index], data as InterleavedRgb8Window)
        : colorizeRasterTile(
            source.metadata,
            {
              request: chunk,
              warp: request.warp,
              level,
              bands: bandsByRequest[index],
              width: request.width,
              height: request.height,
              locate: rasterWarpLocator(request.warp, request.width),
            },
            data as RasterReadResult,
            request.style,
          );
      mergeOpaque(outputs[index], partial);
    }
    colorizeMs += performance.now() - colorStarted;
  }
  signal?.throwIfAborted();
  const taskDiagnostics = diagnostics(
    source,
    before,
    workerStarted,
    readMs,
    colorizeMs,
    directRgb8 ? requests.length : 0,
  );
  return requests.map((request, index) => ({
    width: request.width,
    height: request.height,
    rgba: outputs[index],
    ...(index === 0 ? { diagnostics: taskDiagnostics } : {}),
  }));
}

/** Runs in the GeoTIFF Worker. Raw samples never cross the UI boundary for display. */
export async function renderRasterWindow(
  source: GeoTIFFReader,
  request: RasterRenderRequest,
  signal?: AbortSignal,
): Promise<RasterRenderResult> {
  return (await renderRasterBatch(source, [request], signal))[0];
}
