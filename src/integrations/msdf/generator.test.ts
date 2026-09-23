import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { MsdfGenerator } from './generator';
import { decodeFont } from './woff';
import createHarfBuzz from 'harfbuzzjs/hb.js';
import bindHarfBuzz from 'harfbuzzjs/hbjs.js';

const binary = async (path: string) => {
  const b = await readFile(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
describe('upstream MSDF glyph generation', () => {
  it('generates distinct linear RGB distances from shaped outline IDs, not replicated SDF or RGBA text', async () => {
    const bytes = decodeFont(
      new Uint8Array(
        await binary(
          'node_modules/@fontsource/noto-sans-sc/files/noto-sans-sc-latin-400-normal.woff',
        ),
      ),
    );
    const hb = bindHarfBuzz(
      await createHarfBuzz({ wasmBinary: await binary('node_modules/harfbuzzjs/hb.wasm') }),
    );
    const blob = hb.createBlob(bytes.buffer as ArrayBuffer),
      face = hb.createFace(blob, 0),
      font = hb.createFont(face),
      buffer = hb.createBuffer();
    const generator = await MsdfGenerator.create(
      await binary('node_modules/msdfgen-wasm/wasm/msdfgen.wasm'),
    );
    try {
      font.setScale(face.upem, face.upem);
      buffer.addText('AV');
      buffer.guessSegmentProperties();
      hb.shape(font, buffer);
      const glyphs = buffer.json();
      generator.loadFont('latin', bytes);
      const a = generator.generate(
        { font: 'latin', id: glyphs[0].g, key: 'a', range: 16 },
        font.glyphToPath(glyphs[0].g),
        face.upem,
      );
      const b = generator.generate(
        { font: 'latin', id: glyphs[1].g, key: 'b', range: 16 },
        font.glyphToPath(glyphs[1].g),
        face.upem,
      );
      let differing = 0,
        inside = 0,
        outside = 0;
      for (let i = 0; i < a.data.length; i += 4) {
        const channels = [a.data[i], a.data[i + 1], a.data[i + 2]].sort((a, b) => a - b);
        if (channels[0] !== channels[2]) differing++;
        if (channels[1] > 128) inside++;
        if (channels[1] < 64) outside++;
        expect(a.data[i + 3]).toBe(255);
      }
      expect(differing).toBeGreaterThan(50);
      expect(inside).toBeGreaterThan(20);
      expect(outside).toBeGreaterThan(20);
      expect(a.emPixels).toBe(48);
      expect(a.range).toBe(16);
      expect(a.data).not.toEqual(b.data);
      expect(a.plane[0]).toBeLessThan(0);
      expect(a.plane[1]).toBeLessThan(0);
      expect(a.path).toMatch(/^M/);
      expect(
        generator.generate(
          { font: 'latin', id: glyphs[0].g, key: 'a', range: 16 },
          a.path,
          face.upem,
        ).data,
      ).toEqual(a.data);
    } finally {
      generator.dispose();
      buffer.destroy();
      font.destroy();
      face.destroy();
      blob.destroy();
    }
  });
});
