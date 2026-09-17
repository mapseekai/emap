import type { getDecoder } from 'geotiff';
import { applyHorizontalPredictor } from './horizontal-predictor';
import type {
  RasterNativeDeflateDisabledReason,
  RasterNativeDeflateStatus,
} from '../../domain/raster/types';

type GeoTIFFDecoder = Awaited<ReturnType<typeof getDecoder>>;

const TIFF_DEFLATE_CODES = new Set([8, 32946]);
let nativeBlocks = 0,
  nativeFallbacks = 0,
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

async function nativeInflate(buffer: ArrayBufferLike): Promise<ArrayBuffer> {
  const stream = new DecompressionStream('deflate');
  const output = new Response(stream.readable).arrayBuffer();
  const writer = stream.writable.getWriter();
  const input = new Uint8Array(buffer.byteLength);
  input.set(new Uint8Array(buffer));
  await writer.write(input);
  await writer.close();
  return output;
}

export function getNativeDeflateCapability(
  compression: number,
  parameters: NativeDeflateParameters,
): RasterNativeDeflateStatus {
  const available = typeof DecompressionStream === 'function' && typeof Response === 'function';
  let disabledReason: RasterNativeDeflateDisabledReason | null = null;
  if (!TIFF_DEFLATE_CODES.has(compression)) disabledReason = 'unsupported-compression';
  else if (typeof DecompressionStream !== 'function')
    disabledReason = 'decompression-stream-unavailable';
  else if (typeof Response !== 'function') disabledReason = 'response-unavailable';
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
  return {
    parameters: {
      tileWidth: parameters.tileWidth,
      tileHeight: parameters.tileHeight,
      planarConfiguration: parameters.planarConfiguration,
      bitsPerSample: [...parameters.bitsPerSample],
      predictor: parameters.predictor,
    },
    async decodeBlock(buffer: ArrayBufferLike): Promise<ArrayBufferLike> {
      return nativeInflate(buffer);
    },
    async decode(buffer: ArrayBufferLike): Promise<ArrayBufferLike> {
      const started = performance.now();
      try {
        const decoded = await nativeInflate(buffer),
          result = applyHorizontalPredictor(decoded, parameters);
        nativeBlocks++;
        nativeMs += performance.now() - started;
        return result;
      } catch {
        nativeFallbacks++;
        return fallback.decode(buffer);
      }
    },
  } as GeoTIFFDecoder;
}
