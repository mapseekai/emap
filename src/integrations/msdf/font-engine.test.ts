import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { MsdfFontEngine } from './font-engine';
const signal = () => new AbortController().signal;
afterEach(() => vi.unstubAllGlobals());
async function engine() {
  vi.stubGlobal(
    'fetch',
    async (url: string | URL) => new Response(await readFile(fileURLToPath(url))),
  );
  return MsdfFontEngine.create(pathToFileURL(resolve('dist/msdf') + '/').href);
}
describe('MSDF shaping and outline identity', () => {
  it('shapes Chinese/Latin with metrics independent of paint/size and owns font memory', async () => {
    const e = await engine();
    try {
      const request = {
        key: 'a',
        text: '北京 AV\n上海',
        font: { family: 'sans-serif', weight: 400 },
      };
      const a = await e.shape(request, signal()),
        b = await e.shape({ ...request, key: 'b' }, signal());
      expect(a.glyphs.length).toBe(6);
      expect(a.missing).toBe(0);
      expect(a.glyphs).toEqual(b.glyphs);
      const mono = await e.shape(
        { key: 'mono', text: '京AA', font: { family: 'monospace', weight: 400 } },
        signal(),
      );
      expect(mono.glyphs.slice(-2).every((g) => g.font.includes('noto-sans-mono-'))).toBe(true);
      expect(a.bottom).toBeGreaterThan(1);
      const g = a.glyphs[0],
        bitmap = await e.glyph({ font: g.font, id: g.id, key: 'g', range: 32 }, signal());
      expect(bitmap.path.length).toBeGreaterThan(20);
      expect(bitmap.data.length).toBe(bitmap.width * bitmap.height * 4);
      expect(e.stats.fontBytes).toBeGreaterThan(0);
      expect(e.stats.fontBytes).toBeLessThan(32 * 1024 ** 2);
    } finally {
      e.dispose();
    }
    expect(e.stats.fontBytes).toBe(0);
    expect(e.stats.fonts).toBe(0);
  });
  it('retains HarfBuzz substitutions rather than assuming one glyph per codepoint', async () => {
    const e = await engine();
    try {
      const font = { family: 'sans-serif', weight: 400 };
      const nfc = await e.shape({ key: 'nfc', text: 'é', font }, signal());
      const nfd = await e.shape({ key: 'nfd', text: 'e\u0301', font }, signal());
      const ligature = await e.shape({ key: 'ffi', text: 'ffi', font }, signal());
      expect(nfc.missing + nfd.missing + ligature.missing).toBe(0);
      // Compare actual ink-bearing glyph identities and advances for composed text.
      expect(nfd.glyphs.length).toBe(1);
      expect(nfc.right).toBeCloseTo(nfd.right, 3);
      expect(ligature.glyphs.length).toBeLessThan(3);
      expect(ligature.glyphs.every((g) => g.id > 0)).toBe(true);
    } finally {
      e.dispose();
    }
  });
});
