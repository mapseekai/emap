import type { getDecoder } from 'geotiff';

type GeoTIFFDecoder = Awaited<ReturnType<typeof getDecoder>>;

let nativeBlocks = 0,
  nativeFallbacks = 0,
  nativeMs = 0;

export function getNativeDeflateDiagnostics() {
  return { blocks: nativeBlocks, fallbacks: nativeFallbacks, ms: nativeMs };
}

export interface NativeDeflateParameters {
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly planarConfiguration: number;
  readonly bitsPerSample: readonly number[];
  readonly predictor: number;
}

function applyHorizontalPredictor(
  block: ArrayBuffer,
  parameters: NativeDeflateParameters,
): ArrayBuffer {
  if (parameters.predictor === 1) return block;
  const bits = parameters.bitsPerSample[0],
    bytesPerSample = bits / 8,
    stride = parameters.planarConfiguration === 2 ? 1 : parameters.bitsPerSample.length,
    rowBytes = parameters.tileWidth * stride * bytesPerSample;
  for (let row = 0; row < parameters.tileHeight; row++) {
    const offset = row * rowBytes;
    if (offset >= block.byteLength) break;
    const bytes = Math.min(rowBytes, block.byteLength - offset);
    if (bits === 8) {
      const values = new Uint8Array(block, offset, bytes);
      for (let i = stride; i < values.length; i++) values[i] += values[i - stride];
    } else if (bits === 16) {
      const values = new Uint16Array(block, offset, Math.floor(bytes / 2));
      for (let i = stride; i < values.length; i++) values[i] += values[i - stride];
    } else {
      const values = new Uint32Array(block, offset, Math.floor(bytes / 4));
      for (let i = stride; i < values.length; i++) values[i] += values[i - stride];
    }
  }
  return block;
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

export function canUseNativeDeflate(parameters: NativeDeflateParameters): boolean {
  const bits = parameters.bitsPerSample;
  return (
    typeof DecompressionStream === 'function' &&
    typeof Response === 'function' &&
    (parameters.predictor === 1 || parameters.predictor === 2) &&
    bits.length > 0 &&
    bits.every((value) => value === bits[0]) &&
    (bits[0] === 8 || bits[0] === 16 || bits[0] === 32)
  );
}

export function createNativeDeflateDecoder(
  parameters: NativeDeflateParameters,
  fallback: GeoTIFFDecoder,
): GeoTIFFDecoder {
  if (!canUseNativeDeflate(parameters)) return fallback;
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
