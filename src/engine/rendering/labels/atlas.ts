import type { LabelOptions } from '../../map/label';

export interface LabelAtlasPage {
  readonly canvas: HTMLCanvasElement;
  version: number;
  used: number;
  x: number;
  y: number;
  rowHeight: number;
  keys: Set<string>;
}
export interface LabelRaster {
  readonly page: LabelAtlasPage;
  /** Pixel rectangle within the atlas. */
  readonly rect: readonly [number, number, number, number];
  readonly width: number;
  readonly height: number;
}
const SIZE = 1024,
  MAX_PAGES = 4;

/** Bounded atlas of shaped text runs. Canvas is used only on cache misses to rasterize
 * fonts, not to draw the GPU map. Whole runs retain kerning, ligatures and CJK fallback. */
export class LabelAtlas {
  private entries = new Map<string, LabelRaster>();
  private pages: LabelAtlasPage[] = [];
  private pinned = new Set<LabelAtlasPage>();
  private clock = 0;
  private scratch: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  constructor(private readonly document: Document) {
    this.scratch = document.createElement('canvas');
    this.scratch.width = this.scratch.height = 1;
    const ctx = this.scratch.getContext('2d');
    if (!ctx) throw new Error('Text atlas needs a browser font rasterizer.');
    this.ctx = ctx;
  }
  get bytes(): number {
    return this.pages.length * SIZE * SIZE * 4;
  }
  get pageCount(): number {
    return this.pages.length;
  }
  begin(): void {
    this.pinned.clear();
  }
  get(text: string, options: LabelOptions, pixelRatio: number): LabelRaster | null {
    const key = JSON.stringify([
      text,
      options.fontStyle ?? 'normal',
      options.fontWeight ?? 'normal',
      options.fontSize ?? 14,
      options.fontFamily ?? 'sans-serif',
      options.haloWidth ?? 1.5,
      options.color ?? '#243447',
      options.haloColor ?? '#ffffff',
      Math.min(3, Math.max(1, pixelRatio)),
    ]);
    const cached = this.entries.get(key);
    if (cached) {
      cached.page.used = ++this.clock;
      this.pinned.add(cached.page);
      return cached;
    }
    const measured = this.measure(text, options, pixelRatio);
    if (!measured) return null;
    const {
      ratio,
      font,
      halo,
      lines,
      left,
      ascent,
      lineHeight,
      padding,
      pixelWidth: w,
      pixelHeight: h,
    } = measured;
    let page = this.pages.find((p) => this.fits(p, w, h));
    if (!page && this.pages.length < MAX_PAGES) {
      const canvas = this.document.createElement('canvas');
      canvas.width = canvas.height = SIZE;
      page = { canvas, version: 0, used: 0, x: 1, y: 1, rowHeight: 0, keys: new Set() };
      this.pages.push(page);
    }
    if (!page) {
      page = this.pages.filter((p) => !this.pinned.has(p)).sort((a, b) => a.used - b.used)[0];
      if (!page) return null; // Never overwrite a page already referenced by this layout.
      for (const k of page.keys) this.entries.delete(k);
      // A displayed/navigation frame may still own the old pixels.
      const canvas = this.document.createElement('canvas');
      canvas.width = canvas.height = SIZE;
      const replacement = {
        canvas,
        version: 0,
        used: 0,
        x: 1,
        y: 1,
        rowHeight: 0,
        keys: new Set<string>(),
      };
      this.pages[this.pages.indexOf(page)] = replacement;
      page = replacement;
    }
    if (page.x + w + 1 > SIZE) {
      page.x = 1;
      page.y += page.rowHeight + 1;
      page.rowHeight = 0;
    }
    const x = page.x,
      y = page.y,
      target = page.canvas.getContext('2d')!;
    target.save();
    target.translate(x, y);
    target.scale(ratio, ratio);
    target.font = font;
    target.textAlign = 'left';
    target.textBaseline = 'alphabetic';
    target.lineJoin = 'round';
    target.fillStyle = options.color ?? '#243447';
    target.strokeStyle = options.haloColor ?? '#ffffff';
    target.lineWidth = halo * 2;
    for (let i = 0; i < lines.length; i++) {
      const baseline = padding + ascent + lineHeight * i;
      if (halo > 0) target.strokeText(lines[i], padding + left, baseline);
      target.fillText(lines[i], padding + left, baseline);
    }
    target.restore();
    page.x += w + 1;
    page.rowHeight = Math.max(page.rowHeight, h);
    page.version++;
    page.used = ++this.clock;
    page.keys.add(key);
    this.pinned.add(page);
    const result: LabelRaster = { page, rect: [x, y, w, h], width: w / ratio, height: h / ratio };
    this.entries.set(key, result);
    return result;
  }
  measure(text: string, options: LabelOptions, pixelRatio: number) {
    const size = options.fontSize ?? 14,
      halo = options.haloWidth ?? 1.5;
    const ratio = Math.min(3, Math.max(1, pixelRatio));
    const font = `${options.fontStyle ?? 'normal'} ${options.fontWeight ?? 'normal'} ${size}px ${options.fontFamily ?? 'sans-serif'}`;
    const lines = text.split('\n');
    if (lines.length > 4) return null;
    const ctx = this.ctx;
    ctx.font = font;
    const metrics = lines.map((line) => ctx.measureText(line));
    const left = Math.max(0, ...metrics.map((m) => m.actualBoundingBoxLeft || 0));
    const contentWidth =
      Math.max(1, ...metrics.map((m) => Math.max(m.width, m.actualBoundingBoxRight || 0))) + left;
    const ascent = Math.max(size * 0.8, ...metrics.map((m) => m.actualBoundingBoxAscent || 0));
    const descent = Math.max(size * 0.2, ...metrics.map((m) => m.actualBoundingBoxDescent || 0));
    const lineHeight = size * 1.25,
      padding = halo + 2;
    const pixelWidth = Math.ceil((contentWidth + padding * 2) * ratio);
    const pixelHeight = Math.ceil(
      (ascent + descent + lineHeight * (lines.length - 1) + padding * 2) * ratio,
    );
    if (pixelWidth > SIZE - 2 || pixelHeight > SIZE - 2) return null;
    return {
      font,
      ratio,
      halo,
      lines,
      left,
      ascent,
      lineHeight,
      padding,
      pixelWidth,
      pixelHeight,
      width: pixelWidth / ratio,
      height: pixelHeight / ratio,
    };
  }
  private fits(p: LabelAtlasPage, w: number, h: number): boolean {
    return p.x + w + 1 <= SIZE
      ? p.y + Math.max(p.rowHeight, h) + 1 <= SIZE
      : p.y + p.rowHeight + h + 2 <= SIZE;
  }
  clear(): void {
    this.entries.clear();
    this.pinned.clear();
    for (const p of this.pages) p.canvas.width = p.canvas.height = 0;
    this.pages = [];
  }
  dispose(): void {
    this.clear();
    this.scratch.width = this.scratch.height = 0;
  }
}
