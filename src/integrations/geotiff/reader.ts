import { validateRasterTextureRead } from '../../domain/raster/texture';
import {
  getReadWindowDiagnostics,
  readInterleavedRgb8Window,
  readNumericWindow,
  readTextureWindow,
  supportsBoundedNumericWindow,
  type InterleavedRgb8Window,
} from './read-window';
import { CachedGeoTIFFImage, RasterBlockCache } from './block-cache';
import { getFastLzwDiagnostics } from './fast-lzw';
import { getNativeDeflateDiagnostics } from './native-deflate';
import { collectRasterStatistics } from '../../domain/raster/statistics';
import { GeoTIFF, GeoTIFFImage } from 'geotiff';
import { AffineTransform } from '../../domain/geo/transform';
import {
  RasterError,
  assertRasterPyramid,
  isRasterOverview,
  RASTER_MAX_WINDOW_PIXELS,
  validateRasterRead,
} from '../../domain/raster/policy';
import type {
  RasterLevel,
  RasterBandStatistics,
  RasterMetadata,
  RasterReadRequest,
  RasterReadResult,
  RasterTextureResult,
  RasterReference,
  RasterSource,
} from '../../domain/raster/types';
import { LocalRasterFileSource, validateTiffDirectory } from './file-source';

export interface GeoTIFFOpenOptions {
  readonly overviewFile?: File;
  /** Required override when the source does not carry a supported EPSG GeoKey. */
  readonly crs?: string;
  /** undefined: use TIFF GDAL_NODATA; number: override it; null: disable NoData. */
  readonly noData?: number | null;
  readonly signal?: AbortSignal;
}

const MIB = 1024 ** 2;
const DEFAULT_READ_BUDGET_BYTES = 64 * MIB;
const ROW_STRIPED_READ_BUDGET_MIN_BYTES = 128 * MIB;
const ROW_STRIPED_READ_BUDGET_MAX_BYTES = 256 * MIB;
const ROW_STRIPED_READ_HEADROOM = 1.5;
const ROW_STRIPED_CHUNK_PHYSICAL_BYTES = 96 * MIB;
const ROW_STRIPED_CHUNK_DECODED_BYTES = 64 * MIB;

function decodedBlockBytes(level: RasterLevel): number {
  const bytesPerPixel = level.bits.reduce((sum, bits, band) => {
    const bytes = level.formats[band] === 3 && bits === 16 ? 4 : Math.max(1, Math.ceil(bits / 8));
    return sum + bytes;
  }, 0);
  return level.tileWidth * level.tileHeight * bytesPerPixel;
}

export function readBudgetForRequest(level: RasterLevel, request: RasterReadRequest): number {
  const rowStriped = level.tileWidth >= level.width && level.tileHeight < level.height;
  if (!rowStriped || (level.decodedBlockConcurrency ?? 0) <= 0) return DEFAULT_READ_BUDGET_BYTES;
  const blockRows =
    Math.ceil(request.window[3] / level.tileHeight) -
    Math.floor(request.window[1] / level.tileHeight);
  const estimatedPhysicalBytes = blockRows * decodedBlockBytes(level) * ROW_STRIPED_READ_HEADROOM;
  const workingSetBudget = Math.ceil(estimatedPhysicalBytes / MIB) * MIB;
  return Math.min(
    ROW_STRIPED_READ_BUDGET_MAX_BYTES,
    Math.max(ROW_STRIPED_READ_BUDGET_MIN_BYTES, workingSetBudget),
  );
}

export interface GeoTIFFReaderRuntime {
  readonly cacheBytes?: number;
  readonly pageLimit?: number;
  readonly maxMetadataBytes?: number;
  readonly statistics?: readonly RasterBandStatistics[];
}

function descriptor(
  image: GeoTIFFImage,
  id: number,
  source: NonNullable<RasterLevel['source']>,
): RasterLevel {
  const fd = image.getFileDirectory(),
    samples = image.getSamplesPerPixel();
  const bits = Array.from({ length: samples }, (_, i) => image.getBitsPerSample(i));
  const formats = Array.from({ length: samples }, (_, i) => image.getSampleFormat(i));
  const result: RasterLevel = {
    id,
    source,
    width: image.getWidth(),
    height: image.getHeight(),
    tileWidth: image.getTileWidth(),
    tileHeight: image.getTileHeight(),
    ...(supportsBoundedNumericWindow(image) ? { decodedBlockConcurrency: 4 } : {}),
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
    private readonly physicalBlockBytes: ReadonlyMap<number, Float64Array>,
    readonly directoryBytes: number,
  ) {}

  get metadata(): RasterMetadata {
    return this._metadata;
  }

  setBlockCacheLimit(bytes: number): void {
    this.blockCache.setLimit(bytes);
  }

  getCacheFootprintKeys(): string[] {
    return this.blockCache.getFootprintKeys();
  }

  private exactPhysicalBytes(level: RasterLevel, request: RasterReadRequest): number | null {
    const counts = this.physicalBlockBytes.get(level.id);
    if (!counts) return null;
    const first = Math.floor(request.window[1] / level.tileHeight);
    const last = Math.ceil(request.window[3] / level.tileHeight);
    let bytes = 0;
    for (let block = first; block < last; block++) {
      bytes += counts[block] ?? 0;
      if (!Number.isSafeInteger(bytes))
        throw new RasterError(
          'INVALID_TIFF_DIRECTORY',
          'TIFF strip byte counts exceed safe limits.',
        );
    }
    return bytes;
  }

  private requestReadBudget(level: RasterLevel, request: RasterReadRequest): number {
    const exact = this.exactPhysicalBytes(level, request);
    if (exact === null) return readBudgetForRequest(level, request);
    // Strip byte counts are the exact stored payload. Leave bounded room for decoder/tag reads.
    const withHeadroom = Math.ceil((exact + 8 * MIB) / MIB) * MIB;
    return Math.min(
      ROW_STRIPED_READ_BUDGET_MAX_BYTES,
      Math.max(ROW_STRIPED_READ_BUDGET_MIN_BYTES, withHeadroom),
    );
  }

  splitRowStripedReadRequests(
    request: RasterReadRequest,
    overlapPixels = 0,
  ): readonly RasterReadRequest[] {
    const level = this.metadata.levels.find((item) => item.id === request.level);
    if (!level) throw new RasterError('INVALID_LEVEL', 'Unknown raster level.');
    const rowStriped = level.tileWidth >= level.width && level.tileHeight < level.height;
    if (!rowStriped || (level.decodedBlockConcurrency ?? 0) <= 0) return [request];
    const width = request.window[2] - request.window[0];
    if (width <= 0) return [request];
    const firstBlock = Math.floor(request.window[1] / level.tileHeight);
    const lastBlock = Math.ceil(request.window[3] / level.tileHeight);
    const decodedBytes = decodedBlockBytes(level);
    const maxDecodedBlocks = Math.max(
      1,
      Math.floor(ROW_STRIPED_CHUNK_DECODED_BYTES / Math.max(1, decodedBytes)),
    );
    const maxRowsByPixels = Math.max(1, Math.floor(RASTER_MAX_WINDOW_PIXELS / width));
    const counts = this.physicalBlockBytes.get(level.id);
    const chunks: RasterReadRequest[] = [];
    let startBlock = firstBlock,
      physicalBytes = 0;
    const push = (endBlock: number) => {
      const top = Math.max(request.window[1], startBlock * level.tileHeight);
      const bottom = Math.min(request.window[3], endBlock * level.tileHeight);
      if (bottom <= top) return;
      chunks.push({
        ...request,
        window: [
          request.window[0],
          Math.max(request.window[1], top - overlapPixels),
          request.window[2],
          Math.min(request.window[3], bottom + overlapPixels),
        ],
      });
      startBlock = endBlock;
      physicalBytes = 0;
    };
    for (let block = firstBlock; block < lastBlock; block++) {
      const blockBytes = counts?.[block] ?? decodedBytes;
      if (blockBytes > 64 * MIB)
        throw new RasterError(
          'RASTER_IO_BUDGET',
          'A single TIFF strip exceeds the bounded physical range limit.',
        );
      const prospectiveBlocks = block - startBlock + 1;
      const chunkTop = Math.max(request.window[1], startBlock * level.tileHeight);
      const chunkBottom = Math.min(request.window[3], (block + 1) * level.tileHeight);
      const prospectiveRows = chunkBottom - chunkTop;
      const physicalLimit = counts ? ROW_STRIPED_CHUNK_PHYSICAL_BYTES : Infinity;
      if (
        block > startBlock &&
        (prospectiveBlocks > maxDecodedBlocks ||
          prospectiveRows > maxRowsByPixels ||
          physicalBytes + blockBytes > physicalLimit)
      )
        push(block);
      physicalBytes += blockBytes;
    }
    push(lastBlock);
    return chunks.length ? chunks : [request];
  }

  static async open(
    file: File,
    options: GeoTIFFOpenOptions = {},
    runtime: GeoTIFFReaderRuntime = {},
  ): Promise<GeoTIFFReader> {
    options.signal?.throwIfAborted();
    if (options.noData !== undefined && options.noData !== null && !Number.isFinite(options.noData))
      throw new RasterError(
        'INVALID_NODATA',
        'NoData override must be a finite number, null, or undefined.',
      );
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
      physicalBlockBytes = new Map<number, Float64Array>(),
      levels: RasterLevel[] = [];
    let base: GeoTIFFImage | undefined, baseTiff: GeoTIFF | undefined;
    let hasValidityMask = false;
    let metadataBytes = 0;
    const blockCache = new RasterBlockCache(runtime.cacheBytes);
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
            levels.length,
          );
          base ??= image;
          const subfileType = fd.getValue('NewSubfileType') ?? 0;
          if (subfileType & 4) hasValidityMask = true;
          const levelSource: NonNullable<RasterLevel['source']> =
            image === base ? 'base' : input === file ? 'internal-overview' : 'external-overview';
          const level =
            image !== base && subfileType & 6
              ? undefined
              : descriptor(image, levels.length, levelSource);
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
            if (
              level.tileWidth >= level.width &&
              level.tileHeight < level.height &&
              image.planarConfiguration === 1 &&
              fd.hasTag('StripByteCounts')
            ) {
              const rawCounts = (await fd.loadValue('StripByteCounts')) as
                  | ArrayLike<number | bigint>
                  | undefined,
                expected = Math.ceil(level.height / level.tileHeight);
              if (!rawCounts || rawCounts.length < expected)
                throw new RasterError('INVALID_TIFF_DIRECTORY', 'Invalid TIFF strip byte counts.');
              const counts = new Float64Array(expected);
              for (let index = 0; index < expected; index++) {
                const value = Number(rawCounts[index]);
                if (!Number.isSafeInteger(value) || value < 0)
                  throw new RasterError(
                    'INVALID_TIFF_DIRECTORY',
                    'Invalid TIFF strip byte counts.',
                  );
                counts[index] = value;
              }
              physicalBlockBytes.set(level.id, counts);
            }
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
      const modelType: unknown = keys?.GTModelTypeGeoKey;
      const epsg: unknown =
        modelType === 1
          ? keys?.ProjectedCSTypeGeoKey
          : modelType === 2
            ? keys?.GeographicTypeGeoKey
            : (keys?.ProjectedCSTypeGeoKey ?? keys?.GeographicTypeGeoKey);
      const crs =
        options.crs?.trim() ||
        (typeof epsg === 'number' && Number.isInteger(epsg) && epsg > 0 && epsg < 32767
          ? `EPSG:${epsg}`
          : '');
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
        noData: options.noData === undefined ? base.getGDALNoData() : options.noData,
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
      const reader = new GeoTIFFReader(
        metadata,
        images,
        sources,
        blockCache,
        physicalBlockBytes,
        metadataBytes,
      );
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

  getNativeDeflateStatus() {
    const diagnostics = getNativeDeflateDiagnostics();
    return {
      compressionCodes: diagnostics.compressionCodes,
      available: diagnostics.available,
      eligible: diagnostics.eligible,
      disabledReason: diagnostics.disabledReason,
    };
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
    const blocks = this.blockCache.getDiagnostics(),
      nativeDeflate = getNativeDeflateDiagnostics(),
      fastLzw = getFastLzwDiagnostics(),
      readWindow = getReadWindowDiagnostics();
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
      nativeDeflateBlocks: nativeDeflate.blocks,
      nativeDeflateFallbacks: nativeDeflate.fallbacks,
      nativeDeflateMs: nativeDeflate.ms,
      fastLzwBlocks: fastLzw.blocks,
      fastLzwFallbacks: fastLzw.fallbacks,
      fastLzwMs: fastLzw.ms,
      deinterleaveMs: readWindow.deinterleaveMs,
      directReadMs: readWindow.directReadMs,
      blockLoadMs: blocks.loadMs,
      transferMs: 0,
    };
  }

  supportsInterleavedRgb8(levelId: number): boolean {
    const image = this.images.get(levelId);
    return Boolean(
      image &&
        image.planarConfiguration === 1 &&
        image.getSamplesPerPixel() === 3 &&
        [0, 1, 2].every(
          (band) => image.getBitsPerSample(band) === 8 && image.getSampleFormat(band) === 1,
        ),
    );
  }

  private async runRead<T>(
    request: RasterReadRequest,
    signal: AbortSignal | undefined,
    execute: (image: GeoTIFFImage, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    signal?.throwIfAborted();
    this.lifetime.signal.throwIfAborted();
    const level = validateRasterRead(this.metadata.levels, request);
    if (this.pending >= 16)
      throw new RasterError('RASTER_QUEUE_BUDGET', 'Too many queued raster reads.');
    this.pending++;
    const run = this.tail.then(async () => {
      signal?.throwIfAborted();
      this.lifetime.signal.throwIfAborted();
      const controller = new AbortController(),
        abort = () => controller.abort(signal?.reason ?? this.lifetime.signal.reason);
      signal?.addEventListener('abort', abort, { once: true });
      this.lifetime.signal.addEventListener('abort', abort, { once: true });
      try {
        const readBudget = this.requestReadBudget(level, request);
        for (const source of this.sources) source.beginRead(readBudget);
        const result = await execute(this.images.get(request.level)!, controller.signal);
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

  readInterleavedRgb8Window(
    request: RasterReadRequest,
    signal?: AbortSignal,
  ): Promise<InterleavedRgb8Window> {
    return this.runRead(request, signal, (image, readSignal) => {
      if (!this.supportsInterleavedRgb8(request.level))
        throw new RasterError('UNSUPPORTED_SAMPLES', 'Interleaved RGB8 fast path is unavailable.');
      return readInterleavedRgb8Window(image, request, readSignal);
    });
  }

  readWindow(request: RasterReadRequest, signal?: AbortSignal): Promise<RasterReadResult> {
    return this.runRead(request, signal, (image, readSignal) =>
      readNumericWindow(image, request, readSignal),
    );
  }

  readTexture(request: RasterReadRequest, signal?: AbortSignal): Promise<RasterTextureResult> {
    const level = this.metadata.levels.find((l) => l.id === request.level);
    if (!level) throw new RasterError('INVALID_LEVEL', 'Unknown texture level.');
    validateRasterTextureRead(level, request);
    return this.runRead(request, signal, (image, readSignal) =>
      readTextureWindow(image, request, readSignal),
    );
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
