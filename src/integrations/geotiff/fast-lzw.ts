import { decodeWasmLzw } from './wasm-lzw';
import type { getDecoder } from 'geotiff';
import {
  applyHorizontalPredictor,
  type HorizontalPredictorParameters,
} from './horizontal-predictor';

type GeoTIFFDecoder = Awaited<ReturnType<typeof getDecoder>>;
export interface FastLzwParameters extends HorizontalPredictorParameters {}

const CLEAR_CODE = 256;
const EOI_CODE = 257;
const MAX_CODE = 4095;
let fastLzwBlocks = 0,
  fastLzwFallbacks = 0,
  fastLzwMs = 0;

export function getFastLzwDiagnostics() {
  return { blocks: fastLzwBlocks, fallbacks: fastLzwFallbacks, ms: fastLzwMs };
}

export function canUseFastLzw(compression: number, parameters: FastLzwParameters): boolean {
  const bits = parameters.bitsPerSample;
  return (
    compression === 5 &&
    (parameters.predictor === 1 || parameters.predictor === 2) &&
    bits.length > 0 &&
    bits.every((value) => value === bits[0]) &&
    (bits[0] === 8 || bits[0] === 16 || bits[0] === 32)
  );
}

function decodedBlockCapacity(parameters: FastLzwParameters): number {
  const bytesPerSample = parameters.bitsPerSample[0] / 8,
    samples = parameters.planarConfiguration === 2 ? 1 : parameters.bitsPerSample.length;
  return parameters.tileWidth * parameters.tileHeight * samples * bytesPerSample;
}

interface LzwScratch {
  readonly prefix: Uint16Array;
  readonly suffix: Uint8Array;
  readonly stack: Uint8Array;
}

export function decodeLzwBlock(
  buffer: ArrayBufferLike,
  capacity: number,
  scratch: LzwScratch = {
    prefix: new Uint16Array(4096),
    suffix: new Uint8Array(4096),
    stack: new Uint8Array(4096),
  },
): ArrayBuffer {
  const input = new Uint8Array(buffer),
    output = new Uint8Array(capacity),
    { prefix, suffix, stack } = scratch;
  let nextCode = 258,
    bits = 9,
    bitPosition = 0,
    previous = -1,
    outputPosition = 0;
  const readCode = () => {
    const byte = bitPosition >> 3,
      offset = bitPosition & 7;
    if (byte >= input.length) return EOI_CODE;
    const chunk =
        ((input[byte] ?? 0) << 16) | ((input[byte + 1] ?? 0) << 8) | (input[byte + 2] ?? 0),
      code = (chunk >>> (24 - offset - bits)) & ((1 << bits) - 1);
    bitPosition += bits;
    return code;
  };
  const writeSequence = (code: number): number => {
    let current = code,
      top = 0,
      guard = 0;
    while (current > 255) {
      if (current >= nextCode || guard++ > MAX_CODE)
        throw new Error('Corrupt TIFF LZW dictionary chain.');
      stack[top++] = suffix[current];
      current = prefix[current];
    }
    stack[top++] = current;
    if (outputPosition + top > output.length)
      throw new Error('TIFF LZW block exceeds decoded size.');
    const first = current;
    while (top) output[outputPosition++] = stack[--top];
    return first;
  };

  let code = readCode();
  while (code !== EOI_CODE) {
    if (code === CLEAR_CODE) {
      nextCode = 258;
      bits = 9;
      previous = -1;
      code = readCode();
      while (code === CLEAR_CODE) code = readCode();
      if (code === EOI_CODE) break;
      if (code > 255) throw new Error(`Corrupt TIFF LZW first code ${code}.`);
      if (outputPosition >= output.length) throw new Error('TIFF LZW block exceeds decoded size.');
      output[outputPosition++] = code;
      previous = code;
      code = readCode();
      continue;
    }

    let first: number;
    if (code < nextCode) first = writeSequence(code);
    else if (code === nextCode && previous >= 0) {
      first = writeSequence(previous);
      if (outputPosition >= output.length) throw new Error('TIFF LZW block exceeds decoded size.');
      output[outputPosition++] = first;
    } else throw new Error(`Invalid TIFF LZW code ${code}/${nextCode}.`);

    if (previous >= 0 && nextCode <= MAX_CODE) {
      prefix[nextCode] = previous;
      suffix[nextCode] = first;
      nextCode++;
      if (bits < 12 && nextCode + 1 >= 1 << bits) bits++;
    }
    previous = bits === 12 && nextCode + 1 >= 1 << 12 ? -1 : code;
    code = readCode();
  }
  return outputPosition === output.length ? output.buffer : output.slice(0, outputPosition).buffer;
}

export function createFastLzwDecoder(
  compression: number,
  parameters: FastLzwParameters,
  fallback: GeoTIFFDecoder,
): GeoTIFFDecoder {
  if (!canUseFastLzw(compression, parameters)) return fallback;
  const capacity = decodedBlockCapacity(parameters),
    lengths = new Uint16Array(4096).fill(1, 0, 256),
    scratch: LzwScratch = {
      prefix: new Uint16Array(4096),
      suffix: new Uint8Array(4096),
      stack: new Uint8Array(4096),
    };
  const decode = async (buffer: ArrayBufferLike): Promise<ArrayBuffer> => {
    const wasm = await decodeWasmLzw(buffer, capacity, lengths);
    if (wasm) return wasm;
    fastLzwFallbacks++;
    return decodeLzwBlock(buffer, capacity, scratch);
  };
  return {
    parameters: {
      tileWidth: parameters.tileWidth,
      tileHeight: parameters.tileHeight,
      planarConfiguration: parameters.planarConfiguration,
      bitsPerSample: [...parameters.bitsPerSample],
      predictor: parameters.predictor,
    },
    decodeBlock: decode,
    async decode(buffer: ArrayBufferLike): Promise<ArrayBufferLike> {
      const started = performance.now(),
        decoded = await decode(buffer),
        result = applyHorizontalPredictor(decoded, parameters);
      fastLzwBlocks++;
      fastLzwMs += performance.now() - started;
      return result;
    },
  } as GeoTIFFDecoder;
}
