// Avoid expanding the persistent WASM heap for unusually large TIFF blocks.
const WASM_BLOCK_LIMIT = 4 * 1024 ** 2;
type WasmLzw = typeof import('@developmentseed/lzw-tiff-decoder');
let wasmModule: Promise<WasmLzw | null> | undefined;

function loadWasmLzw(): Promise<WasmLzw | null> {
  return (wasmModule ??= import('@developmentseed/lzw-tiff-decoder')
    .then(async (module) => {
      // CLEAR, byte 0, EOI: also initializes our lazy classic-Worker build.
      const probe = await module.decompress(new Uint8Array([0x80, 0x00, 0x20, 0x20]), 1);
      if (probe.length !== 1 || probe[0] !== 0) throw new Error('Invalid LZW decoder.');
      return module;
    })
    .catch(() => null));
}

/** Count decoded bytes without expanding dictionary strings. Reject incomplete
 * or corrupt streams before calling a decoder that does not expose their status.
 */
export function validatedLzwLength(
  input: Uint8Array,
  capacity: number,
  lengths: Uint16Array,
): number {
  if (!Number.isSafeInteger(capacity) || capacity < 0 || capacity > 64 * 1024 ** 2)
    throw new Error('Invalid TIFF LZW decoded size budget.');
  if (input.length < 2 || input[0] !== 0x80 || (input[1] & 0x80) !== 0)
    throw new Error('Invalid TIFF LZW stream (missing initial CLEAR).');
  let nextCode = 258,
    bits = 9,
    bitPosition = 0,
    previous = -1,
    outputLength = 0;
  while (true) {
    if (bitPosition + bits > input.length * 8)
      throw new Error('Truncated TIFF LZW stream (missing EOI).');
    const byte = bitPosition >> 3,
      offset = bitPosition & 7,
      chunk = ((input[byte] ?? 0) << 16) | ((input[byte + 1] ?? 0) << 8) | (input[byte + 2] ?? 0),
      code = (chunk >>> (24 - offset - bits)) & ((1 << bits) - 1);
    bitPosition += bits;
    if (code === 256) {
      nextCode = 258;
      bits = 9;
      previous = -1;
      continue;
    }
    if (code === 257) return outputLength;
    if (code > nextCode || (previous < 0 && code > 255))
      throw new Error(`Invalid TIFF LZW code ${code}/${nextCode}.`);
    const length = code === nextCode ? lengths[previous] + 1 : lengths[code];
    outputLength += length;
    if (outputLength > capacity) throw new Error('TIFF LZW block exceeds decoded size.');
    if (previous >= 0 && nextCode <= 4095) {
      lengths[nextCode++] = lengths[previous] + 1;
      if (bits < 12 && nextCode + 1 >= 1 << bits) bits++;
    }
    previous = code;
  }
}

/** null means WASM unavailable or outside its small-block memory envelope. */
export async function decodeWasmLzw(
  buffer: ArrayBufferLike,
  capacity: number,
  lengths: Uint16Array,
): Promise<ArrayBuffer | null> {
  const input = new Uint8Array(buffer),
    length = validatedLzwLength(input, capacity, lengths);
  if (!length) return new ArrayBuffer(0);
  if (length > WASM_BLOCK_LIMIT || input.byteLength > WASM_BLOCK_LIMIT) return null;
  const wasm = await loadWasmLzw();
  if (!wasm) return null;
  // v0.2.2 returns an owned copy, not a view into the growable WASM heap.
  const decoded = await wasm.decompress(input, length);
  if (decoded.byteLength !== length) throw new Error('Truncated decoded TIFF LZW block.');
  return decoded.byteOffset === 0 && decoded.byteLength === decoded.buffer.byteLength
    ? (decoded.buffer as ArrayBuffer)
    : decoded.slice().buffer;
}
