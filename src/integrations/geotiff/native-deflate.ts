import type { getDecoder } from 'geotiff';
import { applyHorizontalPredictor } from './horizontal-predictor';
import type {
  RasterNativeDeflateDisabledReason,
  RasterNativeDeflateStatus,
} from '../../domain/raster/types';

type GeoTIFFDecoder = Awaited<ReturnType<typeof getDecoder>>;

const TIFF_DEFLATE_CODES = new Set([8, 32946]);
const nativeFallbacks = 0;
let nativeBlocks = 0,
  nativeMs = 0,
  nativeAvailable = false,
  nativeEligible = false,
  nativeDisabledReason: RasterNativeDeflateDisabledReason | null = null;
const nativeCompressionCodes = new Set<number>();

export function getNativeDeflateDiagnostics() {
  return {
    blocks: nativeBlocks,
    fallbacks: nativeFallbacks,
    ms: nativeMs,
    compressionCodes: [...nativeCompressionCodes].sort((a, b) => a - b),
    available: nativeAvailable,
    eligible: nativeEligible,
    disabledReason: nativeEligible ? null : nativeDisabledReason,
  };
}

export interface NativeDeflateParameters {
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly planarConfiguration: number;
  readonly bitsPerSample: readonly number[];
  readonly predictor: number;
}

function decodedBlockCapacity(parameters: NativeDeflateParameters): number {
  const bytesPerSample = parameters.bitsPerSample[0] / 8,
    samples = parameters.planarConfiguration === 2 ? 1 : parameters.bitsPerSample.length,
    capacity = parameters.tileWidth * parameters.tileHeight * samples * bytesPerSample;
  if (!Number.isSafeInteger(capacity) || capacity < 0)
    throw new Error('Invalid TIFF decoded block size.');
  return capacity;
}

async function nativeInflate(buffer: ArrayBufferLike, capacity: number): Promise<ArrayBuffer> {
  const stream = new DecompressionStream('deflate'),
    writer = stream.writable.getWriter(),
    reader = stream.readable.getReader(),
    input =
      buffer instanceof ArrayBuffer
        ? new Uint8Array(buffer)
        : new Uint8Array(new Uint8Array(buffer)),
    output = new Uint8Array(capacity);
  // The decoder borrows immutable compressed input until the awaited stream completes.
  const write = writer.write(input).then(() => writer.close());
  // The readable side can cancel first on an output-budget violation. Attach a
  // rejection handler immediately so the corresponding writer failure is never unhandled.
  void write.catch(() => undefined);
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (total + value.byteLength > capacity) {
        await reader.cancel('TIFF DEFLATE block exceeds decoded size.');
        throw new Error('TIFF DEFLATE block exceeds decoded size.');
      }
      output.set(value, total);
      total += value.byteLength;
    }
    await write;
  } catch (error) {
    try {
      await writer.abort(error);
    } catch {}
    throw error;
  }
  return total === output.length ? output.buffer : output.slice(0, total).buffer;
}

export function getNativeDeflateCapability(
  compression: number,
  parameters: NativeDeflateParameters,
): RasterNativeDeflateStatus {
  const available = typeof DecompressionStream === 'function';
  let disabledReason: RasterNativeDeflateDisabledReason | null = null;
  if (!TIFF_DEFLATE_CODES.has(compression)) disabledReason = 'unsupported-compression';
  else if (!available) disabledReason = 'decompression-stream-unavailable';
  else if (parameters.predictor !== 1 && parameters.predictor !== 2)
    disabledReason = 'unsupported-predictor';
  else if (
    !parameters.bitsPerSample.length ||
    !parameters.bitsPerSample.every((value) => value === parameters.bitsPerSample[0])
  )
    disabledReason = 'mixed-bits';
  else if (![8, 16, 32].includes(parameters.bitsPerSample[0])) disabledReason = 'unsupported-bits';
  return {
    compressionCodes: [compression],
    available,
    eligible: disabledReason === null,
    disabledReason,
  };
}

function recordCapability(status: RasterNativeDeflateStatus): void {
  for (const compression of status.compressionCodes) nativeCompressionCodes.add(compression);
  nativeAvailable ||= status.available;
  nativeEligible ||= status.eligible;
  if (nativeEligible) nativeDisabledReason = null;
  else if (status.disabledReason) nativeDisabledReason = status.disabledReason;
}

export function canUseNativeDeflate(
  compression: number,
  parameters: NativeDeflateParameters,
): boolean {
  return getNativeDeflateCapability(compression, parameters).eligible;
}

export function createNativeDeflateDecoder(
  compression: number,
  parameters: NativeDeflateParameters,
  fallback: GeoTIFFDecoder,
): GeoTIFFDecoder {
  const capability = getNativeDeflateCapability(compression, parameters);
  recordCapability(capability);
  if (!capability.eligible) return fallback;
  const capacity = decodedBlockCapacity(parameters);
  return {
    parameters: {
      tileWidth: parameters.tileWidth,
      tileHeight: parameters.tileHeight,
      planarConfiguration: parameters.planarConfiguration,
      bitsPerSample: [...parameters.bitsPerSample],
      predictor: parameters.predictor,
    },
    async decodeBlock(buffer: ArrayBufferLike): Promise<ArrayBufferLike> {
      return nativeInflate(buffer, capacity);
    },
    async decode(buffer: ArrayBufferLike): Promise<ArrayBufferLike> {
      const started = performance.now(),
        decoded = await nativeInflate(buffer, capacity),
        result = applyHorizontalPredictor(decoded, parameters);
      nativeBlocks++;
      nativeMs += performance.now() - started;
      return result;
    },
  } as GeoTIFFDecoder;
}
