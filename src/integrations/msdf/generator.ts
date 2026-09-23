import createModule from 'msdfgen-wasm/core';
import { MSDF_EM_PIXELS, type GeneratedGlyph, type GlyphRequest } from './protocol';
type Module = Awaited<ReturnType<typeof createModule>>;

/** Thin, owned adapter to upstream msdfgen/FreeType. The glyph ID is the HarfBuzz
 * output, not a Unicode codepoint: ligatures and contextual substitutions remain intact. */
export class MsdfGenerator {
  private scratch: number;
  private fontPointer = 0;
  private fontKey = '';
  private disposed = false;
  private constructor(private readonly module: Module) {
    this.scratch = module._malloc(128);
    if (!this.scratch) throw new Error('MSDF scratch allocation failed.');
  }
  static async create(wasm: ArrayBuffer): Promise<MsdfGenerator> {
    return new MsdfGenerator(await createModule({ wasm }));
  }
  get heapBytes(): number {
    return this.module.HEAPU8.byteLength;
  }
  loadFont(key: string, bytes: Uint8Array): void {
    if (this.disposed) throw new Error('MSDF generator disposed.');
    if (key === this.fontKey) return;
    const m = this.module,
      ptr = m._malloc(bytes.length);
    if (!ptr) throw new Error('MSDF font allocation failed.');
    m.HEAPU8.set(bytes, ptr);
    const status = m._loadFont(ptr, bytes.length);
    // _loadFont replaces FreeType's previous memory face. Do not free its data earlier.
    if (this.fontPointer) m._free(this.fontPointer);
    this.fontPointer = ptr;
    this.fontKey = status === 0 ? key : '';
    if (status) throw new Error(`MSDF FreeType rejected font (status ${status}).`);
  }
  generate(request: GlyphRequest, path: string, upem: number): GeneratedGlyph {
    const m = this.module,
      tmp = this.scratch;
    if (this.disposed || !this.fontKey) throw new Error('MSDF font not loaded.');
    if (
      !Number.isInteger(request.id) ||
      request.id < 0 ||
      request.id > 65535 ||
      ![16, 32, 64, 128, 256].includes(request.range)
    )
      throw new Error('Invalid MSDF glyph request.');
    const status = m._loadGlyph(request.id, tmp, 1);
    if (status) throw new Error(`MSDF glyph load failed (${status}).`);
    const shape = m.HEAPU32[tmp / 4];
    let bitmap = 0;
    try {
      const metrics = m.HEAPF64.slice((tmp + 8) / 8, (tmp + 8) / 8 + 5);
      const [, left, bottom, right, top] = metrics,
        size = MSDF_EM_PIXELS,
        pad = request.range / 2 + 1;
      if (![left, bottom, right, top].every(Number.isFinite))
        throw new Error('Invalid glyph outline bounds.');
      const l = Math.floor(left * size) - pad,
        b = Math.floor(bottom * size) - pad;
      const r = Math.ceil(right * size) + pad,
        t = Math.ceil(top * size) + pad;
      const width = r - l,
        height = t - b;
      if (width <= 0 || height <= 0 || width > 512 || height > 512)
        throw new Error('Glyph exceeds MSDF texture budget.');
      m.HEAPF64.set(
        [size, -l / size, -b / size, request.range / size, 1, 3, width, height, 1],
        tmp / 8,
      );
      bitmap = m._generateMSDF(shape, tmp);
      if (!bitmap) throw new Error('MSDF generation failed.');
      const ptr = m._getBitmapPixels(bitmap) / 4,
        pixels = m.HEAPF32;
      const data = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const from = ptr + ((height - 1 - y) * width + x) * 3,
            to = (y * width + x) * 4;
          data[to] = pixels[from] * 256;
          data[to + 1] = pixels[from + 1] * 256;
          data[to + 2] = pixels[from + 2] * 256;
          data[to + 3] = 255;
        }
      return {
        key: request.key,
        width,
        height,
        data: new Uint8Array(data.buffer),
        plane: [l / size, -t / size, r / size, -b / size],
        range: request.range,
        emPixels: size,
        path,
        upem,
      };
    } finally {
      if (bitmap) m._destroyBitmap(bitmap);
      if (shape) m._destroyGlyph(shape);
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // This object lives in a dedicated worker. Termination releases the module/FreeType face.
    this.module._free(this.scratch);
    this.scratch = 0;
    if (this.fontPointer) this.module._free(this.fontPointer);
    this.fontPointer = 0;
    this.fontKey = '';
  }
}
