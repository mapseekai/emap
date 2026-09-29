import { serve, browserHost, output } from '@mapseekai/tasklane/host';
import { MsdfFontEngine } from './font-engine';
import type { ShapeRequest, GlyphRequest, ShapedText, GeneratedGlyph } from './protocol';
serve(browserHost(self as unknown as Parameters<typeof browserHost>[0]), {
  msdf: async (payload, ctx) => {
    const data = payload as { type: 'shape' | 'glyphs'; requests: ShapeRequest[] | GlyphRequest[] };
    if (!Array.isArray(data.requests) || data.requests.length > 512)
      throw new Error('MSDF request batch exceeds limit.');
    let instance = ctx.cache.get<MsdfFontEngine>('engine');
    if (!instance) {
      instance = await MsdfFontEngine.create(new URL('msdf/', self.location.href).href);
      try {
        ctx.cache.setResource('engine', instance, 256 * 1024 ** 2, (engine) => engine.dispose());
      } catch (error) {
        instance.dispose();
        throw error;
      }
    }
    const result: Array<ShapedText | GeneratedGlyph> = [];
    for (let i = 0; i < data.requests.length; i++) {
      ctx.signal.throwIfAborted();
      result.push(
        data.type === 'shape'
          ? await instance.shape(data.requests[i] as ShapeRequest, ctx.signal)
          : await instance.glyph(data.requests[i] as GlyphRequest, ctx.signal),
      );
      if (i % 8 === 0) await ctx.checkpoint();
    }
    ctx.signal.throwIfAborted();
    return output(
      { result, stats: instance.stats },
      data.type === 'glyphs'
        ? (result as GeneratedGlyph[]).map((g) => g.data.buffer as ArrayBuffer)
        : [],
    );
  },
});
