import { readNumericWindow } from './read-window';
import { CachedGeoTIFFImage, RasterBlockCache } from './block-cache';
import { collectRasterStatistics } from '../../domain/raster/statistics';
import { GeoTIFF, GeoTIFFImage } from 'geotiff';
import { AffineTransform } from '../../domain/geo/transform';
import {
  RasterError,
  assertRasterPyramid,
  isRasterOverview,
  validateRasterRead,
} from '../../domain/raster/policy';
import type {
  RasterLevel,
  RasterBandStatistics,
  RasterMetadata,
  RasterReadRequest,
  RasterReadResult,
  RasterReference,
  RasterSource,
} from '../../domain/raster/types';
import { LocalRasterFileSource, validateTiffDirectory } from './file-source';

export interface GeoTIFFOpenOptions {
  readonly overviewFile?: File;
  /** Required override when the source does not carry a supported EPSG GeoKey. */
  readonly crs?: string;
  readonly signal?: AbortSignal;
}

export interface GeoTIFFReaderRuntime {
  readonly cacheBytes?: number;
  readonly pageLimit?: number;
  readonly maxMetadataBytes?: number;
  readonly statistics?: readonly RasterBandStatistics[];
}

function descriptor(image: GeoTIFFImage, id: number): RasterLevel {
  const fd = image.getFileDirectory(),
    samples = image.getSamplesPerPixel();
  const bits = Array.from({ length: samples }, (_, i) => image.getBitsPerSample(i));
  const formats = Array.from({ length: samples }, (_, i) => image.getSampleFormat(i));
  const result: RasterLevel = {
    id,
    width: image.getWidth(),
    height: image.getHeight(),
    tileWidth: image.getTileWidth(),
    tileHeight: image.getTileHeight(),
    samples,
    bits,
    formats,
    photometric: fd.getValue('PhotometricInterpretation') ?? 1,
    subfileType: fd.getValue('NewSubfileType') ?? 0,
  };
  if (
    ![result.width, result.height, result.tileWidth, result.tileHeight, samples].every(
      (n) => Number.isSafeInteger(n) && n > 0,
    ) ||
    samples > 32
  )
    throw new RasterError(
      'INVALID_RASTER',
      'Invalid raster dimensions or unsupported sample count.',
    );
  if (
    bits.some((n, i) =>
      formats[i] === 3 ? ![16, 32, 64].includes(n) : ![8, 16, 32].includes(n),
    ) ||
    formats.some((n) => ![1, 2, 3].includes(n))
  )
    throw new RasterError(
      'UNSUPPORTED_SAMPLES',
      'Supported samples: 8/16/32-bit integers and 16/32/64-bit floats.',
    );
  return result;
}

function georeference(image: GeoTIFFImage): {
  origin: [number, number];
  resolution: [number, number];
} {
  const fd = image.getFileDirectory();
  const matrix = fd.getValue('ModelTransformation');
  if (
    matrix &&
    (matrix[1] !== 0 ||
      matrix[4] !== 0 ||
      matrix[2] !== 0 ||
      matrix[6] !== 0 ||
      matrix[12] !== 0 ||
      matrix[13] !== 0)
  )
    throw new RasterError(
      'UNSUPPORTED_TRANSFORM',
      'Rotated/sheared GeoTIFFs must be rectified to a north-up grid before loading.',
    );
  let origin: number[], resolution: number[];
  try {
    origin = image.getOrigin();
    resolution = image.getResolution();
  } catch {
    throw new RasterError(
      'GEOREFERENCE_REQUIRED',
      'GeoTIFF needs a pixel transform and map coordinates.',
    );
  }
  if (
    ![origin[0], origin[1], resolution[0], resolution[1]].every(Number.isFinite) ||
    resolution[0] <= 0 ||
    resolution[1] >= 0
  )
    throw new RasterError(
      'UNSUPPORTED_TRANSFORM',
      'Only finite north-up raster transforms are supported.',
    );
  // ModelTiepoint may refer to a nonzero raster coordinate.
  const tie = fd.getValue('ModelTiepoint');
  if (!matrix && tie) {
    origin[0] -= tie[0] * resolution[0];
    origin[1] -= tie[1] * resolution[1];
  }
  if (image.getGeoKeys()?.GTRasterTypeGeoKey === 2) {
    origin[0] -= resolution[0] / 2;
    origin[1] -= resolution[1] / 2;
  }
  return { origin: [origin[0], origin[1]], resolution: [resolution[0], resolution[1]] };
}

/** Internal decoder. Browser callers use the Worker-backed openGeoTIFF entry point. */
export class GeoTIFFReader implements RasterSource {
  private disposed = false;
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;
  private readonly lifetime = new AbortController();
  private constructor(
    private _metadata: RasterMetadata,
    private readonly images: Map<number, GeoTIFFImage>,
    private readonly sources: LocalRasterFileSource[],
    private readonly blockCache: RasterBlockCache,
    readonly directoryBytes: number,
  ) {}

  get metadata(): RasterMetadata {
    return this._metadata;
  }

  static async open(
    file: File,
    options: GeoTIFFOpenOptions = {},
    runtime: GeoTIFFReaderRuntime = {},
  ): Promise<GeoTIFFReader> {
    options.signal?.throwIfAborted();
    if (!Number.isSafeInteger(file.size) || file.size < 8)
      throw new RasterError('INVALID_RASTER', 'Invalid TIFF file size.');
    if (
      options.overviewFile &&
      options.overviewFile.name.toLowerCase() !== `${file.name}.ovr`.toLowerCase()
    )
      throw new RasterError(
        'OVERVIEW_MISMATCH',
        'External overview filename must match the original filename + .ovr.',
      );
    const sources: LocalRasterFileSource[] = [],
      images = new Map<number, GeoTIFFImage>(),
      levels: RasterLevel[] = [];
    let base: GeoTIFFImage | undefined, baseTiff: GeoTIFF | undefined;
    let hasValidityMask = false;
    let metadataBytes = 0;
    const blockCache = new RasterBlockCache(runtime.cacheBytes);
    let imageId = 0;
    try {
      for (const input of [file, ...(options.overviewFile ? [options.overviewFile] : [])]) {
        const firstLevel = levels.length;
        const source = new LocalRasterFileSource(input, runtime.pageLimit);
        sources.push(source);
        const tiff = await GeoTIFF.fromSource(source, { cache: false }, options.signal);
        baseTiff ??= tiff;
        const queue = [tiff.firstIFDOffset],
          visited = new Set<number>();
        while (queue.length) {
          options.signal?.throwIfAborted();
          const offset = queue.shift()!;
          if (visited.has(offset))
            throw new RasterError(
              'INVALID_TIFF_DIRECTORY',
              'Cyclic or repeated TIFF directory offsets.',
            );
          if (visited.size >= 64 || levels.length >= 64)
            throw new RasterError('TIFF_DIRECTORY_BUDGET', 'Too many TIFF image directories.');
          visited.add(offset);
          metadataBytes += await validateTiffDirectory(
            source,
            offset,
            tiff.littleEndian,
            tiff.bigTiff,
            options.signal,
          );
          if (metadataBytes > (runtime.maxMetadataBytes ?? 32 * 1024 ** 2))
            throw new RasterError(
              'TIFF_DIRECTORY_BUDGET',
              'Combined TIFF directory arrays exceed 32MiB.',
            );
          const fd = await tiff.parser.parseFileDirectoryAt(offset);
          const image = new CachedGeoTIFFImage(
            fd,
            tiff.littleEndian,
            source,
            blockCache,
            imageId++,
          );
          base ??= image;
          const subfileType = fd.getValue('NewSubfileType') ?? 0;
          if (subfileType & 4) hasValidityMask = true;
          const level =
            image !== base && subfileType & 6 ? undefined : descriptor(image, levels.length);
          if (level && (image === base || isRasterOverview(levels[0], level))) {
            // A MINISBLACK/RGB tag difference is safe only for raw color bands,
            // never when an extra sample acquires or loses alpha semantics.
            if (
              image !== base &&
              level.photometric !== levels[0].photometric &&
              [base, image].some((item) =>
                Array.from(item.getFileDirectory().getValue('ExtraSamples') ?? []).some(
                  (type) => type !== 0,
                ),
              )
            )
              throw new RasterError(
                'OVERVIEW_MISMATCH',
                'Overview color tags cannot reinterpret alpha samples.',
              );
            // Explicit overview georeferencing, when present, must cover the same image.
            if (
              image !== base &&
              (fd.hasTag('ModelTiepoint') || fd.hasTag('ModelTransformation'))
            ) {
              const a = georeference(base),
                b = georeference(image);
              const keys = image.getGeoKeys(),
                baseKeys = base.getGeoKeys();
              for (const key of ['ProjectedCSTypeGeoKey', 'GeographicTypeGeoKey'] as const) {
                if (keys?.[key] && baseKeys?.[key] && keys[key] !== baseKeys[key])
                  throw new RasterError(
                    'OVERVIEW_MISMATCH',
                    'Overview CRS differs from the original raster.',
                  );
              }
              for (const axis of [0, 1] as const) {
                const baseSize = axis === 0 ? base.getWidth() : base.getHeight();
                const size = axis === 0 ? level.width : level.height;
                const tolerance = Math.abs(b.resolution[axis]) * 1.01;
                if (
                  Math.abs(a.origin[axis] - b.origin[axis]) > tolerance ||
                  Math.abs(a.resolution[axis] * baseSize - b.resolution[axis] * size) > tolerance
                )
                  throw new RasterError(
                    'OVERVIEW_MISMATCH',
                    'Overview extent differs from the original raster.',
                  );
              }
            }
            images.set(level.id, image);
            levels.push(level);
          }
          if (fd.nextIFDByteOffset) queue.push(fd.nextIFDByteOffset);
          if (fd.hasTag('SubIFDs')) {
            const sub = await fd.loadValue('SubIFDs');
            for (const value of Array.from(sub ?? [])) {
              const child = Number(value);
              if (!Number.isSafeInteger(child) || child < 1 || child >= input.size)
                throw new RasterError('INVALID_TIFF_OFFSET', 'Unsafe SubIFD offset.');
              queue.push(child);
            }
          }
        }
        if (input !== file && levels.length === firstLevel)
          throw new RasterError(
            'OVERVIEW_MISMATCH',
            '所选 .ovr 没有与原图兼容的金字塔。请检查尺寸、波段数、位深和颜色解释；不会静默忽略该文件后退回原图读取。',
          );
      }
      // This mandatory rule runs before readRasters/readRGB or preview generation.
      assertRasterPyramid(file.size, levels);
      if (hasValidityMask)
        throw new RasterError(
          'UNSUPPORTED_MASK',
          '此版本不支持独立 TIFF 有效性掩膜。请转换为带 NoData 或非预乘 Alpha 的栅格后加载；掩膜不会被误当作金字塔。',
        );
      if (!base || !baseTiff) throw new RasterError('INVALID_RASTER', 'Missing base TIFF image.');
      const fd = base.getFileDirectory(),
        keys = base.getGeoKeys();
      const modelType = keys?.GTModelTypeGeoKey;
      const epsg =
        modelType === 1
          ? keys?.ProjectedCSTypeGeoKey
          : modelType === 2
            ? keys?.GeographicTypeGeoKey
            : (keys?.ProjectedCSTypeGeoKey ?? keys?.GeographicTypeGeoKey);
      const crs =
        options.crs?.trim() ||
        (Number.isInteger(epsg) && epsg > 0 && epsg < 32767 ? `EPSG:${epsg}` : '');
      if (!crs)
        throw new RasterError(
          'RASTER_CRS_REQUIRED',
          '无法识别栅格坐标系；请显式指定 crs，不能默认当作 WGS84。',
        );
      if (![0, 1, 2, 3].includes(levels[0].photometric))
        throw new RasterError(
          'UNSUPPORTED_COLORSPACE',
          'Only grayscale, RGB and palette TIFFs are currently supported.',
        );
      if (((await fd.loadValue('Orientation')) ?? 1) !== 1)
        throw new RasterError('UNSUPPORTED_ORIENTATION', 'TIFF orientation must be top-left.');
      const { origin, resolution } = georeference(base);
      const transform = new AffineTransform(resolution[0], resolution[1], origin[0], origin[1]);
      const [right, bottom] = transform.project(base.getWidth(), base.getHeight());
      if (![right, bottom].every(Number.isFinite))
        throw new RasterError(
          'INVALID_RASTER_BOUNDS',
          'Raster map bounds exceed finite coordinate limits.',
        );
      const extra = Array.from(fd.getValue('ExtraSamples') ?? []);
      if (extra.includes(1))
        throw new RasterError(
          'UNSUPPORTED_ALPHA',
          'Associated-alpha TIFFs must be converted to unassociated alpha.',
        );
      const alpha = extra.indexOf(2),
        alphaBand = alpha < 0 ? null : levels[0].samples - extra.length + alpha;
      const palette =
        levels[0].photometric === 3
          ? Array.from((await fd.loadValue('ColorMap')) ?? [])
          : undefined;
      if (palette && palette.length !== 3 * 2 ** levels[0].bits[0])
        throw new RasterError('INVALID_PALETTE', 'TIFF color map has an invalid length.');
      const metadata: RasterMetadata = {
        filename: file.name,
        fileSize: file.size,
        lastModified: file.lastModified,
        crs,
        origin,
        resolution,
        bounds: [origin[0], bottom, right, origin[1]],
        levels,
        noData: base.getGDALNoData(),
        alphaBand,
        palette,
        bigTiff: baseTiff.bigTiff,
        ...(options.overviewFile
          ? {
              overviewFile: {
                filename: options.overviewFile.name,
                fileSize: options.overviewFile.size,
                lastModified: options.overviewFile.lastModified,
              },
            }
          : {}),
      };
      options.signal?.throwIfAborted();
      const reader = new GeoTIFFReader(metadata, images, sources, blockCache, metadataBytes);
      // Mandatory pyramid checks above precede even the first statistics read.
      try {
        if (!metadata.palette)
          reader._metadata = {
            ...metadata,
            statistics:
              runtime.statistics?.length === metadata.levels[0].samples
                ? runtime.statistics
                : await collectRasterStatistics(reader, options.signal),
          };
        return reader;
      } catch (error) {
        reader.dispose();
        throw error;
      }
    } catch (error) {
      blockCache.dispose();
      for (const source of sources) void source.close();
      throw error;
    }
  }

  getTaskDiagnosticsSnapshot() {
    const io = this.sources.reduce(
      (sum, source) => {
        const value = source.getDiagnostics();
        sum.fileReadMs += value.readMs;
        sum.fileReadBytes += value.readBytes;
        sum.fileReadOps += value.readOps;
        sum.pageCacheHits += value.pageHits;
        sum.pageCacheMisses += value.pageMisses;
        return sum;
      },
      { fileReadMs: 0, fileReadBytes: 0, fileReadOps: 0, pageCacheHits: 0, pageCacheMisses: 0 },
    );
    const blocks = this.blockCache.getDiagnostics();
    return {
      ...io,
      blockCacheHits: blocks.hits,
      blockCacheMisses: blocks.misses,
      blockCacheEvictions: blocks.evictions,
      blockCacheEvictedBytes: blocks.evictedBytes,
      blockCacheAdmittedBytes: blocks.admittedBytes,
      blockCacheBytes: blocks.bytes,
      blockCachePeakBytes: blocks.peakBytes,
      blockCacheEntries: blocks.entries,
      blockCachePeakEntries: blocks.peakEntries,
      blockCacheLimitBytes: blocks.limitBytes,
      blockCacheOversizeSkips: blocks.oversizeSkips,
      blockLoadMs: blocks.loadMs,
      transferMs: 0,
    };
  }

  async readWindow(request: RasterReadRequest, signal?: AbortSignal): Promise<RasterReadResult> {
    signal?.throwIfAborted();
    this.lifetime.signal.throwIfAborted();
    validateRasterRead(this.metadata.levels, request);
    if (this.pending >= 16)
      throw new RasterError('RASTER_QUEUE_BUDGET', 'Too many queued raster reads.');
    this.pending++;
    const run = this.tail.then(async () => {
      signal?.throwIfAborted();
      this.lifetime.signal.throwIfAborted();
      const controller = new AbortController();
      const abort = () => controller.abort(signal?.reason ?? this.lifetime.signal.reason);
      signal?.addEventListener('abort', abort, { once: true });
      this.lifetime.signal.addEventListener('abort', abort, { once: true });
      try {
        for (const source of this.sources) source.beginRead();
        const image = this.images.get(request.level)!;
        const result = await readNumericWindow(image, request, controller.signal);
        controller.signal.throwIfAborted();
        return result;
      } finally {
        signal?.removeEventListener('abort', abort);
        this.lifetime.signal.removeEventListener('abort', abort);
      }
    });
    // The serialization sentinel must never resolve to a decoded pixel buffer.
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    try {
      return await run;
    } finally {
      this.pending--;
    }
  }

  toReference(): RasterReference {
    const { filename, fileSize, lastModified, crs, overviewFile } = this.metadata;
    return {
      kind: 'raster',
      storage: 'external-file',
      format: 'geotiff',
      filename,
      fileSize,
      lastModified,
      crs,
      ...(overviewFile ? { overviewFile } : {}),
    };
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.lifetime.abort(new DOMException('Raster source disposed', 'AbortError'));
    for (const source of this.sources) void source.close();
    this.sources.length = 0;
    this.images.clear();
    this.blockCache.dispose();
    this.tail = Promise.resolve();
  }
}
