import { unzlibSync } from 'fflate';

const MAX_FONT_BYTES = 32 * 1024 ** 2;
/** Decode WOFF1 containers to SFNT. Both HarfBuzz and FreeType must receive identical bytes.
 * WOFF2 needs Brotli + font transforms and is explicitly rejected, not misread as TrueType. */
export function decodeFont(input: Uint8Array): Uint8Array {
  if (input.byteLength < 12 || input.byteLength > MAX_FONT_BYTES)
    throw new Error('Invalid font byte length.');
  const v = new DataView(input.buffer, input.byteOffset, input.byteLength),
    magic = v.getUint32(0);
  if (magic === 0x774f4632) throw new Error('MSDF fontUrl requires TTF, OTF or WOFF1, not WOFF2.');
  if (magic !== 0x774f4646) {
    if (magic !== 0x00010000 && magic !== 0x4f54544f)
      throw new Error('Unsupported MSDF font container.');
    return input;
  }
  if (input.length < 44 || v.getUint32(8) !== input.length) throw new Error('Truncated WOFF font.');
  const count = v.getUint16(12),
    total = v.getUint32(16);
  if (
    !count ||
    count > 4096 ||
    44 + 20 * count > input.length ||
    total > MAX_FONT_BYTES ||
    total < 12 + count * 16
  )
    throw new Error('Invalid WOFF table directory.');
  const out = new Uint8Array(total),
    d = new DataView(out.buffer);
  d.setUint32(0, v.getUint32(4));
  d.setUint16(4, count);
  const power = Math.floor(Math.log2(count));
  d.setUint16(6, 16 * 2 ** power);
  d.setUint16(8, power);
  d.setUint16(10, 16 * count - 16 * 2 ** power);
  let cursor = 12 + count * 16;
  const tags = new Set<number>();
  for (let i = 0; i < count; i++) {
    const at = 44 + i * 20,
      tag = v.getUint32(at),
      offset = v.getUint32(at + 4);
    const compressed = v.getUint32(at + 8),
      size = v.getUint32(at + 12);
    if (
      tags.has(tag) ||
      !size ||
      compressed > size ||
      offset < 44 + count * 20 ||
      offset + compressed > input.length ||
      cursor + size > total
    )
      throw new Error('Invalid WOFF table bounds.');
    tags.add(tag);
    const target = out.subarray(cursor, cursor + size),
      source = input.subarray(offset, offset + compressed);
    if (compressed === size) target.set(source);
    else {
      // Preallocated output bounds the decompression working set for untrusted fonts.
      const decoded = unzlibSync(source, { out: target });
      if (decoded.length !== size) throw new Error('Invalid WOFF decompressed table size.');
    }
    const entry = 12 + i * 16;
    d.setUint32(entry, tag);
    d.setUint32(entry + 4, v.getUint32(at + 16));
    d.setUint32(entry + 8, cursor);
    d.setUint32(entry + 12, size);
    cursor += (size + 3) & ~3;
  }
  if (cursor !== total) throw new Error('Invalid WOFF SFNT length.');
  return out;
}
