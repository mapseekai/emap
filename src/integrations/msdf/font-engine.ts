import createHarfBuzz from 'harfbuzzjs/hb.js';
import bindHarfBuzz from 'harfbuzzjs/hbjs.js';
import createBidi from 'bidi-js';
import { decodeFont } from './woff';
import { MsdfGenerator } from './generator';
import type {
  FontManifest,
  FontSelection,
  ShapeRequest,
  ShapedText,
  GlyphRequest,
  GeneratedGlyph,
  WorkerStats,
} from './protocol';

type HB = ReturnType<typeof bindHarfBuzz>;
interface LoadedFont {
  url: string;
  bytes: Uint8Array;
  blob: ReturnType<HB['createBlob']>;
  face: ReturnType<HB['createFace']>;
  font: ReturnType<HB['createFont']>;
  unicodes: Set<number>;
  used: number;
}
export async function fetchBytes(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal, credentials: 'same-origin' });
  if (!response.ok) throw new Error(`MSDF resource HTTP ${response.status}: ${url}`);
  if (Number(response.headers.get('content-length')) > 32 * 1024 ** 2)
    throw new Error('MSDF resource exceeds 32 MiB.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('MSDF resource has no response body.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 32 * 1024 ** 2) {
        await reader.cancel();
        throw new Error('MSDF resource exceeds 32 MiB.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    result.set(chunk, at);
    at += chunk.length;
  }
  return result.buffer;
}
function scriptOf(cp: number): string {
  if ((cp >= 0x600 && cp <= 0x8ff) || (cp >= 0xfb50 && cp <= 0xfeff)) return 'Arab';
  if (cp >= 0x590 && cp <= 0x5ff) return 'Hebr';
  if (cp >= 0x900 && cp <= 0x97f) return 'Deva';
  if (cp >= 0xe00 && cp <= 0xe7f) return 'Thai';
  if (cp >= 0x4e00 && cp <= 0x9fff) return 'Hani';
  if (cp >= 0x3040 && cp <= 0x30ff) return 'Kana';
  if (cp >= 0x41 && cp <= 0x2af) return 'Latn';
  if (cp >= 0x370 && cp <= 0x3ff) return 'Grek';
  if (cp >= 0x400 && cp <= 0x52f) return 'Cyrl';
  return /\p{Letter}/u.test(String.fromCodePoint(cp)) ? 'Zzzz' : '';
}

/** Worker-only shaping and glyph generation; font bytes are owned and explicitly released.
 * Unicode bidi resolution precedes HarfBuzz shaping, with script/font fallback runs. */
export class MsdfFontEngine {
  private fonts = new Map<string, LoadedFont>();
  private clock = 0;
  private bytes = 0;
  private bidi = createBidi();
  private generated = 0;
  private shaped = 0;
  private constructor(
    private hb: HB,
    private hbModule: { HEAPU8: Uint8Array },
    private generator: MsdfGenerator,
    private manifest: FontManifest,
    private base: string,
  ) {}
  static async create(base: string): Promise<MsdfFontEngine> {
    const [hbBytes, sdfBytes, manifestBytes] = await Promise.all(
      ['hb.wasm', 'msdfgen.wasm', 'fonts.json'].map((p) => fetchBytes(new URL(p, base).href)),
    );
    const module = await createHarfBuzz({ wasmBinary: hbBytes });
    return new MsdfFontEngine(
      bindHarfBuzz(module),
      module,
      await MsdfGenerator.create(sdfBytes),
      JSON.parse(new TextDecoder().decode(manifestBytes)) as FontManifest,
      base,
    );
  }
  get stats(): WorkerStats {
    return {
      fontBytes: this.bytes,
      fonts: this.fonts.size,
      glyphsGenerated: this.generated,
      shapedRuns: this.shaped,
      heapBytes: this.generator.heapBytes + this.hbModule.HEAPU8.byteLength,
    };
  }
  private async load(url: string, signal: AbortSignal): Promise<LoadedFont> {
    const previous = this.fonts.get(url);
    if (previous) {
      previous.used = ++this.clock;
      return previous;
    }
    const bytes = decodeFont(new Uint8Array(await fetchBytes(url, signal)));
    signal.throwIfAborted();
    const blob = this.hb.createBlob(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    );
    const face = this.hb.createFace(blob, 0),
      font = this.hb.createFont(face);
    try {
      if (!face.upem || face.upem > 16384)
        throw new Error('Font has an invalid units-per-em value.');
      const codes = face.collectUnicodes();
      if (codes.length > 131072)
        throw new Error('Font character map exceeds the MSDF memory budget.');
      const unicodes = new Set(codes);
      if (!unicodes.size) throw new Error('Font has no supported Unicode characters.');
      font.setScale(face.upem, face.upem);
      const loaded = { url, bytes, blob, face, font, unicodes, used: ++this.clock };
      this.fonts.set(url, loaded);
      this.bytes += bytes.byteLength;
      return loaded;
    } catch (e) {
      font.destroy();
      face.destroy();
      blob.destroy();
      throw e;
    }
  }
  private trim(): void {
    for (const f of [...this.fonts.values()].sort((a, b) => a.used - b.used)) {
      if (this.bytes <= 32 * 1024 ** 2 && this.fonts.size <= 128) break;
      this.fonts.delete(f.url);
      this.bytes -= f.bytes.length;
      f.font.destroy();
      f.face.destroy();
      f.blob.destroy();
    }
  }
  private async choose(
    cp: number,
    selection: FontSelection,
    signal: AbortSignal,
    previous?: LoadedFont,
  ): Promise<LoadedFont> {
    if (selection.url) {
      const own = await this.load(selection.url, signal);
      if (own.unicodes.has(cp)) return own;
    }
    const family = selection.family.toLowerCase();
    const group =
      family === 'serif' || family.includes('noto serif')
        ? 'serif'
        : family === 'monospace' || family.includes('noto sans mono')
          ? 'monospace'
          : 'sans-serif';
    const familyFile =
      group === 'monospace'
        ? 'noto-sans-mono-'
        : group === 'serif'
          ? 'noto-serif-sc-'
          : 'noto-sans-sc-';
    if (previous?.url.includes(familyFile) && previous.unicodes.has(cp)) return previous;
    const weight = selection.weight >= 600 ? 700 : 400;
    for (const name of group === 'sans-serif' ? [group] : [group, 'sans-serif']) {
      for (const asset of this.manifest[`${name}:${weight}`] ?? []) {
        if (!asset.ranges.some(([a, b]) => cp >= a && cp <= b)) continue;
        const font = await this.load(new URL(asset.url, this.base).href, signal);
        if (font.unicodes.has(cp)) return font;
      }
    }
    // Report missing outlines; the main-thread atlas can rasterize the whole
    // run with browser fonts and expose that fallback in its diagnostics.
    const fallback = this.manifest[`sans-serif:${weight}`].find((a) =>
      a.ranges.some(([l, h]) => 65 >= l && 65 <= h),
    );
    if (!fallback) throw new Error('MSDF default font is missing.');
    return this.load(new URL(fallback.url, this.base).href, signal);
  }
  async shape(request: ShapeRequest, signal: AbortSignal): Promise<ShapedText> {
    try {
      if (request.text.length > 1024 || [...request.text].length > 256)
        throw new Error('MSDF text exceeds label limits.');
      const result: ShapedText = {
        key: request.key,
        glyphs: [],
        left: 0,
        top: -0.8,
        right: 0,
        bottom: 0.2,
        missing: 0,
      };
      const lines = request.text.split('\n');
      if (lines.length > 4) return result;
      for (let lineNo = 0; lineNo < lines.length; lineNo++) {
        const text = lines[lineNo];
        if (!text) continue;
        const embedding = this.bidi.getEmbeddingLevels(text),
          visual = Array.from({ length: text.length }, (_, i) => i);
        for (const [a, b] of this.bidi.getReorderSegments(text, embedding)) {
          const reversed = visual.slice(a, b + 1).reverse();
          visual.splice(a, reversed.length, ...reversed);
        }
        const ranks = new Int32Array(text.length);
        visual.forEach((index, rank) => {
          ranks[index] = rank;
        });
        const runs: {
          text: string;
          font: LoadedFont;
          level: number;
          rank: number;
          script: string;
        }[] = [];
        let offset = 0;
        for (const character of text) {
          signal.throwIfAborted();
          const cp = character.codePointAt(0)!,
            last = runs.at(-1);
          const font = await this.choose(cp, request.font, signal, last?.font);
          const level = embedding.levels[offset],
            script = scriptOf(cp) || last?.script || 'Latn';
          if (last && last.font === font && last.level === level && last.script === script) {
            last.text += character;
            last.rank = Math.min(last.rank, ranks[offset]);
          } else runs.push({ text: character, font, level, rank: ranks[offset], script });
          offset += character.length;
        }
        runs.sort((a, b) => a.rank - b.rank);
        let cursor = 0;
        for (const run of runs) {
          const buffer = this.hb.createBuffer(),
            { font, face, url } = run.font;
          try {
            buffer.addText(run.text);
            buffer.guessSegmentProperties();
            if (run.script !== 'Zzzz') buffer.setScript(run.script);
            buffer.setDirection(run.level % 2 ? 'rtl' : 'ltr');
            this.hb.shape(font, buffer);
            const glyphs = buffer.json(),
              advance = glyphs.reduce((n, g) => n + g.ax / face.upem, 0);
            let x = advance < 0 ? -advance : 0;
            for (const g of glyphs) {
              const gx = cursor + x + g.dx / face.upem,
                gy = lineNo * 1.25 - g.dy / face.upem;
              const e = font.glyphExtents(g.g);
              if (g.g === 0) result.missing++;
              if (e && e.width && e.height) {
                result.glyphs.push({ font: url, id: g.g, x: gx, y: gy });
                result.left = Math.min(result.left, gx + e.xBearing / face.upem);
                result.right = Math.max(result.right, gx + (e.xBearing + e.width) / face.upem);
                result.top = Math.min(result.top, gy - e.yBearing / face.upem);
                result.bottom = Math.max(result.bottom, gy - (e.yBearing + e.height) / face.upem);
              }
              x += g.ax / face.upem;
            }
            cursor += Math.abs(advance);
            this.shaped++;
          } finally {
            buffer.destroy();
          }
        }
        result.right = Math.max(result.right, cursor);
        result.bottom = Math.max(result.bottom, lineNo * 1.25 + 0.2);
      }
      return result;
    } finally {
      this.trim();
    }
  }
  async glyph(request: GlyphRequest, signal: AbortSignal): Promise<GeneratedGlyph> {
    try {
      const f = await this.load(request.font, signal);
      this.generator.loadFont(f.url, f.bytes);
      const path = f.font.glyphToPath(request.id);
      if (path.length > 65536) throw new Error('Glyph outline exceeds the MSDF complexity budget.');
      const result = this.generator.generate(request, path, f.face.upem);
      this.generated++;
      return result;
    } finally {
      this.trim();
    }
  }
  dispose(): void {
    for (const f of this.fonts.values()) {
      f.font.destroy();
      f.face.destroy();
      f.blob.destroy();
    }
    this.fonts.clear();
    this.bytes = 0;
    this.generator.dispose();
  }
}
