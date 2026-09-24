import type { LabelOptions } from '../../engine/map/label';
import type {
  LabelAtlasProvider,
  LabelTextRequest,
  MsdfAtlasPage,
  MsdfTextRaster,
  MsdfGlyphQuad,
} from '../../engine/rendering/labels/text-types';
import { MsdfClient } from './client';
import {
  MSDF_EM_PIXELS,
  type ShapeRequest,
  type ShapedText,
  type GeneratedGlyph,
  type GlyphRequest,
} from './protocol';

interface Page extends MsdfAtlasPage {
  x: number;
  y: number;
  row: number;
  used: number;
  keys: Set<string>;
}
interface Glyph extends Omit<GeneratedGlyph, 'data'> {
  page: Page;
  rect: [number, number, number, number];
}
const SIZE = 1024,
  MAX_PAGES = 4;
function selection(options: LabelOptions) {
  if (
    !options.fontUrl &&
    ![
      'sans-serif',
      'serif',
      'monospace',
      'noto sans sc',
      'noto serif sc',
      'noto sans mono',
    ].includes((options.fontFamily ?? 'sans-serif').toLowerCase())
  )
    throw new Error('MSDF cannot read system font outlines. Supply fontUrl for this fontFamily.');
  if (options.fontUrl) {
    const url = new URL(options.fontUrl, globalThis.location?.href ?? 'http://localhost/');
    if (!['http:', 'https:', 'blob:'].includes(url.protocol))
      throw new Error('MSDF fontUrl must use HTTP(S) or an authorized blob URL.');
  }
  return {
    family: options.fontFamily ?? 'sans-serif',
    weight:
      options.fontWeight === 'bold'
        ? 700
        : typeof options.fontWeight === 'number'
          ? options.fontWeight
          : 400,
    ...(options.fontUrl
      ? { url: new URL(options.fontUrl, globalThis.location?.href ?? 'http://localhost/').href }
      : {}),
  };
}
function key(text: string, options: LabelOptions): string {
  return JSON.stringify([text, selection(options)]);
}
function range(options: LabelOptions): number {
  const need = ((options.haloWidth ?? 1.5) / (options.fontSize ?? 14)) * MSDF_EM_PIXELS * 2 + 4;
  return Math.min(256, Math.max(32, 2 ** Math.ceil(Math.log2(need))));
}
function glyphRequest(font: string, id: number, options: LabelOptions): GlyphRequest {
  const r = range(options);
  return { key: JSON.stringify([font, id, r]), font, id, range: r };
}

/** Real RGB MSDF, shared by shaped glyph ID. Font size, paint and DPR are not atlas keys.
 * A larger distance-range tier is allocated only when an unusually wide halo needs it. */
export class MsdfLabelAtlas implements LabelAtlasProvider {
  readonly mode = 'msdf' as const;
  private client: MsdfClient;
  private shapes = new Map<string, ShapedText>();
  private reserved = new Set<string>();
  private glyphs = new Map<string, Glyph>();
  private pages: Page[] = [];
  private pinned = new Set<Page>();
  private clock = 0;
  private colors = new Map<string, [number, number, number, number]>();
  private sample: CanvasRenderingContext2D;
  private generated = 0;
  private frameGlyphs = 0;
  private shapedGlyphs = 0;
  private channelPixels = 0;
  private missing = 0;
  constructor(workerUrl: URL, document: Document = globalThis.document) {
    this.client = new MsdfClient(workerUrl);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('MSDF CSS color parser unavailable.');
    this.sample = ctx;
  }
  get bytes(): number {
    return this.pages.length * SIZE * SIZE * 4;
  }
  get pageCount(): number {
    return this.pages.length;
  }
  get diagnostics() {
    return {
      ...this.client.stats,
      mode: 'msdf',
      glyphCount: this.glyphs.size,
      frameGlyphs: this.frameGlyphs,
      shapeCacheGlyphs: this.shapedGlyphs,
      glyphsReceived: this.generated,
      multichannelPixels: this.channelPixels,
      missingGlyphs: this.missing,
    };
  }
  begin(): void {
    this.reserved.clear();
    this.pinned.clear();
    this.missing = 0;
    this.frameGlyphs = 0;
  }
  async prepare(requests: readonly LabelTextRequest[], signal: AbortSignal): Promise<void> {
    const pending = new Map<string, ShapeRequest>();
    for (const r of requests) {
      const k = key(r.text, r.options);
      if (!this.shapes.has(k)) pending.set(k, { key: k, text: r.text, font: selection(r.options) });
    }
    const input = [...pending.values()];
    for (let i = 0; i < input.length; i += 128) {
      const shaped = await this.client.shape(input.slice(i, i + 128), signal);
      signal.throwIfAborted();
      for (const shape of shaped) {
        this.shapedGlyphs += shape.glyphs.length;
        this.shapes.set(shape.key, shape);
      }
    }
    // Accepted labels stay pinned while later candidate batches are shaped.
    const current = new Set(requests.map((r) => key(r.text, r.options)));
    for (const [k, shape] of this.shapes) {
      if (this.shapes.size <= 4096 && this.shapedGlyphs <= 131072) break;
      if (!this.reserved.has(k) && !current.has(k)) {
        this.shapes.delete(k);
        this.shapedGlyphs -= shape.glyphs.length;
      }
    }
  }
  reserve(text: string, options: LabelOptions): boolean {
    const k = key(text, options),
      shape = this.shapes.get(k);
    if (!shape || this.frameGlyphs + shape.glyphs.length > 65536) return false;
    this.frameGlyphs += shape.glyphs.length;
    this.reserved.add(k);
    return true;
  }
  private metrics(text: string, options: LabelOptions) {
    const shape = this.shapes.get(key(text, options));
    if (!shape || !shape.glyphs.length) return null;
    const size = options.fontSize ?? 14,
      padding = (options.haloWidth ?? 1.5) + 2;
    const shear = options.fontStyle === 'italic' && !options.fontUrl ? 0.2 : 0;
    const slack = Math.max(Math.abs(shape.top), Math.abs(shape.bottom)) * shear;
    const left = shape.left - slack,
      right = shape.right + slack;
    return {
      shape,
      size,
      padding,
      shear,
      width: (right - left) * size + 2 * padding,
      height: (shape.bottom - shape.top) * size + 2 * padding,
      left,
    };
  }
  measure(
    text: string,
    options: LabelOptions,
    _dpr: number,
  ): { width: number; height: number } | null {
    return this.metrics(text, options);
  }
  async prepareGlyphs(requests: readonly LabelTextRequest[], signal: AbortSignal): Promise<void> {
    const needed = new Map<string, GlyphRequest>();
    for (const r of requests) {
      const m = this.metrics(r.text, r.options);
      if (!m) continue;
      this.missing += m.shape.missing;
      for (const g of m.shape.glyphs) {
        const request = glyphRequest(g.font, g.id, r.options);
        needed.set(request.key, request);
        const old = this.glyphs.get(request.key);
        if (old) this.pinned.add(old.page);
      }
    }
    const input = [...needed.values()]
      .filter((r) => !this.glyphs.has(r.key))
      .sort((a, b) => a.font.localeCompare(b.font) || a.range - b.range || a.id - b.id);
    for (let i = 0; i < input.length; i += 32) {
      const glyphs = await this.client.glyphs(input.slice(i, i + 32), signal);
      signal.throwIfAborted();
      this.generated += glyphs.length;
      for (const g of glyphs) {
        if (!this.install(g)) return;
      }
    }
  }
  private fits(p: Page, w: number, h: number): boolean {
    return p.x + w + 1 <= SIZE ? p.y + Math.max(p.row, h) + 1 <= SIZE : p.y + p.row + h + 2 <= SIZE;
  }
  private install(g: GeneratedGlyph): boolean {
    if (
      !Number.isInteger(g.width) ||
      !Number.isInteger(g.height) ||
      g.width < 1 ||
      g.height < 1 ||
      g.width > 512 ||
      g.height > 512 ||
      g.data.length !== g.width * g.height * 4
    )
      throw new Error('Invalid MSDF glyph payload.');
    let p = this.pages.find((p) => this.fits(p, g.width, g.height));
    if (!p && this.pages.length < MAX_PAGES) {
      p = {
        data: new Uint8Array(SIZE * SIZE * 4),
        width: SIZE,
        height: SIZE,
        version: 0,
        generation: 0,
        x: 1,
        y: 1,
        row: 0,
        used: 0,
        keys: new Set(),
      };
      this.pages.push(p);
    }
    if (!p) {
      p = this.pages.filter((p) => !this.pinned.has(p)).sort((a, b) => a.used - b.used)[0];
      if (!p) return false;
      for (const k of p.keys) this.glyphs.delete(k);
      p.keys.clear();
      p.generation = (p.generation ?? 0) + 1;
      p.data.fill(0);
      p.x = p.y = 1;
      p.row = 0;
      p.version++;
    }
    if (p.x + g.width + 1 > SIZE) {
      p.x = 1;
      p.y += p.row + 1;
      p.row = 0;
    }
    const rect: [number, number, number, number] = [p.x, p.y, g.width, g.height];
    for (let y = 0; y < g.height; y++)
      p.data.set(
        g.data.subarray(y * g.width * 4, (y + 1) * g.width * 4),
        ((p.y + y) * SIZE + p.x) * 4,
      );
    for (let i = 0; i < g.data.length; i += 4)
      if (g.data[i] !== g.data[i + 1] || g.data[i + 1] !== g.data[i + 2]) this.channelPixels++;
    const { data: _, ...metadata } = g;
    this.glyphs.set(g.key, { ...metadata, page: p, rect });
    p.x += g.width + 1;
    p.row = Math.max(p.row, g.height);
    p.version++;
    p.used = ++this.clock;
    p.keys.add(g.key);
    this.pinned.add(p);
    return true;
  }
  private color(value: string): [number, number, number, number] {
    const old = this.colors.get(value);
    if (old) return old;
    const c = this.sample;
    c.clearRect(0, 0, 1, 1);
    c.fillStyle = '#243447';
    c.fillStyle = value;
    c.fillRect(0, 0, 1, 1);
    const d = c.getImageData(0, 0, 1, 1).data,
      result: [number, number, number, number] = [d[0] / 255, d[1] / 255, d[2] / 255, d[3] / 255];
    if (this.colors.size > 256) this.colors.clear();
    this.colors.set(value, result);
    return result;
  }
  get(text: string, options: LabelOptions, _dpr: number): MsdfTextRaster | null {
    const m = this.metrics(text, options);
    if (!m) return null;
    const glyphs: MsdfGlyphQuad[] = [];
    for (const g of m.shape.glyphs) {
      const entry = this.glyphs.get(glyphRequest(g.font, g.id, options).key);
      if (!entry) return null;
      const [l, t, r, b] = entry.plane;
      const ox = (g.x - m.left) * m.size + m.padding - m.width / 2;
      const oy = (g.y - m.shape.top) * m.size + m.padding - m.height / 2;
      glyphs.push({
        page: entry.page,
        generation: entry.page.generation ?? 0,
        rect: entry.rect,
        plane: [
          ox + ((l + r) * m.size) / 2 - (m.shear * (t + b) * m.size) / 2,
          oy + ((t + b) * m.size) / 2,
          (r - l) * m.size,
          (b - t) * m.size,
        ],
        rangeCss: (entry.range / entry.emPixels) * m.size,
        path: entry.path,
        pathScale: m.size / entry.upem,
        origin: [ox, oy],
      });
      entry.page.used = ++this.clock;
    }
    return {
      mode: 'msdf',
      width: m.width,
      height: m.height,
      glyphs,
      color: this.color(options.color ?? '#243447'),
      haloColor: this.color(options.haloColor ?? '#ffffff'),
      haloWidth: options.haloWidth ?? 1.5,
      shear: m.shear,
    };
  }
  clear(): void {
    this.client.clear();
    this.shapes.clear();
    this.reserved.clear();
    this.glyphs.clear();
    this.pinned.clear();
    this.pages = [];
    this.missing = 0;
    this.frameGlyphs = 0;
    this.shapedGlyphs = 0;
  }
  dispose(): void {
    this.clear();
    this.colors.clear();
    this.sample.canvas.width = this.sample.canvas.height = 0;
  }
}
